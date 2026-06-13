import { NextResponse } from "next/server";
import { getGroups } from "@/lib/tracker/db";

export const runtime = "nodejs";

// GET /api/tracker/groups — clusters coordinados con miembros + cohesión.
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ groups: getGroups() });
  } catch (err: unknown) {
    console.error("[tracker/groups]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
