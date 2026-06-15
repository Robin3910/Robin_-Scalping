"""
技术指标：纯 Python 实现，避免引入 TA-Lib 等难装的依赖。
计算口径与 MQ5 中 iMA / iRSI / iADX / iMACD 一致（标准 EMA / Wilder / 标准 MACD）。
"""
from __future__ import annotations
from typing import List, Optional


# -------- EMA（与 MT5 iMA 选 MODE_EMA 时一致） --------
def ema(values: List[float], period: int) -> List[float]:
    if not values or period <= 0:
        return []
    k = 2.0 / (period + 1.0)
    out: List[float] = [0.0] * len(values)
    # 初始：使用 SMA 作为种子
    if len(values) < period:
        return [float("nan")] * len(values)
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    for i in range(period, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1.0 - k)
    # 前面补 nan
    for i in range(period - 1):
        out[i] = float("nan")
    return out


def ema_at(values: List[float], period: int) -> Optional[float]:
    arr = ema(values, period)
    if not arr:
        return None
    v = arr[-1]
    return None if v != v else v  # nan check


# -------- RSI（Wilder 平滑） --------
def rsi(values: List[float], period: int) -> List[float]:
    if len(values) <= period:
        return [float("nan")] * len(values)
    gains: List[float] = [0.0]
    losses: List[float] = [0.0]
    for i in range(1, len(values)):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    # Wilder 平滑
    avg_gain = sum(gains[1:period + 1]) / period
    avg_loss = sum(losses[1:period + 1]) / period
    out: List[float] = [float("nan")] * len(values)
    if avg_loss == 0:
        out[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        out[period] = 100.0 - 100.0 / (1.0 + rs)
    for i in range(period + 1, len(values)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100.0 - 100.0 / (1.0 + rs)
    return out


def rsi_at(values: List[float], period: int) -> Optional[float]:
    arr = rsi(values, period)
    if not arr:
        return None
    v = arr[-1]
    return None if v != v else v


# -------- MACD --------
def macd(values: List[float], fast: int, slow: int, signal: int):
    if len(values) < slow + signal:
        nan = [float("nan")] * len(values)
        return nan, nan, nan
    ema_fast = ema(values, fast)
    ema_slow = ema(values, slow)
    main = [a - b for a, b in zip(ema_fast, ema_slow)]
    # signal = EMA(main, signal_period)
    sig = ema(main, signal)
    hist = [m - s for m, s in zip(main, sig)]
    return main, sig, hist


def macd_at(values: List[float], fast: int, slow: int, signal: int):
    m, s, _ = macd(values, fast, slow, signal)
    mv, sv = m[-1] if m else None, s[-1] if s else None
    if mv is not None and mv != mv:
        mv = None
    if sv is not None and sv != sv:
        sv = None
    return mv, sv


# -------- ADX（Wilder，与 MT5 iADX 一致） --------
def adx(highs: List[float], lows: List[float], closes: List[float], period: int) -> List[float]:
    n = len(closes)
    if n < period * 2 + 1:
        return [float("nan")] * n

    plus_dm: List[float] = [0.0] * n
    minus_dm: List[float] = [0.0] * n
    tr: List[float] = [0.0] * n

    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
        tr[i] = max(highs[i] - lows[i],
                    abs(highs[i] - closes[i - 1]),
                    abs(lows[i] - closes[i - 1]))

    # Wilder smoothing
    def smooth(arr: List[float]) -> List[float]:
        out = [0.0] * n
        s = sum(arr[1:period + 1])
        out[period] = s
        for i in range(period + 1, n):
            s = s - s / period + arr[i]
            out[i] = s
        return out

    sm_tr = smooth(tr)
    sm_pdm = smooth(plus_dm)
    sm_ndm = smooth(minus_dm)

    plus_di: List[float] = [float("nan")] * n
    minus_di: List[float] = [float("nan")] * n
    dx: List[float] = [float("nan")] * n
    for i in range(period, n):
        if sm_tr[i] == 0:
            continue
        plus_di[i] = 100.0 * sm_pdm[i] / sm_tr[i]
        minus_di[i] = 100.0 * sm_ndm[i] / sm_tr[i]
        s = plus_di[i] + minus_di[i]
        if s > 0:
            dx[i] = 100.0 * abs(plus_di[i] - minus_di[i]) / s

    # ADX = Wilder smooth of DX
    adx_arr: List[float] = [float("nan")] * n
    if n >= 2 * period + 1:
        # 第一个 ADX 取 dx 在 [period, 2*period] 的平均
        seg = [v for v in dx[period:2 * period + 1] if v == v]
        if seg:
            adx_arr[2 * period] = sum(seg) / len(seg)
        for i in range(2 * period + 1, n):
            prev = adx_arr[i - 1]
            if prev != prev:
                continue
            cv = dx[i]
            if cv == cv:
                adx_arr[i] = (prev * (period - 1) + cv) / period
    return adx_arr


def adx_at(highs: List[float], lows: List[float], closes: List[float], period: int) -> Optional[float]:
    arr = adx(highs, lows, closes, period)
    if not arr:
        return None
    v = arr[-1]
    return None if v != v else v
