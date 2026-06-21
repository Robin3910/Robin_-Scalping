// Robin Scalper 前端 - Premium Dashboard
(() => {
  let cfg = null;
  let snapshot = null;
  let ws = null;
  let logLines = [];
  let lastPrices = {};

  // ---- 图表相关 ----
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let currentTf = '1m';
  let chartInitialized = false;
  let lastKlineUpdate = 0;

  // ---- 工具 ----
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d=4) => v == null || v === 0 ? '--' : Number(v).toFixed(d);

  // ---- 图表初始化 ----
  function initChart() {
    if (typeof LightweightCharts === 'undefined') {
      console.warn('LightweightCharts 未加载');
      return;
    }

    const container = $('kline-chart');
    if (!container) {
      console.warn('图表容器 kline-chart 不存在');
      return;
    }

    console.log('开始初始化图表, 容器尺寸:', container.offsetWidth, 'x', container.offsetHeight);

    // 创建图表 - v4 API
    chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: '#1a1a24' },
        textColor: '#a0a0b0',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(99, 102, 241, 0.5)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
        },
        horzLine: {
          color: 'rgba(99, 102, 241, 0.5)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: false },
    });
    console.log('图表对象已创建:', chart);

    // v4 API：蜡烛图系列
    candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    console.log('蜡烛图系列已创建:', candleSeries);

    // v4 API：成交量系列
    volumeSeries = chart.addHistogramSeries({
      color: '#6366f1',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    console.log('成交量系列已创建:', volumeSeries);

    // 响应式调整
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== container) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    // 加载初始数据
    loadKlines(currentTf);

    chartInitialized = true;
    $('chartStatus').textContent = '已连接';
  }

  async function loadKlines(tf) {
    try {
      const r = await fetch(`/api/klines?tf=${tf}&limit=300`);
      const data = await r.json();
      if (data.ok && data.klines && data.klines.length > 0) {
        updateChartData(data.klines, tf);
        $('chartStatus').textContent = `已加载 ${data.klines.length} 根K线`;
        $('chartCandleCount').textContent = `${tf}`;
      } else {
        $('chartStatus').textContent = '暂无数据';
      }
    } catch (e) {
      console.error('加载K线失败:', e);
      $('chartStatus').textContent = '加载失败';
    }
  }

  function updateChartData(klines, tf) {
    if (!chartInitialized || !candleSeries) return;

    // 调试：检查数据格式
    if (klines && klines.length > 0) {
      console.log('图表数据更新:', {
        '数据条数': klines.length,
        '第一条时间戳': klines[0].time,
        '第一条时间(可读)': new Date(klines[0].time * 1000).toISOString(),
        '最后一条时间戳': klines[klines.length-1].time,
        '最后一条时间(可读)': new Date(klines[klines.length-1].time * 1000).toISOString(),
        '样本数据': klines.slice(0, 2)
      });
    }

    const candleData = klines.map(k => ({
      time: k.time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    const volumeData = klines.map(k => ({
      time: k.time,
      value: k.volume,
      color: k.close >= k.open ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();

    if (tf) currentTf = tf;
    $('chartCandleCount').textContent = `${currentTf} · ${klines.length}根`;
  }

  function updateLastCandle(price) {
    if (!chartInitialized || !candleSeries) return;

    const now = Date.now();
    const tfSeconds = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
    const sec = tfSeconds[currentTf] || 60;
    const bucketTime = Math.floor(now / 1000 / sec) * sec;

    // 更新最新一根K线
    try {
      candleSeries.update({
        time: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
      });
    } catch (e) {
      // 忽略
    }
  }

  // ---- 动画效果 ----
  function animateValueChange(element, isPositive) {
    if (!element) return;
    element.classList.remove('value-up', 'value-down');
    void element.offsetWidth;
    element.classList.add(isPositive ? 'value-up' : 'value-down');
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function setBadge(id, on, onText, offText) {
    const el = $(id);
    el.classList.toggle('on', on);
    el.classList.toggle('off', !on);
    el.textContent = on ? onText : offText;
  }

  // ---- 标签页切换 ----
  function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        $(`tab-${target}`).classList.add('active');
      });
    });
  }

  // ---- 图表时间周期切换 ----
  function initChartTimeframes() {
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tf = btn.dataset.tf;
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTf = tf;
        loadKlines(tf);
      });
    });
  }

  // ---- WebSocket ----
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    $('connText').textContent = '连接中…';
    ws.onopen = () => {
      $('conn').classList.add('on');
      $('conn').classList.remove('off');
      $('connText').textContent = '已连接';
    };
    ws.onclose = () => {
      $('conn').classList.remove('on');
      $('conn').classList.add('off');
      $('connText').textContent = '已断开，5s 后重连';
      setTimeout(connectWS, 5000);
    };
    ws.onmessage = (ev) => {
      let env; try { env = JSON.parse(ev.data); } catch { return; }
      onMessage(env);
    };
  }

  function onMessage(env) {
    if (env.topic === 'snapshot') {
      applySnapshot(env.data);
      // 快照中也包含K线数据
      if (env.data.klines) {
        updateChartData(env.data.klines, env.data.klines_tf || '1m');
      }
    } else if (env.topic === 'state') {
      applyState(env.data);
      // 实时更新K线
      updateLastCandle(env.data.last_price);
    } else if (env.topic === 'klines') {
      updateChartData(env.data.klines, env.data.tf);
    } else if (env.topic === 'log') {
      const entries = env.data.entries || [];
      const lastTs = logLines.length ? logLines[logLines.length-1].ts : 0;
      for (const e of entries) {
        if (e.ts > lastTs) appendLog(e);
      }
    }
  }

  function applySnapshot(s) {
    snapshot = s;
    cfg = s.config;
    lastPrices = {};
    applyConfigToForm();
    applyState(s.state);
    for (const e of s.log) appendLog(e, false);
    flushLog();
  }

  function applyState(st) {
    snapshot.state = st;
    $('sym').textContent = `${cfg.symbol} · ${cfg.leverage}x`;

    // 价格变化动画
    const lastEl = $('last');
    const newPrice = st.last_price;
    if (lastPrices['last'] !== undefined && lastPrices['last'] !== newPrice) {
      animateValueChange(lastEl, newPrice > lastPrices['last']);
      lastEl.style.color = newPrice > lastPrices['last'] ? 'var(--success)' : 'var(--danger)';
      setTimeout(() => { lastEl.style.color = ''; }, 300);
    }
    lastPrices['last'] = newPrice;
    $('last').textContent = fmt(st.last_price, 2);

    $('bid').textContent = fmt(st.bid, 2);
    $('ask').textContent = fmt(st.ask, 2);

    // RSI
    const rsiEl = $('rsi');
    const newRsi = st.rsi;
    if (lastPrices['rsi'] !== undefined && lastPrices['rsi'] !== newRsi) {
      animateValueChange(rsiEl, newRsi > lastPrices['rsi']);
    }
    lastPrices['rsi'] = newRsi;
    $('rsi').textContent = fmt(st.rsi, 1);
    $('evalText').textContent = st.last_eval_text || '--';

    // RSI 条
    const rsiFill = document.querySelector('.rsi-fill');
    if (rsiFill && newRsi != null) {
      const pct = Math.min(100, Math.max(0, (newRsi / 100) * 100));
      rsiFill.style.width = pct + '%';
    }

    // 延迟
    const lat = st.ws_latency_ms || 0;
    $('latency').textContent = lat > 0 ? `延迟 ${lat.toFixed(0)}ms` : '延迟 --';
    $('latency').className = lat > 0 ? (lat < 100 ? 'good' : lat < 500 ? 'warn' : 'bad') : 'muted';

    // HTF
    $('htfTF').textContent = cfg.htf_timeframe;
    const t = $('htfTrend');
    t.textContent = st.htf_trend || '震荡';
    t.className = 'trend ' + (st.htf_trend === '多' ? 'bull' : st.htf_trend === '空' ? 'bear' : 'flat');
    $('htfPrice').textContent = fmt(st.htf_price, 2);
    $('htfMA1').textContent = fmt(st.htf_ma1, 2);
    $('htfMA2').textContent = fmt(st.htf_ma2, 2);
    $('htfADX').textContent = fmt(st.htf_adx, 1);
    $('htfMACD').textContent = `${fmt(st.htf_macd_main, 4)} / ${fmt(st.htf_macd_signal, 4)}`;

    // 持仓
    const longEl = $('longL');
    const shortEl = $('shortL');
    const newLong = st.total_long_lots;
    const newShort = st.total_short_lots;
    if (lastPrices['long'] !== undefined && lastPrices['long'] !== newLong) {
      animateValueChange(longEl, newLong > lastPrices['long']);
    }
    if (lastPrices['short'] !== undefined && lastPrices['short'] !== newShort) {
      animateValueChange(shortEl, newShort < lastPrices['short']);
    }
    lastPrices['long'] = newLong;
    lastPrices['short'] = newShort;

    $('longL').textContent = fmt(st.total_long_lots, 3);
    $('shortL').textContent = fmt(st.total_short_lots, 3);

    // 浮盈
    const upnl = $('upnl');
    const newUpnl = st.unrealized_pnl;
    if (lastPrices['upnl'] !== undefined && lastPrices['upnl'] !== newUpnl) {
      animateValueChange(upnl, newUpnl >= lastPrices['upnl']);
    }
    lastPrices['upnl'] = newUpnl;

    upnl.textContent = `${st.unrealized_pnl >= 0 ? '+' : ''}${fmt(st.unrealized_pnl, 2)}`;
    upnl.className = 'pnl-value ' + (st.unrealized_pnl >= 0 ? 'pos' : 'neg');

    // 风险标签
    $('tagNoTrade').classList.toggle('on', !!st.in_no_trade_time);
    $('tagNoTrade').textContent = st.in_no_trade_time ? '在不做单时段' : '不在不做单时段';
    $('tagDaily').classList.toggle('on', !!st.daily_limit_reached);
    $('tagDaily').textContent = st.daily_limit_reached ? '已达每日上限' : `今日已开 ${st.daily_open_count}/${cfg.daily_max_opens}`;
    $('tagWait').classList.toggle('on', !!(st.wait_after_close || st.wait_after_maxloss));
    $('tagWait').textContent = (st.wait_after_close || st.wait_after_maxloss) ? '在等待中' : '未在平仓后等待';

    // 多头/空头状态
    $('buyActive').textContent = st.buy.active ? '激活' : '未激活';
    $('buyActive').className = 'badge ' + (st.buy.active ? 'on' : 'off');
    $('buyAvg').textContent = fmt(st.buy.avg_price, 4);
    $('buyTrail').textContent = fmt(st.buy.trail_level, 4);
    renderGrid('buyTable', st.buy.grids);

    $('sellActive').textContent = st.sell.active ? '激活' : '未激活';
    $('sellActive').className = 'badge ' + (st.sell.active ? 'on' : 'off');
    $('sellAvg').textContent = fmt(st.sell.avg_price, 4);
    $('sellTrail').textContent = fmt(st.sell.trail_level, 4);
    renderGrid('sellTable', st.sell.grids);

    // 模式/状态
    setBadge('mode', st.paper_trading, '模拟盘', '真实盘');
    $('mode').classList.toggle('paper', st.paper_trading);
    $('mode').classList.toggle('live', !st.paper_trading);
    setBadge('runStat', st.running, '运行中', '未运行');

    // RSI 派生
    $('rsiLevels').textContent = `RSI 上沿/下沿：${fmt(cfg.rsi_overbought, 1)} / ${fmt(cfg.rsi_oversold, 1)}`;
  }

  function renderGrid(tableId, grids) {
    const tb = $(tableId).querySelector('tbody');
    tb.innerHTML = '';
    if (!grids || !grids.length) {
      tb.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px">-- 无挂单 --</td></tr>';
      return;
    }
    grids.forEach((g, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${g.index}</td><td>${fmt(g.entry_price, 4)}</td><td>${fmt(g.lot_size, 3)}</td>`;
      if (i >= 0) tr.style.animation = 'slideIn 0.2s ease-out';
      tb.appendChild(tr);
    });
  }

  function appendLog(e, append=true) {
    if (append) {
      logLines.push(e);
      if (logLines.length > 500) logLines = logLines.slice(-500);
      const box = $('log');
      if (box) {
        const row = document.createElement('div');
        row.className = 'row';
        row.style.animation = 'slideIn 0.2s ease-out';
        row.innerHTML = `<span class="ts">${e.tstr}</span><span class="l-${(e.level||'info').toLowerCase()}">${e.msg}</span>`;
        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
      }
    } else {
      logLines.push(e);
    }
  }
  function flushLog() {
    const box = $('log');
    if (!box) return;
    box.innerHTML = '';
    logLines.slice(-200).forEach((e) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="ts">${e.tstr}</span><span class="l-${(e.level||'info').toLowerCase()}">${e.msg}</span>`;
      box.appendChild(row);
    });
  }

  // ---- 参数表单 ----
  function applyConfigToForm() {
    document.querySelectorAll('[data-cfg]').forEach((el) => {
      const k = el.dataset.cfg;
      if (!cfg || !(k in cfg)) return;
      const v = cfg[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    const tm = $('tradingMode');
    const tn = $('testnet');
    if (tm) tm.value = cfg.paper_trading ? 'paper' : 'live';
    if (tn) tn.value = cfg.testnet ? 'true' : 'false';
  }
  function collectConfig() {
    const out = {...cfg};
    document.querySelectorAll('[data-cfg]').forEach((el) => {
      const k = el.dataset.cfg;
      let v = el.type === 'checkbox' ? el.checked
            : el.type === 'number' ? Number(el.value)
            : el.value;
      out[k] = v;
    });
    const tm = $('tradingMode');
    const tn = $('testnet');
    if (tm) out.paper_trading = tm.value === 'paper';
    if (tn) out.testnet = tn.value === 'true';
    return out;
  }

  // ---- 操作 ----
  async function postJSON(url, body) {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body || {}) });
    return r.json();
  }

  function setButtonLoading(btn, loading, originalText) {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = '...';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || originalText;
    }
  }

  // 保存配置的通用函数
  async function saveConfig() {
    const c = collectConfig();
    const r = await postJSON('/api/config', c);
    if (r.ok) {
      $('cfgTip').textContent = '✓ 已保存 ' + new Date().toLocaleTimeString();
      $('cfgTip').className = 'good';
      cfg = r.config;
      showToast('配置已保存', 'success');
      setTimeout(() => { $('cfgTip').textContent = ''; $('cfgTip').className = 'muted'; }, 3000);
    } else {
      const errMsg = r.error || '?';
      $('cfgTip').textContent = '✕ 保存失败：' + errMsg;
      $('cfgTip').className = 'bad';
      alert('保存失败：' + errMsg + '\n\n请先停止策略后再修改参数');
      setTimeout(() => { $('cfgTip').textContent = ''; $('cfgTip').className = 'muted'; }, 5000);
    }
  }

  $('btnStart').onclick = async () => {
    setButtonLoading($('btnStart'), true, '▶ 启动');
    const r = await postJSON('/api/control', {action:'start'});
    if (r.ok) {
      setBadge('runStat', true, '运行中', '未运行');
      showToast('策略已启动', 'success');
    } else {
      alert('启动失败：' + (r.error || '?'));
      showToast('启动失败', 'error');
    }
    setButtonLoading($('btnStart'), false, '▶ 启动');
  };

  $('btnStop').onclick = async () => {
    setButtonLoading($('btnStop'), true, '■ 停止');
    const r = await postJSON('/api/control', {action:'stop'});
    if (r.ok) {
      setBadge('runStat', false, '运行中', '未运行');
      showToast('策略已停止', 'info');
    } else {
      alert('停止失败：' + (r.error || '?'));
      showToast('停止失败', 'error');
    }
    setButtonLoading($('btnStop'), false, '■ 停止');
  };

  $('btnCloseAll').onclick = async () => {
    if (!confirm('确认全部平仓？')) return;
    setButtonLoading($('btnCloseAll'), true, '⚡ 平仓');
    await postJSON('/api/control', {action:'close_all'});
    showToast('已发送全部平仓指令', 'info');
    setButtonLoading($('btnCloseAll'), false, '⚡ 平仓');
  };

  // 两个保存按钮
  $('btnSaveCfg')?.addEventListener('click', saveConfig);
  $('btnSaveCfg2')?.addEventListener('click', saveConfig);

  // 交易模式切换
  $('tradingMode')?.addEventListener('change', async () => {
    const mode = $('tradingMode').value;
    if (mode === 'live') {
      const key = $('apiKey')?.value.trim();
      const sec = $('apiSec')?.value.trim();
      if (!key || !sec) {
        alert('请先填写 API Key 和 Secret');
        $('tradingMode').value = 'paper';
        showToast('请填写 API 凭证', 'error');
        return;
      }
      const r = await postJSON('/api/control', {action:'switch_live', api_key: key, api_secret: sec});
      if (!r.ok) {
        alert('切换失败：' + (r.error || '?'));
        $('tradingMode').value = 'paper';
        showToast('切换真实盘失败', 'error');
      } else {
        showToast('已切换到真实交易模式', 'success');
        closeTradingModal();
      }
    } else {
      await postJSON('/api/control', {action:'switch_paper'});
      showToast('已切换到模拟盘模式', 'info');
      closeTradingModal();
    }
  });

  // 初始化
  initTabs();
  initChartTimeframes();
  getJSON('/api/snapshot').then((s) => { snapshot = s; cfg = s.config; applyConfigToForm(); applyState(s.state); }).catch(console.error);
  connectWS();

  // 延迟初始化图表，等待 DOM 加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChart);
  } else {
    setTimeout(initChart, 100);
  }

  // 辅助函数
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('API error');
    return r.json();
  }

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      $('btnStart')?.click();
    } else if (e.key === 'x' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      $('btnStop')?.click();
    }
  });
})();

// 弹窗控制函数
function closeTradingModal() {
  const modal = document.getElementById('tradingModal');
  if (modal) modal.style.display = 'none';
}

// Toast 样式
const toastStyle = document.createElement('style');
toastStyle.textContent = `
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    background: #1a1a24;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    font-size: 13px;
    color: #fff;
    transform: translateX(120%);
    transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    z-index: 9999;
  }
  .toast.show { transform: translateX(0); }
  .toast-success { border-color: rgba(34, 197, 94, 0.4); background: linear-gradient(135deg, #1a1a24, rgba(34, 197, 94, 0.1)); }
  .toast-error { border-color: rgba(239, 68, 68, 0.4); background: linear-gradient(135deg, #1a1a24, rgba(239, 68, 68, 0.1)); }
  .toast-info { border-color: rgba(99, 102, 241, 0.4); background: linear-gradient(135deg, #1a1a24, rgba(99, 102, 241, 0.1)); }
  .toast-icon { font-size: 16px; }
  .toast-success .toast-icon { color: #22c55e; }
  .toast-error .toast-icon { color: #ef4444; }
  .toast-info .toast-icon { color: #6366f1; }
`;
document.head.appendChild(toastStyle);
