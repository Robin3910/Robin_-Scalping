import { useAppStore } from '../hooks/useStore';

export function Dashboard() {
  const { engineState, config } = useAppStore();

  if (!engineState) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">状态面板</span>
        </div>
        <div className="card-body">
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
            等待数据...
          </div>
        </div>
      </div>
    );
  }

  const { running, paper_trading, last_price, bid, ask, rsi, htf_trend } = engineState;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">状态面板</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className={`status-badge ${running ? 'running' : 'stopped'}`}>
            <span className="dot"></span>
            {running ? '运行中' : '已停止'}
          </span>
          <span className="status-badge stopped">
            {paper_trading ? '模拟盘' : '真实盘'}
          </span>
        </div>
      </div>
      <div className="card-body">
        <div className="price-display" style={{ marginBottom: '20px' }}>
          <span className="price-main">{last_price?.toFixed(4) || '-.----'}</span>
          <span className="price-change">
            买 {bid?.toFixed(4) || '-.----'} / 卖 {ask?.toFixed(4) || '-.----'}
          </span>
        </div>

        <div className="indicator-row">
          <span className="indicator-label">HTF 趋势</span>
          <span className={`indicator-value ${
            htf_trend === '多' ? 'high' : htf_trend === '空' ? 'low' : 'neutral'
          }`}>
            {htf_trend || '-'}
          </span>
        </div>

        <div className="indicator-row">
          <span className="indicator-label">RSI(14)</span>
          <span className="indicator-value">
            {rsi?.toFixed(2) || '-'}
          </span>
        </div>

        <div className="indicator-row">
          <span className="indicator-label">延迟</span>
          <span className="indicator-value">
            {engineState.ws_latency_ms?.toFixed(1) || '-'} ms
          </span>
        </div>
      </div>
    </div>
  );
}
