# XPL (Plasma) Trading Dashboard

A local dashboard for the XPL token (Plasma chain) that tracks:

- Live price, market cap, and volume (CoinGecko)
- Top 15 wallet holders and how their balances are moving
- Large XPL transfers to/from labeled exchange wallets
- A heuristic detector for likely Plasma One card-reward payouts
- The two unlock events happening this month, with a countdown and notes on
  what to watch for
- A plain-language "accumulation-leaning / distribution-leaning" signal that
  combines the above

It's a Node.js server that polls public APIs on an interval, stores snapshots
in SQLite, and serves a small dashboard UI. No paid API keys required.

## Setup

```bash
npm install
cp .env.example .env   # adjust if needed -- defaults work out of the box
npm start
```

Then open `http://localhost:3000`. The server polls every 60 seconds by
default (`POLL_INTERVAL_MS` in `.env`); the first meaningful chart/table data
appears after the first successful cycle, and trend data (holder deltas,
price history) fills in over the next few cycles.

## Data sources and what's actually confirmed

This is the important part -- be clear-eyed about what's solid data vs. a
best-effort signal:

| Data | Source | Confidence |
|---|---|---|
| Price, market cap, volume | CoinGecko public API | Solid |
| Top holders, native balances | Plasmascan (Blockscout) `/api/v2/addresses` | Solid |
| Raw large transfers | Plasmascan `/api/v2/transactions` | Solid |
| **Which wallets are exchanges** | Manually curated `server/labels.json` | **Empty by default** -- Plasma is a new chain and I could not find a public, reliable list of exchange deposit/hot-wallet addresses on Plasma at build time. Unlabeled large transfers still show up in the feed, just without a "to/from exchange" tag until you add one. |
| **Plasma One card-reward wallet** | Heuristic: a sender that fans out many small transfers to distinct recipients on a Thursday (rewards are paid weekly on Thursdays per Plasma's published terms) | **Unconfirmed, heuristic only** -- flagged as a "candidate," not a fact. No official reward-wallet address is published. |
| **Unlock event wallets** | Plasma tokenomics docs + Bitget/DefiLlama unlock trackers | Dates and allocation categories are solid; **exact distributing wallet addresses are not publicly confirmed** -- see the unlock cards for what to watch for on Plasmascan instead of a specific address. |

The two unlock events tracked (see `server/services/unlocks.js` for sources):

- **July 25, 2026** -- Ecosystem & Growth monthly vest (~89M XPL, ~0.89% of
  supply, estimated as an even monthly tranche of the 3.2B linear-vesting
  pool -- verify the actual amount against
  [defillama.com/unlocks/plasma](https://defillama.com/unlocks/plasma) closer
  to the date, the Foundation may not distribute in perfectly even tranches).
- **July 28, 2026** -- Public-sale US-purchaser 12-month lockup expires. This
  is a subset of the 10% public-sale allocation (non-US buyers already
  unlocked at launch); no exact amount is broken out in public sources, so
  treat it as a date of elevated sell-side risk rather than a precise supply
  figure.

The app also makes a best-effort call to DefiLlama's emissions API
(`DEFILLAMA_EMISSIONS_URL`) to supplement these; if that endpoint's shape
doesn't match (DefiLlama's schema varies per project and wasn't verified live
against Plasma specifically), it silently falls back to the static schedule
above, so the dashboard never breaks because of it.

## Filling in labels as you identify them

Edit `server/labels.json` -- it's re-read every poll cycle, no restart
needed:

```json
{
  "exchanges": {
    "0xabc...": "Binance Hot Wallet"
  },
  "reward_wallets": {
    "0xdef...": "Plasma One Rewards"
  },
  "unlock_allocation": {
    "0x123...": "Ecosystem & Growth Treasury"
  }
}
```

Good ways to find real addresses to add:
- Watch Plasmascan (`https://plasmascan.to`) for addresses it tags itself
  (public tags show up automatically in the holders/flows tables even
  without an entry in `labels.json`).
- When you deposit/withdraw XPL from an exchange yourself, note the address
  Plasmascan shows and add it.
- Around July 25 and July 28, watch the "Suspected" heuristics and the
  unlabeled-whale feed closely -- newly active large wallets around those
  dates are good candidates for the unlock allocation wallets.

## Config (`.env`)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Dashboard HTTP port |
| `POLL_INTERVAL_MS` | 60000 | How often to refresh data |
| `PLASMASCAN_API_BASE` | `https://plasmascan.to/api/v2` | Verify this still matches the live explorer if data stops flowing |
| `COINGECKO_COIN_ID` | `plasma` | CoinGecko's "API ID" for XPL |
| `LARGE_TRANSFER_XPL` | 250000 | Minimum size to show in the large-transfer feed |
| `TX_SCAN_LIMIT` | 200 | Newest transactions scanned per poll cycle |
| `TOTAL_SUPPLY_XPL` | 10000000000 | Used for % of supply calculations |

Raise `TX_SCAN_LIMIT` or lower `POLL_INTERVAL_MS` if Plasma's throughput
means 200 transactions covers less time than you'd like between polls (a
payments-focused chain can have very high TPS, so the scan window may be
seconds, not minutes).

## The "signal" panel

`server/services/signals.js` combines net exchange flow (24h), the change in
combined top-15-holder balance, and proximity to an unlock event into a
three-way bias: accumulation-leaning / neutral / distribution-leaning, with
plain-language notes explaining why. It's a heuristic aid built from the same
signals a discretionary trader would eyeball -- not a prediction, and it's
only as good as the labels in `labels.json`. Treat it as a starting point for
your own judgment, not an answer.

## Known limitations

- Exchange and reward-wallet labeling starts empty/heuristic -- accuracy
  grows as you curate `labels.json`.
- The reward-wallet heuristic accumulates in memory across the server's
  uptime and resets on restart.
- Unlock wallet addresses are not pre-populated (none are publicly
  confirmed); the dashboard tells you what pattern to watch for instead.
- XPL also exists as a bridged/wrapped ERC-20 on Ethereum
  (`WXPL`/exchange-custodied balances may live there instead of on native
  Plasma) -- this dashboard only tracks native Plasma-chain activity. Add an
  Ethereum-side poller if you need that too.
