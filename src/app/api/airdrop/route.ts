import { NextResponse } from "next/server";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getConnection, getWalletKeypair } from "@/lib/solana";
import { isDevnet } from "@/lib/cluster";

// ─── POST /api/airdrop ───────────────────────────────────────────────────────
// Pide SOL del faucet de Solana devnet.
// Solo disponible cuando NEXT_PUBLIC_SOLANA_CLUSTER=devnet.
// Límite: 2 SOL por request, rate-limited por Solana.

export async function POST(): Promise<NextResponse> {
  if (!isDevnet()) {
    return NextResponse.json(
      { error: "Airdrop solo disponible en devnet. No en mainnet." },
      { status: 403 }
    );
  }

  try {
    const connection = getConnection();
    const wallet = getWalletKeypair();

    const signature = await connection.requestAirdrop(
      wallet.publicKey,
      2 * LAMPORTS_PER_SOL
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

    const balance = await connection.getBalance(wallet.publicKey);

    return NextResponse.json({
      signature,
      wallet: wallet.publicKey.toBase58(),
      airdropped: 2,
      newBalanceSOL: balance / LAMPORTS_PER_SOL,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    // Error común: rate limit del faucet
    const isRateLimit = message.toLowerCase().includes("rate") || message.toLowerCase().includes("airdrop");
    return NextResponse.json(
      {
        error: isRateLimit
          ? "Rate limit del faucet — esperá unos segundos e intentá de nuevo."
          : message,
      },
      { status: 500 }
    );
  }
}
