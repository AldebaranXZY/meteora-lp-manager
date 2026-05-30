import { NextRequest, NextResponse } from "next/server";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import {
  CpAmm,
  BaseFeeMode,
  CollectFeeMode,
  ActivationType,
  getBaseFeeParams,
  getDynamicFeeParams,
  validatePoolFees,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
} from "@meteora-ag/cp-amm-sdk";
import { getConnection, getWalletKeypair } from "@/lib/solana";
import { getSOLPrice } from "@/lib/jupiter";
import { submitSmartTransaction } from "@/lib/helius";
import type { DAMMv2Config } from "@/lib/types";

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

interface CreateDAMMv2Request {
  tokenMint: string;
  tokenDecimals: number;
  tokenAAmountUSD: number;
  tokenBAmountSOL: number;
  tokenPriceUSD: number;
  config: DAMMv2Config;
}

function mapBaseFeeMode(
  baseFeeMode: number,
  schedulerType: number
): BaseFeeMode {
  if (baseFeeMode === 0) {
    // Fixed — usar Linear con totalDuration=0
    return schedulerType === 1
      ? BaseFeeMode.FeeTimeSchedulerExponential
      : BaseFeeMode.FeeTimeSchedulerLinear;
  }
  if (baseFeeMode === 1) {
    return schedulerType === 1
      ? BaseFeeMode.FeeTimeSchedulerExponential
      : BaseFeeMode.FeeTimeSchedulerLinear;
  }
  // Market Cap Scheduler → fallback a Time Scheduler
  return schedulerType === 1
    ? BaseFeeMode.FeeMarketCapSchedulerExponential
    : BaseFeeMode.FeeMarketCapSchedulerLinear;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: CreateDAMMv2Request = await request.json();
    const {
      tokenMint, tokenDecimals, tokenAAmountUSD, tokenBAmountSOL,
      tokenPriceUSD, config,
    } = body;

    if (!tokenMint || !tokenAAmountUSD) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const connection = getConnection();
    const wallet = getWalletKeypair();
    const solPrice = await getSOLPrice();

    const cpAmm = new CpAmm(connection);

    // ── Amounts ──────────────────────────────────────────────────────────────
    const tokenAAmount = new BN(
      Math.floor((tokenAAmountUSD / tokenPriceUSD) * Math.pow(10, tokenDecimals))
    );
    const tokenBAmount = new BN(
      Math.floor(tokenBAmountSOL * 1e9)
    );

    // ── Fee params ────────────────────────────────────────────────────────────
    const startingFeeBps = Math.round(config.initialFeePct * 100);
    const endingFeeBps = Math.round(config.feeTierPct * 100);

    const isFixed = config.baseFeeMode === 0;
    const sdkBaseFeeMode = mapBaseFeeMode(config.baseFeeMode, config.schedulerType);

    const baseFee = getBaseFeeParams(
      {
        baseFeeMode: sdkBaseFeeMode,
        feeTimeSchedulerParam: {
          startingFeeBps: isFixed ? endingFeeBps : startingFeeBps,
          endingFeeBps,
          numberOfPeriod: isFixed ? 0 : 50,
          totalDuration: isFixed ? 0 : config.totalDuration,
        },
      },
      tokenDecimals,
      ActivationType.Timestamp
    );

    const dynamicFee = config.dynamicFee
      ? getDynamicFeeParams(25) // binStep approx para dynamic fee
      : undefined;

    // ── collect fee mode ──────────────────────────────────────────────────────
    // UI: 0 = Base+Quote · 1 = Quote only · 2 = Quote+Compounding.
    // Coinciden 1:1 con el enum CollectFeeMode del SDK (BothToken/OnlyB/Compounding).
    const collectFeeMode = config.feeCollectMode as CollectFeeMode;
    // compounding bps: el SDK exige > 0 solo en modo Compounding, y 0 en el resto.
    const compoundingFeeBps =
      collectFeeMode === CollectFeeMode.Compounding
        ? Math.max(1, Math.round(config.compoundingFeePct * 100))
        : 0;

    // ── Pool fees (forma completa que pide el SDK) ────────────────────────────
    const poolFees = {
      baseFee,
      compoundingFeeBps,
      padding: 0,
      dynamicFee: dynamicFee ?? null,
    };
    // Falla temprano con error legible si la config de fees es inválida.
    validatePoolFees(poolFees, collectFeeMode, ActivationType.Timestamp);

    // ── Activation point ──────────────────────────────────────────────────────
    const activationPoint = config.startNow
      ? new BN(Math.floor(Date.now() / 1000))
      : new BN(config.customStartTs ?? Math.floor(Date.now() / 1000));

    // ── Position NFT keypair ──────────────────────────────────────────────────
    const positionNftKeypair = Keypair.generate();

    // ── Init sqrt price + liquidity delta (derivados del ratio de amounts) ────
    const { initSqrtPrice, liquidityDelta } = cpAmm.preparePoolCreationParams({
      tokenAAmount,
      tokenBAmount,
      minSqrtPrice: MIN_SQRT_PRICE,
      maxSqrtPrice: MAX_SQRT_PRICE,
      collectFeeMode,
    });

    // ── Create pool TX ────────────────────────────────────────────────────────
    const { tx } = await cpAmm.createCustomPool({
      payer: wallet.publicKey,
      creator: wallet.publicKey,
      positionNft: positionNftKeypair.publicKey,
      tokenAMint: new PublicKey(tokenMint),
      tokenBMint: SOL_MINT,
      tokenAAmount,
      tokenBAmount,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      liquidityDelta,
      initSqrtPrice,
      poolFees,
      hasAlphaVault: false,
      activationType: ActivationType.Timestamp,
      collectFeeMode,
      activationPoint,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
    });

    // ── Submit ────────────────────────────────────────────────────────────────
    const result = await submitSmartTransaction(tx, [wallet, positionNftKeypair]);

    return NextResponse.json({
      txHash: result.txHash,
      positionNft: positionNftKeypair.publicKey.toBase58(),
      submission: {
        priorityFeeMicroLamports: result.priorityFeeMicroLamports,
        computeUnits: result.computeUnits,
        rebateAddress: result.rebateAddress,
      },
      config: {
        feeCollectMode: collectFeeMode,
        startingFeeBps,
        endingFeeBps,
        isFixed,
        dynamicFee: config.dynamicFee,
        totalDuration: config.totalDuration,
        solPrice,
      },
    });
  } catch (err: unknown) {
    console.error("[damm/create]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
