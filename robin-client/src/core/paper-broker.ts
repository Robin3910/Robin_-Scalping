// Paper Broker - 模拟盘 - 对应 Python 版本的 paper_broker.py

import { BrokerBase } from './broker-base';
import { Order, Position } from './types';

export class PaperBroker extends BrokerBase {
  private positions: Map<string, Position> = new Map();
  private lastPx = 0;
  private onTick?: (price: number) => void;

  constructor(
    symbol: string,
    leverage: number = 10,
    marginMode: 'ISOLATED' | 'CROSSED' = 'ISOLATED',
    onTick?: (price: number) => void
  ) {
    super(symbol, leverage, marginMode);
    this.onTick = onTick;
  }

  mode(): 'PAPER' | 'LIVE' {
    return 'PAPER';
  }

  updatePrice(price: number): void {
    this.lastPx = price;
    // 更新未实现盈亏
    for (const p of this.positions.values()) {
      if (p.side === 'LONG') {
        p.unrealized_pnl = (price - p.entry_price) * p.qty;
      } else {
        p.unrealized_pnl = (p.entry_price - price) * p.qty;
      }
    }
    this.onTick?.(price);
  }

  async setLeverage(): Promise<void> {
    // 模拟盘不需要
  }

  async getMarkPrice(): Promise<number> {
    return this.lastPx;
  }

  private posSide(side: 'BUY' | 'SELL'): 'LONG' | 'SHORT' {
    return side === 'BUY' ? 'LONG' : 'SHORT';
  }

  async openMarket(side: 'BUY' | 'SELL', qty: number): Promise<Order> {
    if (this.lastPx <= 0) {
      return {
        id: '',
        symbol: this.symbol,
        side,
        position_side: this.posSide(side),
        type: 'MARKET',
        qty,
        price: 0,
        reduce_only: false,
        client_id: '',
        ts: Date.now(),
        status: 'REJECTED',
      };
    }

    const posSide = this.posSide(side);
    const price = this.lastPx;

    if (this.positions.has(posSide)) {
      const p = this.positions.get(posSide)!;
      const newQty = p.qty + qty;
      p.entry_price = (p.entry_price * p.qty + price * qty) / newQty;
      p.qty = newQty;
    } else {
      const id = crypto.randomUUID();
      this.positions.set(posSide, {
        symbol: this.symbol,
        side: posSide,
        qty,
        entry_price: price,
        unrealized_pnl: 0,
        leverage: this.leverage,
        margin_type: this.marginMode,
        client_id: `sim-${id.slice(0, 8)}`,
        opened_at: Date.now(),
      });
    }

    return {
      id: crypto.randomUUID(),
      symbol: this.symbol,
      side,
      position_side: posSide,
      type: 'MARKET',
      qty,
      price,
      reduce_only: false,
      client_id: this.positions.get(posSide)!.client_id,
      ts: Date.now(),
      status: 'FILLED',
    };
  }

  async closeMarket(side: 'BUY' | 'SELL', qty?: number): Promise<Order[]> {
    const posSide = this.posSide(side);
    const p = this.positions.get(posSide);
    if (!p || p.qty <= 0) return [];

    const closeQty = qty === undefined ? p.qty : Math.min(qty, p.qty);
    const price = this.lastPx;

    p.qty -= closeQty;
    if (p.qty <= 1e-9) {
      this.positions.delete(posSide);
    }

    return [{
      id: crypto.randomUUID(),
      symbol: this.symbol,
      side,
      position_side: posSide,
      type: 'MARKET',
      qty: closeQty,
      price,
      reduce_only: true,
      client_id: '',
      ts: Date.now(),
      status: 'FILLED',
    }];
  }

  async getPositions(): Promise<Position[]> {
    return [...this.positions.values()].filter(p => p.qty > 0);
  }
}
