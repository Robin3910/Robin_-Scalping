// 配置定义 - 对应 Python 版本的 Config dataclass
// 参数命名尽量与 MQ5 input 一致，方便对照

export interface Config {
  // 账户/交易对
  symbol: string;
  leverage: number;
  margin_mode: 'ISOLATED' | 'CROSSED';
  testnet: boolean;

  // 魔术数字
  magic_number: number;

  // 交易方向
  trade_buy: boolean;
  trade_sell: boolean;

  // HTF 趋势过滤
  enable_check_htf: boolean;
  htf_timeframe: string;
  trend_method: 'price_vs_ma' | 'ma_crossover' | 'ma_adx' | 'macd';
  htf_sensitivity: number;  // 1~10, 1最灵敏
  htf_ma_period2: number;
  htf_adx_period: number;
  htf_adx_threshold: number;
  htf_macd_fast: number;
  htf_macd_slow: number;
  htf_macd_signal: number;
  htf_use_closed_bar: boolean;

  // RSI 入场
  enable_check_rsi: boolean;
  rsi_period: number;
  open_factor: number;  // 1~10, 1最灵敏

  // 网格
  grid_count: number;
  grid_spacing_pct: number;
  grid_lot_size: number;

  // 止盈/止损
  tp_percent: number;
  sl_percent: number;

  // 最大亏损
  use_max_loss: boolean;
  max_loss_usdt: number;
  wait_after_max_loss: boolean;
  max_loss_wait_minutes: number;

  // 分批止盈
  use_split_tp: boolean;
  tp_level1_pct: number;
  tp_level1_ratio: number;
  tp_level2_pct: number;
  tp_level2_ratio: number;
  tp_level3_pct: number;

  // 保本损
  use_breakeven: boolean;
  breakeven_trigger: number;
  breakeven_offset: number;

  // 每日开仓限制
  enable_daily_open_limit: boolean;
  daily_max_opens: number;

  // 平仓后等待
  enable_wait_after_close: boolean;
  wait_minutes_after_close: number;

  // 不做单时间段
  enable_trading_hours: boolean;
  no_trade_times: string;

  // 移动止盈
  use_trailing_stop: boolean;
  trailing_start_pct: number;
  trailing_back_pct: number;

  // 注释
  comment_text: string;

  // 引擎
  paper_trading: boolean;
  use_testnet_paper: boolean;
  log_buffer_size: number;

  // 密码
  password: string;

  // 元信息
  last_modified: number;
}

// 派生属性计算
export function calcHtfMaPeriod1(sensitivity: number): number {
  return Math.round(50 + (sensitivity - 1) * 161.111);
}

export function calcRsiOverbought(openFactor: number): number {
  return 20 + (openFactor - 1) * 6.6667;
}

export function calcRsiOversold(openFactor: number): number {
  return 80 - (openFactor - 1) * 6.6667;
}

export function defaultConfig(): Config {
  return {
    symbol: 'SOLUSDT',
    leverage: 100,
    margin_mode: 'ISOLATED',
    testnet: true,
    magic_number: 951221,
    trade_buy: true,
    trade_sell: true,
    enable_check_htf: false,
    htf_timeframe: '15m',
    trend_method: 'price_vs_ma',
    htf_sensitivity: 5,
    htf_ma_period2: 50,
    htf_adx_period: 14,
    htf_adx_threshold: 25,
    htf_macd_fast: 12,
    htf_macd_slow: 26,
    htf_macd_signal: 9,
    htf_use_closed_bar: true,
    enable_check_rsi: true,
    rsi_period: 14,
    open_factor: 3,
    grid_count: 5,
    grid_spacing_pct: 0.15,
    grid_lot_size: 1,
    tp_percent: 0.03,
    sl_percent: 0.7,
    use_max_loss: false,
    max_loss_usdt: 50,
    wait_after_max_loss: false,
    max_loss_wait_minutes: 30,
    use_split_tp: false,
    tp_level1_pct: 0.3,
    tp_level1_ratio: 0.33,
    tp_level2_pct: 0.5,
    tp_level2_ratio: 0.33,
    tp_level3_pct: 0.6,
    use_breakeven: false,
    breakeven_trigger: 0.3,
    breakeven_offset: 0,
    enable_daily_open_limit: false,
    daily_max_opens: 3,
    enable_wait_after_close: false,
    wait_minutes_after_close: 60,
    enable_trading_hours: false,
    no_trade_times: '00:00-02:00,05:00-08:00',
    use_trailing_stop: true,
    trailing_start_pct: 0.8,
    trailing_back_pct: 0.2,
    comment_text: 'Robin_Tauri',
    paper_trading: true,
    use_testnet_paper: true,
    log_buffer_size: 500,
    password: '',
    last_modified: Date.now(),
  };
}
