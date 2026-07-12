import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDetectedLabel, upsertDetectedLabel } from '../db.js';

const LABELS_PATH = fileURLToPath(new URL('../labels.json', import.meta.url));

function loadCuratedLabels() {
  try {
    const raw = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf8'));
    const flat = new Map();
    for (const [category, entries] of Object.entries(raw)) {
      if (category.startsWith('_') || typeof entries !== 'object') continue;
      for (const [address, label] of Object.entries(entries)) {
        flat.set(address.toLowerCase(), { label, category, source: 'curated' });
      }
    }
    return flat;
  } catch (err) {
    console.warn(`[labels] could not read labels.json (${err.message}); continuing with no curated labels`);
    return new Map();
  }
}

/** Re-read on every call: the file is small and this keeps edits live without a restart. */
export function lookupLabel(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  const curated = loadCuratedLabels();
  if (curated.has(lower)) return curated.get(lower);
  const detected = getDetectedLabel(lower);
  if (detected) {
    return { label: `${detected.label} (heuristic, ${detected.confidence} confidence)`, category: detected.category, source: 'detected' };
  }
  return null;
}

/**
 * Classify a native XPL transfer for the flows feed.
 * Returns one of: exchange_inflow, exchange_outflow, reward_candidate,
 * unlock_related, whale_unlabeled.
 */
export function classifyTransfer({ fromAddress, toAddress }) {
  const fromLabel = lookupLabel(fromAddress);
  const toLabel = lookupLabel(toAddress);

  if (toLabel?.category === 'exchanges') return { category: 'exchange_inflow', fromLabel, toLabel };
  if (fromLabel?.category === 'exchanges') return { category: 'exchange_outflow', fromLabel, toLabel };
  if (fromLabel?.category === 'reward_wallets') return { category: 'reward_candidate', fromLabel, toLabel };
  if (fromLabel?.category === 'unlock_allocation' || toLabel?.category === 'unlock_allocation') {
    return { category: 'unlock_related', fromLabel, toLabel };
  }
  return { category: 'whale_unlabeled', fromLabel, toLabel };
}

/**
 * Heuristically flag candidate Plasma One card-reward distribution wallets:
 * Plasma One pays cashback weekly, every Thursday, as many small transfers
 * from a rewards ledger to individual cardholders. A sender that fans out to
 * many distinct recipients in small amounts on a Thursday is a plausible
 * candidate -- flagged for the user to confirm, not auto-trusted.
 */
const REWARD_MIN_DISTINCT_RECIPIENTS = 15;
const REWARD_BUCKET_MAX_AGE_DAYS = 2;

// Accumulates across poll cycles for the life of the process -- a single
// scan of the newest N transactions won't capture a full day's fan-out on a
// high-throughput chain, so we merge each cycle's Thursday transfers into a
// running per-day set instead of recomputing from scratch. Resets on
// restart; that's an accepted limitation for a heuristic, not a hard fact.
const dayBuckets = new Map();

function pruneOldBuckets() {
  const cutoff = Date.now() - REWARD_BUCKET_MAX_AGE_DAYS * 86_400_000;
  for (const [key, bucket] of dayBuckets) {
    if (bucket.lastTs * 1000 < cutoff) dayBuckets.delete(key);
  }
}

export function detectRewardWalletCandidates(transfers, largeTransferXpl) {
  for (const t of transfers) {
    const day = new Date(t.ts * 1000);
    if (day.getUTCDay() !== 4) continue; // 4 = Thursday
    if (t.amountXpl >= largeTransferXpl) continue; // reward payouts are small, not whale-sized
    const dayKey = day.toISOString().slice(0, 10);
    const key = `${t.fromAddress.toLowerCase()}|${dayKey}`;
    if (!dayBuckets.has(key)) dayBuckets.set(key, { fromAddress: t.fromAddress, recipients: new Set(), count: 0, lastTs: t.ts });
    const bucket = dayBuckets.get(key);
    bucket.recipients.add(t.toAddress.toLowerCase());
    bucket.count += 1;
    bucket.lastTs = Math.max(bucket.lastTs, t.ts);
  }
  pruneOldBuckets();

  const nowSec = Math.floor(Date.now() / 1000);
  const candidates = [];
  for (const bucket of dayBuckets.values()) {
    if (bucket.recipients.size < REWARD_MIN_DISTINCT_RECIPIENTS) continue;
    const existing = getDetectedLabel(bucket.fromAddress.toLowerCase());
    upsertDetectedLabel({
      address: bucket.fromAddress.toLowerCase(),
      label: 'Plasma One card rewards (suspected)',
      category: 'reward_wallets',
      confidence: bucket.recipients.size >= 30 ? 'medium' : 'low',
      firstSeen: existing?.first_seen ?? nowSec,
      lastSeen: nowSec,
      evidence: `${bucket.recipients.size} distinct recipients, ${bucket.count} transfers on a Thursday`,
    });
    candidates.push(bucket);
  }
  return candidates;
}
