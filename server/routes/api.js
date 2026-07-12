import { Router } from 'express';
import { config } from '../config.js';
import {
  getLatestPrice,
  getPriceHistory,
  getLatestHolderSnapshotTs,
  getHolderSnapshot,
  getHolderSnapshotBefore,
  getTransferEvents,
  getDetectedLabels,
  getUnlockEvents as getStoredUnlockEvents,
} from '../db.js';
import { computeSignal } from '../services/signals.js';
import { getLastPollStatus } from '../services/poller.js';
import { explorerAddressUrl, explorerTxUrl } from '../services/plasmascan.js';

export const router = Router();

router.get('/price', (req, res) => {
  const latest = getLatestPrice();
  const sinceTs = Math.floor(Date.now() / 1000) - 7 * 86_400;
  const history = getPriceHistory(sinceTs);
  res.json({ latest, history });
});

router.get('/holders', (req, res) => {
  const latestTs = getLatestHolderSnapshotTs();
  if (!latestTs) return res.json({ ts: null, holders: [] });
  const current = getHolderSnapshot(latestTs);
  const prior = getHolderSnapshotBefore(latestTs);
  const priorByAddress = new Map(prior.map((h) => [h.address, h]));

  const holders = current.map((h) => {
    const before = priorByAddress.get(h.address);
    return {
      ...h,
      explorerUrl: explorerAddressUrl(h.address),
      deltaXpl: before ? h.balance_xpl - before.balance_xpl : null,
    };
  });
  res.json({ ts: latestTs, holders });
});

router.get('/flows', (req, res) => {
  const hours = Number(req.query.hours) || 24;
  const category = req.query.category || null;
  const sinceTs = Math.floor(Date.now() / 1000) - hours * 3600;
  const events = getTransferEvents({ category, sinceTs, limit: 200 }).map((e) => ({
    ...e,
    explorerTxUrl: explorerTxUrl(e.tx_hash),
    fromExplorerUrl: explorerAddressUrl(e.from_address),
    toExplorerUrl: explorerAddressUrl(e.to_address),
  }));
  const rewardCandidates = getDetectedLabels().filter((l) => l.category === 'reward_wallets');
  res.json({ events, rewardCandidates, thresholdXpl: config.largeTransferXpl });
});

router.get('/unlocks', (req, res) => {
  const events = getStoredUnlockEvents().map((e) => ({
    ...e,
    wallets: JSON.parse(e.wallets_json || '[]'),
    daysAway: (new Date(e.date).getTime() - Date.now()) / 86_400_000,
  }));
  res.json({ events });
});

router.get('/signal', (req, res) => {
  const latestPrice = getLatestPrice();
  const sinceTs = Math.floor(Date.now() / 1000) - 24 * 3600;
  const inflow = getTransferEvents({ category: 'exchange_inflow', sinceTs, limit: 1000 })
    .reduce((sum, e) => sum + e.amount_xpl, 0);
  const outflow = getTransferEvents({ category: 'exchange_outflow', sinceTs, limit: 1000 })
    .reduce((sum, e) => sum + e.amount_xpl, 0);

  const latestTs = getLatestHolderSnapshotTs();
  let holderDeltaPct = null;
  if (latestTs) {
    const current = getHolderSnapshot(latestTs);
    const prior = getHolderSnapshotBefore(latestTs);
    if (prior.length > 0) {
      const currentSum = current.reduce((s, h) => s + h.balance_xpl, 0);
      const priorSum = prior.reduce((s, h) => s + h.balance_xpl, 0);
      if (priorSum > 0) holderDeltaPct = ((currentSum - priorSum) / priorSum) * 100;
    }
  }

  const unlockEvents = getStoredUnlockEvents();
  const signal = computeSignal({
    latestPrice,
    exchangeInflow24h: inflow,
    exchangeOutflow24h: outflow,
    holderDeltaPct,
    unlockEvents,
  });
  res.json(signal);
});

router.get('/status', (req, res) => {
  res.json({ lastPoll: getLastPollStatus(), config: { pollIntervalMs: config.pollIntervalMs, largeTransferXpl: config.largeTransferXpl } });
});
