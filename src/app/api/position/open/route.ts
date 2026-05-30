import { NextRequest, NextResponse } from "next/server";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import DLMM, { StrategyType } from "@meteora-ag/dlmm";
import { getConnection, getWalletKeypair } from "@/lib/solana";
import { getSOLPrice, getSwapQuote, buildSwapTransaction } from "@/lib/jupiter";
import { submitSmartTransaction, submitVersionedTransaction } from "@/lib/helius";
import { getTokenBalance } from "@/lib/balance";
import type { DLMMStrategyType, PositionMode } from "@/lib/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const SWAP_BUFFER = 1.03;
const SWAP_SLIPPAGE_BPS = 200;

function mapStrategy(s: DLMMStrategyType): StrategyType {
  switch (s) {
    case "BidAsk": return StrategyType.BidAsk;
    case "Curve": return StrategyType.Curve;
    default: return StrategyType.Spot;
  }
}

/** Mode derivado del rango relativo al active bin */
function deriveMode(minBinId: number, maxBinId: number): PositionMode {
  if (minBinId >= 0) return "single-token-ask";
  if (maxBinId <= 0) return "single-sol-bid";
  return "bilateral";
}

interface OpenPositionRequest {
  poolAddress: string;
  tokenMint: string;
  strategyType: DLMMStrategyType;
  minBinId: number;
  maxBinId: number;
  usdAmount: number;
  tokenPriceUSD: number;
  tokenDecimals: number;
  skewBelow?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: OpenPositionRequest = await request.json();
    const { poolAddress, tokenMint, strategyType, minBinId, maxBinId, usdAmount, tokenPriceUSD, tokenDecimals, skewBelow = 50 } = body;

    if (!poolAddress || !tokenMint || !usdAmount) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const connection = getConnection();
    const wallet = getWalletKeypair();
    const solPrice = await getSOLPrice();
    const mode = deriveMode(minBinId, maxBinId);

    const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddress));
    const activeBin = await dlmmPool.getActiveBin();
    const tokenMintPk = new PublicKey(tokenMint);
    const isTokenX = dlmmPool.tokenX.publicKey.equals(tokenMintPk);

    let totalXAmount: BN;
    let totalYAmount: BN;
    let swapInfo: { txHash: string; solSpent: number; tokensBought: number; priceImpactPct: string } | null = null;

    if (mode === "single-sol-bid") {
      const solLamports = BigInt(Math.floor((usdAmount / solPrice) * 1e9));
      totalXAmount = isTokenX ? new BN(0) : new BN(solLamports.toString());
      totalYAmount = isTokenX ? new BN(solLamports.toString()) : new BN(0);

    } else if (mode === "single-token-ask") {
      const tokenRaw = BigInt(Math.floor((usdAmount / tokenPriceUSD) * Math.pow(10, tokenDecimals)));
      const balance = await getTokenBalance(tokenMintPk, wallet.publicKey);
      const have = BigInt(balance.amountRaw);
      const deficit = tokenRaw > have ? tokenRaw - have : BigInt(0);

      if (deficit > BigInt(0)) {
        const solUSD = (Number(deficit) / Math.pow(10, tokenDecimals)) * tokenPriceUSD * SWAP_BUFFER;
        const solLamports = BigInt(Math.floor((solUSD / solPrice) * 1e9));
        const quote = await getSwapQuote({ inputMint: SOL_MINT, outputMint: tokenMint, amount: solLamports.toString(), slippageBps: SWAP_SLIPPAGE_BPS });
        const { swapTransaction, lastValidBlockHeight } = await buildSwapTransaction({ quote, userPublicKey: wallet.publicKey.toBase58() });
        const vtx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
        const sr = await submitVersionedTransaction(vtx, [wallet], { lastValidBlockHeight });
        swapInfo = { txHash: sr.txHash, solSpent: Number(quote.inAmount) / 1e9, tokensBought: Number(quote.outAmount) / Math.pow(10, tokenDecimals), priceImpactPct: quote.priceImpactPct };
        await new Promise((r) => setTimeout(r, 2500));
      }

      const finalBalance = await getTokenBalance(tokenMintPk, wallet.publicKey);
      const finalRaw = BigInt(finalBalance.amountRaw);
      const actualRaw = finalRaw >= tokenRaw ? tokenRaw : finalRaw;
      totalXAmount = isTokenX ? new BN(actualRaw.toString()) : new BN(0);
      totalYAmount = isTokenX ? new BN(0) : new BN(actualRaw.toString());

    } else {
      // bilateral
      const tokenUSD = usdAmount * (skewBelow / 100);
      const quoteUSD = usdAmount * ((100 - skewBelow) / 100);
      const tokenRaw = BigInt(Math.floor((tokenUSD / tokenPriceUSD) * Math.pow(10, tokenDecimals)));
      const solRaw = BigInt(Math.floor((quoteUSD / solPrice) * 1e9));

      const balance = await getTokenBalance(tokenMintPk, wallet.publicKey);
      const have = BigInt(balance.amountRaw);
      const deficit = tokenRaw > have ? tokenRaw - have : BigInt(0);

      if (deficit > BigInt(0)) {
        const solUSD = (Number(deficit) / Math.pow(10, tokenDecimals)) * tokenPriceUSD * SWAP_BUFFER;
        const solLamports = BigInt(Math.floor((solUSD / solPrice) * 1e9));
        const quote = await getSwapQuote({ inputMint: SOL_MINT, outputMint: tokenMint, amount: solLamports.toString(), slippageBps: SWAP_SLIPPAGE_BPS });
        const { swapTransaction, lastValidBlockHeight } = await buildSwapTransaction({ quote, userPublicKey: wallet.publicKey.toBase58() });
        const vtx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
        const sr = await submitVersionedTransaction(vtx, [wallet], { lastValidBlockHeight });
        swapInfo = { txHash: sr.txHash, solSpent: Number(quote.inAmount) / 1e9, tokensBought: Number(quote.outAmount) / Math.pow(10, tokenDecimals), priceImpactPct: quote.priceImpactPct };
        await new Promise((r) => setTimeout(r, 2500));
      }

      const finalBalance = await getTokenBalance(tokenMintPk, wallet.publicKey);
      const finalRaw = BigInt(finalBalance.amountRaw);
      const actualRaw = finalRaw >= tokenRaw ? tokenRaw : finalRaw;
      totalXAmount = isTokenX ? new BN(actualRaw.toString()) : new BN(solRaw.toString());
      totalYAmount = isTokenX ? new BN(solRaw.toString()) : new BN(actualRaw.toString());
    }

    const positionKeypair = Keypair.generate();
    const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: wallet.publicKey,
      totalXAmount, totalYAmount,
      strategy: {
        maxBinId: activeBin.binId + maxBinId,
        minBinId: activeBin.binId + minBinId,
        strategyType: mapStrategy(strategyType),
      },
    });

    const openResult = await submitSmartTransaction(createPositionTx, [wallet, positionKeypair]);

    return NextResponse.json({
      open: {
        txHash: openResult.txHash,
        positionPubkey: positionKeypair.publicKey.toBase58(),
        priorityFeeMicroLamports: openResult.priorityFeeMicroLamports,
        computeUnits: openResult.computeUnits,
        rebateAddress: openResult.rebateAddress,
      },
      swap: swapInfo,
      mode,
      activeBinId: activeBin.binId,
    });
  } catch (err: unknown) {
    console.error("[position/open]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
