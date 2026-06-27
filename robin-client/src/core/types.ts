// 类型定义 - 对应 Python 版本的 dataclass

export interface Candle {
  timestamp: number;  // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  is_closed: boolean;
}

export interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  position_side: 'LONG' | 'SHORT';
  type: 'MARKET' | 'LIMIT';
  qty: number;
  price: number;
  reduce_only: boolean;
  client_id: string;
  ts: number;
  status: 'FILLED' | 'NEW' | 'CANCELED' | 'REJECTED';
}

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entry_price: number;
  unrealized_pnl: number;
  leverage: number;
  margin_type: 'ISOLATED' | 'CROSSED';
  client_id: string;
  opened_at: number;
}

export interface GridLeg {
  index: number;
  side: 'BUY' | 'SELL';
  entry_price: number;
  lot_size: number;
  open_time: number;
}

export interface SideState {
  active: boolean;
  avg_price: number;
  trail_level: number;
  sl_set: boolean;
  level1_done: boolean;
  level2_done: boolean;
  breakeven_triggered: boolean;
  grids: GridLeg[];
}

export interface LogEntry {
  ts: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'TRADE';
  msg: string;
  tstr: string;
}

export interface TickData {
  price: number;
  bid: number;
  ask: number;
  ts: number;
  binance_ts?: number;
}

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TrendMethod = 'price_vs_ma' | 'ma_crossover' | 'ma_adx' | 'macd';
export type MarginMode = 'ISOLATED' | 'CROSSED';
export type TradingMode = 'PAPER' | 'LIVE';
