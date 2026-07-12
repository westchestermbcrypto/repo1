/**
 * Turns raw data into a plain-language "what to watch" summary.
 * This is a heuristic aid, not financial advice or a prediction --
 * it surfaces the same signals a discretionary trader would eyeball.
 */
export function computeSignal({ latestPrice, exchangeInflow24h, exchangeOutflow24h, holderDeltaPct, unlockEvents }) {
  const netExchangeFlowXpl = exchangeOutflow24h - exchangeInflow24h;
  const notes = [];
  let bias = 'neutral';
  let score = 0;

  if (netExchangeFlowXpl > 0) {
    notes.push(`Net outflow from labeled exchange wallets over 24h (${Math.round(netExchangeFlowXpl).toLocaleString()} XPL) -- tokens moving to self-custody, historically a mild accumulation signal.`);
    score += 1;
  } else if (netExchangeFlowXpl < 0) {
    notes.push(`Net inflow to labeled exchange wallets over 24h (${Math.round(-netExchangeFlowXpl).toLocaleString()} XPL) -- tokens moving toward exchanges, often precedes selling.`);
    score -= 1;
  } else {
    notes.push('No labeled exchange flow detected in the last 24h (or no exchange wallets are labeled yet -- see README).');
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
  const upcoming = (unlockEvents || [])
    .map((e) => ({ ...e, daysAway: (new Date(e.date).getTime() - now) / 86_400_000 }))
    .filter((e) => e.daysAway >= 0 && e.daysAway <= 14)
    .sort((a, b) => a.daysAway - b.daysAway);

  if (upcoming.length > 0) {
    const next = upcoming[0];
    notes.push(`${next.title} is ${Math.ceil(next.daysAway)} day(s) away (${next.date}) -- unlocks typically add sell-side supply; consider this a period of elevated downside risk until absorbed.`);
    score -= 1;
  }

  if (score >= 1) bias = 'accumulation-leaning';
  else if (score <= -1) bias = 'distribution-leaning';

  return {
    bias,
    score,
    netExchangeFlowXpl,
    notes,
    priceUsd: latestPrice?.price_usd ?? null,
    generatedAt: new Date().toISOString(),
  };
}
