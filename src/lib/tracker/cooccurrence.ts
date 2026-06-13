import { getDb, countAnalyzedTokens } from "./db";
import type { RecomputeStats } from "./types";
import {
  aggregatePairs, connectedComponents, density, edgeWeight, lift, classify,
  type BuyerRow,
} from "./coalgo";
import {
  UNIVERSAL_RATIO, UNIVERSAL_MIN_TOKENS, MIN_SUPPORT_TOKENS,
  K_PAIR, MIN_SHARED, EDGE_MIN_WEIGHT, MIN_LIFT, MIN_GROUP_DENSITY,
  TIMING_RANK_WEIGHT, TIMING_TIME_WEIGHT,
} from "./config";

// ─── Co-ocurrencia REAL: pairwise + clustering + significancia ───────────────
// Reemplaza el conteo de ubicuidad (que no detectaba grupos). Flujo:
//   1. Ubicuidad por wallet (SQL) → candidatas (≥2 tokens) + bots ubicuos.
//   2. Pairwise entre candidatas, solo primeros K buyers por token (coalgo).
//   3. Lift (significancia) + peso de timing por par.
//   4. Clustering por componentes conexos sobre aristas significativas, sin bots.
//   5. Persistencia RECONCILIADA: resetea columnas computadas (preserva flags
//      manuales) → arregla los conteos stale que se filtraban al set monitoreado.

interface AggRow { wallet: string; c: number; first_seen: number | null }

