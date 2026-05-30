import { NextResponse } from "next/server";
import { listAlerts } from "@/lib/tracker/db";

export const runtime = "nodejs";

// GET /api/tracker/alerts — feed de alertas recientes (la UI poolea esto)
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ alerts: listAlerts(100) });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
