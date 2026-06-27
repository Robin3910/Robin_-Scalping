// 技术指标 - 对应 Python 版本的 indicators.py
// 计算口径与 MQ5 iMA/iRSI/iADX/iMACD 一致

export function ema(values: number[], period: number): number[] {
  if (!values.length || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(NaN);

  if (values.length < period) return out;

  // 初始 SMA 作为种子
  let seed = 0;
  for (let i = 0; i < period; i++) {
    seed += values[i];
  }
  seed /= period;
  out[period - 1] = seed;

  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }

  return out;
}

export function emaAt(values: number[], period: number): number | null {
  const arr = ema(values, period);
  if (!arr.length) return null;
  const v = arr[arr.length - 1];
  return isNaN(v) ? null : v;
}

// RSI - Wilder 平滑
export function rsi(values: number[], period: number): number[] {
  const n = values.length;
  if (n <= period) return new Array(n).fill(NaN);

  const gains: number[] = [0];
  const losses: number[] = [0];

  for (let i = 1; i < n; i++) {
    const diff = values[i] - values[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  // Wilder 初始平均
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  const out: number[] = new Array(n).fill(NaN);

  if (avgLoss === 0) {
    out[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    out[period] = 100 - 100 / (1 + rs);
  }

  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    if (avgLoss === 0) {
      out[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }

  return out;
}

export function rsiAt(values: number[], period: number): number | null {
  const arr = rsi(values, period);
  if (!arr.length) return null;
  const v = arr[arr.length - 1];
  return isNaN(v) ? null : v;
}

// MACD
export function macd(
  values: number[],
  fast: number,
  slow: number,
  signal: number
): { main: number[]; signal: number[]; histogram: number[] } {
  const n = values.length;
  if (n < slow + signal) {
    return {
      main: new Array(n).fill(NaN),
      signal: new Array(n).fill(NaN),
      histogram: new Array(n).fill(NaN),
    };
  }

  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const main: number[] = [];
  const histogram: number[] = [];

  for (let i = 0; i < n; i++) {
    if (isNaN(emaFast[i]) || isNaN(emaSlow[i])) {
      main.push(NaN);
    } else {
      main.push(emaFast[i] - emaSlow[i]);
    }
  }

  const sig = ema(main, signal);
  for (let i = 0; i < n; i++) {
    histogram.push(isNaN(main[i]) || isNaN(sig[i]) ? NaN : main[i] - sig[i]);
  }

  return { main, signal: sig, histogram };
}

export function macdAt(
  values: number[],
  fast: number,
  slow: number,
  signal: number
): { main: number | null; signal: number | null } {
  const { main, signal: sig } = macd(values, fast, slow, signal);
  const mv = main[main.length - 1];
  const sv = sig[sig.length - 1];
  return {
    main: isNaN(mv) ? null : mv,
    signal: isNaN(sv) ? null : sv,
  };
}

// ADX - Wilder
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number[] {
  const n = closes.length;
  if (n < period * 2 + 1) return new Array(n).fill(NaN);

  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }

  // Wilder smoothing
  const smooth = (arr: number[]): number[] => {
    const out: number[] = new Array(n).fill(0);
    let s = 0;
    for (let i = 1; i <= period; i++) s += arr[i];
    out[period] = s;
    for (let i = period + 1; i < n; i++) {
      s = s - s / period + arr[i];
      out[i] = s;
    }
    return out;
  };

  const smTR = smooth(tr);
  const smPDM = smooth(plusDM);
  const smNDM = smooth(minusDM);

  const plusDI: number[] = new Array(n).fill(NaN);
  const minusDI: number[] = new Array(n).fill(NaN);
  const dx: number[] = new Array(n).fill(NaN);

  for (let i = period; i < n; i++) {
    if (smTR[i] !== 0) {
      plusDI[i] = (100 * smPDM[i]) / smTR[i];
      minusDI[i] = (100 * smNDM[i]) / smTR[i];
      const s = plusDI[i] + minusDI[i];
      if (s > 0) {
        dx[i] = (100 * Math.abs(plusDI[i] - minusDI[i])) / s;
      }
    }
  }

  // ADX = Wilder smooth of DX
  const adxArr: number[] = new Array(n).fill(NaN);
  if (n >= 2 * period + 1) {
    let segSum = 0, segCount = 0;
    for (let i = period; i <= 2 * period; i++) {
      if (!isNaN(dx[i])) {
        segSum += dx[i];
        segCount++;
      }
    }
    if (segCount > 0) {
      adxArr[2 * period] = segSum / segCount;
    }
    for (let i = 2 * period + 1; i < n; i++) {
      const prev = adxArr[i - 1];
      if (!isNaN(prev) && !isNaN(dx[i])) {
        adxArr[i] = (prev * (period - 1) + dx[i]) / period;
      }
    }
  }

  return adxArr;
}

export function adxAt(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number | null {
  const arr = adx(highs, lows, closes, period);
  if (!arr.length) return null;
  const v = arr[arr.length - 1];
  return isNaN(v) ? null : v;
}
