// Binance WebSocket Feed - 对应 Python 版本的 binance_ws.py
// 维护 aggTrade、bookTicker 连接

import { EventBus } from './bus';

const MAINNET_WS = 'wss://fstream.binance.com';
const TESTNET_WS = 'wss://stream.binancefuture.com';

export interface BinanceFeedOptions {
  symbol: string;
  testnet: boolean;
  onAggTrade?: (price: number, qty: number, ts: number) => void;
  onBookTicker?: (bid: number, ask: number) => void;
  onError?: (err: Error) => void;
}

export class BinanceFeed {
  private wsAggTrade: WebSocket | null = null;
  private wsBookTicker: WebSocket | null = null;
  private reconnectTimers: number[] = [];
  private stopFlag = false;
  private symbol: string;
  private testnet: boolean;
  private wsBase: string;
  private onAggTrade?: (price: number, qty: number, ts: number) => void;
  private onBookTicker?: (bid: number, ask: number) => void;
  private onError?: (err: Error) => void;

  constructor(options: BinanceFeedOptions) {
    this.symbol = options.symbol.toLowerCase();
    this.testnet = options.testnet;
    this.wsBase = options.testnet ? TESTNET_WS : MAINNET_WS;
    this.onAggTrade = options.onAggTrade;
    this.onBookTicker = options.onBookTicker;
    this.onError = options.onError;
  }

  start(): void {
    this.stopFlag = false;
    this.connectAggTrade();
    this.connectBookTicker();
  }

  stop(): void {
    this.stopFlag = true;
    this.reconnectTimers.forEach(t => clearTimeout(t));
    this.reconnectTimers = [];
    this.wsAggTrade?.close();
    this.wsBookTicker?.close();
  }

  private connectAggTrade(): void {
    if (this.stopFlag) return;

    const url = `${this.wsBase}/ws/${this.symbol}@aggTrade`;
    console.log(`[BinanceFeed] Connecting ${url}`);

    try {
      this.wsAggTrade = new WebSocket(url);
      this.wsAggTrade.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data);
          const price = parseFloat(d.p);
          const qty = parseFloat(d.q);
          const ts = parseInt(d.T);
          this.onAggTrade?.(price, qty, ts);
        } catch (e) {
          console.warn('[BinanceFeed] parse error:', e);
        }
      };
      this.wsAggTrade.onerror = (e) => {
        console.warn('[BinanceFeed] aggTrade error:', e);
        this.onError?.(new Error('aggTrade connection error'));
      };
      this.wsAggTrade.onclose = () => {
        if (!this.stopFlag) {
          console.log('[BinanceFeed] aggTrade closed, reconnecting in 5s...');
          const t = window.setTimeout(() => this.connectAggTrade(), 5000);
          this.reconnectTimers.push(t);
        }
      };
    } catch (e) {
      console.error('[BinanceFeed] aggTrade connect error:', e);
      const t = window.setTimeout(() => this.connectAggTrade(), 5000);
      this.reconnectTimers.push(t);
    }
  }

  private connectBookTicker(): void {
    if (this.stopFlag) return;

    const url = `${this.wsBase}/ws/${this.symbol}@bookTicker`;
    console.log(`[BinanceFeed] Connecting ${url}`);

    try {
      this.wsBookTicker = new WebSocket(url);
      this.wsBookTicker.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data);
          const bid = parseFloat(d.b);
          const ask = parseFloat(d.a);
          this.onBookTicker?.(bid, ask);
        } catch (e) {
          console.warn('[BinanceFeed] bookTicker parse error:', e);
        }
      };
      this.wsBookTicker.onerror = (e) => {
        console.warn('[BinanceFeed] bookTicker error:', e);
      };
      this.wsBookTicker.onclose = () => {
        if (!this.stopFlag) {
          console.log('[BinanceFeed] bookTicker closed, reconnecting in 5s...');
          const t = window.setTimeout(() => this.connectBookTicker(), 5000);
          this.reconnectTimers.push(t);
        }
      };
    } catch (e) {
      console.error('[BinanceFeed] bookTicker connect error:', e);
      const t = window.setTimeout(() => this.connectBookTicker(), 5000);
      this.reconnectTimers.push(t);
    }
  }
}
