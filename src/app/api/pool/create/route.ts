import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import DLMM, { ActivationType } from "@meteora-ag/dlmm";
import { getConnection, getWalletKeypair } from "@/lib/solana";
import { getSOLPrice } from "@/lib/jupiter";
import { submitSmartTransaction } from "@/lib/helius";

const BIN_ID_OFFSET = 8388608;
const SOL_MINT = "So11111111111111111111111111111111111111112";

function calculateActiveId(priceXinY: number, binStep: number): number {
  if (priceXinY <= 0) return BIN_ID_OFFSET;
  return BIN_ID_OFFSET + Math.round(Math.log(priceXinY) / Math.log(1 + binStep / 10_000));
}

interface CreatePoolRequest {
  tokenXMint: string;
  binStep: number;
  feeBps: number;
  tokenPriceUSD: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { tokenXMint, binStep, feeBps, tokenPriceUSD }: CreatePoolRequest = await request.json();
    if (!tokenXMint || !binStep) return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });

    const connection = getConnection();
    const wallet = getWalletKeypair();
    const solPrice = await getSOLPrice();
    const activeId = calculateActiveId(tokenPriceUSD / solPrice, binStep);

    const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair(
      connection, new BN(binStep),
      new PublicKey(tokenXMint), new PublicKey(SOL_MINT),
      new BN(activeId), new BN(feeBps),
      ActivationType.Timestamp, // activación inmediata (sin activationPoint → ya activo)
      false,                    // hasAlphaVault
      wallet.publicKey,         // creatorKey
    );

    const result = await submitSmartTransaction(createPoolTx, [wallet]);

    return NextResponse.json({
      txHash: result.txHash,
      activeId,
      solPrice,
      submission: {
        priorityFeeMicroLamports: result.priorityFeeMicroLamports,
        computeUnits: result.computeUnits,
        rebateAddress: result.rebateAddress,
      },
    });
  } catch (err: unknown) {
    console.error("[pool/create]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
