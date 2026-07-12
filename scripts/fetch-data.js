// Runs server-side in the GitHub Action (see .github/workflows/update-data.yml).
// Not part of the browser bundle -- this is what dodges the CORS wall that
// blocks the top-holders/large-transfer data from being fetched client-side
// (see README "Why a scraper" section for the full explanation).
import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const PLASMASCAN_BASE = 'https://plasmascan.to';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const COINGECKO_ID = 'plasma';
const TOP_HOLDERS_LIMIT = 15;
const TX_PAGES_TO_SCAN = 6; // ~300 latest txs per run
const LARGE_TRANSFER_XPL = 250_000;
const TOTAL_SUPPLY_XPL = 10_000_000_000;
const REWARD_MIN_DISTINCT_RECIPIENTS = 15;
const REWARD_BUCKET_MAX_AGE_DAYS = 3;

const EXCHANGE_NAME_PATTERN = /binance|coinbase|okx|okex|bybit|kraken|upbit|kucoin|gate\.?io|htx|huobi|bitget|mexc|crypto\.com|bitfinex|gemini|bitstamp|bithumb/i;
const TREASURY_NAME_PATTERN = /ecosystem|team|investor|treasury|foundation|public sale|vesting/i;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'xpl-dashboard-databot/1.0 (+https://github.com/westchestermbcrypto/repo1)',
      accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

function parseXplAmount(raw) {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/,/g, '').replace(/XPL/i, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function addressFromHref(href) {
  if (!href) return null;
  const m = href.match(/\/address\/(0x[a-fA-F0-9]{40})/);
  return m ? m[1].toLowerCase() : null;
}

async function getTopHolders(limit = TOP_HOLDERS_LIMIT) {
  const html = await fetchText(`${PLASMASCAN_BASE}/accounts`);
  const $ = cheerio.load(html);
  const table = $('table.table-hover').first();
  const holders = [];
  table.find('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;
    const rankText = $(tds[0]).text().trim();
    if (!/^\d+$/.test(rankText)) return; // header row
    const link = $(tds[1]).find('a[href^="/address/"]').first();
    const address = addressFromHref(link.attr('href'));
    if (!address) return;
    const nameTag = $(tds[2]).text().trim() || null;
    const balanceTitle = $(tds[3]).find('[title]').first().attr('title');
    const balanceXpl = parseXplAmount(balanceTitle || $(tds[3]).text());
    const pctSupply = parseFloat($(tds[4]).text().replace('%', '').trim());
    const txCount = parseInt($(tds[5]).text().replace(/,/g, '').trim(), 10) || 0;
    holders.push({
      rank: Number(rankText),
      address,
      label: nameTag,
      balanceXpl,
      pctSupply: Number.isFinite(pctSupply) ? pctSupply : null,
      txCount,
      explorerUrl: `${PLASMASCAN_BASE}/address/${address}`,
    });
  });
  return holders.slice(0, limit);
}

async function getRecentTransfers(pages = TX_PAGES_TO_SCAN) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? `${PLASMASCAN_BASE}/txs` : `${PLASMASCAN_BASE}/txs?p=${p}`;
    let html;
    try {
      html = await fetchText(url);
    } catch (err) {
      console.warn(`[fetch-data] skipping txs page ${p}: ${err.message}`);
      continue;
    }
    const $ = cheerio.load(html);
    const table = $('table.table-hover').first();
    table.find('tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 12) return;
      const txHashHref = $(tds[1]).find('a[href^="/tx/"]').first().attr('href');
      const txHash = txHashHref ? txHashHref.replace('/tx/', '') : null;
      if (!txHash) return;
      const ts = parseInt($(tds[7]).text().trim(), 10) || null;
      const fromAddress = addressFromHref($(tds[8]).find('a[href^="/address/"]').first().attr('href'));
      const toAddress = addressFromHref($(tds[10]).find('a[href^="/address/"]').first().attr('href'));
      const valueTitle = $(tds[11]).find('[title]').first().attr('title');
      const amountXpl = parseXplAmount(valueTitle || $(tds[11]).text());
      if (!fromAddress || !toAddress || ts == null) return;
      all.push({ txHash, ts, fromAddress, toAddress, amountXpl });
    });
  }
  // dedupe (pages can overlap slightly if new blocks land mid-scan)
  const seen = new Set();
  return all.filter((t) => (seen.has(t.txHash) ? false : (seen.add(t.txHash), true)));
}

