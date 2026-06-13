import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DB aislada en temp ANTES de importar db.ts (getDb lee el env en la 1ª llamada).
process.env.TRACKER_DB_PATH = join(tmpdir(), `tracker-test-${process.pid}-${Date.now()}.db`);

const db = await import("../src/lib/tracker/db.ts");
const { recompute } = await import("../src/lib/tracker/cooccurrence.ts");

function clear() {
  db.getDb().exec(
    `DELETE FROM early_buyers; DELETE FROM trades; DELETE FROM tokens;
     DELETE FROM wallets; DELETE FROM wallet_pairs; DELETE FROM wallet_groups; DELETE FROM group_meta;`
  );
}
beforeEach(clear);

// Helper: token analizado con sus early buyers.
function addToken(mint: string, buyers: { wallet: string; rank: number }[]) {
  db.upsertToken(mint, mint.slice(0, 4), null);
  db.replaceEarlyBuyers(mint, buyers.map((b) => ({
    wallet: b.wallet, rank: b.rank, solIn: 1, tokensOut: 100, blockTime: 1000 + b.rank, signature: `${mint}-${b.wallet}`,
  })));
}

test("migración: schema_version=4 y columnas nuevas presentes", () => {
  const v = db.getDb().prepare(`SELECT version FROM schema_version`).get() as { version: number };
  assert.equal(v.version, 4);
  const cols = (db.getDb().prepare(`PRAGMA table_info(wallets)`).all() as { name: string }[]).map((c) => c.name);
  for (const c of ["group_id", "cooccurrence_score", "wins", "plays", "win_rate", "realized_pnl", "pnl_tokens"]) {
    assert.ok(cols.includes(c), `falta columna ${c}`);
  }
});

test("reconciliación: wallet que cae queda en count=0, NO se re-monitorea, conserva flags", () => {
  addToken("T1pump", [{ wallet: "W1", rank: 1 }, { wallet: "W2", rank: 2 }]);
  addToken("T2pump", [{ wallet: "W1", rank: 1 }, { wallet: "W2", rank: 2 }]);
  recompute();
  assert.equal(db.getWalletDetail("W1")!.tokensCount, 2);

  // W1: nota manual + monitoreada.
  db.setWalletFlags("W1", { note: "sospechosa" });
  db.setMonitoredByThreshold(2);
  assert.ok(db.getMonitoredWallets().includes("W1"));

  // W1 desaparece de ambos tokens.
  db.replaceEarlyBuyers("T1pump", [{ wallet: "W2", rank: 1, solIn: 1, tokensOut: 100, blockTime: 1001, signature: "x1" }]);
  db.replaceEarlyBuyers("T2pump", [{ wallet: "W2", rank: 1, solIn: 1, tokensOut: 100, blockTime: 1001, signature: "x2" }]);
  recompute();

  const w1 = db.getWalletDetail("W1");
  assert.ok(w1, "W1 con flag manual NO se borra");
  assert.equal(w1!.tokensCount, 0, "count stale corregido a 0");
  // El leak: setMonitoredByThreshold ya NO la re-monitorea (count=0 < umbral).
  db.setMonitoredByThreshold(2);
  assert.ok(!db.getMonitoredWallets().includes("W1"), "wallet caída no se re-monitorea");
});

test("reconciliación: wallet sin flags que cae se borra (GC)", () => {
  addToken("T1pump", [{ wallet: "W3", rank: 1 }, { wallet: "W2", rank: 2 }]);
  recompute();
  assert.ok(db.getWalletDetail("W3"));
  db.replaceEarlyBuyers("T1pump", [{ wallet: "W2", rank: 1, solIn: 1, tokensOut: 100, blockTime: 1001, signature: "y1" }]);
  recompute();
  assert.equal(db.getWalletDetail("W3"), null, "wallet vacía sin flags se GC-ea");
});

test("win-rate: agregado correctamente desde outcomes", () => {
  addToken("T1pump", [{ wallet: "W1", rank: 1 }]);
  addToken("T2pump", [{ wallet: "W1", rank: 1 }]);
  db.setTokenOutcomes([{ mint: "T1pump", outcome: "winner" }, { mint: "T2pump", outcome: "rug" }]);
  recompute();
  const w1 = db.getWalletDetail("W1")!;
  assert.equal(w1.wins, 1);
  assert.equal(w1.plays, 2);
  assert.equal(w1.winRate, 0.5);
});

test("PnL realizado: agregado por wallet y por token", () => {
  addToken("T1pump", [{ wallet: "W1", rank: 1 }]);
  db.replaceTrades("T1pump", [
    { wallet: "W1", side: "buy", sol: 1, tokens: 100, blockTime: 1, signature: "b1" },
    { wallet: "W1", side: "sell", sol: 1.5, tokens: 100, blockTime: 2, signature: "s1" },
  ]);
  recompute();
  const w1 = db.getWalletDetail("W1")!;
  assert.equal(Math.round(w1.realizedPnl * 1000) / 1000, 0.5);
  assert.equal(w1.pnlTokens, 1);
  const t1 = w1.tokens.find((t) => t.mint === "T1pump")!;
  assert.equal(Math.round((t1.realizedPnl ?? 0) * 1000) / 1000, 0.5);
});

test("replaceEarlyBuyers / replaceTrades: reemplazan, no acumulan", () => {
  addToken("T1pump", [{ wallet: "W1", rank: 1 }, { wallet: "W2", rank: 2 }]);
  assert.equal(db.getTokenBuyerCount("T1pump"), 2);
  addToken("T1pump", [{ wallet: "W1", rank: 1 }]); // re-analiza con menos
  assert.equal(db.getTokenBuyerCount("T1pump"), 1, "reemplazo, no acumulación");

  db.replaceTrades("T1pump", [{ wallet: "W1", side: "buy", sol: 1, tokens: 10, blockTime: 1, signature: "a" }]);
  db.replaceTrades("T1pump", [{ wallet: "W1", side: "buy", sol: 2, tokens: 20, blockTime: 1, signature: "b" }]);
  const n = db.getDb().prepare(`SELECT COUNT(*) AS n FROM trades WHERE token_mint = ?`).get("T1pump") as { n: number };
  assert.equal(n.n, 1, "trades reemplazados, no acumulados");
});
