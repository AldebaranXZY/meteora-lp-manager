import type { Trade, DeepAnalyzeResult } from "./types";
import { pumpTradeOf } from "./pumpfun";
import { mainnetConnection, bondingCurvePda, paginateSignatures, fetchEnhanced } from "./indexer";
import { ENHANCED_BATCH, ENHANCED_CONCURRENCY } from "./config";

// ─── Deep analyze: ledger COMPLETO de un token (para PnL realizado) ──────────
// A diferencia de getEarlyBuyers (que se corta al juntar `limit` compradores),
// acá se parsean TODAS las firmas de la bonding curve para capturar cada compra
// Y venta de cada wallet → permite computar el PnL realizado en SOL. Es CARO
// (parsea todo, no se corta), por eso es OPT-IN por token desde la UI.

/** Baja el ledger completo (buys + sells) de un token desde la bonding curve. */
export async function getTokenTrades(mint: string): Promise<DeepAnalyzeResult> {
  const startedAt = Date.now();
  const connection = mainnetConnection();
  const { sigs, pagesUsed, hitPageCap } = await paginateSignatures(connection, bondingCurvePda(mint));
  const chrono = sigs.slice().reverse(); // viejas → nuevas

  const trades: Trade[] = [];
  let enhancedTxParsed = 0;
  const waveSize = ENHANCED_BATCH * ENHANCED_CONCURRENCY;
  for (let i = 0; i < chrono.length; i += waveSize) {
    const slices: { signature: string; blockTime: number }[][] = [];
    for (let c = 0; c < ENHANCED_CONCURRENCY; c++) {
      const start = i + c * ENHANCED_BATCH;
      if (start >= chrono.length) break;
      slices.push(chrono.slice(start, start + ENHANCED_BATCH));
    }
    enhancedTxParsed += slices.reduce((s, sl) => s + sl.length, 0);
    const parsedWaves = await Promise.all(slices.map((sl) => fetchEnhanced(sl.map((s) => s.signature))));

    for (let w = 0; w < slices.length; w++) {
      const bySig = new Map(parsedWaves[w].map((t) => [t.signature, t]));
      for (const s of slices[w]) {
        const tx = bySig.get(s.signature);
        if (!tx) continue;
        const t = pumpTradeOf(tx, mint);
        if (!t) continue;
        trades.push({ wallet: t.wallet, side: t.side, sol: t.sol, tokens: t.tokens, blockTime: tx.timestamp ?? s.blockTime, signature: s.signature });
      }
    }
  }

  return {
    trades,
    stats: { mint, signaturesScanned: sigs.length, pagesUsed, hitPageCap, tradesFound: trades.length, enhancedTxParsed, elapsedMs: Date.now() - startedAt },
  };
}
