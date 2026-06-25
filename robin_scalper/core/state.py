"""
策略运行状态（实时状态，存于内存，JSON 序列化用于 Web 推送）。
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
import time


@dataclass
class GridLeg:
    index: int
    side: str          # "BUY" / "SELL"
    entry_price: float
    lot_size: float
    open_time: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SideState:
    active: bool = False
    avg_price: float = 0.0
    trail_level: float = 0.0
    sl_set: bool = False
    level1_done: bool = False
    level2_done: bool = False
    breakeven_triggered: bool = False
    grids: List[GridLeg] = field(default_factory=list)

    def reset(self) -> None:
        self.active = False
        self.avg_price = 0.0
        self.trail_level = 0.0
        self.sl_set = False
        self.level1_done = False
        self.level2_done = False
        self.breakeven_triggered = False
        self.grids = []


@dataclass
class EngineState:
    # 引擎
    running: bool = False
    paper_trading: bool = True
    last_tick_ts: float = 0.0
    last_eval_text: str = ""
    last_eval_time: float = 0.0
    # 价格
    bid: float = 0.0
    ask: float = 0.0
    last_price: float = 0.0
    # 指标
    rsi: float = 0.0
    htf_trend: str = ""  # "多" / "空" / "震荡" / ""
    htf_price: float = 0.0
    htf_ma1: float = 0.0
    htf_ma2: float = 0.0
    htf_adx: float = 0.0
    htf_macd_main: float = 0.0
    htf_macd_signal: float = 0.0
    # 风控
    daily_open_count: int = 0
    last_open_date: int = 0
    last_close_time: float = 0.0
    last_maxloss_time: float = 0.0
    # 状态
    buy: SideState = field(default_factory=SideState)
    sell: SideState = field(default_factory=SideState)
    # 风控触发
    in_no_trade_time: bool = False
    daily_limit_reached: bool = False
    wait_after_close: bool = False
    wait_after_maxloss: bool = False
    # 持仓汇总
    total_long_lots: float = 0.0
    total_short_lots: float = 0.0
    unrealized_pnl: float = 0.0
    # 错误
    last_error: str = ""
    # 延迟
    ws_latency_ms: float = 0.0  # 最后一次延迟（ms）

    def snapshot(self) -> dict:
        d = asdict(self)
        return d

    def reset_side(self, side: str) -> None:
        if side == "BUY":
            self.buy.reset()
        else:
            self.sell.reset()
