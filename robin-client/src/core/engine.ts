// 策略引擎 - 对应 Python 版本的 engine.py
// 把 Robin_震荡_v0.0.3.mq5 的核心逻辑移植到 TypeScript

import { Config, defaultConfig, calcHtfMaPeriod1 } from './config';
import { CandleAggregator } from './aggregator';
import { ema, rsi, macd, adx, emaAt, rsiAt, macdAt, adxAt } from './indicators';
import { EngineState } from './state';
import { LogBuffer } from './logger';
import { EventBus } from './bus';
import { BrokerBase } from './broker-base';
import { GridLeg, SideState, Order, Position } from './types';

function todayInt(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function parseHHmm(s: string): number {
  const [h, m] = s.split(':');
  return parseInt(h) * 60 + parseInt(m);
}

function inNoTradeTime(now: Date, ranges: string): boolean {
  if (!ranges?.trim()) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const chunk of ranges.replace(/，/g, ',').split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed || !trimmed.includes('-')) continue;
    const [s, e] = trimmed.split('-', 1);
    try {
      const sm = parseHHmm(s.trim());
      const em = parseHHmm(e.trim());
      if (sm <= em) {
        if (sm <= cur && cur < em) return true;
      } else {
        if (cur >= sm || cur < em) return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

interface EvalResult {
  pass: boolean;
  summary: string;
  lines: string[];
}

export class StrategyEngine {
  private cfg: Config;
  private agg: CandleAggregator;
  private broker: BrokerBase;
  private state: EngineState;
  private log: LogBuffer;
  private bus: EventBus;

  // 节流
  private lastTickRun = 0;
  private tickInterval = 30; // ms
  private lastStatusLog = 0;
  private statusLogInterval = 10000; // 10s
  private lastEvalLog = 0;
  private evalLogInterval = 5000; // 5s
  private lastEvalResult: Record<string, any> = {};

  // 回调
  private onStateChange?: (snapshot: any) => void;

  constructor(
    cfg: Config,
    agg: CandleAggregator,
    broker: BrokerBase,
    state: EngineState,
    log: LogBuffer,
    bus: EventBus
  ) {
    this.cfg = cfg;
    this.agg = agg;
    this.broker = broker;
    this.state = state;
    this.log = log;
    this.bus = bus;
  }

  setOnStateChange(cb: (snapshot: any) => void): void {
    this.onStateChange = cb;
  }

  // ============ 入口 ============
  async onTick(price: number, bid: number, ask: number): Promise<void> {
    const now = Date.now();

    // 节流：30ms 才执行一次
    if (now - this.lastTickRun < this.tickInterval) return;
    this.lastTickRun = now;

    // 更新行情
    this.state.last_price = price;
    this.state.bid = bid;
    this.state.ask = ask;
    this.state.last_tick_ts = now / 1000;

    // 兜底：无仓位但状态未归零
    await this.fallbackReset();

    // 主体流程
    await this.checkSignals();
    await this.checkGridTrading(price, bid, ask);
    await this.checkTpSl(price, bid, ask);

    // 推状态
    const snapshot = this.state.snapshot();
    this.bus.publish('state', snapshot);
    this.onStateChange?.(snapshot);

    // 定期日志
    if (now - this.lastStatusLog >= this.statusLogInterval) {
      this.lastStatusLog = now;
      this.logStatus(price);
    }
  }

  private logStatus(price: number): void {
    const cfg = this.cfg;
    const [curRsi, prevRsi] = this.rsiValues();
    const bull = this.htfTrendBullish();
    const bear = this.htfTrendBearish();
    const ma1 = this.htfMa1();
    const ma2 = this.htfMa2();
    const adxV = this.htfAdx();
    const htfClose = this.htfClose();
    const [mv, sv] = this.htfMacd();

    this.log.info(
      `[状态] price=${price} | ` +
      `RSI=${curRsi?.toFixed(1) ?? '?'}(prev=${prevRsi?.toFixed(1) ?? '?'}) | ` +
      `HTF_close=${htfClose?.toFixed(4) ?? '?'} | ` +
      `MA1=${ma1?.toFixed(4) ?? '?'} MA2=${ma2?.toFixed(4) ?? '?'} | ` +
      `ADX=${adxV?.toFixed(2) ?? '?'}(th=${cfg.htf_adx_threshold}) | ` +
      `MACD_main=${mv?.toFixed(4) ?? '?'} sig=${sv?.toFixed(4) ?? '?'} | ` +
      `BULL=${bull ? 'YES' : bear ? 'NO' : '?'} | ` +
      `LONG=${this.state.total_long_lots} SHORT=${this.state.total_short_lots} | ` +
      `pnl=${this.state.unrealized_pnl.toFixed(2)}`
    );
  }

  private async fallbackReset(): Promise<void> {
    const positions = await this.broker.getPositions();
    const longQty = positions.filter(p => p.side === 'LONG').reduce((s, p) => s + p.qty, 0);
    const shortQty = positions.filter(p => p.side === 'SHORT').reduce((s, p) => s + p.qty, 0);

    this.state.total_long_lots = longQty;
    this.state.total_short_lots = shortQty;
    this.state.unrealized_pnl = positions.reduce((s, p) => s + p.unrealized_pnl, 0);

    const anyActive = this.state.buy.active || this.state.sell.active ||
      this.state.buy.avg_price > 0 || this.state.sell.avg_price > 0;

    if (longQty <= 0 && shortQty <= 0 && anyActive) {
      this.log.warn('检测到无仓位但状态未归零，执行重置');
      this.state.buy.active = false;
      this.state.buy.grids = [];
      this.state.buy.avg_price = 0;
      this.state.sell.active = false;
      this.state.sell.grids = [];
      this.state.sell.avg_price = 0;
    } else if (longQty > 0 && !this.state.buy.active) {
      this.state.buy.active = true;
    } else if (shortQty > 0 && !this.state.sell.active) {
      this.state.sell.active = true;
    }
  }

  // ============ HTF 指标 ============
  private htfClose(): number | null {
    const shift = this.cfg.htf_use_closed_bar ? 1 : 0;
    const c = this.agg.getCandle(this.cfg.htf_timeframe, shift);
    return c?.close ?? null;
  }

  private htfMa1(): number | null {
    const shift = this.cfg.htf_use_closed_bar ? 1 : 0;
    const closes = this.agg.getCloses(this.cfg.htf_timeframe);
    const period = calcHtfMaPeriod1(this.cfg.htf_sensitivity);
    if (closes.length < Math.max(period, 5)) return null;

    const targetIdx = closes.length - 1 - shift;
    if (targetIdx < period - 1) return null;

    const sub = closes.slice(0, targetIdx + 1);
    const arr = ema(sub, period);
    const v = arr[arr.length - 1];
    return isNaN(v) ? null : v;
  }

  private htfMa2(): number | null {
    const closes = this.agg.getCloses(this.cfg.htf_timeframe);
    if (closes.length < this.cfg.htf_ma_period2 + 1) return null;

    const targetIdx = closes.length - 1 - (this.cfg.htf_use_closed_bar ? 1 : 0);
    if (targetIdx < this.cfg.htf_ma_period2 - 1) return null;

    const sub = closes.slice(0, targetIdx + 1);
    const arr = ema(sub, this.cfg.htf_ma_period2);
    const v = arr[arr.length - 1];
    return isNaN(v) ? null : v;
  }

  private htfAdx(): number | null {
    const n = this.cfg.htf_adx_period * 3 + 5;
    const ohlcv = this.agg.getOhlcv(this.cfg.htf_timeframe, n);
    if (ohlcv.length < this.cfg.htf_adx_period * 2 + 1) return null;

    const targetIdx = ohlcv.length - 1 - (this.cfg.htf_use_closed_bar ? 1 : 0);
    if (targetIdx < this.cfg.htf_adx_period * 2) return null;

    const highs = ohlcv.slice(0, targetIdx + 1).map(c => c.high);
    const lows = ohlcv.slice(0, targetIdx + 1).map(c => c.low);
    const closes = ohlcv.slice(0, targetIdx + 1).map(c => c.close);
    const arr = adx(highs, lows, closes, this.cfg.htf_adx_period);
    const v = arr[arr.length - 1];
    return isNaN(v) ? null : v;
  }

  private htfMacd(): [number | null, number | null] {
    const closes = this.agg.getCloses(this.cfg.htf_timeframe);
    if (closes.length < this.cfg.htf_macd_slow + this.cfg.htf_macd_signal + 5) return [null, null];

    const targetIdx = closes.length - 1 - (this.cfg.htf_use_closed_bar ? 1 : 0);
    const sub = closes.slice(0, targetIdx + 1);
    const { main, signal } = macd(sub, this.cfg.htf_macd_fast, this.cfg.htf_macd_slow, this.cfg.htf_macd_signal);
    const mv = main[main.length - 1];
    const sv = signal[signal.length - 1];
    return [isNaN(mv) ? null : mv, isNaN(sv) ? null : sv];
  }

  private htfTrendBullish(): boolean | null {
    const close = this.htfClose();
    if (close === null) return null;

    switch (this.cfg.trend_method) {
      case 'price_vs_ma': {
        const ma1 = this.htfMa1();
        if (ma1 === null) return null;
        return close > ma1;
      }
      case 'ma_crossover': {
        const ma1 = this.htfMa1(), ma2 = this.htfMa2();
        if (ma1 === null || ma2 === null) return null;
        return ma1 > ma2;
      }
      case 'ma_adx': {
        const ma1 = this.htfMa1(), adxV = this.htfAdx();
        if (ma1 === null || adxV === null) return null;
        return close > ma1 && adxV >= this.cfg.htf_adx_threshold;
      }
      case 'macd': {
        const [mv, sv] = this.htfMacd();
        if (mv === null || sv === null) return null;
        return mv > sv;
      }
      default:
        return null;
    }
  }

  private htfTrendBearish(): boolean | null {
    const close = this.htfClose();
    if (close === null) return null;

    switch (this.cfg.trend_method) {
      case 'price_vs_ma': {
        const ma1 = this.htfMa1();
        if (ma1 === null) return null;
        return close < ma1;
      }
      case 'ma_crossover': {
        const ma1 = this.htfMa1(), ma2 = this.htfMa2();
        if (ma1 === null || ma2 === null) return null;
        return ma1 < ma2;
      }
      case 'ma_adx': {
        const ma1 = this.htfMa1(), adxV = this.htfAdx();
        if (ma1 === null || adxV === null) return null;
        return close < ma1 && adxV >= this.cfg.htf_adx_threshold;
      }
      case 'macd': {
        const [mv, sv] = this.htfMacd();
        if (mv === null || sv === null) return null;
        return mv < sv;
      }
      default:
        return null;
    }
  }

  // ============ RSI ============
  private rsiValues(): [number | null, number | null] {
    const n = this.cfg.rsi_period * 4 + 50;
    const ohlcv = this.agg.getOhlcv('1m', n);
    if (!ohlcv.length) return [null, null];

    const closed = ohlcv[ohlcv.length - 1].is_closed ? ohlcv : ohlcv.slice(0, -1);
    const closes = closed.map(c => c.close);
    if (closes.length < this.cfg.rsi_period + 2) return [null, null];

    const arr = rsi(closes, this.cfg.rsi_period);
    const cur = arr[arr.length - 1];
    const prv = arr[arr.length - 2];
    return [isNaN(cur) ? null : cur, isNaN(prv) ? null : prv];
  }

  private currentCandleForSignal(): [number | null, number | null] {
    const cur = this.agg.getCandle('1m', 0);
    if (cur && cur.open > 0) return [cur.open, cur.close];
    const prev = this.agg.getCandle('1m', 1);
    if (prev) return [prev.open, prev.close];
    return [null, null];
  }

  // ============ 入场评估 ============
  private async evaluateEntry(isBuy: boolean): Promise<EvalResult> {
    const cfg = this.cfg;
    const [curRsi, prevRsi] = this.rsiValues();
    const curRsiVal = curRsi ?? 50;
    const prevRsiVal = prevRsi ?? 50;
    const side = isBuy ? 'BUY' : 'SELL';
    let allPass = true;
    const lines: string[] = [];

    const cond = (name: string, ok: boolean, detail: string) => {
      if (!ok) allPass = false;
      lines.push(`${ok ? '✓' : '✗'}${name}: ${detail}`);
    };

    // RSI 条件
    if (cfg.enable_check_rsi) {
      if (isBuy) {
        const oversoldTh = 80 - (cfg.open_factor - 1) * 6.6667;
        const [o, c] = this.currentCandleForSignal();
        if (curRsiVal < oversoldTh) {
          if (o !== null && c !== null) {
            const bullBar = c > o;
            cond('RSI', bullBar,
              `cur=${curRsiVal.toFixed(1)} < oversold=${oversoldTh.toFixed(1)}，` +
              `K线${bullBar ? '阳' : '阴'}(open=${o} close=${c})`);
          } else {
            cond('RSI', false, `cur=${curRsiVal.toFixed(1)} < oversold=${oversoldTh.toFixed(1)}，K线数据不足`);
          }
        } else {
          cond('RSI', true, `cur=${curRsiVal.toFixed(1)} >= oversold=${oversoldTh.toFixed(1)}`);
        }
      } else {
        const overboughtTh = 20 + (cfg.open_factor - 1) * 6.6667;
        const [o, c] = this.currentCandleForSignal();
        if (curRsiVal > overboughtTh) {
          if (o !== null && c !== null) {
            const bearBar = c < o;
            cond('RSI', bearBar,
              `cur=${curRsiVal.toFixed(1)} > overbought=${overboughtTh.toFixed(1)}，` +
              `K线${bearBar ? '阴' : '阳'}(open=${o} close=${c})`);
          } else {
            cond('RSI', false, `cur=${curRsiVal.toFixed(1)} > overbought=${overboughtTh.toFixed(1)}，K线数据不足`);
          }
        } else {
          cond('RSI', true, `cur=${curRsiVal.toFixed(1)} <= overbought=${overboughtTh.toFixed(1)}`);
        }
      }
    } else {
      cond('RSI', true, '未启用');
    }

    // HTF 趋势条件
    if (cfg.enable_check_htf) {
      const htfClose = this.htfClose();
      if (isBuy) {
        const bull = this.htfTrendBullish();
        if (htfClose === null) {
          cond('HTF', false, 'HTF K线数据不足，无法判断趋势');
        } else if (bull === null) {
          cond('HTF', false, `close=${htfClose}，指标数据不足`);
        } else if (bull) {
          cond('HTF', true, `BULL=True (close=${htfClose} > MA1)`);
        } else {
          cond('HTF', false, `BULL=False (close=${htfClose} <= MA1)`);
        }
      } else {
        const bear = this.htfTrendBearish();
        if (htfClose === null) {
          cond('HTF', false, 'HTF K线数据不足');
        } else if (bear === null) {
          cond('HTF', false, `close=${htfClose}，指标数据不足`);
        } else if (bear) {
          cond('HTF', true, `BEAR=True (close=${htfClose} < MA1)`);
        } else {
          cond('HTF', false, `BEAR=False (close=${htfClose} >= MA1)`);
        }
      }
    } else {
      cond('HTF', true, '未启用');
    }

    // 全局过滤
    cond('日开仓限', !this.state.daily_limit_reached,
      cfg.enable_daily_open_limit
        ? `${this.state.daily_open_count}/${cfg.daily_max_opens}`
        : '未启用');
    cond('交易时段', !this.state.in_no_trade_time,
      this.state.in_no_trade_time ? '当前在禁止时段' : '允许交易');
    cond('平仓冷却', !this.state.wait_after_close,
      this.state.wait_after_close
        ? `冷却中(${((Date.now() / 1000 - this.state.last_close_time) / 60).toFixed(1)}min)`
        : '无冷却');
    cond('亏损冷却', !this.state.wait_after_maxloss,
      this.state.wait_after_maxloss
        ? `冷却中(${((Date.now() / 1000 - this.state.last_maxloss_time) / 60).toFixed(1)}min)`
        : '无冷却');
    cond('已有仓位', this.state.total_long_lots <= 0 && this.state.total_short_lots <= 0,
      `long=${this.state.total_long_lots} short=${this.state.total_short_lots}`);

    const summary = `${side} ${allPass ? 'PASS' : 'FAIL'}`;
    this.state.last_eval_text = summary;
    this.state.last_eval_time = Date.now() / 1000;

    // 日志节流
    const resultKey = JSON.stringify({ side, allPass, lines });
    const now = Date.now();
    if (now - this.lastEvalLog >= this.evalLogInterval ||
        resultKey !== JSON.stringify(this.lastEvalResult[side] ?? {})) {
      this.lastEvalLog = now;
      this.lastEvalResult[side] = { allPass, lines };
      this.log.info(`[${side}评估] ${summary}\n  ${lines.join('\n  ')}`);
    }

    return { pass: allPass, summary, lines };
  }

  // ============ 信号检查 ============
  private async checkSignals(): Promise<void> {
    const cfg = this.cfg;

    // 每日重置
    const today = todayInt();
    if (cfg.enable_daily_open_limit && today > this.state.last_open_date) {
      this.state.daily_open_count = 0;
      this.state.last_open_date = today;
    }

    // 不做单时间段
    this.state.in_no_trade_time = cfg.enable_trading_hours
      ? inNoTradeTime(new Date(), cfg.no_trade_times)
      : false;

    // 每日限制
    this.state.daily_limit_reached = cfg.enable_daily_open_limit
      && this.state.daily_open_count >= cfg.daily_max_opens;

    // 平仓后等待
    this.state.wait_after_close = false;
    if (cfg.enable_wait_after_close && cfg.wait_minutes_after_close > 0 && this.state.last_close_time > 0) {
      if ((Date.now() / 1000 - this.state.last_close_time) / 60 < cfg.wait_minutes_after_close) {
        this.state.wait_after_close = true;
      }
    }

    // 亏损止损后等待
    this.state.wait_after_maxloss = false;
    if (cfg.wait_after_max_loss && cfg.max_loss_wait_minutes > 0 && this.state.last_maxloss_time > 0) {
      if ((Date.now() / 1000 - this.state.last_maxloss_time) / 60 < cfg.max_loss_wait_minutes) {
        this.state.wait_after_maxloss = true;
      } else {
        this.state.last_maxloss_time = 0;
      }
    }

    // 多空互斥
    if (this.state.total_long_lots > 0 || this.state.total_short_lots > 0) return;

    // 多头信号
    if (cfg.trade_buy && !this.state.buy.active
      && !this.state.daily_limit_reached
      && !this.state.wait_after_close
      && !this.state.wait_after_maxloss
      && !this.state.in_no_trade_time
      && this.state.total_long_lots <= 0 && this.state.total_short_lots <= 0) {
      const { pass } = await this.evaluateEntry(true);
      if (pass) {
        await this.startBuyGrid();
        if (cfg.enable_daily_open_limit && this.state.buy.active) {
          this.state.daily_open_count++;
        }
      }
    }

    // 空头信号
    if (cfg.trade_sell && !this.state.sell.active
      && !this.state.daily_limit_reached
      && !this.state.wait_after_close
      && !this.state.wait_after_maxloss
      && !this.state.in_no_trade_time
      && this.state.total_long_lots <= 0 && this.state.total_short_lots <= 0) {
      const { pass } = await this.evaluateEntry(false);
      if (pass) {
        await this.startSellGrid();
        if (cfg.enable_daily_open_limit && this.state.sell.active) {
          this.state.daily_open_count++;
        }
      }
    }
  }

  // ============ 网格 ============
  private async startBuyGrid(): Promise<void> {
    const s = this.state.buy;
    s.active = true;
    s.avg_price = 0;
    s.grids = [];

    const order = await this.broker.openMarket('BUY', this.cfg.grid_lot_size);
    if (order.status === 'FILLED' && order.price > 0) {
      s.grids.push({
        index: 0,
        side: 'BUY',
        entry_price: order.price,
        lot_size: order.qty,
        open_time: Date.now() / 1000,
      });
      s.avg_price = order.price;
      this.log.trade(`做多首仓 px=${order.price} qty=${order.qty}`);
    } else {
      s.active = false;
    }
  }

  private async startSellGrid(): Promise<void> {
    const s = this.state.sell;
    s.active = true;
    s.avg_price = 0;
    s.grids = [];

    const order = await this.broker.openMarket('SELL', this.cfg.grid_lot_size);
    if (order.status === 'FILLED' && order.price > 0) {
      s.grids.push({
        index: 0,
        side: 'SELL',
        entry_price: order.price,
        lot_size: order.qty,
        open_time: Date.now() / 1000,
      });
      s.avg_price = order.price;
      this.log.trade(`做空首仓 px=${order.price} qty=${order.qty}`);
    } else {
      s.active = false;
    }
  }

  private async checkBuyGrid(ask: number): Promise<void> {
    const s = this.state.buy;
    if (!s.active || !s.grids.length) return;

    const lastIdx = s.grids.length - 1;
    if (lastIdx >= this.cfg.grid_count - 1) return;

    const lastPrice = s.grids[lastIdx].entry_price;
    const gridPrice = lastPrice * (1 - this.cfg.grid_spacing_pct / 100);

    if (ask <= gridPrice) {
      const order = await this.broker.openMarket('BUY', this.cfg.grid_lot_size);
      if (order.status === 'FILLED' && order.price > 0) {
        const totalQty = s.grids.reduce((sum, g) => sum + g.lot_size, 0) + order.qty;
        const totalCost = s.avg_price * s.grids.reduce((sum, g) => sum + g.lot_size, 0) + order.price * order.qty;
        s.avg_price = totalCost / totalQty;
        s.grids.push({
          index: lastIdx + 1,
          side: 'BUY',
          entry_price: order.price,
          lot_size: order.qty,
          open_time: Date.now() / 1000,
        });
        this.log.trade(`做多加仓 idx=${lastIdx + 1} px=${order.price} qty=${order.qty} avg=${s.avg_price.toFixed(4)}`);
      }
    }
  }

  private async checkSellGrid(bid: number): Promise<void> {
    const s = this.state.sell;
    if (!s.active || !s.grids.length) return;

    const lastIdx = s.grids.length - 1;
    if (lastIdx >= this.cfg.grid_count - 1) return;

    const lastPrice = s.grids[lastIdx].entry_price;
    const gridPrice = lastPrice * (1 + this.cfg.grid_spacing_pct / 100);

    if (bid >= gridPrice) {
      const order = await this.broker.openMarket('SELL', this.cfg.grid_lot_size);
      if (order.status === 'FILLED' && order.price > 0) {
        const totalQty = s.grids.reduce((sum, g) => sum + g.lot_size, 0) + order.qty;
        const totalCost = s.avg_price * s.grids.reduce((sum, g) => sum + g.lot_size, 0) + order.price * order.qty;
        s.avg_price = totalCost / totalQty;
        s.grids.push({
          index: lastIdx + 1,
          side: 'SELL',
          entry_price: order.price,
          lot_size: order.qty,
          open_time: Date.now() / 1000,
        });
        this.log.trade(`做空加仓 idx=${lastIdx + 1} px=${order.price} qty=${order.qty} avg=${s.avg_price.toFixed(4)}`);
      }
    }
  }

  private async checkGridTrading(price: number, bid: number, ask: number): Promise<void> {
    await this.checkBuyGrid(ask);
    await this.checkSellGrid(bid);
  }

  // ============ 平仓 ============
  private async closePartialBuy(ratio: number): Promise<void> {
    const positions = await this.broker.getPositions();
    const total = positions.filter(p => p.side === 'LONG').reduce((s, p) => s + p.qty, 0);
    if (total <= 0) return;

    const target = parseFloat((total * ratio).toFixed(3));
    if (target <= 0) return;

    await this.broker.closeMarket('BUY', target);

    // 状态：网格按价格匹配，扣减
    let remaining = target;
    for (const g of this.state.buy.grids) {
      if (remaining <= 0) break;
      const take = Math.min(g.lot_size, remaining);
      g.lot_size -= take;
      remaining -= take;
    }
    this.state.buy.grids = this.state.buy.grids.filter(g => g.lot_size > 1e-9);

    // 检查全部平掉
    const positions2 = await this.broker.getPositions();
    if (!positions2.some(p => p.side === 'LONG')) {
      this.onFullClose('BUY');
    }
  }

  private async closePartialSell(ratio: number): Promise<void> {
    const positions = await this.broker.getPositions();
    const total = positions.filter(p => p.side === 'SHORT').reduce((s, p) => s + p.qty, 0);
    if (total <= 0) return;

    const target = parseFloat((total * ratio).toFixed(3));
    if (target <= 0) return;

    await this.broker.closeMarket('SELL', target);

    let remaining = target;
    for (const g of this.state.sell.grids) {
      if (remaining <= 0) break;
      const take = Math.min(g.lot_size, remaining);
      g.lot_size -= take;
      remaining -= take;
    }
    this.state.sell.grids = this.state.sell.grids.filter(g => g.lot_size > 1e-9);

    const positions2 = await this.broker.getPositions();
    if (!positions2.some(p => p.side === 'SHORT')) {
      this.onFullClose('SELL');
    }
  }

  async closeAllBuy(): Promise<void> {
    await this.broker.closeMarket('BUY');
    this.onFullClose('BUY');
  }

  async closeAllSell(): Promise<void> {
    await this.broker.closeMarket('SELL');
    this.onFullClose('SELL');
  }

  private onFullClose(side: 'BUY' | 'SELL'): void {
    if (side === 'BUY') {
      this.state.buy.active = false;
      this.state.buy.grids = [];
      this.state.buy.avg_price = 0;
    } else {
      this.state.sell.active = false;
      this.state.sell.grids = [];
      this.state.sell.avg_price = 0;
    }
    if (this.cfg.enable_wait_after_close) {
      this.state.last_close_time = Date.now() / 1000;
    }
    this.log.trade(`${side} 仓位全部平仓，状态已重置`);
  }

  // ============ 止盈/止损/移动止损/保本损 ============
  private async checkTpSl(price: number, bid: number, ask: number): Promise<void> {
    const cfg = this.cfg;

    // 最大亏损
    if (cfg.use_max_loss && cfg.max_loss_usdt > 0) {
      if (this.state.unrealized_pnl <= -cfg.max_loss_usdt) {
        this.log.warn(`触发最大亏损 ${this.state.unrealized_pnl.toFixed(2)} <= -${cfg.max_loss_usdt}，全部平仓`);
        this.state.last_maxloss_time = Date.now() / 1000;
        await this.closeAllBuy();
        await this.closeAllSell();
        return;
      }
    }

    await this.checkBuyTpSl(price, bid, ask);
    await this.checkSellTpSl(price, bid, ask);
  }

  private async checkBuyTpSl(price: number, bid: number, ask: number): Promise<void> {
    const cfg = this.cfg;
    const s = this.state.buy;
    if (!s.active || s.avg_price <= 0) return;
    if (!s.grids.some(g => g.lot_size > 0)) return;

    const cur = bid;
    const profitPct = (cur - s.avg_price) / s.avg_price * 100;

    // 移动止盈
    if (cfg.use_trailing_stop && cfg.trailing_start_pct > 0 && cfg.trailing_back_pct > 0) {
      const activate = s.avg_price * (1 + cfg.trailing_start_pct / 100);
      if (cur >= activate) {
        const cand = cur * (1 - cfg.trailing_back_pct / 100);
        if (s.trail_level === 0 || cand > s.trail_level) {
          s.trail_level = cand;
          this.log.info(`多头移动止盈上移 → ${s.trail_level.toFixed(4)}`);
        }
      }
    }

    // 分批止盈
    if (cfg.use_split_tp) {
      if (profitPct >= cfg.tp_level1_pct && !s.level1_done) {
        this.log.info(`多头第1批止盈 profit=${profitPct.toFixed(2)}% 平 ${cfg.tp_level1_ratio * 100}%`);
        await this.closePartialBuy(cfg.tp_level1_ratio);
        s.level1_done = true;
        s.breakeven_triggered = true;
        return;
      }
      if (profitPct >= cfg.tp_level2_pct && s.level1_done && !s.level2_done) {
        this.log.info(`多头第2批止盈 profit=${profitPct.toFixed(2)}% 平 ${cfg.tp_level2_ratio * 100}%`);
        await this.closePartialBuy(cfg.tp_level2_ratio);
        s.level2_done = true;
        return;
      }
      if (profitPct >= cfg.tp_level3_pct && s.level2_done) {
        this.log.info(`多头第3批止盈（全部）profit=${profitPct.toFixed(2)}%`);
        await this.closeAllBuy();
        return;
      }
      if (profitPct >= cfg.tp_percent && (!cfg.use_split_tp || (s.level1_done && s.level2_done))) {
        this.log.info(`多头止盈（全部）profit=${profitPct.toFixed(2)}%`);
        await this.closeAllBuy();
        return;
      }
    } else {
      if (s.trail_level === 0) {
        const tpPrice = s.avg_price * (1 + cfg.tp_percent / 100);
        if (cur >= tpPrice) {
          this.log.info(`多头止盈 profit=${profitPct.toFixed(2)}%`);
          await this.closeAllBuy();
          return;
        }
      }
    }

    // 保本损
    if (cfg.use_breakeven && s.breakeven_triggered) {
      const be = s.avg_price * (1 + cfg.breakeven_offset / 100);
      if (cur <= be) {
        this.log.info(`多头保本损触发 cur=${cur.toFixed(4)} <= be=${be.toFixed(4)}`);
        await this.closeAllBuy();
        return;
      }
    }

    // 网格打满后按成本价止损
    const active = s.grids.filter(g => g.entry_price > 0).length;
    if (active >= cfg.grid_count) {
      const slPrice = s.avg_price * (1 - cfg.sl_percent / 100);
      if (cur <= slPrice) {
        this.log.warn(`多头止损 cur=${cur.toFixed(4)} <= sl=${slPrice.toFixed(4)}`);
        this.state.last_maxloss_time = Date.now() / 1000;
        await this.closeAllBuy();
      }
    }
  }

  private async checkSellTpSl(price: number, bid: number, ask: number): Promise<void> {
    const cfg = this.cfg;
    const s = this.state.sell;
    if (!s.active || s.avg_price <= 0) return;
    if (!s.grids.some(g => g.lot_size > 0)) return;

    const cur = ask;
    const profitPct = (s.avg_price - cur) / s.avg_price * 100;

    // 移动止盈
    if (cfg.use_trailing_stop && cfg.trailing_start_pct > 0 && cfg.trailing_back_pct > 0) {
      const activate = s.avg_price * (1 - cfg.trailing_start_pct / 100);
      if (cur <= activate) {
        const cand = cur * (1 + cfg.trailing_back_pct / 100);
        if (s.trail_level === 0 || cand < s.trail_level) {
          s.trail_level = cand;
          this.log.info(`空头移动止盈下移 → ${s.trail_level.toFixed(4)}`);
        }
      }
    }

    // 分批止盈
    if (cfg.use_split_tp) {
      if (profitPct >= cfg.tp_level1_pct && !s.level1_done) {
        this.log.info(`空头第1批止盈 profit=${profitPct.toFixed(2)}% 平 ${cfg.tp_level1_ratio * 100}%`);
        await this.closePartialSell(cfg.tp_level1_ratio);
        s.level1_done = true;
        s.breakeven_triggered = true;
        return;
      }
      if (profitPct >= cfg.tp_level2_pct && s.level1_done && !s.level2_done) {
        this.log.info(`空头第2批止盈 profit=${profitPct.toFixed(2)}% 平 ${cfg.tp_level2_ratio * 100}%`);
        await this.closePartialSell(cfg.tp_level2_ratio);
        s.level2_done = true;
        return;
      }
      if (profitPct >= cfg.tp_level3_pct && s.level2_done) {
        this.log.info(`空头第3批止盈（全部）profit=${profitPct.toFixed(2)}%`);
        await this.closeAllSell();
        return;
      }
      if (profitPct >= cfg.tp_percent && (!cfg.use_split_tp || (s.level1_done && s.level2_done))) {
        this.log.info(`空头止盈（全部）profit=${profitPct.toFixed(2)}%`);
        await this.closeAllSell();
        return;
      }
    } else {
      if (s.trail_level === 0) {
        const tpPrice = s.avg_price * (1 - cfg.tp_percent / 100);
        if (cur <= tpPrice) {
          this.log.info(`空头止盈 profit=${profitPct.toFixed(2)}%`);
          await this.closeAllSell();
          return;
        }
      }
    }

    // 保本损
    if (cfg.use_breakeven && s.breakeven_triggered) {
      const be = s.avg_price * (1 - cfg.breakeven_offset / 100);
      if (cur >= be) {
        this.log.info(`空头保本损触发 cur=${cur.toFixed(4)} >= be=${be.toFixed(4)}`);
        await this.closeAllSell();
        return;
      }
    }

    // 网格打满后止损
    const active = s.grids.filter(g => g.entry_price > 0).length;
    if (active >= cfg.grid_count) {
      const slPrice = s.avg_price * (1 + cfg.sl_percent / 100);
      if (cur >= slPrice) {
        this.log.warn(`空头止损 cur=${cur.toFixed(4)} >= sl=${slPrice.toFixed(4)}`);
        this.state.last_maxloss_time = Date.now() / 1000;
        await this.closeAllSell();
      }
    }
  }
}
