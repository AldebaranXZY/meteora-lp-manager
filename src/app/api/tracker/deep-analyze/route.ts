import { NextRequest, NextResponse } from "next/server";
import { getTokenTrades } from "@/lib/tracker/ledger";
import { replaceTrades } from "@/lib/tracker/db";
import { recompute } from "@/lib/tracker/cooccurrence";

export const runtime = "nodejs";

// POST /api/tracker/deep-analyze { mint }
// Baja el ledger COMPLETO (buys + sells) del token y recomputa el PnL realizado.
// Es CARO (parsea TODAS las firmas de la bonding curve, no se corta) → opt-in por
// token desde la UI. El default /analyze sigue siendo barato (solo early buyers).
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const mint = typeof body?.mint === "string" ? body.mint.trim() : undefined;
    if (!mint) return NextResponse.json({ error: "Falta mint" }, { status: 400 });

    const { trades, stats } = await getTokenTrades(mint);
    replaceTrades(mint, trades);
    const recomputeStats = recompute();

    return NextResponse.json({ ok: true, stats, recomputeStats });
  } catch (err: unknown) {
    console.error("[tracker/deep-analyze]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
