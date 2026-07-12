import { config } from '../config.js';

const NATIVE_DECIMALS = 18n;
const NATIVE_DIVISOR = 10n ** NATIVE_DECIMALS;

async function fetchJson(url, { timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Plasmascan request failed: ${res.status} ${res.statusText} (${url})`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function weiToXpl(weiString) {
  try {
    const wei = BigInt(weiString);
    const whole = wei / NATIVE_DIVISOR;
    const remainder = wei % NATIVE_DIVISOR;
    return Number(whole) + Number(remainder) / Number(NATIVE_DIVISOR);
  } catch {
    return Number(weiString) / 1e18;
  }
}

function pickLabel(addressObj) {
  if (!addressObj) return null;
  const tag = addressObj.public_tags?.[0]?.display_name
    || addressObj.metadata?.name
    || addressObj.name
    || null;
  return tag;
}

/**
 * Top addresses by native XPL balance ("Top Accounts" leaderboard).
 * Blockscout's /addresses endpoint returns items sorted by coin_balance desc.
 */
export async function getTopAddresses(limit = 30) {
  const results = [];
  let nextParams = null;
  while (results.length < limit) {
    const url = new URL(`${config.plasmascanApiBase}/addresses`);
    if (nextParams) {
      for (const [k, v] of Object.entries(nextParams)) url.searchParams.set(k, v);
    }
    const data = await fetchJson(url);
    const items = data.items || [];
    if (items.length === 0) break;
    for (const item of items) {
      results.push({
        address: item.hash,
        balanceXpl: weiToXpl(item.coin_balance ?? '0'),
        label: pickLabel(item),
        isContract: Boolean(item.is_contract),
      });
      if (results.length >= limit) break;
    }
    nextParams = data.next_page_params;
    if (!nextParams) break;
  }
  return results;
}

/**
 * Newest validated transactions, newest first, up to `limit`.
 * Used to scan for large native XPL transfers.
 */
export async function getRecentTransactions(limit = 200) {
  const results = [];
  let nextParams = null;
  while (results.length < limit) {
    const url = new URL(`${config.plasmascanApiBase}/transactions`);
    url.searchParams.set('filter', 'validated');
    if (nextParams) {
      for (const [k, v] of Object.entries(nextParams)) url.searchParams.set(k, v);
    }
    const data = await fetchJson(url);
    const items = data.items || [];
    if (items.length === 0) break;
    for (const item of items) {
      results.push({
        txHash: item.hash,
        blockNumber: item.block_number ?? item.block,
        ts: item.timestamp ? Math.floor(new Date(item.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
        fromAddress: item.from?.hash,
        toAddress: item.to?.hash,
        amountXpl: weiToXpl(item.value ?? '0'),
        fromLabel: pickLabel(item.from),
        toLabel: pickLabel(item.to),
      });
      if (results.length >= limit) break;
    }
    nextParams = data.next_page_params;
    if (!nextParams) break;
  }
  return results;
}

export function explorerAddressUrl(address) {
  return `https://plasmascan.to/address/${address}`;
}

export function explorerTxUrl(txHash) {
  return `https://plasmascan.to/tx/${txHash}`;
}
