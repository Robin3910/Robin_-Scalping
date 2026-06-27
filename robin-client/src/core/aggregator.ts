// K线聚合器 - 对应 Python 版本的 aggregator.py
// 环形 K线缓存 + 按周期的多周期聚合

import { Candle } from './types';

export const BINANCE_TIMEFRAMES: Record<string, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600,
  '8h': 28800, '12h': 43200, '1d': 86400, '3d': 259200,
  '1w': 604800, '1M': 2592000,
};

export class CandleAggregator {
  private maxlen: number;
  private timeframes: string[];
  private current: Map<string, Candle | null>;
  private history: Map<string, Candle[]>;

  constructor(timeframes: string[], maxlen: number = 500) {
    this.maxlen = maxlen;
    this.timeframes = timeframes;
    this.current = new Map();
    this.history = new Map();

    for (const tf of timeframes) {
      this.current.set(tf, null);
      this.history.set(tf, []);
    }
  }

  private bucketStart(tsMs: number, periodSec: number): number {
    const sec = Math.floor(tsMs / 1000);
    const bucket = Math.floor(sec / periodSec) * periodSec;
    return bucket * 1000;
  }

  clearAll(): void {
    for (const tf of this.timeframes) {
      this.current.set(tf, null);
      this.history.set(tf, []);
    }
  }

  onTrade(price: number, qty: number, tsMs: number): void {
    for (const tf of this.timeframes) {
      const periodSec = BINANCE_TIMEFRAMES[tf];
      if (!periodSec) continue;

      const bucket = this.bucketStart(tsMs, periodSec);
      let cur = this.current.get(tf) ?? null;

      if (cur === null || cur.timestamp !== bucket) {
        // 新K线
        if (cur !== null) {
          cur.is_closed = true;
          this.history.get(tf)!.push(cur);
        }
        const newCandle: Candle = {
          timestamp: bucket,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: qty,
          is_closed: false,
        };
        this.current.set(tf, newCandle);
      } else {
        // 更新当前K线
        if (price > cur.high) cur.high = price;
        if (price < cur.low) cur.low = price;
        cur.close = price;
        cur.volume += qty;
        cur.timestamp = bucket;
      }
    }
  }

  getCloses(tf: string, n?: number): number[] {
    const hist = this.history.get(tf);
    if (!hist) return [];

    let closes = hist.map(c => c.close);
    const cur = this.current.get(tf);
    if (cur) closes = [...closes, cur.close];

    if (n !== undefined) {
      closes = closes.slice(-n);
    }
    return closes;
  }

  getHighs(tf: string, n?: number): number[] {
    const hist = this.history.get(tf);
    if (!hist) return [];

    let highs = hist.map(c => c.high);
    const cur = this.current.get(tf);
    if (cur) highs = [...highs, cur.high];

    if (n !== undefined) {
      highs = highs.slice(-n);
    }
    return highs;
  }

  getLows(tf: string, n?: number): number[] {
    const hist = this.history.get(tf);
    if (!hist) return [];

    let lows = hist.map(c => c.low);
    const cur = this.current.get(tf);
    if (cur) lows = [...lows, cur.low];

    if (n !== undefined) {
      lows = lows.slice(-n);
    }
    return lows;
  }

  getOhlcv(tf: string, n: number): Candle[] {
    const hist = this.history.get(tf);
    if (!hist) return [];

    let all = [...hist];
    const cur = this.current.get(tf);
    if (cur) all = [...all, cur];

    return all.slice(-n);
  }

  getCandle(tf: string, shift: number = 0): Candle | null {
    const hist = this.history.get(tf);
    if (!hist) return null;

    if (shift === 0) {
      return this.current.get(tf) ?? null;
    }

    const len = hist.length;
    if (len < shift) return null;
    return hist[len - shift];
  }

  getOpenClose(tf: string, shift: number): [number | null, number | null] {
    const c = this.getCandle(tf, shift);
    if (!c) return [null, null];
    return [c.open, c.close];
  }

  async loadHistory(
    symbol: string,
    testnet: boolean,
    limit: number = 200,
    logFn?: (msg: string) => void
  ): Promise<void> {
    const rest = testnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';

    const promises = this.timeframes.map(async (tf) => {
      try {
        const params = new URLSearchParams({
          symbol: symbol.toUpperCase(),
          interval: tf,
          limit: String(limit),
        });
        const resp = await fetch(`${rest}/fapi/v1/klines?${params}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const klines = await resp.json();

        for (const k of klines as any[]) {
          const candle: Candle = {
            timestamp: Number(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            is_closed: true,
          };
          this.history.get(tf)!.push(candle);
        }

        logFn?.(`历史K线加载: ${symbol} ${tf} x${klines.length}`);
      } catch (e: any) {
        logFn?.(`历史K线加载失败: ${tf} ${e.message}`);
      }
    });

    await Promise.all(promises);
  }
}
