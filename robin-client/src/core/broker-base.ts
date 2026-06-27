// Broker 接口定义 - 对应 Python 版本的 base.py

import { Order, Position } from './types';

export abstract class BrokerBase {
  constructor(
    public symbol: string,
    public leverage: number = 10,
    public marginMode: 'ISOLATED' | 'CROSSED' = 'ISOLATED'
  ) {}

  abstract mode(): 'PAPER' | 'LIVE';
  abstract setLeverage(): Promise<void>;
  abstract getMarkPrice(): Promise<number>;
  abstract openMarket(side: 'BUY' | 'SELL', qty: number): Promise<Order>;
  abstract closeMarket(side: 'BUY' | 'SELL', qty?: number): Promise<Order[]>;
  abstract getPositions(): Promise<Position[]>;
}
