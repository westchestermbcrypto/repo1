# XPL (Plasma) Trading Dashboard

A static [GitHub Pages](https://pages.github.com/) dashboard for the XPL token
(Plasma chain) that tracks:

- Live price, market cap, and volume (CoinGecko, fetched client-side)
- Top 15 wallet holders and how their balances are moving
- Large XPL transfers to/from labeled exchange wallets
- A heuristic detector for likely Plasma One card-reward payouts
- The two unlock events happening this month, with a countdown and notes on
  what to watch for
- A plain-language "accumulation-leaning / distribution-leaning" signal that
  combines the above

## Why a scraper, not just client-side API calls

The original design tried to fetch everything straight from the browser. That
works for price data (CoinGecko allows cross-origin requests), but not for
holders or transfers: `plasmascan.to`'s actual API
(`api.plasmascan.to`, an Etherscan-V2-family API, confirmed by hitting it
live) has no endpoint for "top holders by balance" or "recent large
transfers chain-wide" -- Etherscan-style APIs never expose that, on any
chain. That data only exists on the explorer's own web pages, which don't
send CORS headers, so a browser can't read them either.

The fix: a scheduled **GitHub Action** (`.github/workflows/update-data.yml`,
every ~30 minutes) runs `scripts/fetch-data.js` server-side -- server-to-server
requests aren't subject to CORS at all -- scrapes `plasmascan.to/accounts` and
`plasmascan.to/txs`, classifies transfers, and commits the result to
`data/snapshot.json`. The static page just fetches that JSON file (same-origin,
no CORS issue) plus live price data straight from CoinGecko. Still 100%
GitHub Pages; the only "server" is the Action, and it doesn't run at page-load
time, so there's nothing to host.

## Setup

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. **Enable GitHub Pages**: repo Settings -> Pages -> Source: Deploy from a
   branch -> Branch: `main`, folder `/ (root)`.
3. **Run the data workflow once manually** so the dashboard has real data
   immediately instead of waiting for the first scheduled run: Actions tab ->
   "Update XPL dashboard data" -> Run workflow.
4. Visit the Pages URL GitHub gives you (Settings -> Pages shows it once
   enabled).

No API keys, no build step, no `npm install` needed to view the site --
`npm install` is only for running the Action (or testing the scraper
locally with `npm run fetch-data`).

## Data sources and what's actually confirmed

| Data | Source | Confidence |
|---|---|---|
| Price, market cap, volume | CoinGecko public API (client-side, live) | Solid |
| Top holders, native balances | Scraped from `plasmascan.to/accounts` by the Action | Solid, refreshed every ~30 min |
| Raw large transfers | Scraped from `plasmascan.to/txs` (newest ~300 txs per run) by the Action | Solid for what's scanned; a transfer between two scheduled runs on a very high-throughput window could theoretically be missed if it falls outside the scanned page range -- not expected in practice at Plasma's current volume |
| **Which wallets are exchanges / treasury / team / investor** | Auto-detected from plasmascan.to's own name tags (pattern-matched in `scripts/fetch-data.js`) + anything you add to `data/labels.json` | The explorer already labels several: e.g. a "Binance: Hot Wallet" entry and Ecosystem/Team/Investor treasury wallets showed up unprompted in testing. Auto-detected labels get written back into `data/labels.json` each run so they're visible and overridable. |
| **Plasma One card-reward wallet** | Heuristic: a sender that fans out many small transfers to distinct recipients on a Thursday (rewards are paid weekly on Thursdays per Plasma's published terms), tracked across runs in `data/reward-heuristic-state.json` | **Unconfirmed, heuristic only** -- flagged as a "candidate," not a fact. No official reward-wallet address is published. |
| **Unlock event wallets** | Plasma tokenomics docs + Bitget/DefiLlama unlock trackers | Dates and allocation categories are solid; **exact distributing wallet addresses are not publicly confirmed** -- the unlock cards tell you what to watch for instead. The scraped holders table already surfaces strong candidates (wallets tagged "Ecosystem Treasury", "Team", "Investor" show up directly in the top-15 list). |

The two unlock events tracked (see `STATIC_UNLOCK_EVENTS` in
`scripts/fetch-data.js` for sources):

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

DefiLlama's emissions API now requires a paid plan (confirmed by testing --
it returns 402), so it's not called at all; the static schedule above is the
only unlock source.

## Filling in labels as you identify them

Edit `data/labels.json` and commit it -- the Action always treats entries here
as `"curated"` and preserves them across runs, even as it merges in new
auto-detected labels:

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
- Check the top-holders table on the dashboard itself -- several are already
  auto-labeled from plasmascan.to's own tags.
- When you deposit/withdraw XPL from an exchange yourself, note the address
  plasmascan.to shows and add it.
- Around July 25 and July 28, watch the "Suspected" heuristics and the
  unlabeled-whale feed closely -- newly active large wallets around those
  dates are good candidates for the unlock allocation wallets.

## Configuring the scraper

Constants live at the top of `scripts/fetch-data.js`:

| Constant | Default | Meaning |
|---|---|---|
| `TOP_HOLDERS_LIMIT` | 15 | How many holders to keep |
| `TX_PAGES_TO_SCAN` | 6 | Pages of `plasmascan.to/txs` scanned per run (~50 txs/page) |
| `LARGE_TRANSFER_XPL` | 250000 | Minimum size to show in the large-transfer feed |
| `TOTAL_SUPPLY_XPL` | 10000000000 | Used for % of supply calculations |

Raise `TX_PAGES_TO_SCAN` (or shorten the cron interval in
`.github/workflows/update-data.yml`) if Plasma's throughput means the scanned
window covers less time than you'd like between refreshes.

## The "signal" panel

`computeSignal()` in `scripts/fetch-data.js` combines net exchange flow (in
the scanned window), the change in combined top-15-holder balance, and
proximity to an unlock event into a three-way bias: accumulation-leaning /
neutral / distribution-leaning, with plain-language notes explaining why.
It's a heuristic aid built from the same signals a discretionary trader would
eyeball -- not a prediction, and it's only as good as the labels in
`data/labels.json`. Treat it as a starting point for your own judgment, not
an answer.

## Known limitations

- Data updates on a ~30 minute cycle (GitHub Actions' practical minimum
  cadence for scheduled workflows), not real-time -- price is the exception,
  fetched live in the browser.
- Exchange and reward-wallet labeling accuracy grows as `data/labels.json`
  is curated; auto-detection only catches wallets plasmascan.to has already
  tagged.
- Unlock wallet addresses are not pre-populated (none are publicly
  confirmed); the dashboard tells you what pattern to watch for instead.
- XPL also exists as a bridged/wrapped ERC-20 on Ethereum
  (`WXPL`/exchange-custodied balances may live there instead of on native
  Plasma) -- this dashboard only tracks native Plasma-chain activity.
- The scraper depends on `plasmascan.to`'s current page markup
  (`scripts/fetch-data.js`'s `getTopHolders`/`getRecentTransfers`); if the
  explorer redesigns those pages, the Action will start logging warnings and
  writing empty holder/transfer arrays until the selectors are updated.
