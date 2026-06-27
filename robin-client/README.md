# Robin Scalper Client

基于 Tauri + React + TypeScript 的加密货币网格交易客户端。

## 功能特性

- 网格交易策略（支持做多/做空）
- 实时 K 线图表（TradingView Lightweight Charts）
- 技术指标（EMA、RSI、MACD、ADX）
- 模拟盘 / 真实盘切换
- Binance Testnet 支持
- 移动止盈 / 分批止盈 / 保本损
- 每日开仓限制 / 平仓冷却

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.0 |
| 前端框架 | React 18 |
| 构建工具 | Vite |
| 语言 | TypeScript |
| 图表 | Lightweight Charts |
| 状态管理 | Zustand |

## 开发

### 环境要求

- Node.js 18+
- Rust 1.70+
- npm 或 yarn

### 安装依赖

```bash
cd robin-client
npm install
```

### 开发模式

```bash
# 启动 Vite 开发服务器
npm run dev

# 或使用 Tauri 开发模式（需要 Rust 环境）
npm run tauri dev
```

### 构建

```bash
# 构建前端
npm run build

# 构建 Tauri 应用
npm run tauri build
```

## 项目结构

```
robin-client/
├── src/
│   ├── core/               # 核心引擎 (TypeScript)
│   │   ├── config.ts       # 配置定义
│   │   ├── engine.ts       # 策略引擎
│   │   ├── aggregator.ts   # K线聚合器
│   │   ├── indicators.ts   # 技术指标
│   │   ├── broker-base.ts  # Broker 接口
│   │   ├── paper-broker.ts # 模拟盘
│   │   ├── binance-broker.ts # 真实交易
│   │   ├── binance-feed.ts # WebSocket 行情
│   │   ├── state.ts        # 状态管理
│   │   ├── bus.ts          # 事件总线
│   │   └── logger.ts       # 日志
│   ├── components/          # React 组件
│   │   ├── Chart.tsx       # K线图表
│   │   ├── Dashboard.tsx    # 状态面板
│   │   ├── PositionPanel.tsx # 持仓面板
│   │   ├── LogPanel.tsx    # 日志面板
│   │   ├── ControlPanel.tsx # 控制面板
│   │   └── ConfigPanel.tsx  # 配置面板
│   ├── hooks/
│   │   └── useStore.ts     # 状态管理
│   └── styles/
│       └── global.css      # 全局样式
├── src-tauri/              # Tauri Rust 后端
│   ├── src/main.rs         # Rust 入口
│   └── tauri.conf.json     # Tauri 配置
└── package.json
```

## 许可证

MIT
