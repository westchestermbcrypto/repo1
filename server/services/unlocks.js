import { config } from '../config.js';

/**
 * XPL has no publicly confirmed vesting-contract addresses as of this
 * writing (Plasma Foundation controls distribution; no address has been
 * published in project docs). Rather than guess an address, each event
 * lists what to look for on Plasmascan so it can be filled in once known --
 * see README "Filling in unlock wallets" section.
 *
 * Sources (checked July 2026):
 *  - https://www.plasma.org/docs/get-started/xpl/tokenomics
 *  - https://web3.bitget.com/en/academy/plasma-xpl-token-unlock-schedule-key-dates-vesting-periods-and-price-impact
 *  - https://defillama.com/unlocks/plasma
 */
const STATIC_UNLOCK_EVENTS = [
  {
    id: 'ecosystem-growth-2026-07-25',
    date: '2026-07-25',
    title: 'Ecosystem & Growth monthly vest',
    amount_xpl: (3_200_000_000 / 36),
    pct_supply: (3_200_000_000 / 36 / config.totalSupplyXpl) * 100,
    category: 'ecosystem_growth',
    source: 'https://www.plasma.org/docs/get-started/xpl/tokenomics',
    wallets_json: JSON.stringify([
      {
        address: null,
        note: 'Not yet publicly confirmed. Watch for a Plasmascan address tagged '
          + '"Plasma Foundation" / "Ecosystem" with large recurring monthly outflows '
          + 'around the 25th; add its address to server/labels.json under '
          + '"unlock_allocation" once identified.',
      },
    ]),
    note: 'Estimated even monthly tranche (3.2B XPL / 36 months). Actual tranche size '
      + 'may vary if the Foundation front- or back-loads distributions -- verify against '
      + 'https://defillama.com/unlocks/plasma closer to the date.',
  },
  {
    id: 'public-sale-us-lockup-2026-07-28',
    date: '2026-07-28',
    title: 'Public sale US-purchaser lockup expiry',
    amount_xpl: null,
    pct_supply: null,
    category: 'public_sale',
    source: 'https://web3.bitget.com/en/academy/plasma-xpl-token-unlock-schedule-key-dates-vesting-periods-and-price-impact',
    wallets_json: JSON.stringify([
      {
        address: null,
        note: 'XPL bought by US purchasers in the public sale (10% of total supply pool, '
          + 'non-US portion already unlocked at launch) becomes freely transferable. No '
          + 'single custodial wallet -- watch for a broad increase in outbound transfers '
          + 'from many previously-dormant public-sale addresses starting this date, and '
          + 'for inflows to exchange deposit addresses shortly after.',
      },
    ]),
    note: 'Exact XPL amount subject to this specific lockup is not separately broken out '
      + 'in public sources (it is a subset of the 10% public-sale allocation); treat this '
      + 'primarily as a date to watch for elevated sell-side liquidity, not a precise amount.',
  },
];

async function fetchJson(url, { timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`DefiLlama request failed: ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort refresh from DefiLlama. Their emissions payload shape varies
 * by project and isn't guaranteed to match here -- on any parse failure we
 * just keep the static schedule, logging a warning rather than crashing.
 */
export async function getUnlockEvents() {
  try {
    const data = await fetchJson(config.defillamaEmissionsUrl);
    const events = data?.events || data?.data?.events;
    if (Array.isArray(events) && events.length > 0) {
      const parsed = events
        .filter((e) => e?.timestamp || e?.date)
        .map((e, i) => {
          const date = e.date || new Date(e.timestamp * 1000).toISOString().slice(0, 10);
          return {
            id: `defillama-${date}-${i}`,
            date,
            title: e.category || e.description || 'Token unlock',
            amount_xpl: e.noOfTokens?.[0] ?? e.amount ?? null,
            pct_supply: null,
            category: e.category || 'unknown',
            source: 'https://defillama.com/unlocks/plasma',
            wallets_json: JSON.stringify([]),
          };
        });
      // Merge: DefiLlama data supplements but does not replace the curated
      // static events, which carry richer "what to watch for" guidance.
      const staticIds = new Set(STATIC_UNLOCK_EVENTS.map((e) => e.id));
      const merged = [...STATIC_UNLOCK_EVENTS, ...parsed.filter((e) => !staticIds.has(e.id))];
      return { events: merged, defillamaOk: true };
    }
    return { events: STATIC_UNLOCK_EVENTS, defillamaOk: false };
  } catch (err) {
    return { events: STATIC_UNLOCK_EVENTS, defillamaOk: false, error: err.message };
  }
}

export { STATIC_UNLOCK_EVENTS };
