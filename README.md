# Robin 震荡 · Python 移植版

把 `Robin_震荡_v0.0.3.mq5`（MetaTrader 5 EA）移植到 **Python + Flask + Binance USDT 永续合约 WebSocket**，
并附带一个浏览器可访问的实时操作面板。

> ⚠️ **风险提示**：本项目包含真实下单逻辑，参数请在 **模拟盘 / Testnet** 上充分验证后再使用；
> 数字资产交易有风险，使用本软件造成的任何损失由使用者自行承担。

---

## 功能一览

- ✅ 完整移植 MQ5 中的策略核心
  - HTF 大周期趋势过滤（4 种判断方法：价格 vs MA / 双 MA / MA+ADX / MACD）
  - RSI 穿越 + 反向 K 线的入场逻辑
  - 多/空双方向网格（数量 / 间距 / 手数 / 加权平均成本价）
  - 固定止盈止损 / 三档分批止盈 / 移动止盈 / 保本损
  - 风控：最大浮亏、每日开仓上限、平仓后等待、不做单时间段
- ✅ **每次 WebSocket 行情 tick** 都跑一次评估
- ✅ **Binance USDT 永续** WebSocket（aggTrade + bookTicker）
- ✅ **模拟盘 + 真实盘** 双模式，UI 切换；默认模拟盘，默认 Testnet
- ✅ Web 面板
  - 登录验证
  - 实时价格 / 指标 / HTF 趋势 / 网格 / 持仓 / 浮盈
  - 在线修改所有策略参数（保存即生效）
  - 实时日志（INFO / WARN / ERROR / TRADE）
  - 一键启停 / 全部平仓

---

## 快速开始

```bash
# 1) 安装依赖
pip3 install -r requirements.txt

# 2) 复制环境变量
cp .env.example .env
# 编辑 .env：修改 ROBIN_PASSWORD（必填）

# 3) 启动
ROBIN_PASSWORD=your_password python3 -m robin_scalper.main
# 或：.env 已配置好后直接
python3 -m robin_scalper.main
```

打开浏览器访问：<http://localhost:8765/>，使用 `ROBIN_PASSWORD` 登录。

---

## 配置说明

所有策略参数都通过 Web 面板或 `config/config.json` 修改，**保存即热生效**。
参数名与 MQ5 中 `input` 1:1 对应，方便对照。

| 分类 | 关键参数 | 含义 |
| --- | --- | --- |
| 交易对 | `symbol`、`leverage`、`margin_mode` | BTCUSDT、10x、ISOLATED |
| 方向 | `trade_buy`、`trade_sell` | 是否允许做多/做空 |
| HTF | `htf_timeframe`、`trend_method`、`htf_sensitivity` | 1m/3m/.../1d，1=最灵敏 |
| RSI | `rsi_period`、`open_factor` (1~10) | 1=上沿20/下沿80，10=上沿80/下沿20 |
| 网格 | `grid_count`、`grid_spacing_pct`、`grid_lot_size` | 网格数量、间距、每格手数 |
| 止盈止损 | `tp_percent`、`sl_percent` | 基于成本价的百分比 |
| 分批止盈 | `use_split_tp`、`tp_level1_*`/`tp_level2_*`/`tp_level3_pct` | 3 档分批平仓 |
| 保本损 | `use_breakeven`、`breakeven_offset` | 必须先启用分批止盈 |
| 风控 | `use_max_loss`、`max_loss_usdt` | 达到即全部平仓 |
| 时间段 | `no_trade_times` | `"00:00-02:00,05:00-08:00"`，支持跨天 |
| 移动止盈 | `use_trailing_stop`、`trailing_start_pct`、`trailing_back_pct` | 浮盈 N% 激活后回撤 M% 平仓 |

> 💡 **HTF 灵敏度**：与 MQ5 一致，公式为 `MA1 = round(50 + (sensitivity - 1) * 161.111)`。
> 灵敏度 1 → MA=50（约 50 分钟，HTF=1m）；灵敏度 10 → MA=1500（约 25 小时，HTF=1m）。
> HTF 周期请根据灵敏度合理选择，例如灵敏度 10 时建议 HTF ≥ 1h。

---

## 模拟盘 vs 真实盘

- **模拟盘（默认）**：内部撮合，吃最新行情价成交；所有浮盈按 mark price 计算。
- **真实盘**：通过 Binance USDT 永续 REST 下市价单。
  - 默认走 **Testnet**（`testnet.binancefuture.com`），首次使用请先在 Testnet 申请 API Key。
  - 切到真实盘前会调用 `/fapi/v1/leverage` 与 `/fapi/v1/marginType` 设置杠杆和保证金模式。
  - **Web 面板切换真实盘时强制要求输入 API Key/Secret**，仅写入内存，不持久化。

> 🔒 真实盘请确保 API Key 只授予「合约交易」权限，**不要**勾选「提现」。

---

## 关键设计点

1. **每次 tick 都计算** —— 与 MQ5 `OnTick` 一致；不依赖 K 线收线。
2. **本地 K 线聚合器** —— WebSocket aggTrade → 1m K 线 → 二次聚合 5m/15m/1h/HTF。
3. **HTF 已收线判断** —— 仿 MT5 `HTF_Use_ClosedBar`：默认用上一根 K 线（shift=1）来判断趋势，
   避免在 HTF 当前 K 线还没收时就误判。
4. **网格固定成本价** —— 与 MQ5 一致：加仓时**加权平均**，部分平仓**不改变**成本价。
5. **多空互斥** —— 与 MQ5 一致：有多仓就不开空，有空仓就不开多。
6. **事件总线** —— 行情、策略、推送、UI 全部解耦。

---

## 目录结构

```
Robin_-Scalping/
├── Robin_震荡_v0.0.3.mq5     # 原始 MT5 源码（参考用）
├── requirements.txt
├── .env.example
├── README.md
├── config/
│   └── config.json           # 运行时参数（自动生成）
└── robin_scalper/
    ├── main.py               # 启动入口
    ├── app.py                # 应用容器
    ├── core/
    │   ├── config.py         # 参数定义（dataclass）
    │   ├── config_store.py   # JSON 读写
    │   ├── aggregator.py     # K 线聚合
    │   ├── indicators.py     # EMA / RSI / MACD / ADX（纯 Python）
    │   ├── state.py          # 引擎状态
    │   ├── bus.py            # pub-sub 事件总线
    │   └── logger.py         # 环形日志
    ├── exchange/
    │   ├── base.py           # BrokerBase 抽象
    │   ├── paper_broker.py   # 模拟盘
    │   ├── binance_broker.py # Binance 真实下单
    │   └── binance_ws.py     # Binance 行情 WebSocket
    ├── strategy/
    │   └── engine.py         # 策略核心（移植自 MQ5 OnTick）
    └── web/
        ├── server.py         # Flask + flask-sock
        ├── templates/        # login.html / dashboard.html
        └── static/           # style.css / app.js
```

---

## 与 MQ5 的差异

| 项 | MQ5 | Python 版 |
| --- | --- | --- |
| K 线数据 | MT5 服务器推送 | 本地由 aggTrade 聚合（无 1m 历史回放，启动后增量） |
| 订单修改 SL | `trade.PositionModify` | 不改 SL，统一用「市价兜底」平仓（更可靠） |
| 授权验证 | veloalgo.com HTTP | **已移除**（MQ5 注释掉的链接也用不上了） |
| 跨进程 | 单进程 | 单进程内 asyncio loop 线程 + Flask 线程 |
| HTF MA1 周期 | 1~10 级映射 50~1500 | 同公式 |

---

## License

MIT
