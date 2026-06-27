import { useState } from 'react';
import { useAppStore } from '../hooks/useStore';

export function ConfigPanel() {
  const { config, setConfig } = useAppStore();
  const [localConfig, setLocalConfig] = useState({ ...config });
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setConfig(localConfig);
    setSaving(true);
    setTimeout(() => setSaving(false), 1000);
  };

  const handleReset = () => {
    setLocalConfig({ ...config });
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">参数配置</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleReset}>
            重置
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? '已保存' : '保存'}
          </button>
        </div>
      </div>
      <div className="card-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <div className="form-group">
          <label className="form-label">交易对</label>
          <input
            type="text"
            className="form-input"
            value={localConfig.symbol}
            onChange={(e) => setLocalConfig({ ...localConfig, symbol: e.target.value.toUpperCase() })}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">杠杆</label>
            <input
              type="number"
              className="form-input"
              value={localConfig.leverage}
              onChange={(e) => setLocalConfig({ ...localConfig, leverage: parseInt(e.target.value) || 10 })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">保证金模式</label>
            <select
              className="form-input"
              value={localConfig.margin_mode}
              onChange={(e) => setLocalConfig({ ...localConfig, margin_mode: e.target.value as 'ISOLATED' | 'CROSSED' })}
            >
              <option value="ISOLATED">逐仓</option>
              <option value="CROSSED">全仓</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">网格数量</label>
            <input
              type="number"
              className="form-input"
              value={localConfig.grid_count}
              onChange={(e) => setLocalConfig({ ...localConfig, grid_count: parseInt(e.target.value) || 5 })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">网格间距 (%)</label>
            <input
              type="number"
              className="form-input"
              step="0.01"
              value={localConfig.grid_spacing_pct}
              onChange={(e) => setLocalConfig({ ...localConfig, grid_spacing_pct: parseFloat(e.target.value) || 0.15 })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">每格数量</label>
            <input
              type="number"
              className="form-input"
              step="0.001"
              value={localConfig.grid_lot_size}
              onChange={(e) => setLocalConfig({ ...localConfig, grid_lot_size: parseFloat(e.target.value) || 1 })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">止盈 (%)</label>
            <input
              type="number"
              className="form-input"
              step="0.01"
              value={localConfig.tp_percent}
              onChange={(e) => setLocalConfig({ ...localConfig, tp_percent: parseFloat(e.target.value) || 0.8 })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">止损 (%)</label>
            <input
              type="number"
              className="form-input"
              step="0.01"
              value={localConfig.sl_percent}
              onChange={(e) => setLocalConfig({ ...localConfig, sl_percent: parseFloat(e.target.value) || 0.7 })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">启用RSI</label>
            <select
              className="form-input"
              value={localConfig.enable_check_rsi ? 'true' : 'false'}
              onChange={(e) => setLocalConfig({ ...localConfig, enable_check_rsi: e.target.value === 'true' })}
            >
              <option value="true">启用</option>
              <option value="false">禁用</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">交易方向</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={localConfig.trade_buy}
                onChange={(e) => setLocalConfig({ ...localConfig, trade_buy: e.target.checked })}
              />
              做多
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={localConfig.trade_sell}
                onChange={(e) => setLocalConfig({ ...localConfig, trade_sell: e.target.checked })}
              />
              做空
            </label>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">模拟盘</label>
          <select
            className="form-input"
            value={localConfig.paper_trading ? 'true' : 'false'}
            onChange={(e) => setLocalConfig({ ...localConfig, paper_trading: e.target.value === 'true' })}
          >
            <option value="true">模拟盘</option>
            <option value="false">真实盘</option>
          </select>
        </div>
      </div>
    </div>
  );
}
