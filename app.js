const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const COINGECKO_ID = 'plasma';
const STALE_AFTER_MS = 90 * 60 * 1000; // Action runs every ~30 min; 90 min = 3 missed cycles

const CATEGORY_LABELS = {
  exchange_inflow: 'Exchange inflow',
  exchange_outflow: 'Exchange outflow',
  reward_candidate: 'Reward candidate',
  unlock_related: 'Unlock-related',
  whale_unlabeled: 'Unlabeled whale',
};

function fmtUsd(n, { compact = false } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 2 : n < 1 ? 4 : 2,
  }).format(n);
}

function fmtXpl(n, { compact = false } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 2 : 0,
  }).format(n);
}

function fmtPct(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function deltaClass(n) {
  if (n == null || Number.isNaN(n) || Math.abs(n) < 1e-9) return 'delta-flat';
  return n > 0 ? 'delta-up' : 'delta-down';
}

function timeAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hr ago`;
}

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function addrLink(addr, label) {
  const text = label ? label : shortAddr(addr);
  const title = label ? `${label} (${addr})` : addr;
  return `<a class="mono" href="https://plasmascan.to/address/${addr}" target="_blank" rel="noopener" title="${title}">${text}</a>`;
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function loadSnapshot() {
  return fetchJson(`data/snapshot.json?t=${Date.now()}`);
}

async function loadLiveMarket() {
  const url = new URL(`${COINGECKO_API}/coins/markets`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('ids', COINGECKO_ID);
  url.searchParams.set('price_change_percentage', '1h,24h,7d');
  const data = await fetchJson(url);
  const coin = data?.[0];
  if (!coin) return null;
  return {
    priceUsd: coin.current_price,
    marketCapUsd: coin.market_cap,
    volume24hUsd: coin.total_volume,
    change24hPct: coin.price_change_percentage_24h_in_currency ?? null,
    change7dPct: coin.price_change_percentage_7d_in_currency ?? null,
  };
}

async function loadSparkline() {
  const url = new URL(`${COINGECKO_API}/coins/${COINGECKO_ID}/market_chart`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('days', '7');
  const data = await fetchJson(url);
  return (data?.prices || []).map(([ts, price]) => ({ ts, price }));
}

function renderFreshness(generatedAt) {
  const el = document.getElementById('freshness');
  const ago = timeAgo(generatedAt);
  if (!ago) {
    el.textContent = 'Snapshot data unavailable';
    el.classList.add('stale');
    return;
  }
  const stale = Date.now() - new Date(generatedAt).getTime() > STALE_AFTER_MS;
  el.textContent = `Holders/flows data updated ${ago}`;
  el.classList.toggle('stale', stale);
}

function renderStatTiles(market) {
  const tiles = document.querySelectorAll('#stat-tiles .stat-tile');
  const price = market?.priceUsd;
  const change24h = market?.change24hPct;

  tiles[0].querySelector('.stat-value').textContent = fmtUsd(price);
  tiles[1].querySelector('.stat-value').innerHTML =
    `<span class="${deltaClass(change24h)}">${fmtPct(change24h)}</span>`;
  tiles[2].querySelector('.stat-value').textContent = fmtUsd(market?.marketCapUsd, { compact: true });
  tiles[3].querySelector('.stat-value').textContent = fmtUsd(market?.volume24hUsd, { compact: true });
}

function renderSignal(signal) {
  const body = document.getElementById('signal-body');
  if (!signal) {
    body.innerHTML = '<div class="empty-state">Signal unavailable &mdash; snapshot data missing.</div>';
    return;
  }
  const badgeClass = signal.bias === 'accumulation-leaning' ? 'signal-accumulation'
    : signal.bias === 'distribution-leaning' ? 'signal-distribution' : 'signal-neutral';
  const label = signal.bias === 'accumulation-leaning' ? 'Accumulation-leaning'
    : signal.bias === 'distribution-leaning' ? 'Distribution-leaning' : 'Neutral';
  const notes = (signal.notes || []).map((n) => `<li>${n}</li>`).join('');
  body.innerHTML = `
    <span class="signal-badge ${badgeClass}">${label}</span>
    <ul class="signal-notes">${notes}</ul>
  `;
}

function renderSparkline(points) {
  const wrap = document.getElementById('sparkline-wrap');
  if (!points || points.length < 2) {
    wrap.innerHTML = '<div class="empty-state">Chart unavailable.</div>';
    return;
  }
  const w = 600, h = 64, pad = 4;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (p.price - min) / range);
    return [x, y];
  });
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;
  const first = prices[0], last = prices[prices.length - 1];
  const changePct = ((last - first) / first) * 100;

  wrap.innerHTML = `
    <svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path class="fill" d="${fillPath}"></path>
      <path class="line" d="${linePath}"></path>
    </svg>
    <div class="stat-delta ${deltaClass(changePct)}">${fmtPct(changePct)} over 7 days</div>
  `;
}

function renderUnlocks(events) {
  const grid = document.getElementById('unlock-grid');
  if (!events || events.length === 0) {
    grid.innerHTML = '<div class="empty-state">No unlock data.</div>';
    return;
  }
  const now = Date.now();
  grid.innerHTML = events.map((e) => {
    const daysAway = Math.ceil((new Date(e.date).getTime() - now) / 86_400_000);
    const daysText = daysAway < 0 ? 'Passed' : daysAway === 0 ? 'Today' : `${daysAway}d`;
    const amount = e.amountXpl != null
      ? `~${fmtXpl(e.amountXpl, { compact: true })} XPL (~${e.pctSupply?.toFixed(2)}% of supply)`
      : 'Amount not publicly broken out';
    return `
      <div class="unlock-card">
        <div class="unlock-days">${daysText}</div>
        <h3>${e.title}</h3>
        <p><strong>${e.date}</strong> &middot; ${amount}</p>
        <p>${e.watch}</p>
        <p><a href="${e.source}" target="_blank" rel="noopener">source</a></p>
      </div>
    `;
  }).join('');
}

function renderHolders(holders) {
  const tbody = document.querySelector('#holders-table tbody');
  if (!holders || holders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No holder data yet &mdash; wait for the next scheduled refresh.</td></tr>';
    return;
  }
  tbody.innerHTML = holders.map((h) => `
    <tr>
      <td>${h.rank}</td>
      <td>${addrLink(h.address)}</td>
      <td>${h.label ?? '—'}</td>
      <td class="num">${fmtXpl(h.balanceXpl)}</td>
      <td class="num">${h.pctSupply != null ? h.pctSupply.toFixed(2) + '%' : '—'}</td>
      <td class="num ${deltaClass(h.deltaXpl)}">${h.deltaXpl != null ? (h.deltaXpl > 0 ? '+' : '') + fmtXpl(h.deltaXpl) : '—'}</td>
    </tr>
  `).join('');
}

let currentFlows = [];
let currentFilter = 'all';

function renderFlowFilters(flows) {
  const container = document.getElementById('flow-filters');
  const counts = { all: flows.length };
  for (const f of flows) counts[f.category] = (counts[f.category] || 0) + 1;
  const cats = ['all', ...Object.keys(CATEGORY_LABELS)].filter((c) => c === 'all' || counts[c]);
  container.innerHTML = cats.map((c) => {
    const label = c === 'all' ? 'All' : CATEGORY_LABELS[c];
    return `<button data-cat="${c}" aria-pressed="${c === currentFilter}">${label} (${counts[c] || 0})</button>`;
  }).join('');
  container.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.cat;
      container.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderFlowsTable();
    });
  });
}

function renderFlowsTable() {
  const tbody = document.querySelector('#flows-table tbody');
  const rows = currentFilter === 'all' ? currentFlows : currentFlows.filter((f) => f.category === currentFilter);
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No transfers in this category in the current scan window.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.slice(0, 100).map((f) => `
    <tr>
      <td>${timeAgo(new Date(f.ts * 1000).toISOString())}</td>
      <td><span class="tag tag-${f.category}">${CATEGORY_LABELS[f.category] || f.category}</span></td>
      <td>${addrLink(f.fromAddress, f.fromLabel)}</td>
      <td>${addrLink(f.toAddress, f.toLabel)}</td>
      <td class="num">${fmtXpl(f.amountXpl)}</td>
      <td><a class="mono" href="${f.explorerTxUrl}" target="_blank" rel="noopener">${shortAddr(f.txHash)}</a></td>
    </tr>
  `).join('');
}

function renderFlows(flows) {
  currentFlows = flows || [];
  renderFlowFilters(currentFlows);
  renderFlowsTable();
}

function renderRewards(candidates) {
  const body = document.getElementById('rewards-body');
  if (!candidates || candidates.length === 0) {
    body.innerHTML = '<div class="empty-state">No candidates detected in the current scan window (checked most recently for Thursday fan-out patterns).</div>';
    return;
  }
  body.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Address</th><th>Day</th><th class="num">Distinct recipients</th><th class="num">Transfers</th><th>Confidence</th></tr></thead>
        <tbody>
          ${candidates.map((c) => `
            <tr>
              <td>${addrLink(c.address)}</td>
              <td>${c.dayKey}</td>
              <td class="num">${c.distinctRecipients}</td>
              <td class="num">${c.transferCount}</td>
              <td>${c.confidence}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function main() {
  const [snapshotResult, marketResult, sparklineResult] = await Promise.allSettled([
    loadSnapshot(),
    loadLiveMarket(),
    loadSparkline(),
  ]);

  const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null;
  const liveMarket = marketResult.status === 'fulfilled' ? marketResult.value : null;
  const sparkline = sparklineResult.status === 'fulfilled' ? sparklineResult.value : null;

  renderFreshness(snapshot?.generatedAt);
  renderStatTiles(liveMarket || snapshot?.market || null);
  renderSignal(snapshot?.signal);
  renderSparkline(sparkline);
  renderUnlocks(snapshot?.unlockEvents);
  renderHolders(snapshot?.holders);
  renderFlows(snapshot?.largeTransfers);
  renderRewards(snapshot?.rewardCandidates);

  if (snapshotResult.status === 'rejected') {
    console.warn('Snapshot load failed:', snapshotResult.reason);
  }
  if (marketResult.status === 'rejected') {
    console.warn('Live market load failed, will show snapshot price if available:', marketResult.reason);
  }
}

main();
