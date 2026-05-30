import { NextRequest, NextResponse } from "next/server";
import { getSwapQuote } from "@/lib/jupiter";

// ─── GET /api/swap/quote ─────────────────────────────────────────────────────
// Params:
//   input       → mint del input (ej: SOL mint)
//   output      → mint del output (ej: el token a comprar)
//   amount      → cantidad en lamports/smallest units
//   slippageBps → bps de slippage tolerable (default 100 = 1%)
//   swapMode    → "ExactIn" (default) o "ExactOut"

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const inputMint = request.nextUrl.searchParams.get("input") ?? SOL_MINT;
    const outputMint = request.nextUrl.searchParams.get("output");
    const amount = request.nextUrl.searchParams.get("amount");
    const slippageBps = parseInt(
      request.nextUrl.searchParams.get("slippageBps") ?? "100"
    );
    const swapMode =
      (request.nextUrl.searchParams.get("swapMode") as "ExactIn" | "ExactOut") ??
      "ExactIn";

    if (!outputMint || !amount) {
      return NextResponse.json(
        { error: "Faltan parámetros: output, amount" },
        { status: 400 }
      );
    }

    const quote = await getSwapQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      swapMode,
    });

    return NextResponse.json(quote);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
