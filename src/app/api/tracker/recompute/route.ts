import { NextResponse } from "next/server";
import { recompute } from "@/lib/tracker/cooccurrence";
import { getAnalyzedTokenMints, setTokenOutcomes } from "@/lib/tracker/db";
import { getTokensInfo } from "@/lib/tracker/dexscreener";
import { classifyOutcome } from "@/lib/tracker/coalgo";
import { WINNER_MIN_MCAP_USD, WINNER_MIN_LIQ_USD, RUG_MAX_LIQ_USD, RUG_MAX_MCAP_USD } from "@/lib/tracker/config";

export const runtime = "nodejs";

// POST /api/tracker/recompute
// 1) Clasifica el desenlace de cada token analizado (DexScreener: ganó/rugueó) —
//    base del win-rate de traders rentables.
// 2) Recalcula co-ocurrencia + win-rate UNA sola vez (la UI lo llama al terminar
//    un batch; antes /analyze hacía O(N) recomputes, uno por token).
export async function POST(): Promise<NextResponse> {
  try {
    // 1. Desenlace de tokens (best-effort: si DexScreener falla, quedan 'pending').
    const mints = getAnalyzedTokenMints();
    if (mints.length > 0) {
      const infos = await getTokensInfo(mints);
      const opts = {
        winnerMinMcap: WINNER_MIN_MCAP_USD, winnerMinLiq: WINNER_MIN_LIQ_USD,
        rugMaxLiq: RUG_MAX_LIQ_USD, rugMaxMcap: RUG_MAX_MCAP_USD,
      };
      setTokenOutcomes(mints.map((mint) => ({ mint, outcome: classifyOutcome(infos[mint] ?? { mcap: 0, liquidityUsd: 0, volume24h: 0, dexes: [] }, opts) })));
    }

    // 2. Co-ocurrencia + win-rate.
    const stats = recompute();
    return NextResponse.json({ ok: true, stats });
  } catch (err: unknown) {
    console.error("[tracker/recompute]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
