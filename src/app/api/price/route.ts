import { NextRequest, NextResponse } from "next/server";
import type { PriceApiResponse } from "@/lib/types";
import { getJupiterPrice } from "@/lib/jupiter";

// ─── GET /api/price?ca=<mint_address> ────────────────────────────────────────
// Refrescar precio. Jupiter v3 → DexScreener fallback.

async function getPriceFromDexScreener(ca: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { next: { revalidate: 15 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pairs: Array<{ priceUsd?: string; liquidity?: { usd?: number } }> =
      data?.pairs ?? [];
    if (pairs.length === 0) return null;

    const best = pairs.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
    )[0];
    return best?.priceUsd ? parseFloat(best.priceUsd) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ca = request.nextUrl.searchParams.get("ca");
  if (!ca) {
    return NextResponse.json({ error: "Falta el parámetro ca" }, { status: 400 });
  }

  let price = await getJupiterPrice(ca);
  let source = "jupiter";

  if (price === null) {
    price = await getPriceFromDexScreener(ca);
    source = "dexscreener";
  }

  const response: PriceApiResponse & { source: string } = { mint: ca, price, source };
  return NextResponse.json(response);
}
