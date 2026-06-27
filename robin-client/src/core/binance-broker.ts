// Binance Broker - 真实交易 - 对应 Python 版本的 binance_broker.py

import { BrokerBase } from './broker-base';
import { Order, Position } from './types';

const MAINNET_REST = 'https://fapi.binance.com';
const TESTNET_REST = 'https://testnet.binancefuture.com';

function sign(secret: string, params: Record<string, string | number>): string {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(qs);
  return crypto.subtle
    .importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then(cryptoKey =>
      crypto.subtle.sign('HMAC', cryptoKey, data)
    )
    .then(buf =>
      Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    );
}

export class BinanceBroker extends BrokerBase {
  private apiKey: string;
  private apiSecret: string;
  private testnet: boolean;
  private lastPx = 0;
  private baseUrl: string;

  constructor(
    symbol: string,
    apiKey: string,
    apiSecret: string,
    testnet: boolean = true,
    leverage: number = 10,
    marginMode: 'ISOLATED' | 'CROSSED' = 'ISOLATED'
  ) {
    super(symbol, leverage, marginMode);
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.testnet = testnet;
    this.baseUrl = testnet ? TESTNET_REST : MAINNET_REST;
  }

  mode(): 'PAPER' | 'LIVE' {
    return 'LIVE';
  }

  updatePrice(price: number): void {
    this.lastPx = price;
  }

  private async signed(params: Record<string, string | number>): Promise<string> {
    return sign(this.apiSecret, { ...params, timestamp: Date.now() });
  }

  private async get(path: string, params: Record<string, string | number> = {}, signed = false): Promise<any> {
    let url = `${this.baseUrl}${path}?${new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString()}`;
    if (signed) {
      const sig = await this.signed(params);
      url += `&signature=${sig}`;
    }
    const resp = await fetch(url, {
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${err}`);
    }
    return resp.json();
  }

  private async post(path: string, params: Record<string, string | number>, signed = true): Promise<any> {
    const queryParams = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();

    let url = `${this.baseUrl}${path}`;
    if (signed) {
      const sig = await this.signed(params);
      url += `?${queryParams}&signature=${sig}`;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${err}`);
    }
    return resp.json();
  }

  async setLeverage(): Promise<void> {
    try {
      await this.post('/fapi/v1/leverage', {
        symbol: this.symbol,
        leverage: this.leverage,
      });
    } catch (e) {
      console.warn('setLeverage failed:', e);
    }
    try {
      await this.post('/fapi/v1/marginType', {
        symbol: this.symbol,
        marginType: this.marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSSED',
      });
    } catch (e) {
      // 已是目标模式时会报错，忽略
    }
  }

  async getMarkPrice(): Promise<number> {
    const d = await this.get('/fapi/v1/premiumIndex', { symbol: this.symbol }, false);
    return parseFloat(d.markPrice);
  }

  private roundQty(qty: number): number {
    return parseFloat(qty.toFixed(3));
  }

  async openMarket(side: 'BUY' | 'SELL', qty: number): Promise<Order> {
    const params: Record<string, string | number> = {
      symbol: this.symbol,
      side,
      type: 'MARKET',
      quantity: this.roundQty(qty),
    };

    try {
      const r = await this.post('/fapi/v1/order', params);
      return {
        id: String(r.orderId),
        symbol: this.symbol,
        side,
        position_side: side === 'BUY' ? 'LONG' : 'SHORT',
        type: 'MARKET',
        qty: parseFloat(r.executedQty),
        price: parseFloat(r.avgPrice || String(this.lastPx)),
        reduce_only: false,
        client_id: r.clientOrderId || '',
        ts: Date.now(),
        status: r.status,
      };
    } catch (e: any) {
      console.error('openMarket failed:', e);
      return {
        id: '',
        symbol: this.symbol,
        side,
        position_side: side === 'BUY' ? 'LONG' : 'SHORT',
        type: 'MARKET',
        qty,
        price: 0,
        reduce_only: false,
        client_id: '',
        ts: Date.now(),
        status: 'REJECTED',
      };
    }
  }

  async closeMarket(side: 'BUY' | 'SELL', qty?: number): Promise<Order[]> {
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const positions = await this.getPositions();
    const target = positions.find(p => p.side === posSide);
    if (!target) return [];

    const closeQty = qty === undefined ? target.qty : Math.min(qty, target.qty);
    const params: Record<string, string | number> = {
      symbol: this.symbol,
      side: side === 'BUY' ? 'SELL' : 'BUY',
      type: 'MARKET',
      quantity: this.roundQty(closeQty),
      reduceOnly: 'true',
    };

    try {
      const r = await this.post('/fapi/v1/order', params);
      return [{
        id: String(r.orderId),
        symbol: this.symbol,
        side: params.side as 'BUY' | 'SELL',
        position_side: posSide,
        type: 'MARKET',
        qty: parseFloat(r.executedQty),
        price: parseFloat(r.avgPrice || String(this.lastPx)),
        reduce_only: true,
        client_id: r.clientOrderId || '',
        ts: Date.now(),
        status: r.status,
      }];
    } catch (e: any) {
      console.error('closeMarket failed:', e);
      return [];
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const arr = await this.get('/fapi/v2/positionRisk', { symbol: this.symbol }, true);
      const out: Position[] = [];
      for (const p of arr) {
        const qty = parseFloat(p.positionAmt);
        if (Math.abs(qty) <= 0) continue;
        out.push({
          symbol: p.symbol,
          side: qty > 0 ? 'LONG' : 'SHORT',
          qty: Math.abs(qty),
          entry_price: parseFloat(p.entryPrice),
          unrealized_pnl: parseFloat(p.unRealizedProfit),
          leverage: parseInt(p.leverage) || this.leverage,
          margin_type: (p.marginType as 'ISOLATED' | 'CROSSED') || this.marginMode,
          client_id: '',
          opened_at: Date.now(),
        });
      }
      return out;
    } catch (e: any) {
      console.warn('getPositions failed:', e);
      return [];
    }
  }
}
