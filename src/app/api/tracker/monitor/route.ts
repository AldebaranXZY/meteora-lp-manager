import { NextRequest, NextResponse } from "next/server";
import { setMonitoredByThreshold } from "@/lib/tracker/db";
import { syncWebhook } from "@/lib/tracker/helius-webhook";

export const runtime = "nodejs";

// POST /api/tracker/monitor { minTokens }
// Marca como monitoreadas las wallets con co-ocurrencia >= minTokens (no ignoradas)
// y sincroniza el webhook de Helius con ese set.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { minTokens } = await request.json();
    const k = Math.max(1, Number(minTokens) || 2);

    const wallets = setMonitoredByThreshold(k);
    // NOTA v1: el catch-up de eventos perdidos mientras el túnel estuvo caído
    // queda pendiente — por ahora se monitorea desde el momento del sync.
    const sync = await syncWebhook(wallets);

    return NextResponse.json({ ok: true, monitored: wallets.length, sync });
  } catch (err: unknown) {
    console.error("[tracker/monitor]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
