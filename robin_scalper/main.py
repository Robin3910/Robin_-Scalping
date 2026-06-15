"""
启动入口：把 asyncio loop 跑在单独线程里（因为 flask-sock 在主线程跑 WS），
策略在 loop 线程里 await；HTTP / WS 路由通过 run_coroutine_threadsafe 与 loop 通信。
"""
from __future__ import annotations
import os
import sys
import time
import asyncio
import threading
from pathlib import Path

# 让 python 能从仓库根目录运行
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

# 兼容两种运行方式
from robin_scalper.app import app
from robin_scalper.core import Config
from robin_scalper.core.config_store import save_config
from robin_scalper.web.server import app_flask


def ensure_password():
    """首次启动要求 ROBIN_PASSWORD 已设置，否则提醒并使用默认（仅 dev）"""
    pwd = os.environ.get("ROBIN_PASSWORD", "").strip()
    if not pwd:
        # 也尝试从 .env 读
        env_path = ROOT / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("ROBIN_PASSWORD="):
                    pwd = line.split("=", 1)[1].strip().strip('"').strip("'")
                    os.environ["ROBIN_PASSWORD"] = pwd
                    break
    if not pwd:
        print("=" * 60)
        print("[警告] 未设置 ROBIN_PASSWORD，将使用默认密码 'change-me'。生产请改！")
        print("=" * 60)
        os.environ["ROBIN_PASSWORD"] = "change-me"
        pwd = "change-me"
    # 写入运行时配置
    if not app.cfg.password:
        app.cfg.password = pwd
        save_config(app.cfg)


def ensure_default_symbol():
    """如果 config.json 不存在，写一份默认的"""
    from robin_scalper.core.config_store import DEFAULT_PATH
    if not os.path.exists(DEFAULT_PATH):
        save_config(app.cfg)
        print(f"[init] 已写入默认配置：{DEFAULT_PATH}")


def loop_thread(loop: asyncio.AbstractEventLoop):
    asyncio.set_event_loop(loop)
    loop.run_forever()


def main():
    ensure_password()
    ensure_default_symbol()

    # 把 password / testnet / api key 同步到 cfg
    pwd = os.environ.get("ROBIN_PASSWORD", "")
    if pwd and not app.cfg.password:
        app.cfg.password = pwd
    app.cfg.testnet = os.environ.get("BINANCE_TESTNET", "true").lower() == "true"

    api_key = os.environ.get("BINANCE_API_KEY", "")
    api_sec = os.environ.get("BINANCE_API_SECRET", "")
    if api_key and api_sec and not app.cfg.paper_trading:
        app.switch_to_live(api_key, api_sec)

    # 起 asyncio loop
    loop = asyncio.new_event_loop()
    app._loop = loop
    app.bus.attach_loop(loop)
    t = threading.Thread(target=loop_thread, args=(loop,), daemon=True, name="async-loop")
    t.start()

    host = os.environ.get("WEB_HOST", "0.0.0.0")
    port = int(os.environ.get("WEB_PORT", "8765"))
    print(f"[start] Robin Scalper Web  http://{host}:{port}/")
    print(f"[start] 默认模式：{'模拟盘' if app.cfg.paper_trading else '真实盘'}")
    print(f"[start] 登录密码：{pwd}")
    try:
        app_flask.run(host=host, port=port, debug=False, threaded=True)
    finally:
        loop.call_soon_threadsafe(loop.stop)


if __name__ == "__main__":
    main()
