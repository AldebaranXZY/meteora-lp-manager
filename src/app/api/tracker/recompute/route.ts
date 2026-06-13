import { NextResponse } from "next/server";
import { recompute } from "@/lib/tracker/cooccurrence";

export const runtime = "nodejs";

// POST /api/tracker/recompute
// Recalcula co-ocurrencia (ubicuidad + pares + grupos) UNA sola vez. La UI lo
// llama al terminar un batch de análisis; así "30 análisis = 1 recompute" en vez
// de O(N) recomputes (uno por token) como hacía antes /analyze.
export async function POST(): Promise<NextResponse> {
  try {
    const stats = recompute();
    return NextResponse.json({ ok: true, stats });
  } catch (err: unknown) {
    console.error("[tracker/recompute]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
