// 全局状态管理 - 使用 Zustand

import { create } from 'zustand';
import { Config, defaultConfig } from '../core/config';
import { EngineState } from '../core/state';
import { LogEntry } from '../core/types';
import { CandleAggregator } from '../core/aggregator';
import { PaperBroker } from '../core/paper-broker';
import { BinanceBroker } from '../core/binance-broker';
import { BinanceFeed } from '../core/binance-feed';
import { EventBus } from '../core/bus';
import { LogBuffer } from '../core/logger';
import { StrategyEngine } from '../core/engine';

interface AppState {
  // 状态
  config: Config;
  engineState: any;
  logs: LogEntry[];
  klines: any[];
  isRunning: boolean;
  isConnected: boolean;
  apiKey: string;
  apiSecret: string;

  // 核心实例
  aggregator: CandleAggregator | null;
  broker: PaperBroker | BinanceBroker | null;
  feed: BinanceFeed | null;
  engine: StrategyEngine | null;
  bus: EventBus;
  logBuffer: LogBuffer;

  // 方法
  setConfig: (config: Config) => void;
  setApiCredentials: (key: string, secret: string) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  closeAll: () => Promise<void>;
  closeBuy: () => Promise<void>;
  closeSell: () => Promise<void>;
  switchToPaper: () => void;
  switchToLive: (key: string, secret: string) => void;
  updateLog: (entry: LogEntry) => void;
  updateState: (snapshot: any) => void;
  updateKlines: (klines: any[]) => void;
}

const bus = new EventBus();
const logBuffer = new LogBuffer(500, (entry) => {
  // 日志会通过事件更新
});

export const useAppStore = create<AppState>((set, get) => ({
  config: defaultConfig(),
  engineState: null,
  logs: [],
  klines: [],
  isRunning: false,
  isConnected: false,
  apiKey: '',
  apiSecret: '',
  aggregator: null,
  broker: null,
  feed: null,
  engine: null,
  bus,
  logBuffer,

  setConfig: (config) => set({ config }),

  setApiCredentials: (key, secret) => set({ apiKey: key, apiSecret: secret }),

  start: async () => {
    const state = get();
    const { config, aggregator, broker, feed, engine } = state;

    if (!aggregator || !broker || !feed || !engine) {
      console.error('Components not initialized');
      return;
    }

    // 加载历史K线
    await aggregator.loadHistory(
      config.symbol,
      config.testnet,
      200,
      (msg) => logBuffer.info(msg)
    );

    // 启动feed
    feed.start();

    // 启动引擎
    state.engine.setOnStateChange((snapshot) => {
      set({ engineState: snapshot });
    });

    set({ isRunning: true, isConnected: true });
    logBuffer.info(`策略启动: ${config.symbol} paper=${config.paper_trading}`);
  },

  stop: async () => {
    const { feed, engine } = get();
    feed?.stop();
    set({ isRunning: false });
    logBuffer.info('策略已停止');
  },

  closeAll: async () => {
    const { engine } = get();
    if (engine) {
      await engine.closeAllBuy();
      await engine.closeAllSell();
    }
  },

  closeBuy: async () => {
    const { engine } = get();
    if (engine) {
      await engine.closeAllBuy();
    }
  },

  closeSell: async () => {
    const { engine } = get();
    if (engine) {
      await engine.closeAllSell();
    }
  },

  switchToPaper: () => {
    const state = get();
    const { config } = state;
    const broker = new PaperBroker(
      config.symbol,
      config.leverage,
      config.margin_mode,
      (price) => {
        (state.broker as PaperBroker)?.updatePrice?.(price);
      }
    );
    set({ broker });
    logBuffer.info('已切换到模拟盘');
  },

  switchToLive: (key, secret) => {
    const state = get();
    const { config } = state;
    const broker = new BinanceBroker(
      config.symbol,
      key,
      secret,
      config.testnet,
      config.leverage,
      config.margin_mode
    );
    set({ broker, apiKey: key, apiSecret: secret });
    logBuffer.info('已切换到真实交易');
  },

  updateLog: (entry) => {
    set((state) => ({
      logs: [...state.logs.slice(-499), entry],
    }));
  },

  updateState: (snapshot) => {
    set({ engineState: snapshot });
  },

  updateKlines: (klines) => {
    set({ klines });
  },
}));

// 初始化核心组件
export function initComponents() {
  const state = useAppStore.getState();
  const { config, bus, logBuffer } = state;

  // 创建 K线聚合器
  const aggregator = new CandleAggregator(
    ['1m', '3m', '5m', '15m', '1h', config.htf_timeframe, '1d'],
    500
  );

  // 创建 Broker (默认模拟盘)
  const broker = new PaperBroker(
    config.symbol,
    config.leverage,
    config.margin_mode,
    (price) => broker.updatePrice?.(price)
  );

  // 创建策略引擎
  const engineState = new EngineState();
  const engine = new StrategyEngine(
    config,
    aggregator,
    broker,
    engineState,
    logBuffer,
    bus
  );

  // 创建 WebSocket Feed
  const feed = new BinanceFeed({
    symbol: config.symbol,
    testnet: config.testnet,
    onAggTrade: (price, qty, ts) => {
      aggregator.onTrade(price, qty, ts);
      bus.publish('tick', { price, qty, ts, binance_ts: ts / 1000 });
    },
    onBookTicker: (bid, ask) => {
      bus.publish('quote', { bid, ask });
    },
    onError: (err) => {
      logBuffer.error(`WebSocket错误: ${err.message}`);
    },
  });

  // 订阅事件
  bus.subscribe('tick', (env) => {
    const data = env.data;
    engine.onTick(data.price, data.bid || data.price, data.ask || data.price);
  });

  bus.subscribe('state', (env) => {
    useAppStore.getState().updateState(env.data);
  });

  // 设置到 store
  useAppStore.setState({
    aggregator,
    broker,
    engine,
    feed,
  });

  return { aggregator, broker, engine, feed, bus, logBuffer };
}
