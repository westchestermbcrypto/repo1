import { config } from '../config.js';
import * as plasmascan from './plasmascan.js';
import * as coingecko from './coingecko.js';
import { getUnlockEvents } from './unlocks.js';
import { classifyTransfer, detectRewardWalletCandidates, lookupLabel } from './labels.js';
import {
  insertPriceSnapshot,
  replaceHolderSnapshot,
  insertTransferEvent,
  replaceUnlockEvents,
  getLatestPrice,
  setMeta,
  getMeta,
} from '../db.js';

const HOLDER_DISPLAY_COUNT = 15;
const HOLDER_FETCH_COUNT = 30;

async function pollPrice() {
  const market = await coingecko.getMarketData();
  const ts = Math.floor(Date.now() / 1000);
  insertPriceSnapshot({
    ts,
    priceUsd: market.priceUsd,
    marketCapUsd: market.marketCapUsd,
    volume24hUsd: market.volume24hUsd,
    change24hPct: market.change24hPct,
  });
  return market;
}

async function pollHolders() {
  const addresses = await plasmascan.getTopAddresses(HOLDER_FETCH_COUNT);
  const ts = Math.floor(Date.now() / 1000);
  const rows = addresses.slice(0, HOLDER_DISPLAY_COUNT).map((a, i) => {
    const curated = lookupLabel(a.address);
    return {
      rank: i + 1,
      address: a.address,
      balance_xpl: a.balanceXpl,
      pct_supply: (a.balanceXpl / config.totalSupplyXpl) * 100,
      label: curated?.label || a.label || null,
    };
  });
  replaceHolderSnapshot(ts, rows);
  return rows;
}

async function pollTransfers(latestPriceUsd) {
  const transfers = await plasmascan.getRecentTransactions(config.txScanLimit);

  // Reward-wallet heuristic runs over the whole batch (small transfers included).
  detectRewardWalletCandidates(transfers, config.largeTransferXpl);

  const large = transfers.filter((t) => t.amountXpl >= config.largeTransferXpl);
  for (const t of large) {
    const { category, fromLabel, toLabel } = classifyTransfer(t);
    insertTransferEvent({
      txHash: t.txHash,
      blockNumber: t.blockNumber ?? null,
      ts: t.ts,
      fromAddress: t.fromAddress,
      toAddress: t.toAddress,
      amountXpl: t.amountXpl,
      amountUsd: latestPriceUsd ? t.amountXpl * latestPriceUsd : null,
      category,
      fromLabel: fromLabel?.label ?? t.fromLabel ?? null,
      toLabel: toLabel?.label ?? t.toLabel ?? null,
    });
  }
  return { scanned: transfers.length, large: large.length };
}

async function pollUnlocks() {
  const { events } = await getUnlockEvents();
  replaceUnlockEvents(events);
  return events.length;
}

export async function runPollCycle() {
  const results = { ts: new Date().toISOString(), errors: [] };

  let priceUsd = getLatestPrice()?.price_usd ?? null;
  try {
    const market = await pollPrice();
    priceUsd = market.priceUsd;
    results.price = 'ok';
  } catch (err) {
    results.errors.push(`price: ${err.message}`);
  }

  try {
    const holders = await pollHolders();
    results.holders = `ok (${holders.length})`;
  } catch (err) {
    results.errors.push(`holders: ${err.message}`);
  }

  try {
    const t = await pollTransfers(priceUsd);
    results.transfers = `ok (scanned ${t.scanned}, ${t.large} large)`;
  } catch (err) {
    results.errors.push(`transfers: ${err.message}`);
  }

  try {
    const count = await pollUnlocks();
    results.unlocks = `ok (${count})`;
  } catch (err) {
    results.errors.push(`unlocks: ${err.message}`);
  }

  setMeta('last_poll', JSON.stringify(results));
  if (results.errors.length > 0) {
    console.warn('[poller] cycle completed with errors:', results.errors);
  } else {
    console.log('[poller] cycle ok:', results);
  }
  return results;
}

export function getLastPollStatus() {
  const raw = getMeta('last_poll');
  return raw ? JSON.parse(raw) : null;
}

let timer = null;

export function startPolling() {
  if (timer) return;
  runPollCycle();
  timer = setInterval(runPollCycle, config.pollIntervalMs);
}

export function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
