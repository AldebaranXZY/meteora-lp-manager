import { NextRequest, NextResponse } from "next/server";
import { listTokens, upsertToken, replaceEarlyBuyers, getTokenBuyerCount } from "@/lib/tracker/db";
import { getTokenMeta } from "@/lib/tracker/meta";
import { getEarlyBuyers } from "@/lib/tracker/indexer";
import { recomputeWallets } from "@/lib/tracker/cooccurrence";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

// POST /api/tracker/analyze { mint, limit? }
// Baja las primeras N compras del token, las guarda y recalcula co-ocurrencia.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const mint: string | undefined = body.mint;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
    if (!mint) return NextResponse.json({ error: "Falta mint" }, { status: 400 });

    // Asegurar el token en DB (con metadata) si es la primera vez.
    if (!listTokens().some((t) => t.mint === mint)) {
      const meta = await getTokenMeta(mint);
      upsertToken(mint, meta.symbol, meta.name);
    }

    const buyers = await getEarlyBuyers(mint, limit);
    replaceEarlyBuyers(mint, buyers);
    recomputeWallets();

    return NextResponse.json({ ok: true, mint, buyers: getTokenBuyerCount(mint) });
  } catch (err: unknown) {
    console.error("[tracker/analyze]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
