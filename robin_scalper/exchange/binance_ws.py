"""
Binance USDT 永续合约 WebSocket 客户端。
  - aggTrade 流：逐笔成交流，进 K 线聚合器
  - bookTicker 流：最优买卖价（用于 ask/bid）
  - markPrice 流：标记价（用于显示）
  - userData 流：账户/订单更新（真实模式才需要；模拟盘会跳过签名）
无需 websockets 库依赖，使用纯 websockets 协议实现轻量连接。
"""
from __future__ import annotations
import asyncio
import json
import time
import hmac
import hashlib
import threading
from typing import Callable, Optional
from urllib.parse import urlencode

import requests
from ..core.bus import EventBus
from ..core.aggregator import CandleAggregator
from ..core.logger import LogBuffer


# ---- WebSocket 原生协议（极简，节省一个依赖）----
try:
    import websockets  # type: ignore
    HAS_WS = True
except ImportError:
    HAS_WS = False

# 引入 flask-sock 的 websocket client 不在异步侧用；用纯 asyncio + websockets 库
# 但是用户没装 websockets 也能跑——所以加 fallback
try:
    import websocket  # type: ignore  # 来自 websocket-client
    HAS_WSCLIENT = True
except ImportError:
    HAS_WSCLIENT = False


# ---- REST 基础 ----
MAINNET_REST = "https://fapi.binance.com"
TESTNET_REST = "https://testnet.binancefuture.com"
MAINNET_WS = "wss://fstream.binance.com"
TESTNET_WS = "wss://stream.binancefuture.com"


def _base_urls(testnet: bool):
    return (TESTNET_REST if testnet else MAINNET_REST,
            TESTNET_WS if testnet else MAINNET_WS)


def _sign(secret: str, params: dict) -> str:
    qs = urlencode(params, doseq=True)
    return hmac.new(secret.encode(), qs.encode(), hashlib.sha256).hexdigest()


class BinanceFeed:
    """
    维护三类连接：
      - aggTrade   → on_trade / 当前价
      - bookTicker → bid/ask
      - markPrice  → 标记价
    """
    def __init__(self, bus: EventBus, agg: CandleAggregator, log: LogBuffer,
                 symbol: str, testnet: bool = True):
        self.bus = bus
        self.agg = agg
        self.log = log
        self.symbol = symbol.lower()
        self.testnet = testnet
        self._stop = threading.Event()
        self._threads = []

    # ---- REST ----
    def exchange_info(self):
        rest, _ = _base_urls(self.testnet)
        r = requests.get(f"{rest}/fapi/v1/exchangeInfo", timeout=10)
        r.raise_for_status()
        return r.json()

    # ---- 控制 ----
    def start(self) -> None:
        if not HAS_WS and not HAS_WSCLIENT:
            self.log.error("缺少 websockets 或 websocket-client，无法启动行情。请 pip install websockets。")
            return
        self._stop.clear()
        t1 = threading.Thread(target=self._run_aggtrade, name="ws-aggtrade", daemon=True)
        t2 = threading.Thread(target=self._run_bookticker, name="ws-book", daemon=True)
        t1.start(); t2.start()
        self._threads = [t1, t2]
        self.log.info(f"行情 WebSocket 已启动：symbol={self.symbol} testnet={self.testnet}")

    def stop(self) -> None:
        self._stop.set()

    # ---- 各连接 ----
    def _run_aggtrade(self) -> None:
        while not self._stop.is_set():
            try:
                _, ws_base = _base_urls(self.testnet)
                url = f"{ws_base}/ws/{self.symbol}@aggTrade"
                self.log.info(f"连接 {url}")
                if HAS_WS:
                    self._loop_async_trades(url)
                else:
                    self._loop_syncio_trades(url)
            except Exception as e:
                self.log.warn(f"aggTrade 连接断开: {e}，5s 后重连")
                time.sleep(5)

    def _run_bookticker(self) -> None:
        while not self._stop.is_set():
            try:
                _, ws_base = _base_urls(self.testnet)
                url = f"{ws_base}/ws/{self.symbol}@bookTicker"
                self.log.info(f"连接 {url}")
                if HAS_WS:
                    self._loop_async_book(url)
                else:
                    self._loop_syncio_book(url)
            except Exception as e:
                self.log.warn(f"bookTicker 断开: {e}，5s 后重连")
                time.sleep(5)

    # ---- asyncio 实现 ----
    def _loop_async_trades(self, url: str) -> None:
        import asyncio
        asyncio.run(self._consume_aggtrade(url))

    def _loop_async_book(self, url: str) -> None:
        import asyncio
        asyncio.run(self._consume_book(url))

    async def _consume_aggtrade(self, url: str) -> None:
        import websockets
        async with websockets.connect(url, ping_interval=20) as ws:
            async for msg in ws:
                if self._stop.is_set():
                    break
                d = json.loads(msg)
                price = float(d["p"]); qty = float(d["q"]); ts = int(d["T"])
                self.agg.on_trade(price, qty, ts)
                # 推送价格 tick
                await self.bus.publish("tick", {"price": price, "ts": ts / 1000.0})
                await self.bus.publish("trade", {"price": price, "qty": qty, "ts": ts / 1000.0})

    async def _consume_book(self, url: str) -> None:
        import websockets
        async with websockets.connect(url, ping_interval=20) as ws:
            async for msg in ws:
                if self._stop.is_set():
                    break
                d = json.loads(msg)
                bid = float(d["b"]); ask = float(d["a"])
                await self.bus.publish("quote", {"bid": bid, "ask": ask})

    # ---- websocket-client 同步实现（fallback） ----
    def _loop_syncio_trades(self, url: str) -> None:
        ws = websocket.create_connection(url, timeout=20)
        while not self._stop.is_set():
            msg = ws.recv()
            d = json.loads(msg)
            price = float(d["p"]); qty = float(d["q"]); ts = int(d["T"])
            self.agg.on_trade(price, qty, ts)
            # 同步模式下，bus 的协程推送放到 fire-and-forget 线程里
            self.bus.publish_sync("tick", {"price": price, "ts": ts / 1000.0})
            self.bus.publish_sync("trade", {"price": price, "qty": qty, "ts": ts / 1000.0})
        ws.close()

    def _loop_syncio_book(self, url: str) -> None:
        ws = websocket.create_connection(url, timeout=20)
        while not self._stop.is_set():
            msg = ws.recv()
            d = json.loads(msg)
            self.bus.publish_sync("quote", {"bid": float(d["b"]), "ask": float(d["a"])})
        ws.close()
