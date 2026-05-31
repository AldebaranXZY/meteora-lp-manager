import { NextRequest, NextResponse } from "next/server";
import { getTokensInfo } from "@/lib/tracker/dexscreener";

export const runtime = "nodejs";

// GET /api/tracker/token-info?mints=a,b,c — enriquecimiento DexScreener (gratis).
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const raw = request.nextUrl.searchParams.get("mints") ?? "";
    const mints = raw.split(",").map((m) => m.trim()).filter(Boolean).slice(0, 60);
    if (mints.length === 0) return NextResponse.json({ info: {} });
    const info = await getTokensInfo(mints);
    return NextResponse.json({ info });
  } catch (err: unknown) {
    console.error("[tracker/token-info]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
