import { NextRequest, NextResponse } from "next/server";
import { getWalletDetail } from "@/lib/tracker/db";

export const runtime = "nodejs";

// GET /api/tracker/wallet?address=<wallet>
// Drill-down: en qué tokens fue early buyer (rank/SOL/tiempo), con qué co-buyers
// co-ocurre (shared/lift/weight) y a qué grupo pertenece.
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const address = request.nextUrl.searchParams.get("address")?.trim();
    if (!address) return NextResponse.json({ error: "Falta address" }, { status: 400 });
    const detail = getWalletDetail(address);
    if (!detail) return NextResponse.json({ error: "Wallet no encontrada" }, { status: 404 });
    return NextResponse.json({ detail });
  } catch (err: unknown) {
    console.error("[tracker/wallet]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
