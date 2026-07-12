import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS price_snapshots (
    ts INTEGER PRIMARY KEY,
    price_usd REAL,
    market_cap_usd REAL,
    volume_24h_usd REAL,
    change_24h_pct REAL
  );

  CREATE TABLE IF NOT EXISTS holder_snapshots (
    ts INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    address TEXT NOT NULL,
    balance_xpl REAL NOT NULL,
    pct_supply REAL NOT NULL,
    label TEXT,
    PRIMARY KEY (ts, address)
  );

  CREATE TABLE IF NOT EXISTS transfer_events (
    tx_hash TEXT PRIMARY KEY,
    block_number INTEGER,
    ts INTEGER NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount_xpl REAL NOT NULL,
    amount_usd REAL,
    category TEXT NOT NULL,
    from_label TEXT,
    to_label TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_transfer_events_ts ON transfer_events (ts DESC);
  CREATE INDEX IF NOT EXISTS idx_transfer_events_category ON transfer_events (category, ts DESC);

  CREATE TABLE IF NOT EXISTS detected_labels (
    address TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    confidence TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    evidence TEXT
  );

  CREATE TABLE IF NOT EXISTS unlock_events (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    amount_xpl REAL,
    pct_supply REAL,
    category TEXT,
    source TEXT,
    wallets_json TEXT
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

export function getMeta(key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function insertPriceSnapshot({ ts, priceUsd, marketCapUsd, volume24hUsd, change24hPct }) {
  db.prepare(`
    INSERT INTO price_snapshots (ts, price_usd, market_cap_usd, volume_24h_usd, change_24h_pct)
    VALUES (@ts, @priceUsd, @marketCapUsd, @volume24hUsd, @change24hPct)
    ON CONFLICT(ts) DO UPDATE SET
      price_usd = excluded.price_usd,
      market_cap_usd = excluded.market_cap_usd,
      volume_24h_usd = excluded.volume_24h_usd,
      change_24h_pct = excluded.change_24h_pct
  `).run({ ts, priceUsd, marketCapUsd, volume24hUsd, change24hPct });
}

export function getLatestPrice() {
  return db.prepare('SELECT * FROM price_snapshots ORDER BY ts DESC LIMIT 1').get();
}

export function getPriceHistory(sinceTs) {
  return db.prepare('SELECT * FROM price_snapshots WHERE ts >= ? ORDER BY ts ASC').all(sinceTs);
}

export const replaceHolderSnapshot = db.transaction((ts, holders) => {
  const insert = db.prepare(`
    INSERT INTO holder_snapshots (ts, rank, address, balance_xpl, pct_supply, label)
    VALUES (@ts, @rank, @address, @balance_xpl, @pct_supply, @label)
    ON CONFLICT(ts, address) DO UPDATE SET
      rank = excluded.rank, balance_xpl = excluded.balance_xpl,
      pct_supply = excluded.pct_supply, label = excluded.label
  `);
  for (const h of holders) insert.run({ ts, ...h });
});

export function getLatestHolderSnapshotTs() {
  const row = db.prepare('SELECT MAX(ts) AS ts FROM holder_snapshots').get();
  return row?.ts ?? null;
}

export function getHolderSnapshot(ts) {
  return db.prepare('SELECT * FROM holder_snapshots WHERE ts = ? ORDER BY rank ASC').all(ts);
}

export function getHolderSnapshotBefore(ts) {
  const row = db.prepare('SELECT MAX(ts) AS ts FROM holder_snapshots WHERE ts < ?').get(ts);
  return row?.ts ? getHolderSnapshot(row.ts) : [];
}

export function insertTransferEvent(evt) {
  db.prepare(`
    INSERT OR IGNORE INTO transfer_events
      (tx_hash, block_number, ts, from_address, to_address, amount_xpl, amount_usd, category, from_label, to_label)
    VALUES
      (@txHash, @blockNumber, @ts, @fromAddress, @toAddress, @amountXpl, @amountUsd, @category, @fromLabel, @toLabel)
  `).run(evt);
}

export function getTransferEvents({ category = null, sinceTs = 0, limit = 100 } = {}) {
  if (category) {
    return db.prepare(`
      SELECT * FROM transfer_events WHERE category = ? AND ts >= ? ORDER BY ts DESC LIMIT ?
    `).all(category, sinceTs, limit);
  }
  return db.prepare(`
    SELECT * FROM transfer_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?
  `).all(sinceTs, limit);
}

export function upsertDetectedLabel({ address, label, category, confidence, firstSeen, lastSeen, evidence }) {
  db.prepare(`
    INSERT INTO detected_labels (address, label, category, confidence, first_seen, last_seen, evidence)
    VALUES (@address, @label, @category, @confidence, @firstSeen, @lastSeen, @evidence)
    ON CONFLICT(address) DO UPDATE SET
      last_seen = excluded.last_seen,
      evidence = excluded.evidence,
      confidence = excluded.confidence
  `).run({ address, label, category, confidence, firstSeen, lastSeen, evidence });
}

export function getDetectedLabels() {
  return db.prepare('SELECT * FROM detected_labels ORDER BY last_seen DESC').all();
}

export function getDetectedLabel(address) {
  return db.prepare('SELECT * FROM detected_labels WHERE address = ?').get(address);
}

export function replaceUnlockEvents(events) {
  const insert = db.prepare(`
    INSERT INTO unlock_events (id, date, title, amount_xpl, pct_supply, category, source, wallets_json)
    VALUES (@id, @date, @title, @amount_xpl, @pct_supply, @category, @source, @wallets_json)
    ON CONFLICT(id) DO UPDATE SET
      date = excluded.date, title = excluded.title, amount_xpl = excluded.amount_xpl,
      pct_supply = excluded.pct_supply, category = excluded.category,
      source = excluded.source, wallets_json = excluded.wallets_json
  `);
  const tx = db.transaction((rows) => { for (const r of rows) insert.run(r); });
  tx(events);
}

export function getUnlockEvents() {
  return db.prepare('SELECT * FROM unlock_events ORDER BY date ASC').all();
}

export default db;
