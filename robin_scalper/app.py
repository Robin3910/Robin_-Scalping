"""
应用容器：把所有模块拼起来。
  - 维护单一 Config、Aggregator、Bus、Logger、State
  - 提供 start/stop 切换（用户面板「启动策略」开关）
  - 暴露 ws 推送 & REST 调用的入口
"""
from __future__ import annotations
import asyncio
import os
import time
import threading
from typing import Optional, Callable, Awaitable

from .core import Config, default_config, CandleAggregator, EngineState, EventBus, LogBuffer
from .core.config_store import load_config, save_config
from .core.indicators import ema, rsi, macd, adx
from .exchange.paper_broker import PaperBroker
from .exchange.binance_broker import BinanceBroker
from .exchange.base import BrokerBase
from .exchange.binance_ws import BinanceFeed
from .strategy.engine import StrategyEngine


class App:
    def __init__(self):
        # 配置
        self.cfg: Config = load_config()
        # 总线 & 日志
        self.bus = EventBus()
        self.log = LogBuffer(size=self.cfg.log_buffer_size)
        # 状态
        self.state = EngineState()
        self.state.paper_trading = self.cfg.paper_trading
        # 聚合器：1m 基础 + 一些常用大周期
        self.agg = CandleAggregator(
            timeframes=["1m", "3m", "5m", "15m", "1h", self.cfg.htf_timeframe, "1d"],
            maxlen=1000,
        )
        # 行情
        self.feed = BinanceFeed(self.bus, self.agg, self.log,
                                symbol=self.cfg.symbol, testnet=self.cfg.testnet)
        # 经纪商（默认 Paper，可热切换）
        self.broker: BrokerBase = PaperBroker(
            symbol=self.cfg.symbol, bus=self.bus, log=self.log,
            leverage=self.cfg.leverage, margin_mode=self.cfg.margin_mode,
        )
        # 策略引擎
        self.engine = StrategyEngine(self.cfg, self.agg, self.broker,
                                     self.state, self.log, self.bus)
        # 控制
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._tick_ts = 0.0

    # ====== 配置切换 ======
    def update_config(self, new_cfg: Config, persist: bool = True) -> None:
        self.cfg = new_cfg
        if persist:
            save_config(self.cfg)
        self.log.info(f"配置已更新：symbol={self.cfg.symbol} paper={self.cfg.paper_trading}")

    def reload_config(self) -> None:
        self.cfg = load_config()
        self.log.info("配置已从磁盘重新加载")

    # ====== 模式切换 ======
    def switch_to_live(self, api_key: str, api_secret: str) -> None:
        """切到真实盘：必须在停止状态下调用"""
        if self._running:
            self.log.warn("请先停止策略再切换交易模式")
            return
        self.broker = BinanceBroker(
            symbol=self.cfg.symbol, api_key=api_key, api_secret=api_secret,
            bus=self.bus, log=self.log, testnet=self.cfg.testnet,
            leverage=self.cfg.leverage, margin_mode=self.cfg.margin_mode,
        )
        self.engine.broker = self.broker
        self.state.paper_trading = False
        self.cfg.paper_trading = False
        self.log.info("已切换到真实交易模式（testnet={}）".format(self.cfg.testnet))

    def switch_to_paper(self) -> None:
        if self._running:
            self.log.warn("请先停止策略再切换交易模式")
            return
        self.broker = PaperBroker(
            symbol=self.cfg.symbol, bus=self.bus, log=self.log,
            leverage=self.cfg.leverage, margin_mode=self.cfg.margin_mode,
        )
        self.engine.broker = self.broker
        self.state.paper_trading = True
        self.cfg.paper_trading = True
        self.log.info("已切换到模拟盘")

    # ====== 启动 / 停止 ======
    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self.state.running = True
        self.log.info(f"启动策略：symbol={self.cfg.symbol} paper={self.cfg.paper_trading} testnet={self.cfg.testnet}")

        # 启动前先加载历史 K 线
        self.agg.load_history(
            symbol=self.cfg.symbol,
            testnet=self.cfg.testnet,
            limit=200,
            log_fn=self.log.info,
        )

        # 真实盘：设置杠杆
        if not self.cfg.paper_trading:
            try:
                await self.broker.set_leverage()
            except Exception as e:
                self.log.warn(f"set_leverage 失败: {e}")

        # 启动行情
        self.feed.start()

        # 订阅 tick 进入策略
        async def on_tick(env):
            d = env["data"]
            ts = d.get("ts", time.time())
            # 计算延迟：消息时间戳 vs 本地收到时间
            binance_ts = d.get("binance_ts", 0)
            if binance_ts > 0:
                self.state.ws_latency_ms = (ts - binance_ts) * 1000
            self._tick_ts = ts
            price = float(d["price"])
            bid = self.state.bid or price
            ask = self.state.ask or price
            await self.engine.on_tick(price, bid, ask)
        self.bus.subscribe("tick", on_tick)

        # 订阅 quote
        async def on_quote(env):
            d = env["data"]
            self.state.bid = float(d.get("bid", self.state.bid))
            self.state.ask = float(d.get("ask", self.state.ask))
        self.bus.subscribe("quote", on_quote)

    async def stop(self) -> None:
        self._running = False
        self.state.running = False
        self.feed.stop()
        self.log.info("策略已停止")

    # ====== 手动控制 ======
    async def manual_close_all(self) -> None:
        self.log.info("手动触发：全部平仓")
        if self.state.total_long_lots > 0:
            await self.engine._close_all_buy()
        if self.state.total_short_lots > 0:
            await self.engine._close_all_sell()

    async def manual_close_side(self, side: str) -> None:
        if side == "BUY":
            await self.engine._close_all_buy()
        else:
            await self.engine._close_all_sell()

    # ====== K 线数据 API ======
    def get_klines(self, tf: str = "1m", limit: int = 200) -> list:
        """获取 K 线数据用于图表展示"""
        candles = self.agg.get_ohlcv(tf, limit)
        result = []
        for c in candles:
            result.append({
                "time": int(c.timestamp / 1000),  # Unix timestamp (秒)
                "open": c.open,
                "high": c.high,
                "low": c.low,
                "close": c.close,
                "volume": c.volume,
            })
        return result

    # ====== 状态快照 ======
    def snapshot(self) -> dict:
        # 每次取时再算一些指标快照
        cur_rsi, prev_rsi = self.engine._rsi_values()
        if cur_rsi is not None:
            self.state.rsi = cur_rsi
        # HTF 趋势
        bull = self.engine._htf_trend_bullish()
        bear = self.engine._htf_trend_bearish()
        if bull: self.state.htf_trend = "多"
        elif bear: self.state.htf_trend = "空"
        else: self.state.htf_trend = "震荡"
        self.state.htf_price = self.engine._htf_close() or 0.0
        self.state.htf_ma1 = self.engine._htf_ma1() or 0.0
        self.state.htf_ma2 = self.engine._htf_ma2() or 0.0
        self.state.htf_adx = self.engine._htf_adx() or 0.0
        mv, sv = self.engine._htf_macd()
        self.state.htf_macd_main = mv or 0.0
        self.state.htf_macd_signal = sv or 0.0

        # K线数据（用于图表）
        klines = self.get_klines("1m", 200)

        return {
            "state": self.state.snapshot(),
            "config": self.cfg.to_dict(),
            "log": self.log.tail(100),
            "klines": klines,
            "klines_tf": "1m",
            "ts": time.time(),
        }


# 全局单例
app = App()
