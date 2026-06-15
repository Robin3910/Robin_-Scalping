// Robin Scalper 前端
(() => {
  let cfg = null;
  let snapshot = null;
  let ws = null;
  let logLines = [];

  // ---- 工具 ----
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d=4) => v == null || v === 0 ? '--' : Number(v).toFixed(d);
  const fmtPct = (v) => v == null ? '--' : `${(v*100).toFixed(2)}%`;

  function setBadge(id, on, onText, offText) {
    const el = $(id);
    el.classList.toggle('on', on);
    el.classList.toggle('off', !on);
    el.textContent = on ? onText : offText;
  }

  // ---- WebSocket ----
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    $('connText').textContent = '连接中…';
    ws.onopen = () => {
      $('conn').classList.add('on');
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
    } else if (env.topic === 'state') {
      applyState(env.data);
    } else if (env.topic === 'log') {
      const entries = env.data.entries || [];
      // 增量追加
      const lastTs = logLines.length ? logLines[logLines.length-1].ts : 0;
      for (const e of entries) {
        if (e.ts > lastTs) appendLog(e);
      }
    } else if (env.topic === 'tick') {
      // 节流：在 applyState 时也会更新
    }
  }

  function applySnapshot(s) {
    snapshot = s;
    cfg = s.config;
    applyConfigToForm();
    applyState(s.state);
    // 填充日志
    for (const e of s.log) appendLog(e, false);
    flushLog();
  }

  function applyState(st) {
    snapshot.state = st;
    $('sym').textContent = `${cfg.symbol} · ${cfg.leverage}x`;
    $('last').textContent = fmt(st.last_price, 2);
    $('last').className = 'big' + (st.last_price > 0 ? '' : '');
    $('bid').textContent = fmt(st.bid, 2);
    $('ask').textContent = fmt(st.ask, 2);
    $('rsi').textContent = fmt(st.rsi, 1);
    $('evalText').textContent = st.last_eval_text || '--';

    $('htfTF').textContent = cfg.htf_timeframe;
    const t = $('htfTrend');
    t.textContent = st.htf_trend || '震荡';
    t.className = 'trend ' + (st.htf_trend === '多' ? 'bull' : st.htf_trend === '空' ? 'bear' : 'flat');
    $('htfPrice').textContent = fmt(st.htf_price, 2);
    $('htfMA1').textContent = fmt(st.htf_ma1, 2);
    $('htfMA2').textContent = fmt(st.htf_ma2, 2);
    $('htfADX').textContent = fmt(st.htf_adx, 1);
    $('htfMACD').textContent = `${fmt(st.htf_macd_main, 4)} / ${fmt(st.htf_macd_signal, 4)}`;

    $('longL').textContent = fmt(st.total_long_lots, 3);
    $('shortL').textContent = fmt(st.total_short_lots, 3);
    const upnl = $('upnl');
    upnl.textContent = `${st.unrealized_pnl >= 0 ? '+' : ''}${fmt(st.unrealized_pnl, 2)} USDT`;
    upnl.className = 'big ' + (st.unrealized_pnl >= 0 ? 'pos' : 'neg');

    $('tagNoTrade').classList.toggle('on', !!st.in_no_trade_time);
    $('tagNoTrade').textContent = st.in_no_trade_time ? '在不做单时段' : '不在不做单时段';
    $('tagDaily').classList.toggle('on', !!st.daily_limit_reached);
    $('tagDaily').textContent = st.daily_limit_reached ? '已达每日上限' : `今日已开 ${st.daily_open_count}/${cfg.daily_max_opens}`;
    $('tagWait').classList.toggle('on', !!(st.wait_after_close || st.wait_after_maxloss));
    $('tagWait').textContent = (st.wait_after_close || st.wait_after_maxloss) ? '在等待中' : '未在平仓后等待';

    // 多头
    $('buyActive').textContent = st.buy.active ? '是' : '否';
    $('buyAvg').textContent = fmt(st.buy.avg_price, 4);
    $('buyTrail').textContent = fmt(st.buy.trail_level, 4);
    renderGrid('buyTable', st.buy.grids);
    $('sellActive').textContent = st.sell.active ? '是' : '否';
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
      tb.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center">-- 无 --</td></tr>';
      return;
    }
    grids.forEach((g) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${g.index}</td><td>${fmt(g.entry_price, 4)}</td><td>${fmt(g.lot_size, 3)}</td>`;
      tb.appendChild(tr);
    });
  }

  function appendLog(e, append=true) {
    if (append) {
      logLines.push(e);
      if (logLines.length > 500) logLines = logLines.slice(-500);
      const box = $('log');
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="ts">${e.tstr}</span><span class="l-${(e.level||'info').toLowerCase()}">${e.msg}</span>`;
      box.appendChild(row);
      // 自动滚动到底
      box.scrollTop = box.scrollHeight;
    } else {
      logLines.push(e);
    }
  }
  function flushLog() {
    const box = $('log');
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
      if (!(k in cfg)) return;
      const v = cfg[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    $('tradingMode').value = cfg.paper_trading ? 'paper' : 'live';
    $('testnet').value = cfg.testnet ? 'true' : 'false';
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
    out.paper_trading = $('tradingMode').value === 'paper';
    out.testnet = $('testnet').value === 'true';
    return out;
  }

  // ---- 操作 ----
  async function postJSON(url, body) {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body || {}) });
    return r.json();
  }
  async function getJSON(url) {
    const r = await fetch(url); return r.json();
  }

  $('btnStart').onclick = async () => { await postJSON('/api/control', {action:'start'}); };
  $('btnStop').onclick  = async () => { await postJSON('/api/control', {action:'stop'}); };
  $('btnCloseAll').onclick = async () => {
    if (!confirm('确认全部平仓？')) return;
    await postJSON('/api/control', {action:'close_all'});
  };
  $('btnSaveCfg').onclick = async () => {
    const c = collectConfig();
    const r = await postJSON('/api/config', c);
    if (r.ok) {
      $('cfgTip').textContent = '已保存 ' + new Date().toLocaleTimeString();
      cfg = r.config;
    } else {
      $('cfgTip').textContent = '保存失败：' + (r.error || '?');
    }
  };

  // 启动时拉一次快照
  getJSON('/api/snapshot').then((s) => { snapshot = s; cfg = s.config; applyConfigToForm(); applyState(s.state); });
  connectWS();

  // 切换模式时给出提示
  $('tradingMode').addEventListener('change', async () => {
    const mode = $('tradingMode').value;
    if (mode === 'live') {
      const key = $('apiKey').value.trim();
      const sec = $('apiSec').value.trim();
      if (!key || !sec) {
        alert('请先填写 API Key 和 Secret，再切换到真实盘');
        $('tradingMode').value = 'paper';
        return;
      }
      const r = await postJSON('/api/control', {action:'switch_live', api_key: key, api_secret: sec});
      if (!r.ok) {
        alert('切换失败：' + (r.error || '?'));
        $('tradingMode').value = 'paper';
      }
    } else {
      await postJSON('/api/control', {action:'switch_paper'});
    }
  });
})();
