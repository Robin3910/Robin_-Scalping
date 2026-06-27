import React, { useEffect } from 'react';
import { Chart } from './components/Chart';
import { Dashboard } from './components/Dashboard';
import { PositionPanel } from './components/PositionPanel';
import { LogPanel } from './components/LogPanel';
import { ControlPanel } from './components/ControlPanel';
import { ConfigPanel } from './components/ConfigPanel';
import { useAppStore, initComponents } from './hooks/useStore';
import './styles/global.css';

function App() {
  const { klines, updateKlines, logBuffer, aggregator } = useAppStore();

  useEffect(() => {
    // 初始化核心组件
    initComponents();

    // 订阅日志更新
    logBuffer.onLog = (entry) => {
      useAppStore.getState().updateLog(entry);
    };

    // 定期更新K线数据
    const interval = setInterval(() => {
      if (aggregator) {
        const candles = aggregator.getOhlcv('1m', 200);
        const klinesData = candles.map((c) => ({
          time: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
        updateKlines(klinesData);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app-container">
      <header className="header">
        <h1 className="header-title">
          <span>Robin</span> Scalper
        </h1>
        <div className="header-status">
          <ControlPanel />
        </div>
      </header>

      <main className="main-content">
        <div className="left-panel">
          <div className="card" style={{ flex: 1, minHeight: '400px' }}>
            <div className="card-header">
              <span className="card-title">K线图表</span>
            </div>
            <div style={{ flex: 1, padding: '8px', height: 'calc(100% - 48px)' }}>
              <Chart klines={klines} />
            </div>
          </div>

          <Dashboard />

          <PositionPanel />
        </div>

        <div className="right-panel">
          <ConfigPanel />
          <LogPanel />
        </div>
      </main>
    </div>
  );
}

export default App;
