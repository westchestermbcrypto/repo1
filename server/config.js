import 'dotenv/config';

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num('PORT', 3000),
  pollIntervalMs: num('POLL_INTERVAL_MS', 60_000),
  plasmascanApiBase: process.env.PLASMASCAN_API_BASE || 'https://plasmascan.to/api/v2',
  coingeckoCoinId: process.env.COINGECKO_COIN_ID || 'plasma',
  coingeckoApiBase: process.env.COINGECKO_API_BASE || 'https://api.coingecko.com/api/v3',
  defillamaEmissionsUrl: process.env.DEFILLAMA_EMISSIONS_URL || 'https://api.llama.fi/emissions/plasma',
  largeTransferXpl: num('LARGE_TRANSFER_XPL', 250_000),
  txScanLimit: num('TX_SCAN_LIMIT', 200),
  totalSupplyXpl: num('TOTAL_SUPPLY_XPL', 10_000_000_000),
  dbPath: process.env.DB_PATH || new URL('../data/dashboard.db', import.meta.url).pathname,
};
