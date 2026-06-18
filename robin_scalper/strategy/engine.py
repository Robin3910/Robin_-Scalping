"""
把 Robin_震荡_v0.0.3.mq5 的核心逻辑移植到 Python。

对应 MQ5 函数：
  OnTick                    -> Engine.on_tick
  EvaluateEntryConditions   -> _evaluate_entry
  CheckTradingSignals       -> _check_signals
  IsInNoTradeTime           -> _in_no_trade_time
  StartBuyGrid / StartSellGrid -> _start_buy_grid / _start_sell_grid
  CheckBuyGrid / CheckSellGrid -> _check_buy_grid / _check_sell_grid
  CheckBuyTP_SL / CheckSellTP_SL -> _check_buy_tp_sl / _check_sell_tp_sl
  CloseAllBuy / CloseAllSell -> broker.close_market
  ClosePartialBuy / ClosePartialSell -> _close_partial
  SetBuyPositionsSL / SetSellPositionsSL -> 真实盘可调用 change_sl（这里我们用市价兜底，不再用交易所 SL）
"""
from __future__ import annotations
import asyncio
import time
from datetime import datetime
from typing import Optional, Tuple, List

from ..core.config import Config
from ..core.aggregator import CandleAggregator
from ..core.indicators import ema, rsi, macd, adx
from ..core.state import EngineState, SideState, GridLeg
from ..core.logger import LogBuffer
from ..core.bus import EventBus
from ..exchange.base import BrokerBase


# ---------- 工具 ----------
def _today_int() -> int:
    t = time.localtime()
    return t.tm_year * 10000 + t.tm_mon * 100 + t.tm_mday


def _parse_hhmm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def _in_no_trade_time(now: datetime, ranges: str) -> bool:
    if not ranges or not ranges.strip():
        return False
    cur = now.hour * 60 + now.min
    for chunk in ranges.replace("，", ",").split(","):
        chunk = chunk.strip()
        if not chunk or "-" not in chunk:
            continue
        s, e = chunk.split("-", 1)
        try:
            sm = _parse_hhmm(s.strip())
            em = _parse_hhmm(e.strip())
        except ValueError:
            continue
        if sm <= em:
            if sm <= cur < em:
                return True
        else:
            if cur >= sm or cur < em:
                return True
    return False


