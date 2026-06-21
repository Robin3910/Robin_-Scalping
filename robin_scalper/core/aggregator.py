"""
环形 K 线缓存 + 按周期的多周期聚合。
设计目标：
  1. WebSocket 进来的是逐笔成交，实时聚合成 M1 K 线
  2. 由 M1 二次聚合成 5m/15m/1h/4h... 等任意周期（与 MQ5 PERIOD_ 对齐）
  3. 提供最近 N 根 K 线的访问接口，供指标模块使用
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, Deque, List, Optional
import time


# Binance K 线粒度（与 ccxt/binance 兼容）
BINANCE_TIMEFRAMES = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600,
    "8h": 28800, "12h": 43200, "1d": 86400, "3d": 259200,
    "1w": 604800, "1M": 2592000,
}


@dataclass
class Candle:
    timestamp: int     # ms，K 线起点
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    is_closed: bool = False

    def update_with_trade(self, price: float, qty: float, ts_ms: int) -> None:
        if self.open == 0:
            self.open = price
            self.high = price
            self.low = price
        else:
            if price > self.high:
                self.high = price
            if price > self.open:
                # 注意：只更新到当前 tick 之前没改过的
                pass
            if price < self.low:
                self.low = price
        self.close = price
        self.volume += qty
        self.timestamp = ts_ms  # 移动到最新 tick


class CandleAggregator:
    """
    1m 粒度是基础，再向上聚合更高周期。
    输入：逐笔 trade (price, qty, ts_ms)
    输出：last candle / 最近 N 根 close
    """
    def __init__(self, timeframes: List[str], maxlen: int = 500):
        self.maxlen = maxlen
        self.timeframes = list(timeframes)
        # 每个周期一根「正在形成」的 K 线
        self.current: Dict[str, Optional[Candle]] = {tf: None for tf in self.timeframes}
        # 每个周期一个 deque 历史
        self.history: Dict[str, Deque[Candle]] = {tf: deque(maxlen=maxlen) for tf in self.timeframes}

    def clear_all(self) -> None:
        """清空所有周期的历史和当前 K 线，切换交易对时调用"""
        self.current = {tf: None for tf in self.timeframes}
        for tf in self.timeframes:
            self.history[tf].clear()

    @staticmethod
    def _bucket_start(ts_ms: int, period_sec: int) -> int:
        sec = ts_ms // 1000
        bucket = (sec // period_sec) * period_sec
        return bucket * 1000

    def on_trade(self, price: float, qty: float, ts_ms: int) -> None:
        for tf in self.timeframes:
            period_sec = BINANCE_TIMEFRAMES[tf]
            bucket = self._bucket_start(ts_ms, period_sec)
            cur = self.current[tf]
            if cur is None or cur.timestamp != bucket:
                # 新 K 线：把上一根收线
                if cur is not None:
                    cur.is_closed = True
                    self.history[tf].append(cur)
                self.current[tf] = Candle(timestamp=bucket, open=price, high=price,
                                            low=price, close=price, volume=qty)
            else:
                # 在当前 K 线里更新
                if price > cur.high:
                    cur.high = price
                if price < cur.low:
                    cur.low = price
                cur.close = price
                cur.volume += qty

    def get_closes(self, tf: str, n: Optional[int] = None) -> List[float]:
        """最近 n 根（含当前未收线）的 close 序列"""
        if tf not in self.history:
            return []
        closes = [c.close for c in self.history[tf]]
        cur = self.current.get(tf)
        if cur is not None:
            closes = closes + [cur.close]
        if n is not None:
            closes = closes[-n:]
        return closes

    def get_ohlcv(self, tf: str, n: int) -> List[Candle]:
        """最近 n 根（含当前未收线）"""
        if tf not in self.history:
            return []
        all_c = list(self.history[tf])
        cur = self.current.get(tf)
        if cur is not None:
            all_c = all_c + [cur]
        return all_c[-n:]

    def get_candle(self, tf: str, shift: int = 0) -> Optional[Candle]:
        """shift=0 表示当前正在形成的 K 线；shift=1 表示上一根（已收线）"""
        if tf not in self.history:
            return None
        if shift == 0:
            return self.current.get(tf)
        # shift>=1 从 history 末尾往前数
        hist = list(self.history[tf])
        if len(hist) < shift:
            return None
        return hist[-shift]

    def get_open_close(self, tf: str, shift: int) -> tuple[Optional[float], Optional[float]]:
        c = self.get_candle(tf, shift)
        if c is None:
            return None, None
        return c.open, c.close

    def load_history(self, symbol: str, testnet: bool = True,
                     limit: int = 200, log_fn=None) -> None:
        """启动时从 Binance REST API 拉取历史 K 线填充 history。"""
        import requests
        rest = "https://testnet.binancefuture.com" if testnet else "https://fapi.binance.com"
        for tf in self.timeframes:
            try:
                params = {"symbol": symbol.upper(), "interval": tf, "limit": limit}
                r = requests.get(f"{rest}/fapi/v1/klines", params=params, timeout=15)
                r.raise_for_status()
                klines = r.json()
                for k in klines:
                    ts_ms = int(k[0])
                    candle = Candle(
                        timestamp=ts_ms,
                        open=float(k[1]),
                        high=float(k[2]),
                        low=float(k[3]),
                        close=float(k[4]),
                        volume=float(k[5]),
                        is_closed=True,
                    )
                    self.history[tf].append(candle)
                if log_fn:
                    log_fn(f"历史 K 线加载：{symbol} {tf} ×{len(klines)} 根")
            except Exception as e:
                if log_fn:
                    log_fn(f"历史 K 线加载失败：{tf} {e}")
