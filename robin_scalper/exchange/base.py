"""
交易接口抽象。模拟盘与真实盘都实现同一组方法。
"""
from __future__ import annotations
import time
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field


@dataclass
class Order:
    id: str                  # 模拟盘 = uuid；真实盘 = orderId 或 clientOrderId
    symbol: str
    side: str                # BUY / SELL
    position_side: str       # LONG / SHORT
    type: str                # MARKET / LIMIT
    qty: float
    price: float             # 成交均价
    reduce_only: bool = False
    client_id: str = ""
    ts: float = field(default_factory=time.time)
    status: str = "FILLED"   # FILLED / NEW / CANCELED / REJECTED


@dataclass
class Position:
    symbol: str
    side: str                # LONG / SHORT
    qty: float
    entry_price: float
    unrealized_pnl: float = 0.0
    leverage: int = 10
    margin_type: str = "ISOLATED"
    client_id: str = ""
    opened_at: float = field(default_factory=time.time)


class BrokerBase(ABC):
    def __init__(self, symbol: str, leverage: int = 10, margin_mode: str = "ISOLATED"):
        self.symbol = symbol
        self.leverage = leverage
        self.margin_mode = margin_mode

    @abstractmethod
    async def set_leverage(self) -> None: ...
    @abstractmethod
    async def get_mark_price(self) -> float: ...
    @abstractmethod
    async def open_market(self, side: str, qty: float) -> Order: ...
    @abstractmethod
    async def close_market(self, side: str, qty: Optional[float] = None) -> List[Order]: ...
    @abstractmethod
    async def get_positions(self) -> List[Position]: ...
    @abstractmethod
    def mode(self) -> str: ...  # "PAPER" / "LIVE"