# ---------- 引擎 ----------
class StrategyEngine:
    def __init__(self, cfg: Config, agg: CandleAggregator, broker: BrokerBase,
                 state: EngineState, log: LogBuffer, bus: EventBus):
        self.cfg = cfg
        self.agg = agg
        self.broker = broker
        self.state = state
        self.log = log
        self.bus = bus
        self._executor = None  # 由外部注入（asyncio loop 所在线程的 executor）

        # 节流：上次执行 tick 的时间
        self._last_tick_run: float = 0.0
        self._tick_interval: float = 0.030   # 30ms
        # 定期状态日志
        self._last_status_log: float = 0.0
        self._status_log_interval: float = 10.0  # 10s
        # 评估日志节流：记录上次打印详细评估的时间
        self._last_eval_log: float = 0.0
        self._eval_log_interval: float = 5.0  # 评估详细日志 5s 一次
        self._last_eval_result: dict = {}  # 记忆上次结果，用于检测变化

    def bind_executor(self, executor):
        self._executor = executor

    # -------- 入口 --------
    async def on_tick(self, price: float, bid: float, ask: float) -> None:
        now = time.time()

        # 节流：30ms 才执行一次
        if now - self._last_tick_run < self._tick_interval:
            return
        self._last_tick_run = now

        # 0) 更新行情
        self.state.last_price = price
        self.state.bid = bid
        self.state.ask = ask
        self.state.last_tick_ts = now

        # 1) 兜底：无仓位但状态未归零 → 重置
        await self._fallback_reset()

        # 2) 主体流程
        await self._check_signals()
        await self._check_grid_trading(price, bid, ask)
        await self._check_tp_sl(price, bid, ask)

        # 3) 推一次状态给前端
        await self.bus.publish("state", self.state.snapshot())

        # 4) 定期日志：每 10s 打印一次完整状态
        if now - self._last_status_log >= self._status_log_interval:
            self._last_status_log = now
            self._log_status(price)

    def _log_status(self, price: float) -> None:
        cfg = self.cfg
        cur_rsi, prev_rsi = self._rsi_values()
        bull = self._htf_trend_bullish()
        bear = self._htf_trend_bearish()
        ma1 = self._htf_ma1()
        ma2 = self._htf_ma2()
        adx_v = self._htf_adx()
        htf_close = self._htf_close()
        mv, sv = self._htf_macd()

        def t(b):
            if b is None: return "?"
            return "YES" if b else "NO"

        self.log.info(
            f"[状态] price={price} | "
            f"RSI={f'{cur_rsi:.1f}' if cur_rsi else '?'}(prev={f'{prev_rsi:.1f}' if prev_rsi else '?'}) | "
            f"HTF_close={f'{htf_close:.4f}' if htf_close else '?'} | "
            f"MA1={f'{ma1:.4f}' if ma1 else '?'} MA2={f'{ma2:.4f}' if ma2 else '?'} | "
            f"ADX={f'{adx_v:.2f}' if adx_v else '?'}(th={cfg.htf_adx_threshold}) | "
            f"MACD_main={f'{mv:.4f}' if mv else '?'} sig={f'{sv:.4f}' if sv else '?'} | "
            f"BULL={t(bull)} BEAR={t(bear)} | "
            f"LONG={self.state.total_long_lots} SHORT={self.state.total_short_lots} | "
            f"buy.active={self.state.buy.active} sell.active={self.state.sell.active} | "
            f"daily={self.state.daily_open_count}/{cfg.daily_max_opens if cfg.enable_daily_open_limit else 'N/A'} | "
            f"no_trade={self.state.in_no_trade_time} | "
            f"wait_close={self.state.wait_after_close} wait_loss={self.state.wait_after_maxloss} | "
            f"pnl={self.state.unrealized_pnl:.2f}"
        )
    async def _fallback_reset(self) -> None:
        # 模拟盘：用 broker.positions 兜底
        positions = await self.broker.get_positions()
        long_qty = sum(p.qty for p in positions if p.side == "LONG")
        short_qty = sum(p.qty for p in positions if p.side == "SHORT")
        self.state.total_long_lots = long_qty
        self.state.total_short_lots = short_qty
        self.state.unrealized_pnl = sum(p.unrealized_pnl for p in positions)

        any_active = (self.state.buy.active or self.state.sell.active
                      or self.state.buy.avg_price > 0 or self.state.sell.avg_price > 0)
        if long_qty <= 0 and short_qty <= 0 and any_active:
            self.log.warn("检测到无仓位但状态未归零，执行重置")
            self.state.buy.reset()
            self.state.sell.reset()
        elif long_qty > 0 and not self.state.buy.active:
            self.state.buy.active = True
        elif short_qty > 0 and not self.state.sell.active:
            self.state.sell.active = True

    # =============== 入场评估 ===============
    def _htf_close(self) -> Optional[float]:
        shift = 1 if self.cfg.htf_use_closed_bar else 0
        c = self.agg.get_candle(self.cfg.htf_timeframe, shift)
        return None if c is None else c.close

    def _htf_ma1(self) -> Optional[float]:
        shift = 1 if self.cfg.htf_use_closed_bar else 0
        closes = self.agg.get_closes(self.cfg.htf_timeframe)
        # 取到 shift 时刻为止的所有 close：拿当前正在形成的，再剔除 shift 之内
        # 简单做法：用 get_candle(shift) 的 close；MA1 重新算
        if len(closes) < max(self.cfg.htf_ma_period1, 5):
            return None
        # 取到 shift 索引为止
        target_idx = len(closes) - 1 - shift
        if target_idx < self.cfg.htf_ma_period1 - 1:
            return None
        arr = ema(closes[:target_idx + 1], self.cfg.htf_ma_period1)
        v = arr[-1]
        return None if v != v else v

    def _htf_ma2(self) -> Optional[float]:
        closes = self.agg.get_closes(self.cfg.htf_timeframe)
        if len(closes) < self.cfg.htf_ma_period2 + 1:
            return None
        target_idx = len(closes) - 1 - (1 if self.cfg.htf_use_closed_bar else 0)
        if target_idx < self.cfg.htf_ma_period2 - 1:
            return None
        arr = ema(closes[:target_idx + 1], self.cfg.htf_ma_period2)
        v = arr[-1]
        return None if v != v else v

    def _htf_adx(self) -> Optional[float]:
        ohlcv = self.agg.get_ohlcv(self.cfg.htf_timeframe, self.cfg.htf_adx_period * 3 + 5)
        if len(ohlcv) < self.cfg.htf_adx_period * 2 + 1:
            return None
        target_idx = len(ohlcv) - 1 - (1 if self.cfg.htf_use_closed_bar else 0)
        if target_idx < self.cfg.htf_adx_period * 2:
            return None
        highs = [c.high for c in ohlcv[:target_idx + 1]]
        lows = [c.low for c in ohlcv[:target_idx + 1]]
        closes = [c.close for c in ohlcv[:target_idx + 1]]
        v = adx(highs, lows, closes, self.cfg.htf_adx_period)[-1]
        return None if v != v else v

    def _htf_macd(self) -> Tuple[Optional[float], Optional[float]]:
        closes = self.agg.get_closes(self.cfg.htf_timeframe)
        if len(closes) < self.cfg.htf_macd_slow + self.cfg.htf_macd_signal + 5:
            return None, None
        target_idx = len(closes) - 1 - (1 if self.cfg.htf_use_closed_bar else 0)
        sub = closes[:target_idx + 1]
        m, s, _ = macd(sub, self.cfg.htf_macd_fast, self.cfg.htf_macd_slow, self.cfg.htf_macd_signal)
        mv, sv = m[-1], s[-1]
        if mv != mv: mv = None
        if sv != sv: sv = None
        return mv, sv

    def _htf_trend_bullish(self) -> Optional[bool]:
        close = self._htf_close()
        if close is None: return None
        method = self.cfg.trend_method
        if method == "price_vs_ma":
            ma1 = self._htf_ma1()
            if ma1 is None: return None
            return close > ma1
        if method == "ma_crossover":
            ma1 = self._htf_ma1(); ma2 = self._htf_ma2()
            if ma1 is None or ma2 is None: return None
            return ma1 > ma2
        if method == "ma_adx":
            ma1 = self._htf_ma1(); adx_v = self._htf_adx()
            if ma1 is None or adx_v is None: return None
            return (close > ma1) and (adx_v >= self.cfg.htf_adx_threshold)
        if method == "macd":
            mv, sv = self._htf_macd()
            if mv is None or sv is None: return None
            return mv > sv
        return None

    def _htf_trend_bearish(self) -> Optional[bool]:
        close = self._htf_close()
        if close is None: return None
        method = self.cfg.trend_method
        if method == "price_vs_ma":
            ma1 = self._htf_ma1()
            if ma1 is None: return None
            return close < ma1
        if method == "ma_crossover":
            ma1 = self._htf_ma1(); ma2 = self._htf_ma2()
            if ma1 is None or ma2 is None: return None
            return ma1 < ma2
        if method == "ma_adx":
            ma1 = self._htf_ma1(); adx_v = self._htf_adx()
            if ma1 is None or adx_v is None: return None
            return (close < ma1) and (adx_v >= self.cfg.htf_adx_threshold)
        if method == "macd":
            mv, sv = self._htf_macd()
            if mv is None or sv is None: return None
            return mv < sv
        return None

    def _rsi_values(self) -> Tuple[Optional[float], Optional[float]]:
        """返回 (current_rsi, prev_rsi)  ——  基于已收线的 1m K 线。
        与 MT5 iRSI(handle, 0, 0/1) 一致：MT5 shift=0 是「最近收线」那根。
        """
        # 取足够多的已收线 K 线
        n = self.cfg.rsi_period * 4 + 50
        ohlcv = self.agg.get_ohlcv("1m", n)
        if not ohlcv:
            return None, None
        # 排除正在形成的最后一根（它在 ohlcv 末尾）
        closed = ohlcv[:-1] if not ohlcv[-1].is_closed else ohlcv
        closes = [c.close for c in closed]
        if len(closes) < self.cfg.rsi_period + 2:
            return None, None
        arr = rsi(closes, self.cfg.rsi_period)
        cur = arr[-1]; prv = arr[-2]
        if cur != cur: cur = None
        if prv != prv: prv = None
        return cur, prv

    def _current_candle_for_signal(self) -> Tuple[Optional[float], Optional[float]]:
        """入场 K 线：对应 MQ5 iOpen/iClose(..., 0) —— 正在形成的那根。
        若尚未形成（aggregator 为空），回退到最近已收线那根。
        """
        cur = self.agg.get_candle("1m", 0)
        if cur is not None and cur.open > 0:
            return cur.open, cur.close
        # 回退
        prev = self.agg.get_candle("1m", 1)
        if prev is not None:
            return prev.open, prev.close
        return None, None

    async def _evaluate_entry(self, is_buy: bool) -> Tuple[bool, str]:
        """与 MQ5 EvaluateEntryConditions 一致：所有启用条件 AND。"""
        cfg = self.cfg
        cur_rsi, prev_rsi = self._rsi_values()
        cur_rsi = cur_rsi if cur_rsi is not None else 50.0
        prev_rsi = prev_rsi if prev_rsi is not None else 50.0
        side = "BUY" if is_buy else "SELL"
        all_pass = True
        lines = []

        def cond(name: str, ok: bool, detail: str):
            nonlocal all_pass
            if not ok:
                all_pass = False
            icon = "✓" if ok else "✗"
            lines.append(f"{icon}{name}: {detail}")

        # ① RSI 条件
        if cfg.enable_check_rsi:
            if is_buy:
                preroll = self.state.buy.rsi_preroll_triggered
                oversold_th = cfg.rsi_oversold
                if cur_rsi < oversold_th:
                    self.state.buy.rsi_preroll_triggered = True
                    cond("RSI", False,
                         f"cur={cur_rsi:.1f} < oversold={oversold_th} → 等待K线收阳")
                elif preroll:
                    o, c = self._current_candle_for_signal()
                    if o is not None and c is not None:
                        bull_bar = c > o
                        cond("RSI", bull_bar,
                             f"cur={cur_rsi:.1f} ≥ oversold={oversold_th}，pre_triggered=YES，"
                             f"K线 {'阳' if bull_bar else '阴'}(open={o} close={c})")
                    else:
                        cond("RSI", False, "cur≥oversold 但K线数据不足")
                else:
                    cond("RSI", False,
                         f"cur={cur_rsi:.1f} ≥ oversold={oversold_th}，pre_triggered=NO")
            else:
                preroll = self.state.sell.rsi_preroll_triggered
                overbought_th = cfg.rsi_overbought
                if cur_rsi > overbought_th:
                    self.state.sell.rsi_preroll_triggered = True
                    cond("RSI", False,
                         f"cur={cur_rsi:.1f} > overbought={overbought_th} → 等待K线收阴")
                elif preroll:
                    o, c = self._current_candle_for_signal()
                    if o is not None and c is not None:
                        bear_bar = c < o
                        cond("RSI", bear_bar,
                             f"cur={cur_rsi:.1f} ≤ overbought={overbought_th}，pre_triggered=YES，"
                             f"K线 {'阴' if bear_bar else '阳'}(open={o} close={c})")
                    else:
                        cond("RSI", False, "cur≤overbought 但K线数据不足")
                else:
                    cond("RSI", False,
                         f"cur={cur_rsi:.1f} ≤ overbought={overbought_th}，pre_triggered=NO")
        else:
            cond("RSI", True, "未启用")

        # ② HTF 趋势条件
        if cfg.enable_check_htf:
            trend_ok = False
            htf_close = self._htf_close()
            if is_buy:
                bull = self._htf_trend_bullish()
                if htf_close is None:
                    cond("HTF", False, "HTF K线数据不足，无法判断趋势")
                elif bull is None:
                    cond("HTF", False, f"close={htf_close}，指标数据不足")
                elif bull:
                    cond("HTF", True, f"BULL=True (close={htf_close} > MA1)")
                else:
                    cond("HTF", False, f"BULL=False (close={htf_close} ≤ MA1)")
            else:
                bear = self._htf_trend_bearish()
                if htf_close is None:
                    cond("HTF", False, "HTF K线数据不足")
                elif bear is None:
                    cond("HTF", False, f"close={htf_close}，指标数据不足")
                elif bear:
                    cond("HTF", True, f"BEAR=True (close={htf_close} < MA1)")
                else:
                    cond("HTF", False, f"BEAR=False (close={htf_close} ≥ MA1)")
        else:
            cond("HTF", True, "未启用")

        # ③ 全局过滤
        cond("日开仓限", not self.state.daily_limit_reached,
             f"{self.state.daily_open_count}/{cfg.daily_max_opens}" if cfg.enable_daily_open_limit else "未启用")
        cond("交易时段", not self.state.in_no_trade_time,
             f"当前在禁止时段" if self.state.in_no_trade_time else "允许交易")
        cond("平仓冷却", not self.state.wait_after_close,
             f"冷却中({(time.time()-self.state.last_close_time)/60:.1f}min)"
             if self.state.wait_after_close else "无冷却")
        cond("亏损冷却", not self.state.wait_after_maxloss,
             f"冷却中({(time.time()-self.state.last_maxloss_time)/60:.1f}min)"
             if self.state.wait_after_maxloss else "无冷却")
        cond("已有仓位", self.state.total_long_lots <= 0 and self.state.total_short_lots <= 0,
             f"long={self.state.total_long_lots} short={self.state.total_short_lots}")

        now = time.time()
        summary = f"{side} {"PASS" if all_pass else "FAIL"}"
        self.state.last_eval_text = summary
        self.state.last_eval_time = time.time()
        # 日志：只在变化时或超过 5s 才打印，避免刷屏
        result_key = (side, all_pass, tuple(lines))
        if now - self._last_eval_log >= self._eval_log_interval or result_key != self._last_eval_result.get(side):
            self._last_eval_log = now
            self._last_eval_result[side] = result_key
            self.log.info(f"[{side}评估] {summary}\n  " + "\n  ".join(lines))

        return all_pass, summary

    # =============== 信号检查 ===============
    async def _check_signals(self) -> None:
        cfg = self.cfg
        # 每日重置
        today = _today_int()
        if cfg.enable_daily_open_limit and today > self.state.last_open_date:
            self.state.daily_open_count = 0
            self.state.last_open_date = today

        # 不做单时间段
        self.state.in_no_trade_time = _in_no_trade_time(datetime.now(), cfg.no_trade_times) if cfg.enable_trading_hours else False

        # 每日限制
        self.state.daily_limit_reached = (cfg.enable_daily_open_limit
                                          and self.state.daily_open_count >= cfg.daily_max_opens)
        # 平仓后等待
        self.state.wait_after_close = False
        if cfg.enable_wait_after_close and cfg.wait_minutes_after_close > 0 and self.state.last_close_time > 0:
            if (time.time() - self.state.last_close_time) / 60.0 < cfg.wait_minutes_after_close:
                self.state.wait_after_close = True
        # 亏损止损后等待
        self.state.wait_after_maxloss = False
        if cfg.wait_after_max_loss and cfg.max_loss_wait_minutes > 0 and self.state.last_maxloss_time > 0:
            if (time.time() - self.state.last_maxloss_time) / 60.0 < cfg.max_loss_wait_minutes:
                self.state.wait_after_maxloss = True
            else:
                self.state.last_maxloss_time = 0

        # 多空互斥
        if self.state.total_long_lots > 0 or self.state.total_short_lots > 0:
            return

        # 多头信号
        if (cfg.trade_buy and not self.state.buy.active
                and not self.state.daily_limit_reached
                and not self.state.wait_after_close
                and not self.state.wait_after_maxloss
                and not self.state.in_no_trade_time
                and self.state.total_long_lots <= 0 and self.state.total_short_lots <= 0):
            ok, _ = await self._evaluate_entry(True)
            if ok:
                await self._start_buy_grid()
                if cfg.enable_daily_open_limit and self.state.buy.active:
                    self.state.daily_open_count += 1

        # 空头信号
        if (cfg.trade_sell and not self.state.sell.active
                and not self.state.daily_limit_reached
                and not self.state.wait_after_close
                and not self.state.wait_after_maxloss
                and not self.state.in_no_trade_time
                and self.state.total_long_lots <= 0 and self.state.total_short_lots <= 0):
            ok, _ = await self._evaluate_entry(False)
            if ok:
                await self._start_sell_grid()
                if cfg.enable_daily_open_limit and self.state.sell.active:
                    self.state.daily_open_count += 1

    # =============== 网格 ===============
    async def _start_buy_grid(self) -> None:
        s = self.state.buy
        s.active = True
        s.avg_price = 0.0
        s.grids = []
        order = await self.broker.open_market("BUY", self.cfg.grid_lot_size)
        if order.status == "FILLED" and order.price > 0:
            s.grids.append(GridLeg(index=0, side="BUY",
                                   entry_price=order.price,
                                   lot_size=order.qty,
                                   open_time=time.time()))
            s.avg_price = order.price
            self.log.trade(f"做多首仓 px={order.price} qty={order.qty}")
        else:
            s.active = False

    async def _start_sell_grid(self) -> None:
        s = self.state.sell
        s.active = True
        s.avg_price = 0.0
        s.grids = []
        order = await self.broker.open_market("SELL", self.cfg.grid_lot_size)
        if order.status == "FILLED" and order.price > 0:
            s.grids.append(GridLeg(index=0, side="SELL",
                                   entry_price=order.price,
                                   lot_size=order.qty,
                                   open_time=time.time()))
            s.avg_price = order.price
            self.log.trade(f"做空首仓 px={order.price} qty={order.qty}")
        else:
            s.active = False

    async def _check_buy_grid(self, ask: float) -> None:
        s = self.state.buy
        if not s.active or not s.grids:
            return
        last_idx = len(s.grids) - 1
        if last_idx >= self.cfg.grid_count - 1:
            return  # 已满
        last_price = s.grids[-1].entry_price
        grid_price = last_price * (1.0 - self.cfg.grid_spacing_pct / 100.0)
        if ask <= grid_price:
            order = await self.broker.open_market("BUY", self.cfg.grid_lot_size)
            if order.status == "FILLED" and order.price > 0:
                # 加权平均成本
                total_qty = sum(g.lot_size for g in s.grids) + order.qty
                total_cost = s.avg_price * sum(g.lot_size for g in s.grids) + order.price * order.qty
                s.avg_price = total_cost / total_qty
                s.grids.append(GridLeg(index=last_idx + 1, side="BUY",
                                       entry_price=order.price,
                                       lot_size=order.qty,
                                       open_time=time.time()))
                self.log.trade(f"做多加仓 idx={last_idx+1} px={order.price} qty={order.qty} avg={s.avg_price:.4f}")

    async def _check_sell_grid(self, bid: float) -> None:
        s = self.state.sell
        if not s.active or not s.grids:
            return
        last_idx = len(s.grids) - 1
        if last_idx >= self.cfg.grid_count - 1:
            return
        last_price = s.grids[-1].entry_price
        grid_price = last_price * (1.0 + self.cfg.grid_spacing_pct / 100.0)
        if bid >= grid_price:
            order = await self.broker.open_market("SELL", self.cfg.grid_lot_size)
            if order.status == "FILLED" and order.price > 0:
                total_qty = sum(g.lot_size for g in s.grids) + order.qty
                total_cost = s.avg_price * sum(g.lot_size for g in s.grids) + order.price * order.qty
                s.avg_price = total_cost / total_qty
                s.grids.append(GridLeg(index=last_idx + 1, side="SELL",
                                       entry_price=order.price,
                                       lot_size=order.qty,
                                       open_time=time.time()))
                self.log.trade(f"做空加仓 idx={last_idx+1} px={order.price} qty={order.qty} avg={s.avg_price:.4f}")

    async def _check_grid_trading(self, price: float, bid: float, ask: float) -> None:
        await self._check_buy_grid(ask)
        await self._check_sell_grid(bid)

    # =============== 平仓：部分 / 全部 ===============
    async def _close_partial_buy(self, ratio: float) -> None:
        positions = await self.broker.get_positions()
        total = sum(p.qty for p in positions if p.side == "LONG")
        if total <= 0:
            return
        target = total * ratio
        # 量化到 lot step：保守保留 3 位
        target = float(f"{target:.3f}")
        if target <= 0:
            return
        await self.broker.close_market("BUY", target)
        # 状态：网格按价格匹配，扣减
        remaining = target
        for g in self.state.buy.grids:
            if remaining <= 0:
                break
            take = min(g.lot_size, remaining)
            g.lot_size -= take
            remaining -= take
        # 移除 lot_size=0 的腿
        self.state.buy.grids = [g for g in self.state.buy.grids if g.lot_size > 1e-9]
        # 检查全部平掉
        positions = await self.broker.get_positions()
        if not any(p.side == "LONG" for p in positions):
            self._on_full_close("BUY")

    async def _close_partial_sell(self, ratio: float) -> None:
        positions = await self.broker.get_positions()
        total = sum(p.qty for p in positions if p.side == "SHORT")
        if total <= 0:
            return
        target = total * ratio
        target = float(f"{target:.3f}")
        if target <= 0:
            return
        await self.broker.close_market("SELL", target)
        remaining = target
        for g in self.state.sell.grids:
            if remaining <= 0:
                break
            take = min(g.lot_size, remaining)
            g.lot_size -= take
            remaining -= take
        self.state.sell.grids = [g for g in self.state.sell.grids if g.lot_size > 1e-9]
        positions = await self.broker.get_positions()
        if not any(p.side == "SHORT" for p in positions):
            self._on_full_close("SELL")

    async def _close_all_buy(self) -> None:
        await self.broker.close_market("BUY")
        self._on_full_close("BUY")

    async def _close_all_sell(self) -> None:
        await self.broker.close_market("SELL")
        self._on_full_close("SELL")

    def _on_full_close(self, side: str) -> None:
        if side == "BUY":
            self.state.buy.reset()
            self.state.buy.rsi_preroll_triggered = False
        else:
            self.state.sell.reset()
            self.state.sell.rsi_preroll_triggered = False
        if self.cfg.enable_wait_after_close:
            self.state.last_close_time = time.time()
        self.log.trade(f"{side} 仓位全部平仓，状态已重置")

    # =============== 止盈/止损/移动止损/保本损 ===============
    async def _check_tp_sl(self, price: float, bid: float, ask: float) -> None:
        cfg = self.cfg
        # 最大亏损
        if cfg.use_max_loss and cfg.max_loss_usdt > 0:
            if self.state.unrealized_pnl <= -cfg.max_loss_usdt:
                self.log.warn(f"触发最大亏损 {self.state.unrealized_pnl:.2f} ≤ -{cfg.max_loss_usdt}，全部平仓")
                self.state.last_maxloss_time = time.time()
                await self._close_all_buy()
                await self._close_all_sell()
                return

        await self._check_buy_tp_sl(price, bid, ask)
        await self._check_sell_tp_sl(price, bid, ask)

    async def _check_buy_tp_sl(self, price: float, bid: float, ask: float) -> None:
        cfg = self.cfg
        s = self.state.buy
        if not s.active or s.avg_price <= 0:
            return
        # 持仓存在性
        if not any(True for _ in s.grids if _.lot_size > 0):
            return
        cur = bid
        profit_pct = (cur - s.avg_price) / s.avg_price * 100.0

        # 移动止盈
        if cfg.use_trailing_stop and cfg.trailing_start_pct > 0 and cfg.trailing_back_pct > 0:
            activate = s.avg_price * (1.0 + cfg.trailing_start_pct / 100.0)
            if cur >= activate:
                cand = cur * (1.0 - cfg.trailing_back_pct / 100.0)
                if s.trail_level == 0 or cand > s.trail_level:
                    s.trail_level = cand
                    self.log.info(f"多头移动止盈上移 → {s.trail_level:.4f}")

        if cfg.use_split_tp:
            if profit_pct >= cfg.tp_level1_pct and not s.level1_done:
                self.log.info(f"多头第1批止盈 profit={profit_pct:.2f}% 平 {cfg.tp_level1_ratio*100:.0f}%")
                await self._close_partial_buy(cfg.tp_level1_ratio)
                s.level1_done = True
                s.breakeven_triggered = True
                return
            if profit_pct >= cfg.tp_level2_pct and s.level1_done and not s.level2_done:
                self.log.info(f"多头第2批止盈 profit={profit_pct:.2f}% 平 {cfg.tp_level2_ratio*100:.0f}%")
                await self._close_partial_buy(cfg.tp_level2_ratio)
                s.level2_done = True
                return
            if profit_pct >= cfg.tp_level3_pct and s.level2_done:
                self.log.info(f"多头第3批止盈（全部）profit={profit_pct:.2f}%")
                await self._close_all_buy()
                return
            if profit_pct >= cfg.tp_percent and (not cfg.use_split_tp or (s.level1_done and s.level2_done)):
                self.log.info(f"多头止盈（全部）profit={profit_pct:.2f}%")
                await self._close_all_buy()
                return
        else:
            if s.trail_level == 0.0:
                tp_price = s.avg_price * (1.0 + cfg.tp_percent / 100.0)
                if cur >= tp_price:
                    self.log.info(f"多头止盈 profit={profit_pct:.2f}%")
                    await self._close_all_buy()
                    return

        # 保本损
        if cfg.use_breakeven and s.breakeven_triggered:
            be = s.avg_price * (1.0 + cfg.breakeven_offset / 100.0)
            if cur <= be:
                self.log.info(f"多头保本损触发 cur={cur:.4f} ≤ be={be:.4f}")
                await self._close_all_buy()
                return

        # 网格打满后按成本价止损
        active = sum(1 for g in s.grids if g.entry_price > 0)
        if active >= cfg.grid_count:
            sl_price = s.avg_price * (1.0 - cfg.sl_percent / 100.0)
            if cur <= sl_price:
                self.log.warn(f"多头止损 cur={cur:.4f} ≤ sl={sl_price:.4f}")
                self.state.last_maxloss_time = time.time()
                await self._close_all_buy()

    async def _check_sell_tp_sl(self, price: float, bid: float, ask: float) -> None:
        cfg = self.cfg
        s = self.state.sell
        if not s.active or s.avg_price <= 0:
            return
        if not any(True for _ in s.grids if _.lot_size > 0):
            return
        cur = ask
        profit_pct = (s.avg_price - cur) / s.avg_price * 100.0

        if cfg.use_trailing_stop and cfg.trailing_start_pct > 0 and cfg.trailing_back_pct > 0:
            activate = s.avg_price * (1.0 - cfg.trailing_start_pct / 100.0)
            if cur <= activate:
                cand = cur * (1.0 + cfg.trailing_back_pct / 100.0)
                if s.trail_level == 0 or cand < s.trail_level:
                    s.trail_level = cand
                    self.log.info(f"空头移动止盈下移 → {s.trail_level:.4f}")

        if cfg.use_split_tp:
            if profit_pct >= cfg.tp_level1_pct and not s.level1_done:
                self.log.info(f"空头第1批止盈 profit={profit_pct:.2f}% 平 {cfg.tp_level1_ratio*100:.0f}%")
                await self._close_partial_sell(cfg.tp_level1_ratio)
                s.level1_done = True
                s.breakeven_triggered = True
                return
            if profit_pct >= cfg.tp_level2_pct and s.level1_done and not s.level2_done:
                self.log.info(f"空头第2批止盈 profit={profit_pct:.2f}% 平 {cfg.tp_level2_ratio*100:.0f}%")
                await self._close_partial_sell(cfg.tp_level2_ratio)
                s.level2_done = True
                return
            if profit_pct >= cfg.tp_level3_pct and s.level2_done:
                self.log.info(f"空头第3批止盈（全部）profit={profit_pct:.2f}%")
                await self._close_all_sell()
                return
            if profit_pct >= cfg.tp_percent and (not cfg.use_split_tp or (s.level1_done and s.level2_done)):
                self.log.info(f"空头止盈（全部）profit={profit_pct:.2f}%")
                await self._close_all_sell()
                return
        else:
            if s.trail_level == 0.0:
                tp_price = s.avg_price * (1.0 - cfg.tp_percent / 100.0)
                if cur <= tp_price:
                    self.log.info(f"空头止盈 profit={profit_pct:.2f}%")
                    await self._close_all_sell()
                    return

        if cfg.use_breakeven and s.breakeven_triggered:
            be = s.avg_price * (1.0 - cfg.breakeven_offset / 100.0)
            if cur >= be:
                self.log.info(f"空头保本损触发 cur={cur:.4f} ≥ be={be:.4f}")
                await self._close_all_sell()
                return

        active = sum(1 for g in s.grids if g.entry_price > 0)
        if active >= cfg.grid_count:
            sl_price = s.avg_price * (1.0 + cfg.sl_percent / 100.0)
            if cur >= sl_price:
                self.log.warn(f"空头止损 cur={cur:.4f} ≥ sl={sl_price:.4f}")
                self.state.last_maxloss_time = time.time()
                await self._close_all_sell()
