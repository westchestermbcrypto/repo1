import { config } from '../config.js';

async function fetchJson(url, { timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText} (${url})`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getMarketData() {
  const url = new URL(`${config.coingeckoApiBase}/coins/markets`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('ids', config.coingeckoCoinId);
  url.searchParams.set('price_change_percentage', '1h,24h,7d');
  const data = await fetchJson(url);
  const coin = data?.[0];
  if (!coin) {
    throw new Error(`CoinGecko returned no data for coin id "${config.coingeckoCoinId}" -- check COINGECKO_COIN_ID in .env`);
  }
  return {
    priceUsd: coin.current_price,
    marketCapUsd: coin.market_cap,
    volume24hUsd: coin.total_volume,
    change1hPct: coin.price_change_percentage_1h_in_currency ?? null,
    change24hPct: coin.price_change_percentage_24h_in_currency ?? coin.price_change_percentage_24h ?? null,
    change7dPct: coin.price_change_percentage_7d_in_currency ?? null,
  };
}
