import { NextRequest, NextResponse } from "next/server";
import { getWalletsRanked, setWalletFlags } from "@/lib/tracker/db";

export const runtime = "nodejs";

// GET /api/tracker/wallets?minTokens=2 — wallets co-ocurrentes rankeadas
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const minTokens = Math.max(1, Number(request.nextUrl.searchParams.get("minTokens")) || 2);
    return NextResponse.json({ wallets: getWalletsRanked(minTokens), minTokens });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}

// PATCH /api/tracker/wallets { wallet, isIgnored?, note? } — flags manuales
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const { wallet, isIgnored, note } = await request.json();
    if (!wallet) return NextResponse.json({ error: "Falta wallet" }, { status: 400 });
    setWalletFlags(wallet, { isIgnored, note });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
