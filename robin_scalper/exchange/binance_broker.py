"""
Binance USDT 永续合约真实交易客户端（REST 同步，调用方自行包到线程池）。
签名使用 HMAC-SHA256。所有方法都是阻塞的；策略引擎中通过 run_in_executor 包装。
"""
from __future__ import annotations
import time
import hmac
import hashlib
from typing import List, Optional, Dict, Any
from urllib.parse import urlencode
import requests
from .base import BrokerBase, Order, Position
from ..core.logger import LogBuffer
from ..core.bus import EventBus


MAINNET_REST = "https://fapi.binance.com"
TESTNET_REST = "https://testnet.binancefuture.com"


def _base_url(testnet: bool) -> str:
    return TESTNET_REST if testnet else MAINNET_REST


def _sign(secret: str, params: dict) -> str:
    qs = urlencode(params, doseq=True)
    return hmac.new(secret.encode(), qs.encode(), hashlib.sha256).hexdigest()


class BinanceBroker(BrokerBase):
    def __init__(self, symbol: str, api_key: str, api_secret: str,
                 bus: EventBus, log: LogBuffer, testnet: bool = True,
                 leverage: int = 10, margin_mode: str = "ISOLATED"):
        super().__init__(symbol, leverage, margin_mode)
        self.api_key = api_key
        self.api_secret = api_secret
        self.testnet = testnet
        self.base = _base_url(testnet)
        self.session = requests.Session()
        self.session.headers.update({"X-MBX-APIKEY": self.api_key})
        self.bus = bus
        self.log = log
        self.last_px: float = 0.0
        bus.subscribe("tick", lambda env: self._update_px(env))

    def mode(self) -> str:
        return "LIVE"

    def _update_px(self, env: dict) -> None:
        self.last_px = float(env["data"]["price"])

    def _signed(self, params: dict) -> dict:
        params = dict(params)
        params["timestamp"] = int(time.time() * 1000)
        params["signature"] = _sign(self.api_secret, params)
        return params

    def _get(self, path: str, params: dict, signed: bool = False) -> Any:
        if signed:
            params = self._signed(params)
        r = self.session.get(f"{self.base}{path}", params=params, timeout=10)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, params: dict, signed: bool = True) -> Any:
        if signed:
            params = self._signed(params)
        r = self.session.post(f"{self.base}{path}", params=params, timeout=10)
        r.raise_for_status()
        return r.json()

    def _delete(self, path: str, params: dict, signed: bool = True) -> Any:
        if signed:
            params = self._signed(params)
        r = self.session.delete(f"{self.base}{path}", params=params, timeout=10)
        r.raise_for_status()
        return r.json()

    async def set_leverage(self) -> None:
        try:
            r = self._post("/fapi/v1/leverage",
                           {"symbol": self.symbol, "leverage": self.leverage})
            self.log.info(f"设置杠杆 {self.symbol}={self.leverage}: {r}")
        except Exception as e:
            self.log.warn(f"设置杠杆失败: {e}")
        # 保证金模式
        try:
            r = self._post("/fapi/v1/marginType",
                           {"symbol": self.symbol, "marginType": self.margin_mode})
            self.log.info(f"设置保证金模式 {self.margin_mode}: {r}")
        except Exception as e:
            # 已是目标模式时会报错，忽略
            self.log.info(f"marginType 提示: {e}")

    async def get_mark_price(self) -> float:
        d = self._get("/fapi/v1/premiumIndex", {"symbol": self.symbol}, signed=False)
        return float(d["markPrice"])

    async def open_market(self, side: str, qty: float) -> Order:
        # 真实下单：quantity 按 LOT_SIZE 量化
        params = {
            "symbol": self.symbol,
            "side": side,
            "type": "MARKET",
            "quantity": self._round_qty(qty),
        }
        try:
            r = self._post("/fapi/v1/order", params)
        except Exception as e:
            self.log.error(f"下单失败: {e}")
            return Order(id="", symbol=self.symbol, side=side,
                         position_side="LONG" if side == "BUY" else "SHORT",
                         type="MARKET", qty=qty, price=0, status="REJECTED")
        return Order(
            id=str(r.get("orderId", "")),
            symbol=self.symbol, side=side,
            position_side="LONG" if side == "BUY" else "SHORT",
            type="MARKET", qty=float(r.get("executedQty", qty)),
            price=float(r.get("avgPrice", self.last_px)),
            status=r.get("status", "FILLED"),
            client_id=r.get("clientOrderId", ""),
        )

    async def close_market(self, side: str, qty: Optional[float] = None) -> List[Order]:
        pos_side = "LONG" if side == "BUY" else "SHORT"
        # 查询当前持仓量
        positions = await self.get_positions()
        target = next((p for p in positions if p.side == pos_side), None)
        if target is None:
            return []
        close_qty = target.qty if qty is None else min(qty, target.qty)
        params = {
            "symbol": self.symbol,
            "side": "SELL" if side == "BUY" else "BUY",
            "type": "MARKET",
            "quantity": self._round_qty(close_qty),
            "reduceOnly": "true",
        }
        try:
            r = self._post("/fapi/v1/order", params)
        except Exception as e:
            self.log.error(f"平仓失败: {e}")
            return []
        return [Order(
            id=str(r.get("orderId", "")),
            symbol=self.symbol,
            side=params["side"],
            position_side=pos_side,
            type="MARKET",
            qty=float(r.get("executedQty", close_qty)),
            price=float(r.get("avgPrice", self.last_px)),
            status=r.get("status", "FILLED"),
            reduce_only=True,
            client_id=r.get("clientOrderId", ""),
        )]

    async def get_positions(self) -> List[Position]:
        try:
            arr = self._get("/fapi/v2/positionRisk", {"symbol": self.symbol}, signed=True)
        except Exception as e:
            self.log.warn(f"查询持仓失败: {e}")
            return []
        out: List[Position] = []
        for p in arr:
            qty = float(p.get("positionAmt", 0))
            if abs(qty) <= 0:
                continue
            out.append(Position(
                symbol=p["symbol"],
                side="LONG" if qty > 0 else "SHORT",
                qty=abs(qty),
                entry_price=float(p["entryPrice"]),
                unrealized_pnl=float(p["unRealizedProfit"]),
                leverage=int(float(p.get("leverage", self.leverage))),
                margin_type=p.get("marginType", self.margin_mode),
            ))
        return out

    def _round_qty(self, qty: float) -> float:
        # 保守：保留 3 位有效；实际应该读取 exchangeInfo.LOT_SIZE
        return float(f"{qty:.3f}")
