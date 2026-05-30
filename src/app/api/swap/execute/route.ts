import { NextRequest, NextResponse } from "next/server";
import { VersionedTransaction } from "@solana/web3.js";
import { getWalletKeypair } from "@/lib/solana";
import {
  getSwapQuote,
  buildSwapTransaction,
  type SwapQuote,
} from "@/lib/jupiter";
import { submitVersionedTransaction } from "@/lib/helius";

// ─── POST /api/swap/execute ──────────────────────────────────────────────────
// Body:
//   inputMint   → mint del input (default SOL)
//   outputMint  → mint del output
//   amount      → cantidad en smallest units
//   slippageBps → default 100
//   swapMode    → "ExactIn" (default) o "ExactOut"
//   quote?      → si ya tenés un quote del endpoint /quote, lo reusás
//
// Devuelve el txHash + info del swap.

const SOL_MINT = "So11111111111111111111111111111111111111112";

interface SwapExecuteRequest {
  inputMint?: string;
  outputMint?: string;
  amount?: string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
  quote?: SwapQuote;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: SwapExecuteRequest = await request.json();
    const wallet = getWalletKeypair();

    // ── 1. Obtener quote (o usar el provisto) ─────────────────────────────
    let quote: SwapQuote;

    if (body.quote) {
      quote = body.quote;
    } else {
      if (!body.outputMint || !body.amount) {
        return NextResponse.json(
          { error: "Falta outputMint o amount (o pasar 'quote' directamente)" },
          { status: 400 }
        );
      }
      quote = await getSwapQuote({
        inputMint: body.inputMint ?? SOL_MINT,
        outputMint: body.outputMint,
        amount: body.amount,
        slippageBps: body.slippageBps ?? 100,
        swapMode: body.swapMode ?? "ExactIn",
      });
    }

    // ── 2. Build TX via Jupiter ───────────────────────────────────────────
    const { swapTransaction, lastValidBlockHeight } = await buildSwapTransaction({
      quote,
      userPublicKey: wallet.publicKey.toBase58(),
    });

    // ── 3. Deserializar VersionedTransaction ──────────────────────────────
    const vtx = VersionedTransaction.deserialize(
      Buffer.from(swapTransaction, "base64")
    );

    // ── 4. Firmar + enviar via Helius con rebate-address ──────────────────
    const result = await submitVersionedTransaction(vtx, [wallet], {
      lastValidBlockHeight,
    });

    return NextResponse.json({
      txHash: result.txHash,
      quote: {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
        slippageBps: quote.slippageBps,
      },
      submission: {
        rebateAddress: result.rebateAddress,
      },
    });
  } catch (err: unknown) {
    console.error("[swap/execute] Error:", err);
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
