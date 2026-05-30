import { NextRequest, NextResponse } from "next/server";
import { getWalletKeypair } from "@/lib/solana";
import { getTokenBalance, getSOLBalance } from "@/lib/balance";

// ─── GET /api/balance?mint=<token_mint> ──────────────────────────────────────
// Devuelve el balance del token + balance de SOL de la wallet de trading.
// Si no se especifica mint, devuelve solo SOL.

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const mint = request.nextUrl.searchParams.get("mint");
    const wallet = getWalletKeypair();

    const solBalance = await getSOLBalance(wallet.publicKey);

    if (!mint || mint === SOL_MINT) {
      return NextResponse.json({
        wallet: wallet.publicKey.toBase58(),
        sol: solBalance,
        token: null,
      });
    }

    const tokenBalance = await getTokenBalance(mint, wallet.publicKey);

    return NextResponse.json({
      wallet: wallet.publicKey.toBase58(),
      sol: solBalance,
      token: tokenBalance,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
