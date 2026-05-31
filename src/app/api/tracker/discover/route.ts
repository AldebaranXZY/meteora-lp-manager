import { NextRequest, NextResponse } from "next/server";
import { getTopTokens, type DiscoverMode } from "@/lib/tracker/discover";

export const runtime = "nodejs";

const MODES: DiscoverMode[] = ["top24h", "trending", "recent"];

// GET /api/tracker/discover?mode=top24h|trending|recent
// Top memecoins de pump.fun vía Jupiter (gratis).
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const raw = request.nextUrl.searchParams.get("mode");
    const mode: DiscoverMode = MODES.includes(raw as DiscoverMode) ? (raw as DiscoverMode) : "top24h";
    const tokens = await getTopTokens(mode);
    return NextResponse.json({ mode, tokens });
  } catch (err: unknown) {
    console.error("[tracker/discover]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