/** Recalcula wallets + pares + grupos desde early_buyers. Idempotente. */
export function recompute(): RecomputeStats {
  const startedAt = Date.now();
  const db = getDb();
  const totalTokens = countAnalyzedTokens();
  const denom = totalTokens || 1;

  // 1. Ubicuidad (SQL): conteo de tokens distintos + primer block_time por wallet.
  const agg = db.prepare(
    `SELECT wallet, COUNT(DISTINCT token_mint) AS c, MIN(block_time) AS first_seen
     FROM early_buyers GROUP BY wallet`
  ).all() as AggRow[];
  const tokensByWallet = new Map(agg.map((a) => [a.wallet, a.c]));
  const candidates = new Set(agg.filter((a) => a.c >= 2).map((a) => a.wallet));
  const isUniversal = (count: number) =>
    totalTokens >= UNIVERSAL_MIN_TOKENS && count / denom >= UNIVERSAL_RATIO;
  const universal = new Set(agg.filter((a) => isUniversal(a.c)).map((a) => a.wallet));

  // 2. Pairwise entre candidatas (primeros K buyers por token).
  const rows = db.prepare(
    `SELECT token_mint AS token, wallet, rank, block_time AS blockTime
     FROM early_buyers WHERE rank <= ? ORDER BY token_mint, rank`
  ).all(K_PAIR) as BuyerRow[];
  const pairs = aggregatePairs(rows, candidates).filter((p) => p.shared >= MIN_SHARED);

  // 3. Lift + peso de timing por par.
  const scored = pairs.map((p) => ({
    ...p,
    lift: lift(p.shared, tokensByWallet.get(p.a) ?? 0, tokensByWallet.get(p.b) ?? 0, denom),
    weight: edgeWeight(p, TIMING_RANK_WEIGHT, TIMING_TIME_WEIGHT),
  }));

  // 4. Clustering: aristas significativas (peso + lift) sin bots ubicuos (puentes).
  const edges = scored
    .filter((p) => p.weight >= EDGE_MIN_WEIGHT && p.lift >= MIN_LIFT && !universal.has(p.a) && !universal.has(p.b))
    .map((p) => ({ a: p.a, b: p.b }));
  const comps = connectedComponents(edges).filter((c) => density(c, edges) >= MIN_GROUP_DENSITY);

  const groupOf = new Map<string, number>();
  comps.forEach((c, idx) => { for (const w of c) groupOf.set(w, idx + 1); });

  // Score por wallet: mayor peso de arista en la que participa (para ranking).
  const scoreOf = new Map<string, number>();
  for (const p of scored) {
    if (p.weight > (scoreOf.get(p.a) ?? 0)) scoreOf.set(p.a, p.weight);
    if (p.weight > (scoreOf.get(p.b) ?? 0)) scoreOf.set(p.b, p.weight);
  }

  // 5. Persistencia reconciliada.
  const upsert = db.prepare(
    `INSERT INTO wallets (wallet, tokens_count, ubiquity_ratio, kind, first_seen, group_id, cooccurrence_score)
     VALUES (@wallet, @count, @ratio, @kind, @firstSeen, @groupId, @score)
     ON CONFLICT(wallet) DO UPDATE SET
       tokens_count = @count, ubiquity_ratio = @ratio, kind = @kind,
       first_seen = @firstSeen, group_id = @groupId, cooccurrence_score = @score`
  );
  const insPair = db.prepare(
    `INSERT OR REPLACE INTO wallet_pairs (wallet_a, wallet_b, shared_count, sum_rank_gap, sum_time_gap, lift, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insGroup = db.prepare(`INSERT OR REPLACE INTO wallet_groups (wallet, group_id) VALUES (?, ?)`);
  const insMeta = db.prepare(
    `INSERT OR REPLACE INTO group_meta (group_id, size, shared_tokens, avg_edge_weight, cohesion, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    // Reset SOLO columnas computadas → preserva is_monitored/is_ignored/note.
    db.prepare(`UPDATE wallets SET tokens_count = 0, ubiquity_ratio = 0, kind = 'unknown', first_seen = NULL, group_id = NULL, cooccurrence_score = 0`).run();
    for (const a of agg) {
      const ratio = a.c / denom;
      const groupId = groupOf.get(a.wallet) ?? null;
      upsert.run({
        wallet: a.wallet, count: a.c, ratio,
        kind: classify(a.c, ratio, totalTokens, groupId, {
          universalRatio: UNIVERSAL_RATIO, universalMinTokens: UNIVERSAL_MIN_TOKENS, minSupportTokens: MIN_SUPPORT_TOKENS,
        }),
        firstSeen: a.first_seen, groupId, score: scoreOf.get(a.wallet) ?? 0,
      });
    }
    // GC de filas vacías SIN flags manuales (no se pierde nada elegido a mano).
    db.prepare(`DELETE FROM wallets WHERE tokens_count = 0 AND is_monitored = 0 AND is_ignored = 0 AND note IS NULL`).run();

    // Pares (para drill-down de co-buyers).
    db.prepare(`DELETE FROM wallet_pairs`).run();
    for (const p of scored) insPair.run(p.a, p.b, p.shared, p.sumRankGap, p.sumTimeGap, p.lift, p.weight);

    // Grupos + meta.
    db.prepare(`DELETE FROM wallet_groups`).run();
    db.prepare(`DELETE FROM group_meta`).run();
    const now = Date.now();
    comps.forEach((members, idx) => {
      const gid = idx + 1;
      for (const w of members) insGroup.run(w, gid);
      const memberSet = new Set(members);
      const groupEdges = scored.filter((p) => memberSet.has(p.a) && memberSet.has(p.b));
      const avgWeight = groupEdges.length ? groupEdges.reduce((s, p) => s + p.weight, 0) / groupEdges.length : 0;
      const maxShared = groupEdges.reduce((s, p) => Math.max(s, p.shared), 0); // proxy de tokens co-comprados
      const cohesion = density(members, edges);
      insMeta.run(gid, members.length, maxShared, avgWeight, cohesion, now);
    });
  })();

  const lifts = scored.map((p) => p.lift).sort((a, b) => a - b);
  const medianLift = lifts.length ? lifts[Math.floor(lifts.length / 2)] : 0;
  return {
    totalTokens,
    candidateWallets: candidates.size,
    pairsAboveSupport: scored.length,
    groupsFound: comps.length,
    largestGroupSize: comps.reduce((m, c) => Math.max(m, c.length), 0),
    medianLift,
    elapsedMs: Date.now() - startedAt,
  };
}
