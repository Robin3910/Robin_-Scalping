"""
Flask Web 入口：
  - GET  /            登录页
  - POST /api/login
  - GET  /dashboard   主面板（HTML）
  - WS   /ws          实时推送（state / log / tick）
  - GET  /api/snapshot
  - POST /api/config  改参数
  - POST /api/control {action: start|stop|close_all|close_buy|close_sell|switch_paper|switch_live}
  - POST /api/credentials  设置 Binance API Key/Secret（仅内存）
"""
from __future__ import annotations
import asyncio
import os
import json
import time
import hmac
import hashlib
import secrets
from functools import wraps
from typing import Optional

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_sock import Sock

from ..app import app
from ..core import Config


app_flask = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "templates"),
    static_folder=os.path.join(os.path.dirname(__file__), "static"),
)
app_flask.secret_key = os.environ.get("ROBIN_SECRET", secrets.token_hex(16))
sock = Sock(app_flask)


# ===== 鉴权 =====
def _password() -> str:
    return app.cfg.password or os.environ.get("ROBIN_PASSWORD", "")


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not session.get("authed"):
            return jsonify({"ok": False, "error": "未登录"}), 401
        return fn(*a, **kw)
    return wrapper


# ===== 页面 =====
@app_flask.route("/")
def index():
    if session.get("authed"):
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app_flask.route("/login", methods=["POST"])
def do_login():
    pwd = (request.form.get("password") or request.json.get("password") if request.is_json else request.form.get("password")) or ""
    expected = _password()
    if not expected:
        return jsonify({"ok": False, "error": "未设置密码（请在 .env 配置 ROBIN_PASSWORD）"}), 400
    if not hmac.compare_digest(pwd.encode(), expected.encode()):
        return jsonify({"ok": False, "error": "密码错误"}), 401
    session["authed"] = True
    return jsonify({"ok": True})


@app_flask.route("/logout")
def do_logout():
    session.pop("authed", None)
    return redirect(url_for("index"))


@app_flask.route("/dashboard")
def dashboard():
    if not session.get("authed"):
        return redirect(url_for("index"))
    return render_template("dashboard.html")


# ===== REST =====
@app_flask.route("/api/snapshot", methods=["GET"])
@login_required
def api_snapshot():
    return jsonify(app.snapshot())


@app_flask.route("/api/klines", methods=["GET"])
@login_required
def api_klines():
    tf = request.args.get("tf", "1m")
    limit = request.args.get("limit", 200, type=int)
    klines = app.get_klines(tf, min(limit, 1000))
    return jsonify({"ok": True, "tf": tf, "klines": klines, "ts": time.time()})


@app_flask.route("/api/config", methods=["GET", "POST"])
@login_required
def api_config():
    if request.method == "GET":
        return jsonify(app.cfg.to_dict())
    data = request.get_json(force=True, silent=True) or {}
    # 运行中禁止修改参数
    if app._running:
        return jsonify({"ok": False, "error": "策略运行中，请先停止后再修改参数"}), 400
    data.pop("htf_ma_period1", None)
    data.pop("rsi_overbought", None)
    data.pop("rsi_oversold", None)
    # 取当前配置 + 补丁
    current = app.cfg.to_dict()
    current.update(data)
    new_cfg = Config.from_dict(current)
    # 一些基本校验
    if new_cfg.grid_lot_size <= 0:
        return jsonify({"ok": False, "error": "grid_lot_size 必须 > 0"}), 400
    if new_cfg.grid_count < 1 or new_cfg.grid_count > 50:
        return jsonify({"ok": False, "error": "grid_count 必须在 1~50"}), 400
    if new_cfg.htf_sensitivity < 1 or new_cfg.htf_sensitivity > 10:
        return jsonify({"ok": False, "error": "htf_sensitivity 必须在 1~10"}), 400
    if new_cfg.open_factor < 1 or new_cfg.open_factor > 10:
        return jsonify({"ok": False, "error": "open_factor 必须在 1~10"}), 400
    if new_cfg.sl_percent < new_cfg.grid_count / 2.0 * new_cfg.grid_spacing_pct - 1e-6:
        return jsonify({"ok": False,
                        "error": f"sl_percent({new_cfg.sl_percent}) 不能小于 "
                                 f"grid_count/2 * spacing({new_cfg.grid_count/2.0*new_cfg.grid_spacing_pct:.3f})"}), 400
    app.update_config(new_cfg)
    # 影响一些模块
    if app.agg is not None and new_cfg.htf_timeframe not in app.agg.timeframes:
        # 重设 aggregator
        from .core import CandleAggregator
        old = app.agg
        new = CandleAggregator(
            timeframes=["1m", "3m", "5m", "15m", "1h", new_cfg.htf_timeframe, "1d"],
            maxlen=1000,
        )
        # 历史保留 1m
        new.current = old.current
        new.history = old.history
        app.agg = new
        app.engine.agg = new
    return jsonify({"ok": True, "config": app.cfg.to_dict()})