async function getMarketData() {
  const url = new URL(`${COINGECKO_API}/coins/markets`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('ids', COINGECKO_ID);
  url.searchParams.set('price_change_percentage', '1h,24h,7d');
  const data = await fetchJson(url);
  const coin = data?.[0];
  if (!coin) throw new Error(`CoinGecko returned no data for id "${COINGECKO_ID}"`);
  return {
    priceUsd: coin.current_price,
    marketCapUsd: coin.market_cap,
    volume24hUsd: coin.total_volume,
    change1hPct: coin.price_change_percentage_1h_in_currency ?? null,
    change24hPct: coin.price_change_percentage_24h_in_currency ?? null,
    change7dPct: coin.price_change_percentage_7d_in_currency ?? null,
  };
}

async function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadCuratedLabels(labelsDoc) {
  const flat = new Map();
  for (const [category, entries] of Object.entries(labelsDoc || {})) {
    if (category.startsWith('_') || typeof entries !== 'object') continue;
    for (const [address, label] of Object.entries(entries)) {
      flat.set(address.toLowerCase(), { label, category, source: 'curated' });
    }
  }
  return flat;
}

/** Auto-tag holders whose scraped explorer name-tag matches known patterns. */
function autoLabelFromHolders(holders) {
  const auto = new Map();
  for (const h of holders) {
    if (!h.label) continue;
    if (EXCHANGE_NAME_PATTERN.test(h.label)) {
      auto.set(h.address, { label: h.label, category: 'exchanges', source: 'auto' });
    } else if (TREASURY_NAME_PATTERN.test(h.label)) {
      auto.set(h.address, { label: h.label, category: 'unlock_allocation', source: 'auto' });
    }
  }
  return auto;
}

function classifyTransfer({ fromAddress, toAddress }, labelIndex) {
  const fromLabel = labelIndex.get(fromAddress) || null;
  const toLabel = labelIndex.get(toAddress) || null;
  if (toLabel?.category === 'exchanges') return { category: 'exchange_inflow', fromLabel, toLabel };
  if (fromLabel?.category === 'exchanges') return { category: 'exchange_outflow', fromLabel, toLabel };
  if (fromLabel?.category === 'reward_wallets') return { category: 'reward_candidate', fromLabel, toLabel };
  if (fromLabel?.category === 'unlock_allocation' || toLabel?.category === 'unlock_allocation') {
    return { category: 'unlock_related', fromLabel, toLabel };
  }
  return { category: 'whale_unlabeled', fromLabel, toLabel };
}

/**
 * Plasma One pays card cashback weekly, every Thursday, as many small
 * transfers from a rewards ledger to individual cardholders. A sender that
 * fans out to many distinct recipients in small amounts on a Thursday is a
 * plausible candidate -- flagged for the user to confirm, not auto-trusted.
 * State persists across Action runs in data/reward-heuristic-state.json
 * since a single run only sees ~300 of the newest transactions.
 */
function detectRewardCandidates(transfers, state) {
  const buckets = new Map(Object.entries(state.buckets || {}));
  for (const t of transfers) {
    if (t.amountXpl >= LARGE_TRANSFER_XPL) continue; // rewards are small, not whale-sized
    const day = new Date(t.ts * 1000);
    if (day.getUTCDay() !== 4) continue; // Thursday
    const dayKey = day.toISOString().slice(0, 10);
    const key = `${t.fromAddress}|${dayKey}`;
    const bucket = buckets.get(key) || { fromAddress: t.fromAddress, dayKey, recipients: [], count: 0, lastTs: t.ts };
    const recipients = new Set(bucket.recipients);
    recipients.add(t.toAddress);
    bucket.recipients = [...recipients];
    bucket.count += 1;
    bucket.lastTs = Math.max(bucket.lastTs, t.ts);
    buckets.set(key, bucket);
  }
  const cutoff = Date.now() / 1000 - REWARD_BUCKET_MAX_AGE_DAYS * 86_400;
  for (const [key, bucket] of buckets) {
    if (bucket.lastTs < cutoff) buckets.delete(key);
  }
  const candidates = [...buckets.values()]
    .filter((b) => b.recipients.length >= REWARD_MIN_DISTINCT_RECIPIENTS)
    .map((b) => ({
      address: b.fromAddress,
      dayKey: b.dayKey,
      distinctRecipients: b.recipients.length,
      transferCount: b.count,
      confidence: b.recipients.length >= 30 ? 'medium' : 'low',
    }));
  return { candidates, state: { buckets: Object.fromEntries(buckets) } };
}

const STATIC_UNLOCK_EVENTS = [
  {
    id: 'ecosystem-growth-2026-07-25',
    date: '2026-07-25',
    title: 'Ecosystem & Growth monthly vest',
    amountXpl: 3_200_000_000 / 36,
    pctSupply: ((3_200_000_000 / 36) / TOTAL_SUPPLY_XPL) * 100,
    category: 'ecosystem_growth',
    source: 'https://www.plasma.org/docs/get-started/xpl/tokenomics',
    watch: 'Estimated even monthly tranche (3.2B XPL / 36 months) -- verify against '
      + 'https://defillama.com/unlocks/plasma closer to the date. Watch the "Plasma: '
      + 'Ecosystem Treasury" wallet in the top-holders table for a large outflow around the 25th.',
  },
  {
    id: 'public-sale-us-lockup-2026-07-28',
    date: '2026-07-28',
    title: 'Public sale US-purchaser lockup expiry',
    amountXpl: null,
    pctSupply: null,
    category: 'public_sale',
    source: 'https://web3.bitget.com/en/academy/plasma-xpl-token-unlock-schedule-key-dates-vesting-periods-and-price-impact',
    watch: 'No single custodial wallet -- this unlocks XPL held by many individual public-sale '
      + 'purchasers. Watch for a broad increase in outbound transfers from previously-dormant '
      + 'wallets starting this date, and for inflows to exchange deposit addresses shortly after.',
  },
];

function computeSignal({ market, exchangeInflow24h, exchangeOutflow24h, holderDeltaPct, unlockEvents }) {
  const netExchangeFlowXpl = exchangeOutflow24h - exchangeInflow24h;
  const notes = [];
  let score = 0;

  if (netExchangeFlowXpl > 0) {
    notes.push(`Net outflow from labeled exchange wallets over the scanned window (${Math.round(netExchangeFlowXpl).toLocaleString()} XPL) -- tokens moving to self-custody, historically a mild accumulation signal.`);
    score += 1;
  } else if (netExchangeFlowXpl < 0) {
    notes.push(`Net inflow to labeled exchange wallets over the scanned window (${Math.round(-netExchangeFlowXpl).toLocaleString()} XPL) -- tokens moving toward exchanges, often precedes selling.`);
    score -= 1;
  } else {
    notes.push('No labeled exchange flow detected in the scanned window.');
  }

  if (holderDeltaPct != null) {
    if (holderDeltaPct > 0.5) {
      notes.push(`Top-15 holder combined balance is up ${holderDeltaPct.toFixed(2)}% vs. the prior snapshot -- concentration increasing.`);
      score += 0.5;
    } else if (holderDeltaPct < -0.5) {
      notes.push(`Top-15 holder combined balance is down ${holderDeltaPct.toFixed(2)}% vs. the prior snapshot -- whales distributing.`);
      score -= 0.5;
    }
  }

  const now = Date.now();
  const upcoming = unlockEvents
    .map((e) => ({ ...e, daysAway: (new Date(e.date).getTime() - now) / 86_400_000 }))
    .filter((e) => e.daysAway >= 0 && e.daysAway <= 14)
    .sort((a, b) => a.daysAway - b.daysAway);
  if (upcoming.length > 0) {
    const next = upcoming[0];
    notes.push(`${next.title} is ${Math.ceil(next.daysAway)} day(s) away (${next.date}) -- unlocks typically add sell-side supply; treat this as a period of elevated downside risk until absorbed.`);
    score -= 1;
  }

  let bias = 'neutral';
  if (score >= 1) bias = 'accumulation-leaning';
  else if (score <= -1) bias = 'distribution-leaning';

  return { bias, score, netExchangeFlowXpl, notes, priceUsd: market?.priceUsd ?? null };
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const [market, holders, transfers] = await Promise.all([
    getMarketData().catch((err) => { console.warn(`[fetch-data] CoinGecko failed: ${err.message}`); return null; }),
    getTopHolders().catch((err) => { console.warn(`[fetch-data] holders scrape failed: ${err.message}`); return []; }),
    getRecentTransfers().catch((err) => { console.warn(`[fetch-data] txs scrape failed: ${err.message}`); return []; }),
  ]);

  const curatedDoc = await readJsonSafe(path.join(DATA_DIR, 'labels.json'), {
    exchanges: {}, reward_wallets: {}, unlock_allocation: {},
  });
  const labelIndex = loadCuratedLabels(curatedDoc);
  for (const [addr, entry] of autoLabelFromHolders(holders)) {
    if (!labelIndex.has(addr)) labelIndex.set(addr, entry);
  }

  const rewardState = await readJsonSafe(path.join(DATA_DIR, 'reward-heuristic-state.json'), { buckets: {} });
  const { candidates: rewardCandidates, state: nextRewardState } = detectRewardCandidates(transfers, rewardState);
  for (const c of rewardCandidates) {
    if (!labelIndex.has(c.address)) {
      labelIndex.set(c.address, { label: `Plasma One card rewards (suspected, ${c.confidence} confidence)`, category: 'reward_wallets', source: 'detected' });
    }
  }

  const classifiedTransfers = transfers.map((t) => ({ ...t, ...classifyTransfer(t, labelIndex) }));
  const largeTransfers = classifiedTransfers
    .filter((t) => t.amountXpl >= LARGE_TRANSFER_XPL)
    .sort((a, b) => b.ts - a.ts)
    .map((t) => ({
      txHash: t.txHash,
      ts: t.ts,
      fromAddress: t.fromAddress,
      toAddress: t.toAddress,
      amountXpl: t.amountXpl,
      category: t.category,
      fromLabel: t.fromLabel?.label ?? null,
      toLabel: t.toLabel?.label ?? null,
      explorerTxUrl: `${PLASMASCAN_BASE}/tx/${t.txHash}`,
    }));

  const sinceTs = Date.now() / 1000 - 24 * 3600;
  const exchangeInflow24h = classifiedTransfers.filter((t) => t.category === 'exchange_inflow' && t.ts >= sinceTs).reduce((s, t) => s + t.amountXpl, 0);
  const exchangeOutflow24h = classifiedTransfers.filter((t) => t.category === 'exchange_outflow' && t.ts >= sinceTs).reduce((s, t) => s + t.amountXpl, 0);

  const previousHolders = await readJsonSafe(path.join(DATA_DIR, 'previous-holders.json'), null);
  let holderDeltaPct = null;
  const holdersWithDelta = holders.map((h) => {
    const prior = previousHolders?.holders?.find((p) => p.address === h.address);
    return { ...h, deltaXpl: prior ? h.balanceXpl - prior.balanceXpl : null };
  });
  if (previousHolders?.holders?.length) {
    const currentSum = holders.reduce((s, h) => s + h.balanceXpl, 0);
    const priorSum = previousHolders.holders.reduce((s, h) => s + h.balanceXpl, 0);
    if (priorSum > 0) holderDeltaPct = ((currentSum - priorSum) / priorSum) * 100;
  }

  const signal = computeSignal({
    market,
    exchangeInflow24h,
    exchangeOutflow24h,
    holderDeltaPct,
    unlockEvents: STATIC_UNLOCK_EVENTS,
  });

  const snapshot = {
    generatedAt: new Date().toISOString(),
    market,
    holders: holdersWithDelta,
    holderDeltaPct,
    largeTransfers,
    rewardCandidates,
    unlockEvents: STATIC_UNLOCK_EVENTS,
    signal,
    thresholdXpl: LARGE_TRANSFER_XPL,
    scannedTxCount: transfers.length,
  };

  await fs.writeFile(path.join(DATA_DIR, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(DATA_DIR, 'previous-holders.json'), JSON.stringify({ generatedAt: snapshot.generatedAt, holders }, null, 2));
  await fs.writeFile(path.join(DATA_DIR, 'reward-heuristic-state.json'), JSON.stringify(nextRewardState, null, 2));

  // Seed labels.json with anything auto-detected that wasn't already curated,
  // so it becomes visible/editable in the repo rather than staying implicit.
  const seededDoc = { exchanges: {}, reward_wallets: {}, unlock_allocation: {}, ...curatedDoc };
  for (const [addr, entry] of labelIndex) {
    if (entry.source === 'curated') continue;
    seededDoc[entry.category] = seededDoc[entry.category] || {};
    if (!(addr in seededDoc[entry.category])) seededDoc[entry.category][addr] = entry.label;
  }
  await fs.writeFile(path.join(DATA_DIR, 'labels.json'), JSON.stringify(seededDoc, null, 2));

  console.log(`[fetch-data] wrote snapshot: ${holders.length} holders, ${transfers.length} txs scanned, ${largeTransfers.length} large transfers, ${rewardCandidates.length} reward candidates.`);
}

main().catch((err) => {
  console.error('[fetch-data] fatal:', err);
  process.exitCode = 1;
});
