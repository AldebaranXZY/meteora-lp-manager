import { NextRequest, NextResponse } from "next/server";
import type { PoolSearchResponse } from "@/lib/types";

const METEORA_BASE = "https://dlmm.datapi.meteora.ag";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const mint = request.nextUrl.searchParams.get("mint");
  if (!mint) return NextResponse.json({ error: "Falta el parámetro mint" }, { status: 400 });

  try {
    const res = await fetch(`${METEORA_BASE}/pools?page=1&page_size=500`, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ error: `Meteora API respondió ${res.status}` }, { status: res.status });

    const body = await res.json();
    const allPools = Array.isArray(body) ? body : (body.data ?? []);

    const matchingPools = allPools
      .filter((p: Record<string, unknown>) => {
        const tokenX = (p.token_x as Record<string, string>)?.address ?? (p.mint_x as string) ?? "";
        const tokenY = (p.token_y as Record<string, string>)?.address ?? (p.mint_y as string) ?? "";
        return tokenX.toLowerCase() === mint.toLowerCase() || tokenY.toLowerCase() === mint.toLowerCase();
      })
      .map((p: Record<string, unknown>) => ({
        address: p.address as string,
        name: p.name as string,
        mint_x: (p.token_x as Record<string, string>)?.address ?? (p.mint_x as string) ?? "",
        mint_y: (p.token_y as Record<string, string>)?.address ?? (p.mint_y as string) ?? "",
        bin_step: (p.config as Record<string, number>)?.bin_step ?? (p.bin_step as number) ?? 0,
        base_fee_percentage: String((p.config as Record<string, number>)?.base_fee_pct ?? p.base_fee_percentage ?? "0"),
        current_price: (p.current_price as number) ?? 0,
        liquidity: String(p.tvl ?? p.liquidity ?? "0"),
        trade_volume_24h: (p.volume as Record<string, number>)?.["24h"] ?? (p.trade_volume_24h as number) ?? 0,
        fees_24h: (p.fees as Record<string, number>)?.["24h"] ?? (p.fees_24h as number) ?? 0,
        today_fees: (p.fees as Record<string, number>)?.["24h"] ?? (p.today_fees as number) ?? 0,
        apr: (p.fee_tvl_ratio as Record<string, number>)?.["24h"] ?? (p.apr as number) ?? 0,
        hide: (p.is_hidden as boolean) ?? false,
      }))
      .filter((p: { hide: boolean }) => !p.hide)
      .slice(0, 10);

    const response: PoolSearchResponse = {
      pools: matchingPools,
      bestPool: matchingPools[0] ?? null,
    };
    return NextResponse.json(response);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
