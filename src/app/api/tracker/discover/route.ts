import { NextRequest, NextResponse } from "next/server";
import { getTopCreatedTokens } from "@/lib/tracker/discover";

export const runtime = "nodejs";

// GET /api/tracker/discover?day=1|2  (1 = ayer, 2 = antes de ayer)
// Top 100 memecoins creadas ese día en pump.fun, por volumen.
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const day = request.nextUrl.searchParams.get("day") === "2" ? 2 : 1;
    const tokens = await getTopCreatedTokens(day);
    return NextResponse.json({ day, tokens });
  } catch (err: unknown) {
    console.error("[tracker/discover]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
