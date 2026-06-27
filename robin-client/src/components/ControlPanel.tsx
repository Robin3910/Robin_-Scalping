import { useState } from 'react';
import { useAppStore } from '../hooks/useStore';

export function ControlPanel() {
  const { isRunning, start, stop, closeAll, closeBuy, closeSell, config } = useAppStore();
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    try {
      await start();
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stop();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">控制面板</span>
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {!isRunning ? (
            <button
              className="btn btn-success"
              onClick={handleStart}
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading ? '启动中...' : '启动策略'}
            </button>
          ) : (
            <button
              className="btn btn-danger"
              onClick={handleStop}
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading ? '停止中...' : '停止策略'}
            </button>
          )}
        </div>

        <div className="control-group">
          <button
            className="btn btn-secondary btn-sm"
            onClick={closeBuy}
            disabled={!isRunning}
          >
            平多
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={closeSell}
            disabled={!isRunning}
          >
            平空
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={closeAll}
            disabled={!isRunning}
          >
            全部平仓
          </button>
        </div>

        <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '12px' }}>
          <div className="indicator-row">
            <span className="indicator-label">交易对</span>
            <span className="indicator-value">{config.symbol}</span>
          </div>
          <div className="indicator-row">
            <span className="indicator-label">模式</span>
            <span className="indicator-value">{config.paper_trading ? '模拟盘' : '真实盘'}</span>
          </div>
          <div className="indicator-row">
            <span className="indicator-label">网络</span>
            <span className="indicator-value">{config.testnet ? '测试网' : '主网'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
