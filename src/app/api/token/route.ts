import { NextRequest, NextResponse } from "next/server";
import type { TokenApiResponse } from "@/lib/types";
import { getJupiterPrice } from "@/lib/jupiter";
import { getHeliusRpcUrl } from "@/lib/cluster";

// ─── GET /api/token?ca=<mint_address> ────────────────────────────────────────
// Proxy server-side hacia Helius DAS API.
// HELIUS_API_KEY nunca sale del servidor.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ca = request.nextUrl.searchParams.get("ca");

  if (!ca) {
    return NextResponse.json({ error: "Falta el parámetro ca" }, { status: 400 });
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "HELIUS_API_KEY no configurada en .env.local" },
      { status: 500 }
    );
  }

  try {
    // ── Fetch asset metadata via DAS API ──────────────────────────────────
    const heliusRes = await fetch(
      getHeliusRpcUrl(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "get-asset",
          method: "getAsset",
          params: { id: ca },
        }),
      }
    );

    if (!heliusRes.ok) {
      return NextResponse.json(
        { error: `Helius respondió ${heliusRes.status}` },
        { status: heliusRes.status }
      );
    }

    const heliusData = await heliusRes.json();

    if (heliusData.error) {
      return NextResponse.json(
        { error: heliusData.error.message ?? "Error de Helius" },
        { status: 400 }
      );
    }

    // ── Fetch price: Jupiter v3 → DexScreener fallback ────────────────────
    let price: number | null = null;
    let priceSource: "jupiter" | "dexscreener" | "none" = "none";

    const jupPrice = await getJupiterPrice(ca);
    if (jupPrice !== null) {
      price = jupPrice;
      priceSource = "jupiter";
    }

    if (price === null) {
      try {
        const dexRes = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${ca}`
        );
        const dexData = await dexRes.json();
        const pairs: Array<{ priceUsd?: string; liquidity?: { usd?: number } }> =
          dexData?.pairs ?? [];
        if (pairs.length > 0) {
          const best = pairs.sort(
            (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
          )[0];
          if (best?.priceUsd) {
            price = parseFloat(best.priceUsd);
            priceSource = "dexscreener";
          }
        }
      } catch { /* precio queda null */ }
    }

    const response: TokenApiResponse = {
      asset: heliusData.result,
      price,
      priceSource,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
