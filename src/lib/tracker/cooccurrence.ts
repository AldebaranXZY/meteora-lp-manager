import { getDb, countAnalyzedTokens } from "./db";
import type { WalletKind } from "./types";

// ─── Co-ocurrencia: recomputar conteos por wallet + clasificar ───────────────
// NO se excluye a nadie. Las wallets de ubicuidad altísima (aparecen en casi
// todos los tokens) se ETIQUETAN como 'universal_sniper' (probable bot) para
// distinguirlas del grupo coordinado; el resto con co-ocurrencia ≥ 2 = 'group'.
// Heurística aproximada y tuneable con datos reales.

const UNIVERSAL_RATIO = 0.8;      // aparece en ≥80% de los tokens trackeados
const UNIVERSAL_MIN_TOKENS = 4;   // recién con ≥4 tokens tiene sentido juzgar ubicuidad

function classify(count: number, ratio: number, totalTokens: number): WalletKind {
  if (totalTokens >= UNIVERSAL_MIN_TOKENS && ratio >= UNIVERSAL_RATIO) return "universal_sniper";
  if (count >= 2) return "group";
  return "unknown";
}

/**
 * Recalcula la tabla `wallets` desde `early_buyers`. Preserva los flags manuales
 * (is_monitored, is_ignored, note) — solo actualiza conteo, ratio, kind y first_seen.
 */
export function recomputeWallets(): void {
  const db = getDb();
  const totalTokens = countAnalyzedTokens() || 1;

  const agg = db.prepare(
    `SELECT wallet, COUNT(DISTINCT token_mint) AS c, MIN(block_time) AS first_seen
     FROM early_buyers GROUP BY wallet`
  ).all() as { wallet: string; c: number; first_seen: number | null }[];

  const upsert = db.prepare(
    `INSERT INTO wallets (wallet, tokens_count, ubiquity_ratio, kind, first_seen)
     VALUES (@wallet, @count, @ratio, @kind, @firstSeen)
     ON CONFLICT(wallet) DO UPDATE SET
       tokens_count = @count, ubiquity_ratio = @ratio, kind = @kind, first_seen = @firstSeen`
  );

  db.transaction(() => {
    for (const r of agg) {
      const ratio = r.c / totalTokens;
      upsert.run({
        wallet: r.wallet,
        count: r.c,
        ratio,
        kind: classify(r.c, ratio, totalTokens),
        firstSeen: r.first_seen,
      });
    }
  })();
}
