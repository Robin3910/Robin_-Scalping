import { useAppStore } from '../hooks/useStore';

export function PositionPanel() {
  const { engineState } = useAppStore();

  if (!engineState) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">持仓信息</span>
        </div>
        <div className="card-body">
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '20px' }}>
            等待数据...
          </div>
        </div>
      </div>
    );
  }

  const { buy, sell, total_long_lots, total_short_lots, unrealized_pnl } = engineState;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">持仓信息</span>
      </div>
      <div className="card-body">
        <div className="position-grid">
          <div className={`position-card ${buy.active ? 'long' : ''}`}>
            <div className="position-label">多头 LONG</div>
            <div className={`position-value ${buy.active ? 'long' : ''}`}>
              {total_long_lots?.toFixed(3) || '0'}
            </div>
            <div className="position-detail">
              {buy.active ? (
                <>
                  均价: {buy.avg_price?.toFixed(4)}<br />
                  网格: {buy.grids?.length || 0}
                </>
              ) : '无持仓'}
            </div>
          </div>

          <div className={`position-card ${sell.active ? 'short' : ''}`}>
            <div className="position-label">空头 SHORT</div>
            <div className={`position-value ${sell.active ? 'short' : ''}`}>
              {total_short_lots?.toFixed(3) || '0'}
            </div>
            <div className="position-detail">
              {sell.active ? (
                <>
                  均价: {sell.avg_price?.toFixed(4)}<br />
                  网格: {sell.grids?.length || 0}
                </>
              ) : '无持仓'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <div className="indicator-row">
            <span className="indicator-label">未实现盈亏</span>
            <span className={`indicator-value ${unrealized_pnl >= 0 ? 'high' : 'low'}`}>
              {unrealized_pnl >= 0 ? '+' : ''}{unrealized_pnl?.toFixed(2) || '0.00'} USDT
            </span>
          </div>
        </div>

        <div style={{ marginTop: '12px' }}>
          <div className="indicator-row">
            <span className="indicator-label">多头状态</span>
            <span className={`state-indicator ${buy.active ? 'active' : 'inactive'}`}>
              {buy.active ? '活跃' : '空闲'}
            </span>
          </div>
          <div className="indicator-row">
            <span className="indicator-label">空头状态</span>
            <span className={`state-indicator ${sell.active ? 'active' : 'inactive'}`}>
              {sell.active ? '活跃' : '空闲'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
