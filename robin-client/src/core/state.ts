// 策略运行状态 - 对应 Python 版本的 state.py

import { GridLeg, SideState, LogEntry, TickData } from './types';

export class EngineState {
  // 引擎状态
  running = false;
  paper_trading = true;
  last_tick_ts = 0;
  last_eval_text = '';
  last_eval_time = 0;

  // 价格
  bid = 0;
  ask = 0;
  last_price = 0;

  // 指标
  rsi = 0;
  htf_trend: '多' | '空' | '震荡' | '' = '';
  htf_price = 0;
  htf_ma1 = 0;
  htf_ma2 = 0;
  htf_adx = 0;
  htf_macd_main = 0;
  htf_macd_signal = 0;

  // 风控
  daily_open_count = 0;
  last_open_date = 0;
  last_close_time = 0;
  last_maxloss_time = 0;

  // 多空状态
  buy: SideState = {
    active: false,
    avg_price: 0,
    trail_level: 0,
    sl_set: false,
    level1_done: false,
    level2_done: false,
    breakeven_triggered: false,
    grids: [],
  };

  sell: SideState = {
    active: false,
    avg_price: 0,
    trail_level: 0,
    sl_set: false,
    level1_done: false,
    level2_done: false,
    breakeven_triggered: false,
    grids: [],
  };

  // 风控触发标志
  in_no_trade_time = false;
  daily_limit_reached = false;
  wait_after_close = false;
  wait_after_maxloss = false;

  // 持仓汇总
  total_long_lots = 0;
  total_short_lots = 0;
  unrealized_pnl = 0;

  // 错误
  last_error = '';

  // 延迟
  ws_latency_ms = 0;

  snapshot(): any {
    return {
      running: this.running,
      paper_trading: this.paper_trading,
      last_tick_ts: this.last_tick_ts,
      last_eval_text: this.last_eval_text,
      last_eval_time: this.last_eval_time,
      bid: this.bid,
      ask: this.ask,
      last_price: this.last_price,
      rsi: this.rsi,
      htf_trend: this.htf_trend,
      htf_price: this.htf_price,
      htf_ma1: this.htf_ma1,
      htf_ma2: this.htf_ma2,
      htf_adx: this.htf_adx,
      htf_macd_main: this.htf_macd_main,
      htf_macd_signal: this.htf_macd_signal,
      daily_open_count: this.daily_open_count,
      last_open_date: this.last_open_date,
      last_close_time: this.last_close_time,
      last_maxloss_time: this.last_maxloss_time,
      buy: { ...this.buy },
      sell: { ...this.sell },
      in_no_trade_time: this.in_no_trade_time,
      daily_limit_reached: this.daily_limit_reached,
      wait_after_close: this.wait_after_close,
      wait_after_maxloss: this.wait_after_maxloss,
      total_long_lots: this.total_long_lots,
      total_short_lots: this.total_short_lots,
      unrealized_pnl: this.unrealized_pnl,
      last_error: this.last_error,
      ws_latency_ms: this.ws_latency_ms,
    };
  }

  resetSide(side: 'BUY' | 'SELL'): void {
    if (side === 'BUY') {
      this.buy = {
        active: false,
        avg_price: 0,
        trail_level: 0,
        sl_set: false,
        level1_done: false,
        level2_done: false,
        breakeven_triggered: false,
        grids: [],
      };
    } else {
      this.sell = {
        active: false,
        avg_price: 0,
        trail_level: 0,
        sl_set: false,
        level1_done: false,
        level2_done: false,
        breakeven_triggered: false,
        grids: [],
      };
    }
  }
}
