import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import { getConnection } from "@/lib/solana";
import type { DLMMPool } from "@/lib/types";

// GET /api/pool/info?address=<pool_address>
// Fetchea info del pool directo desde la chain.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const address = request.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "Falta el parámetro address" }, { status: 400 });

  try {
    const connection = getConnection();
    const dlmmPool = await DLMM.create(connection, new PublicKey(address));
    const activeBin = await dlmmPool.getActiveBin();
    const activeBinPrice = dlmmPool.fromPricePerLamport(Number(activeBin.price));

    const pool: DLMMPool = {
      address,
      name: `${dlmmPool.tokenX.publicKey.toBase58().slice(0, 4)}.../${dlmmPool.tokenY.publicKey.toBase58().slice(0, 4)}...`,
      mint_x: dlmmPool.tokenX.publicKey.toBase58(),
      mint_y: dlmmPool.tokenY.publicKey.toBase58(),
      bin_step: dlmmPool.lbPair.binStep,
      base_fee_percentage: String(dlmmPool.lbPair.parameters.baseFactor / 100),
      current_price: parseFloat(activeBinPrice.toString()),
      liquidity: "0",
      trade_volume_24h: 0,
      fees_24h: 0,
      today_fees: 0,
      apr: 0,
      hide: false,
    };

    return NextResponse.json({ pool, activeBinId: activeBin.binId });
  } catch (err: unknown) {
    console.error("[pool/info]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