@app_flask.route("/api/control", methods=["POST"])
@login_required
def api_control():
    data = request.get_json(force=True, silent=True) or {}
    action = data.get("action")
    loop = app._loop

    async def go():
        if action == "start":
            await app.start()
        elif action == "stop":
            await app.stop()
        elif action == "close_all":
            await app.manual_close_all()
        elif action == "close_buy":
            await app.manual_close_side("BUY")
        elif action == "close_sell":
            await app.manual_close_side("SELL")
        elif action == "switch_paper":
            app.switch_to_paper()
        elif action == "switch_live":
            key = data.get("api_key", "")
            sec = data.get("api_secret", "")
            if not key or not sec:
                return {"ok": False, "error": "缺少 api_key / api_secret"}
            app.switch_to_live(key, sec)
        else:
            return {"ok": False, "error": f"未知 action: {action}"}
        return {"ok": True}

    if loop is None or not loop.is_running():
        return jsonify({"ok": False, "error": "事件循环未启动"}), 500
    fut = asyncio.run_coroutine_threadsafe(go(), loop)
    try:
        result = fut.result(timeout=5)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify(result)


@app_flask.route("/api/credentials", methods=["POST"])
@login_required
def api_credentials():
    data = request.get_json(force=True, silent=True) or {}
    key = data.get("api_key", "")
    sec = data.get("api_secret", "")
    if key and sec:
        os.environ["BINANCE_API_KEY"] = key
        os.environ["BINANCE_API_SECRET"] = sec
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "key/secret 缺失"}), 400


# ===== WebSocket =====
@sock.route("/ws")
def ws_conn(ws):
    # 鉴权：要求 URL 带 token = session 校验（生产可改 JWT）
    token = request.args.get("token", "")
    if not session.get("authed"):
        try:
            ws.send(json.dumps({"topic": "error", "data": {"error": "未登录"}}))
        except Exception:
            return
        return
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)

    def push(env: dict):
        try:
            ws.send(json.dumps(env, ensure_ascii=False, default=str))
        except Exception:
            pass

    # 启动时一次快照
    push({"topic": "snapshot", "ts": time.time(), "data": app.snapshot()})

    # 订阅各 topic
    def on_state(env): push(env)
    def on_tick(env): push(env)
    def on_log(env): push(env)
    def on_kline(env): push(env)
    app.bus.subscribe("state", on_state)
    app.bus.subscribe("tick", on_tick)
    app.bus.subscribe("kline", on_kline)
    # 日志也通过：单独一个子通道
    last_log_idx = [0]

    import threading
    stop_flag = [False]
    def log_pusher():
        while not stop_flag[0]:
            try:
                logs = app.log.tail(20)
                push({"topic": "log", "ts": time.time(), "data": {"entries": logs}})
            except Exception:
                break
            time.sleep(1.0)
    t = threading.Thread(target=log_pusher, daemon=True)
    t.start()

    # K 线推送线程：定期推送当前 K 线状态
    def kline_pusher():
        last_tf = "1m"
        while not stop_flag[0]:
            try:
                klines = app.get_klines(last_tf, 100)
                push({"topic": "klines", "ts": time.time(), "data": {"tf": last_tf, "klines": klines}})
            except Exception:
                break
            time.sleep(2.0)  # 每2秒推送一次
    tk = threading.Thread(target=kline_pusher, daemon=True)
    tk.start()

    try:
        while True:
            msg = ws.receive(timeout=30)
            if msg is None:
                # ping
                try: ws.send(json.dumps({"topic": "ping", "ts": time.time()}))
                except Exception: break
                continue
            # 简单处理客户端消息：subscribe / unsubscribe
            try:
                cmd = json.loads(msg)
            except Exception:
                continue
            if cmd.get("type") == "snapshot":
                push({"topic": "snapshot", "ts": time.time(), "data": app.snapshot()})
    except Exception:
        pass
    finally:
        stop_flag[0] = True
        app.bus.unsubscribe("state", on_state)
        app.bus.unsubscribe("tick", on_tick)
        app.bus.unsubscribe("kline", on_kline)
