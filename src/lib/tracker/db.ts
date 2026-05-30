import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TrackedToken, EarlyBuyer, WalletRow, WalletKind, TrackerAlert } from "./types";

// ─── Conexión SQLite (singleton, archivo local data/tracker.db) ──────────────

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "tracker.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  _db = db;
  return _db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  added_at INTEGER NOT NULL,
  analyzed_at INTEGER,
  buyers_fetched INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS early_buyers (
  token_mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  rank INTEGER NOT NULL,
  sol_in REAL,
  tokens_out REAL,
  block_time INTEGER,
  signature TEXT,
  PRIMARY KEY (token_mint, wallet)
);
CREATE INDEX IF NOT EXISTS idx_early_buyers_wallet ON early_buyers(wallet);
CREATE TABLE IF NOT EXISTS wallets (
  wallet TEXT PRIMARY KEY,
  tokens_count INTEGER NOT NULL DEFAULT 0,
  ubiquity_ratio REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'unknown',
  first_seen INTEGER,
  is_monitored INTEGER NOT NULL DEFAULT 0,
  is_ignored INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  token_mint TEXT,
  signature TEXT,
  sol_in REAL,
  block_time INTEGER,
  received_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_received ON alerts(received_at DESC);
`;

// ─── Tokens ───────────────────────────────────────────────────────────────────

interface TokenRowRaw { mint: string; symbol: string | null; name: string | null; added_at: number; analyzed_at: number | null; buyers_fetched: number }
const toToken = (r: TokenRowRaw): TrackedToken => ({
  mint: r.mint, symbol: r.symbol, name: r.name,
  addedAt: r.added_at, analyzedAt: r.analyzed_at, buyersFetched: r.buyers_fetched,
});

export function upsertToken(mint: string, symbol: string | null, name: string | null): void {
  getDb().prepare(
    `INSERT INTO tokens (mint, symbol, name, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(mint) DO UPDATE SET symbol = excluded.symbol, name = excluded.name`
  ).run(mint, symbol, name, Date.now());
}

export function listTokens(): TrackedToken[] {
  return (getDb().prepare(`SELECT * FROM tokens ORDER BY added_at DESC`).all() as TokenRowRaw[]).map(toToken);
}

export function countAnalyzedTokens(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM tokens WHERE buyers_fetched = 1`).get() as { n: number };
  return row.n;
}

// ─── Early buyers ──────────────────────────────────────────────────────────────

/** Reemplaza el set de compradores tempranos de un token y lo marca analizado. */
export function replaceEarlyBuyers(mint: string, buyers: EarlyBuyer[]): void {
  const db = getDb();
  const del = db.prepare(`DELETE FROM early_buyers WHERE token_mint = ?`);
  const ins = db.prepare(
    `INSERT OR REPLACE INTO early_buyers (token_mint, wallet, rank, sol_in, tokens_out, block_time, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const mark = db.prepare(`UPDATE tokens SET analyzed_at = ?, buyers_fetched = 1 WHERE mint = ?`);
  db.transaction(() => {
    del.run(mint);
    for (const b of buyers) ins.run(mint, b.wallet, b.rank, b.solIn, b.tokensOut, b.blockTime, b.signature);
    mark.run(Date.now(), mint);
  })();
}

export function getTokenBuyerCount(mint: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM early_buyers WHERE token_mint = ?`).get(mint) as { n: number };
  return row.n;
}

// ─── Wallets ───────────────────────────────────────────────────────────────────

interface WalletRowRaw { wallet: string; tokens_count: number; ubiquity_ratio: number; kind: string; first_seen: number | null; is_monitored: number; is_ignored: number; note: string | null }
const toWallet = (r: WalletRowRaw): WalletRow => ({
  wallet: r.wallet, tokensCount: r.tokens_count, ubiquityRatio: r.ubiquity_ratio,
  kind: r.kind as WalletKind, firstSeen: r.first_seen,
  isMonitored: !!r.is_monitored, isIgnored: !!r.is_ignored, note: r.note,
});

/** Wallets que aparecen en >= minTokens tokens, rankeadas por co-ocurrencia. */
export function getWalletsRanked(minTokens: number): WalletRow[] {
  return (getDb().prepare(
    `SELECT * FROM wallets WHERE tokens_count >= ? ORDER BY tokens_count DESC, ubiquity_ratio DESC`
  ).all(minTokens) as WalletRowRaw[]).map(toWallet);
}

export function getMonitoredWallets(): string[] {
  return (getDb().prepare(`SELECT wallet FROM wallets WHERE is_monitored = 1`).all() as { wallet: string }[]).map((r) => r.wallet);
}

export function setWalletFlags(wallet: string, flags: { isIgnored?: boolean; note?: string }): void {
  const db = getDb();
  if (flags.isIgnored !== undefined) db.prepare(`UPDATE wallets SET is_ignored = ? WHERE wallet = ?`).run(flags.isIgnored ? 1 : 0, wallet);
  if (flags.note !== undefined) db.prepare(`UPDATE wallets SET note = ? WHERE wallet = ?`).run(flags.note, wallet);
}

/** Marca como monitoreadas las wallets con count >= minTokens (no ignoradas); limpia el resto. */
export function setMonitoredByThreshold(minTokens: number): string[] {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE wallets SET is_monitored = 0`).run();
    db.prepare(`UPDATE wallets SET is_monitored = 1 WHERE tokens_count >= ? AND is_ignored = 0`).run(minTokens);
  })();
  return getMonitoredWallets();
}

// ─── Alerts ─────────────────────────────────────────────────────────────────────

interface AlertRowRaw { id: number; wallet: string; token_mint: string | null; signature: string | null; sol_in: number | null; block_time: number | null; received_at: number; seen: number }
const toAlert = (r: AlertRowRaw): TrackerAlert => ({
  id: r.id, wallet: r.wallet, tokenMint: r.token_mint, signature: r.signature,
  solIn: r.sol_in, blockTime: r.block_time, receivedAt: r.received_at, seen: !!r.seen,
});

export function insertAlert(a: Omit<TrackerAlert, "id" | "receivedAt" | "seen">): void {
  getDb().prepare(
    `INSERT INTO alerts (wallet, token_mint, signature, sol_in, block_time, received_at, seen)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(a.wallet, a.tokenMint, a.signature, a.solIn, a.blockTime, Date.now());
}

export function listAlerts(limit = 100): TrackerAlert[] {
  return (getDb().prepare(`SELECT * FROM alerts ORDER BY received_at DESC LIMIT ?`).all(limit) as AlertRowRaw[]).map(toAlert);
}

/** True si ya existe una alerta para esa (firma, wallet) — evita duplicados del webhook. */
export function alertExists(signature: string, wallet: string): boolean {
  const row = getDb().prepare(`SELECT 1 FROM alerts WHERE signature = ? AND wallet = ? LIMIT 1`).get(signature, wallet);
  return !!row;
}
