import { useAppStore } from '../hooks/useStore';

export function LogPanel() {
  const { logs } = useAppStore();

  const getLevelClass = (level: string) => {
    switch (level) {
      case 'TRADE': return 'trade';
      case 'WARN': return 'warn';
      case 'ERROR': return 'error';
      default: return 'info';
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">交易日志</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {logs.length} 条
        </span>
      </div>
      <div className="card-body">
        <div className="log-panel">
          {logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
              暂无日志
            </div>
          ) : (
            logs.slice(-100).map((log, idx) => (
              <div key={idx} className={`log-entry ${getLevelClass(log.level)}`}>
                <span className="time">[{log.tstr}]</span>
                <span className="level">[{log.level}]</span> {log.msg}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
