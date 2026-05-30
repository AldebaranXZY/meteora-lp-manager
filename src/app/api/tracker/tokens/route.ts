import { NextRequest, NextResponse } from "next/server";
import { listTokens, upsertToken } from "@/lib/tracker/db";
import { getTokenMeta } from "@/lib/tracker/meta";

export const runtime = "nodejs";

// GET /api/tracker/tokens — lista de tokens trackeados
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ tokens: listTokens() });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}

// POST /api/tracker/tokens { mint } — agrega un token (con metadata)
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { mint } = await request.json();
    if (!mint || typeof mint !== "string") {
      return NextResponse.json({ error: "Falta mint" }, { status: 400 });
    }
    const meta = await getTokenMeta(mint);
    upsertToken(mint, meta.symbol, meta.name);
    return NextResponse.json({ ok: true, mint, ...meta });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
