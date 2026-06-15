"""
模拟盘实现：内存里维护持仓和成交，吃最新行情价成交。
"""
from __future__ import annotations
import time
import uuid
import asyncio
from typing import Dict, List, Optional

from .base import BrokerBase, Order, Position
from ..core.logger import LogBuffer
from ..core.bus import EventBus


class PaperBroker(BrokerBase):
    def __init__(self, symbol: str, bus: EventBus, log: LogBuffer,
                 leverage: int = 10, margin_mode: str = "ISOLATED"):
        super().__init__(symbol, leverage, margin_mode)
        self.bus = bus
        self.log = log
        # 按 side 持仓
        self.positions: Dict[str, Position] = {}
        self.last_px: float = 0.0
        # 订阅 tick，更新价格
        bus.subscribe("tick", self._on_tick)

    def mode(self) -> str:
        return "PAPER"

    def _on_tick(self, env: dict) -> None:
        self.last_px = float(env["data"]["price"])
        for p in self.positions.values():
            if p.side == "LONG":
                p.unrealized_pnl = (self.last_px - p.entry_price) * p.qty
            else:
                p.unrealized_pnl = (p.entry_price - self.last_px) * p.qty

    async def set_leverage(self) -> None:
        return  # 模拟盘不需要

    async def get_mark_price(self) -> float:
        return self.last_px

    def _position_side(self, side: str) -> str:
        return "LONG" if side == "BUY" else "SHORT"

    async def open_market(self, side: str, qty: float) -> Order:
        # 模拟盘有 last_px=0 的可能，让策略重试
        if self.last_px <= 0:
            self.log.warn("模拟盘尚未收到行情价")
            return Order(id="", symbol=self.symbol, side=side,
                         position_side=self._position_side(side),
                         type="MARKET", qty=qty, price=0, status="REJECTED")
        pos_side = self._position_side(side)
        # 同一方向累加
        if pos_side in self.positions:
            p = self.positions[pos_side]
            new_qty = p.qty + qty
            p.entry_price = (p.entry_price * p.qty + self.last_px * qty) / new_qty
            p.qty = new_qty
        else:
            self.positions[pos_side] = Position(
                symbol=self.symbol, side=pos_side, qty=qty,
                entry_price=self.last_px, leverage=self.leverage,
                margin_type=self.margin_mode,
                client_id=f"sim-{uuid.uuid4().hex[:8]}",
            )
        order = Order(
            id=uuid.uuid4().hex,
            symbol=self.symbol, side=side, position_side=pos_side,
            type="MARKET", qty=qty, price=self.last_px, status="FILLED",
            client_id=self.positions[pos_side].client_id,
        )
        self.log.trade(f"[PAPER] OPEN {side} qty={qty} px={self.last_px} id={order.id}")
        return order

    async def close_market(self, side: str, qty: Optional[float] = None) -> List[Order]:
        pos_side = self._position_side(side)
        p = self.positions.get(pos_side)
        if p is None or p.qty <= 0:
            return []
        close_qty = p.qty if qty is None else min(qty, p.qty)
        price = self.last_px
        order = Order(
            id=uuid.uuid4().hex, symbol=self.symbol, side=side,
            position_side=pos_side, type="MARKET", qty=close_qty,
            price=price, status="FILLED", reduce_only=True,
        )
        p.qty -= close_qty
        if p.qty <= 1e-9:
            del self.positions[pos_side]
        self.log.trade(f"[PAPER] CLOSE {side} qty={close_qty} px={price} id={order.id}")
        return [order]

    async def get_positions(self) -> List[Position]:
        return [p for p in self.positions.values() if p.qty > 0]
