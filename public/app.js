const REFRESH_MS = 30_000;

function fmtUsd(n, opts = {}) {
  if (n == null || Number.isNaN(n)) return '–';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2, ...opts }).format(n);
}
function fmtCompactUsd(n) {
  if (n == null) return '–';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(n);
}
function fmtNum(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '–';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
}
function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
function shortAddr(a) {
  if (!a) return '–';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function timeAgo(ts) {
  const secs = Math.floor(Date.now() / 1000) - ts;
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function renderStats(price) {
  const latest = price.latest;
  document.getElementById('stat-price').textContent = fmtUsd(latest?.price_usd);
  const change = latest?.change_24h_pct;
  const changeEl = document.getElementById('stat-price-change');
  changeEl.textContent = `${fmtPct(change)} (24h)`;
  changeEl.style.color = change > 0 ? 'var(--good)' : change < 0 ? 'var(--critical)' : 'var(--text-secondary)';
  document.getElementById('stat-mcap').textContent = fmtCompactUsd(latest?.market_cap_usd);
  document.getElementById('stat-vol').textContent = fmtCompactUsd(latest?.volume_24h_usd);
}

function renderPriceChart(history) {
  const svg = document.getElementById('price-svg');
  svg.innerHTML = '';
  if (!history || history.length < 2) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', 20); t.setAttribute('y', 110);
    t.setAttribute('fill', 'var(--text-muted)'); t.setAttribute('font-size', '13');
    t.textContent = 'Not enough price history yet -- check back after a few poll cycles.';
    svg.appendChild(t);
    return;
  }
  const W = 720, H = 220, padL = 50, padR = 10, padT = 10, padB = 24;
  const xs = history.map((h) => h.ts);
  const ys = history.map((h) => h.price_usd);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const yPad = (maxY - minY) * 0.1 || maxY * 0.05 || 1;
  const y0 = minY - yPad, y1 = maxY + yPad;
  const x0 = xs[0], x1 = xs[xs.length - 1];

  const xScale = (x) => padL + ((x - x0) / (x1 - x0 || 1)) * (W - padL - padR);
  const yScale = (y) => padT + (1 - (y - y0) / (y1 - y0 || 1)) * (H - padT - padB);

  const ns = 'http://www.w3.org/2000/svg';
  const grid = document.createElementNS(ns, 'g');
  for (let i = 0; i <= 3; i++) {
    const gy = padT + (i / 3) * (H - padT - padB);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
    line.setAttribute('y1', gy); line.setAttribute('y2', gy);
    line.setAttribute('stroke', 'var(--gridline)'); line.setAttribute('stroke-width', '1');
    grid.appendChild(line);
    const val = y1 - (i / 3) * (y1 - y0);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', 4); label.setAttribute('y', gy + 4);
    label.setAttribute('fill', 'var(--text-muted)'); label.setAttribute('font-size', '10');
    label.textContent = fmtUsd(val);
    grid.appendChild(label);
  }
  svg.appendChild(grid);

  const points = history.map((h) => [xScale(h.ts), yScale(h.price_usd)]);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${H - padB} L${points[0][0].toFixed(1)},${H - padB} Z`;
  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d', areaD);
  area.setAttribute('fill', 'var(--series-blue)');
  area.setAttribute('opacity', '0.08');
  svg.appendChild(area);

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--series-blue)');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  const endDot = document.createElementNS(ns, 'circle');
  const last = points[points.length - 1];
  endDot.setAttribute('cx', last[0]); endDot.setAttribute('cy', last[1]);
  endDot.setAttribute('r', 4); endDot.setAttribute('fill', 'var(--series-blue)');
  svg.appendChild(endDot);

  // Hover crosshair + tooltip
  const crosshair = document.createElementNS(ns, 'line');
  crosshair.setAttribute('y1', padT); crosshair.setAttribute('y2', H - padB);
  crosshair.setAttribute('stroke', 'var(--baseline)'); crosshair.setAttribute('stroke-width', '1');
  crosshair.setAttribute('visibility', 'hidden');
  svg.appendChild(crosshair);

  const tooltip = document.createElementNS(ns, 'text');
  tooltip.setAttribute('font-size', '11'); tooltip.setAttribute('fill', 'var(--text-primary)');
  tooltip.setAttribute('visibility', 'hidden');
  svg.appendChild(tooltip);

  const overlay = document.createElementNS(ns, 'rect');
  overlay.setAttribute('x', padL); overlay.setAttribute('y', padT);
  overlay.setAttribute('width', W - padL - padR); overlay.setAttribute('height', H - padT - padB);
  overlay.setAttribute('fill', 'transparent');
  overlay.addEventListener('mousemove', (evt) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mx = (evt.clientX - rect.left) * scaleX;
    let nearest = 0, best = Infinity;
    points.forEach((p, i) => { const d = Math.abs(p[0] - mx); if (d < best) { best = d; nearest = i; } });
    const [px, py] = points[nearest];
    crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px);
    crosshair.setAttribute('visibility', 'visible');
    tooltip.setAttribute('x', Math.min(px + 8, W - 120));
    tooltip.setAttribute('y', Math.max(py - 8, 14));
    tooltip.textContent = `${fmtUsd(history[nearest].price_usd)} · ${new Date(history[nearest].ts * 1000).toLocaleString()}`;
    tooltip.setAttribute('visibility', 'visible');
  });
  overlay.addEventListener('mouseleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    tooltip.setAttribute('visibility', 'hidden');
  });
  svg.appendChild(overlay);
}

function renderSignal(signal) {
  const badge = document.getElementById('signal-badge');
  badge.textContent = signal.bias.replace('-', ' ');
  badge.className = `signal-badge ${signal.bias}`;
  const list = document.getElementById('signal-notes');
  list.innerHTML = '';
  for (const note of signal.notes) {
    const li = document.createElement('li');
    li.textContent = note;
    list.appendChild(li);
  }
}

function renderHolders(data) {
  document.getElementById('stat-holders-pct').textContent = data.holders.length
    ? `${fmtNum(data.holders.reduce((s, h) => s + h.pct_supply, 0), 2)}%`
    : '–';
  const tbody = document.querySelector('#holders-table tbody');
  tbody.innerHTML = '';
  for (const h of data.holders) {
    const tr = document.createElement('tr');
    const delta = h.deltaXpl;
    const deltaStr = delta == null ? '–' : `${delta > 0 ? '+' : ''}${fmtNum(delta)}`;
    const deltaColor = delta > 0 ? 'var(--good)' : delta < 0 ? 'var(--critical)' : 'var(--text-secondary)';
    tr.innerHTML = `
      <td>${h.rank}</td>
      <td class="addr"><a href="${h.explorerUrl}" target="_blank" rel="noopener">${shortAddr(h.address)}</a></td>
      <td>${h.label || '<span class="muted">unlabeled</span>'}</td>
      <td>${fmtNum(h.balance_xpl)}</td>
      <td>${fmtNum(h.pct_supply, 2)}%</td>
      <td style="color:${deltaColor}">${deltaStr}</td>
    `;
    tbody.appendChild(tr);
  }
}

const CATEGORY_LABEL = {
  exchange_inflow: 'To exchange',
  exchange_outflow: 'From exchange',
  reward_candidate: 'Card rewards',
  unlock_related: 'Unlock-related',
  whale_unlabeled: 'Unlabeled whale',
};

let flowsData = null;
let activeCategory = '';

function renderFlows() {
  if (!flowsData) return;
  document.getElementById('flows-threshold').textContent = `(≥ ${fmtNum(flowsData.thresholdXpl)} XPL)`;
  const tbody = document.querySelector('#flows-table tbody');
  tbody.innerHTML = '';
  const rows = activeCategory ? flowsData.events.filter((e) => e.category === activeCategory) : flowsData.events;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No transfers in this window yet.</td></tr>`;
    return;
  }
  for (const e of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${timeAgo(e.ts)}</td>
      <td><span class="tag ${e.category}">${CATEGORY_LABEL[e.category] || e.category}</span></td>
      <td>${fmtNum(e.amount_xpl)} XPL<br/><span class="muted small">${fmtCompactUsd(e.amount_usd)}</span></td>
      <td class="addr"><a href="${e.fromExplorerUrl}" target="_blank" rel="noopener">${e.from_label || shortAddr(e.from_address)}</a></td>
      <td class="addr"><a href="${e.toExplorerUrl}" target="_blank" rel="noopener">${e.to_label || shortAddr(e.to_address)}</a></td>
    `;
    tbody.appendChild(tr);
  }
}

function renderRewardCandidates() {
  const tbody = document.querySelector('#reward-table tbody');
  tbody.innerHTML = '';
  const list = flowsData?.rewardCandidates || [];
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No candidates detected yet -- the heuristic needs a Thursday with enough scanned volume. Runs continuously once the server is left running.</td></tr>`;
    return;
  }
  for (const r of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="addr"><a href="https://plasmascan.to/address/${r.address}" target="_blank" rel="noopener">${shortAddr(r.address)}</a></td>
      <td>${r.confidence}</td>
      <td>${r.evidence}</td>
      <td>${timeAgo(r.last_seen)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderUnlocks(data) {
  const wrap = document.getElementById('unlock-cards');
  wrap.innerHTML = '';
  for (const e of data.events) {
    const days = Math.ceil(e.daysAway);
    const card = document.createElement('div');
    card.className = 'unlock-card';
    const walletsHtml = (e.wallets || []).map((w) => `<div class="note">${w.address ? `<span class="addr">${shortAddr(w.address)}</span>` : ''} ${w.note || ''}</div>`).join('');
    card.innerHTML = `
      <div class="days">${days >= 0 ? `${days}d` : 'past'}</div>
      <div class="title">${e.title}</div>
      <div class="note">${e.date}${e.amount_xpl ? ` · ~${fmtNum(e.amount_xpl)} XPL` : ''}${e.pct_supply ? ` (${e.pct_supply.toFixed(2)}% supply)` : ''}</div>
      ${e.note ? `<div class="note">${e.note}</div>` : ''}
      ${walletsHtml}
      ${e.source ? `<a href="${e.source}" target="_blank" rel="noopener">source</a>` : ''}
    `;
    wrap.appendChild(card);
  }
}

async function refresh() {
  try {
    const [price, holders, flows, unlocks, signal, status] = await Promise.all([
      getJson('/api/price'),
      getJson('/api/holders'),
      getJson('/api/flows?hours=24'),
      getJson('/api/unlocks'),
      getJson('/api/signal'),
      getJson('/api/status'),
    ]);
    renderStats(price);
    renderPriceChart(price.history);
    renderSignal(signal);
    renderHolders(holders);
    flowsData = flows;
    renderFlows();
    renderRewardCandidates();
    renderUnlocks(unlocks);

    document.getElementById('last-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    const errs = status.lastPoll?.errors || [];
    const badge = document.getElementById('poll-badge');
    badge.textContent = errs.length ? `${errs.length} data source issue(s)` : 'All sources OK';
    badge.style.color = errs.length ? 'var(--warning)' : 'var(--good)';
    if (errs.length) badge.title = errs.join('\n');
  } catch (err) {
    document.getElementById('last-updated').textContent = `Fetch failed: ${err.message}`;
  }
}

document.getElementById('flows-filter').addEventListener('click', (evt) => {
  const btn = evt.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('#flows-filter .chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
  activeCategory = btn.dataset.cat;
  renderFlows();
});

refresh();
setInterval(refresh, REFRESH_MS);
