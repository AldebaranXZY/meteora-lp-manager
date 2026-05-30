import { NextRequest, NextResponse } from "next/server";
import { getMonitoredWallets, insertAlert, alertExists } from "@/lib/tracker/db";
import { detectPumpBuys, type HeliusEnhancedTx } from "@/lib/tracker/pumpfun";

export const runtime = "nodejs";

// POST /api/tracker/webhook — receptor del webhook de Helius.
// NO está cubierto por el middleware (Helius no puede mandar el bearer); se
// autentica con su propio secret reenviado en Authorization.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.TRACKER_WEBHOOK_SECRET;
  if (secret && request.headers.get("authorization") !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const txs: HeliusEnhancedTx[] = Array.isArray(payload) ? payload : [payload];
    const monitored = new Set(getMonitoredWallets());
    if (monitored.size === 0) return NextResponse.json({ ok: true, inserted: 0 });

    let inserted = 0;
    for (const tx of txs) {
      for (const buy of detectPumpBuys(tx, monitored)) {
        if (buy.signature && alertExists(buy.signature, buy.wallet)) continue;
        insertAlert({
          wallet: buy.wallet,
          tokenMint: buy.mint,
          signature: buy.signature,
          solIn: buy.solIn,
          blockTime: buy.blockTime,
        });
        inserted++;
      }
    }
    return NextResponse.json({ ok: true, inserted });
  } catch (err: unknown) {
    console.error("[tracker/webhook]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
