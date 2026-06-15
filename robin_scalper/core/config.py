"""
配置定义：参数命名尽量 1:1 对应 MQ5 里的 input，方便对照。
默认值与 Robin_震荡_v0.0.3.mq5 保持一致。
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any
import time


# === 与 MQ5 对齐的 HTF 周期枚举 ===
HTF_TIMEFRAMES = {
    "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h", "8h": "8h", "12h": "12h",
    "1d": "1d", "3d": "3d", "1w": "1w", "1M": "1M",
}

# 趋势判断方法
TREND_METHODS = ["price_vs_ma", "ma_crossover", "ma_adx", "macd"]


@dataclass
class Config:
    # ---- 账户/交易对 ----
    symbol: str = "BTCUSDT"
    leverage: int = 10
    margin_mode: str = "ISOLATED"  # ISOLATED | CROSSED
    testnet: bool = True            # 默认走测试网，避免误下单

    # ---- 魔术数字（用于订单 clientOrderId 标识） ----
    magic_number: int = 951221

    # ---- 交易方向 ----
    trade_buy: bool = True
    trade_sell: bool = True

    # ---- HTF 趋势过滤 ----
    enable_check_htf: bool = True
    htf_timeframe: str = "4h"
    trend_method: str = "price_vs_ma"  # 0/1/2/3
    htf_sensitivity: float = 5.0       # 1~10，1 最灵敏
    htf_ma_period2: int = 50
    htf_adx_period: int = 14
    htf_adx_threshold: float = 25.0
    htf_macd_fast: int = 12
    htf_macd_slow: int = 26
    htf_macd_signal: int = 9
    htf_use_closed_bar: bool = True

    # ---- RSI 入场 ----
    enable_check_rsi: bool = True
    rsi_period: int = 14
    open_factor: float = 6.0  # 1~10, 1 最灵敏

    # ---- 网格 ----
    grid_count: int = 8
    grid_spacing_pct: float = 0.15
    grid_lot_size: float = 0.01

    # ---- 止盈/止损 ----
    tp_percent: float = 0.8
    sl_percent: float = 0.7

    # ---- 最大亏损 ----
    use_max_loss: bool = False
    max_loss_usdt: float = 50.0
    wait_after_max_loss: bool = False
    max_loss_wait_minutes: int = 30

    # ---- 分批止盈 ----
    use_split_tp: bool = False
    tp_level1_pct: float = 0.3
    tp_level1_ratio: float = 0.33
    tp_level2_pct: float = 0.5
    tp_level2_ratio: float = 0.33
    tp_level3_pct: float = 0.6

    # ---- 保本损（必须先启用分批止盈才能生效） ----
    use_breakeven: bool = False
    breakeven_trigger: float = 0.3
    breakeven_offset: float = 0.0

    # ---- 每日开仓次数限制 ----
    enable_daily_open_limit: bool = False
    daily_max_opens: int = 3

    # ---- 平仓后等待 ----
    enable_wait_after_close: bool = False
    wait_minutes_after_close: int = 60

    # ---- 不做单时间段（本地时区） ----
    enable_trading_hours: bool = False
    no_trade_times: str = "00:00-02:00,05:00-08:00"

    # ---- 移动止盈（价格百分比） ----
    use_trailing_stop: bool = True
    trailing_start_pct: float = 0.8
    trailing_back_pct: float = 0.2

    # ---- 注释（订单 clientOrderId 前缀） ----
    comment_text: str = "Robin_ZhenDang"

    # ---- 引擎 ----
    paper_trading: bool = True  # 默认模拟盘
    log_buffer_size: int = 500

    # ---- Web ----
    password: str = ""          # 由 .env 注入或首次启动要求设置

    # ---- 元信息 ----
    last_modified: float = field(default_factory=lambda: time.time())

    # --- 派生 ---
    @property
    def htf_ma_period1(self) -> int:
        # 与 MQ5 完全一致: round(50 + (sensitivity - 1) * 161.111)
        return int(round(50.0 + (self.htf_sensitivity - 1.0) * 161.111))

    @property
    def rsi_overbought(self) -> float:
        return 20.0 + (self.open_factor - 1.0) * 6.6667

    @property
    def rsi_oversold(self) -> float:
        return 80.0 - (self.open_factor - 1.0) * 6.6667

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["htf_ma_period1"] = self.htf_ma_period1
        d["rsi_overbought"] = self.rsi_overbought
        d["rsi_oversold"] = self.rsi_oversold
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Config":
        # 过滤掉派生字段
        drop = {"htf_ma_period1", "rsi_overbought", "rsi_oversold"}
        kwargs = {k: v for k, v in d.items() if k in cls.__dataclass_fields__ and k not in drop}
        return cls(**kwargs)


def default_config() -> Config:
    return Config()
