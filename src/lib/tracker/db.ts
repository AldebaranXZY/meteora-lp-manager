import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  TrackedToken, EarlyBuyer, WalletRow, WalletKind, TrackerAlert, AnalyzeStats,
  GroupSummary, WalletDetail, WalletTokenHit, CoBuyer, TokenOutcome,
} from "./types";
import { ALERTS_RETENTION_DAYS, ALERTS_MAX_ROWS } from "./config";

// ─── Conexión SQLite (singleton, archivo local data/tracker.db) ──────────────

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "tracker.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  _db = db;
  return _db;
}

// ─── Migraciones idempotentes ────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS cubre DBs nuevas; para DBs ya existentes hay que
// agregar columnas/tablas nuevas sin perder data. Todo guardado por existencia.

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
}
function addColumn(db: Database.Database, table: string, col: string, decl: string): void {
  if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

const SCHEMA_VERSION = 3;

function migrate(db: Database.Database): void {
  // Diagnóstico del último análisis (JSON serializado de AnalyzeStats).
  addColumn(db, "tokens", "last_stats", "TEXT");
  // Co-ocurrencia: cluster + score por wallet.
  addColumn(db, "wallets", "group_id", "INTEGER");
  addColumn(db, "wallets", "cooccurrence_score", "REAL NOT NULL DEFAULT 0");
  // Profitabilidad: desenlace del token + win-rate por wallet.
  addColumn(db, "tokens", "outcome", "TEXT NOT NULL DEFAULT 'pending'");
  addColumn(db, "wallets", "wins", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "wallets", "plays", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "wallets", "win_rate", "REAL NOT NULL DEFAULT 0");
  // Registro de versión (para futuras migraciones explícitas).
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get() as { version: number } | undefined;
  if (!row) db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(SCHEMA_VERSION);
  else if (row.version !== SCHEMA_VERSION) db.prepare(`UPDATE schema_version SET version = ?`).run(SCHEMA_VERSION);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  added_at INTEGER NOT NULL,
  analyzed_at INTEGER,
  buyers_fetched INTEGER NOT NULL DEFAULT 0,
  last_stats TEXT,
  outcome TEXT NOT NULL DEFAULT 'pending'
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
  note TEXT,
  group_id INTEGER,
  cooccurrence_score REAL NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  win_rate REAL NOT NULL DEFAULT 0
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
CREATE TABLE IF NOT EXISTS wallet_pairs (
  wallet_a TEXT NOT NULL,
  wallet_b TEXT NOT NULL,
  shared_count INTEGER NOT NULL,
  sum_rank_gap INTEGER NOT NULL DEFAULT 0,
  sum_time_gap INTEGER NOT NULL DEFAULT 0,
  lift REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (wallet_a, wallet_b)
);
CREATE INDEX IF NOT EXISTS idx_pairs_a ON wallet_pairs(wallet_a);
CREATE INDEX IF NOT EXISTS idx_pairs_b ON wallet_pairs(wallet_b);
CREATE TABLE IF NOT EXISTS wallet_groups (
  wallet TEXT PRIMARY KEY,
  group_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_id ON wallet_groups(group_id);
CREATE TABLE IF NOT EXISTS group_meta (
  group_id INTEGER PRIMARY KEY,
  size INTEGER NOT NULL,
  shared_tokens INTEGER NOT NULL,
  avg_edge_weight REAL NOT NULL,
  cohesion REAL NOT NULL,
  computed_at INTEGER NOT NULL
);
`;

// ─── Tokens ───────────────────────────────────────────────────────────────────

interface TokenRowRaw { mint: string; symbol: string | null; name: string | null; added_at: number; analyzed_at: number | null; buyers_fetched: number; last_stats: string | null; outcome: string }
function parseStats(raw: string | null): AnalyzeStats | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as AnalyzeStats; } catch { return null; }
}
const toToken = (r: TokenRowRaw): TrackedToken => ({
  mint: r.mint, symbol: r.symbol, name: r.name,
  addedAt: r.added_at, analyzedAt: r.analyzed_at, buyersFetched: r.buyers_fetched,
  stats: parseStats(r.last_stats), outcome: (r.outcome as TokenOutcome) ?? "pending",
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

/** Mints de tokens analizados (para enriquecer con DexScreener y clasificar desenlace). */
export function getAnalyzedTokenMints(): string[] {
  return (getDb().prepare(`SELECT mint FROM tokens WHERE buyers_fetched = 1`).all() as { mint: string }[]).map((r) => r.mint);
}

/** Persiste el desenlace (winner/rug/pending) de cada token. */
export function setTokenOutcomes(outcomes: { mint: string; outcome: TokenOutcome }[]): void {
  const db = getDb();
  const upd = db.prepare(`UPDATE tokens SET outcome = ? WHERE mint = ?`);
  db.transaction(() => { for (const o of outcomes) upd.run(o.outcome, o.mint); })();
}

/** Mapa mint→outcome de los tokens analizados (para win-rate). */
export function getTokenOutcomes(): Map<string, TokenOutcome> {
  const rows = getDb().prepare(`SELECT mint, outcome FROM tokens WHERE buyers_fetched = 1`).all() as { mint: string; outcome: string }[];
  return new Map(rows.map((r) => [r.mint, (r.outcome as TokenOutcome) ?? "pending"]));
}

// ─── Early buyers ──────────────────────────────────────────────────────────────

/** Reemplaza el set de compradores tempranos de un token, lo marca analizado y
 * guarda el diagnóstico (`AnalyzeStats`) del análisis. */
export function replaceEarlyBuyers(mint: string, buyers: EarlyBuyer[], stats?: AnalyzeStats): void {
  const db = getDb();
  const del = db.prepare(`DELETE FROM early_buyers WHERE token_mint = ?`);
  const ins = db.prepare(
    `INSERT OR REPLACE INTO early_buyers (token_mint, wallet, rank, sol_in, tokens_out, block_time, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const mark = db.prepare(`UPDATE tokens SET analyzed_at = ?, buyers_fetched = 1, last_stats = ? WHERE mint = ?`);
  db.transaction(() => {
    del.run(mint);
    for (const b of buyers) ins.run(mint, b.wallet, b.rank, b.solIn, b.tokensOut, b.blockTime, b.signature);
    mark.run(Date.now(), stats ? JSON.stringify(stats) : null, mint);
  })();
}

export function getTokenBuyerCount(mint: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM early_buyers WHERE token_mint = ?`).get(mint) as { n: number };
  return row.n;
}

// ─── Wallets ───────────────────────────────────────────────────────────────────

interface WalletRowRaw { wallet: string; tokens_count: number; ubiquity_ratio: number; kind: string; first_seen: number | null; is_monitored: number; is_ignored: number; note: string | null; group_id: number | null; cooccurrence_score: number; wins: number; plays: number; win_rate: number }
const toWallet = (r: WalletRowRaw): WalletRow => ({
  wallet: r.wallet, tokensCount: r.tokens_count, ubiquityRatio: r.ubiquity_ratio,
  kind: r.kind as WalletKind, firstSeen: r.first_seen,
  isMonitored: !!r.is_monitored, isIgnored: !!r.is_ignored, note: r.note,
  groupId: r.group_id, cooccurrenceScore: r.cooccurrence_score,
  wins: r.wins, plays: r.plays, winRate: r.win_rate,
});

/** Wallets que aparecen en >= minTokens tokens, rankeadas por co-ocurrencia. */
export function getWalletsRanked(minTokens: number): WalletRow[] {
  return (getDb().prepare(
    `SELECT * FROM wallets WHERE tokens_count >= ?
     ORDER BY (group_id IS NULL), cooccurrence_score DESC, tokens_count DESC, ubiquity_ratio DESC`
  ).all(minTokens) as WalletRowRaw[]).map(toWallet);
}

// ─── Grupos coordinados (clusters) ───────────────────────────────────────────

interface GroupMetaRaw { group_id: number; size: number; shared_tokens: number; avg_edge_weight: number; cohesion: number }

/** Clusters coordinados con sus miembros, ordenados por cohesión. */
export function getGroups(): GroupSummary[] {
  const db = getDb();
  const metas = db.prepare(
    `SELECT group_id, size, shared_tokens, avg_edge_weight, cohesion FROM group_meta ORDER BY avg_edge_weight DESC`
  ).all() as GroupMetaRaw[];
  const memberStmt = db.prepare(`SELECT wallet FROM wallet_groups WHERE group_id = ? ORDER BY wallet`);
  return metas.map((m) => ({
    groupId: m.group_id,
    size: m.size,
    sharedTokens: m.shared_tokens,
    avgEdgeWeight: m.avg_edge_weight,
    cohesion: m.cohesion,
    wallets: (memberStmt.all(m.group_id) as { wallet: string }[]).map((r) => r.wallet),
  }));
}

/** Wallets de un grupo (para export/monitoreo). */
export function getGroupWallets(groupId: number): string[] {
  return (getDb().prepare(`SELECT wallet FROM wallet_groups WHERE group_id = ? ORDER BY wallet`).all(groupId) as { wallet: string }[]).map((r) => r.wallet);
}

/** Detalle de una wallet: tokens en los que fue early buyer + co-buyers + grupo. */
export function getWalletDetail(wallet: string): WalletDetail | null {
  const db = getDb();
  const w = db.prepare(`SELECT * FROM wallets WHERE wallet = ?`).get(wallet) as WalletRowRaw | undefined;
  if (!w) return null;

  const tokens = (db.prepare(
    `SELECT eb.token_mint AS mint, t.symbol AS symbol, eb.rank AS rank, eb.sol_in AS solIn,
            eb.block_time AS blockTime, COALESCE(t.outcome, 'pending') AS outcome
     FROM early_buyers eb LEFT JOIN tokens t ON t.mint = eb.token_mint
     WHERE eb.wallet = ? ORDER BY eb.block_time ASC`
  ).all(wallet) as WalletTokenHit[]);

  // Co-buyers: pares donde la wallet es a o b. shared/lift/weight ya calculados.
  const coBuyers = (db.prepare(
    `SELECT CASE WHEN wallet_a = ? THEN wallet_b ELSE wallet_a END AS wallet,
            shared_count AS shared, lift, weight
     FROM wallet_pairs WHERE wallet_a = ? OR wallet_b = ?
     ORDER BY weight DESC LIMIT 50`
  ).all(wallet, wallet, wallet) as CoBuyer[]);

  return {
    wallet: w.wallet,
    kind: w.kind as WalletKind,
    tokensCount: w.tokens_count,
    ubiquityRatio: w.ubiquity_ratio,
    groupId: w.group_id,
    wins: w.wins, plays: w.plays, winRate: w.win_rate,
    tokens,
    coBuyers,
  };
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

/** Limpia alertas viejas (retención) y recorta al tope de filas. Evita que la
 * tabla crezca infinito (antes no había límite). */
export function pruneAlerts(): void {
  const db = getDb();
  const cutoff = Date.now() - ALERTS_RETENTION_DAYS * 86_400_000;
  db.prepare(`DELETE FROM alerts WHERE received_at < ?`).run(cutoff);
  db.prepare(
    `DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY received_at DESC LIMIT ?)`
  ).run(ALERTS_MAX_ROWS);
}
