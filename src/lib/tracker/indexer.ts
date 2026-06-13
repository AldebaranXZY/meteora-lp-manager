import type { EarlyBuyer, AnalyzeResult } from "./types";
import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_FUN_PROGRAM, pumpBuyOf, type HeliusEnhancedTx } from "./pumpfun";
import { fetchJSON, retry } from "./http";
import { MAX_SIGNATURE_PAGES, ENHANCED_BATCH, ENHANCED_CONCURRENCY, MIGRATION_STALE_SEC } from "./config";

// ─── Early buyers de un token (on-chain vía Helius) ──────────────────────────
// Antes esto usaba Bitquery, pero el EAP free tier cuenta los trades pero solo
// deja ENUMERAR ~8-12 filas individuales por token → perdía los early buyers de
// tokens activos/migrados (lo detectó scripts/test-discover.mjs). Helius da la
// historia on-chain completa y determinística.
//
// Estrategia: paginar getSignaturesForAddress(bondingCurve) hasta el GÉNESIS
// (firma más vieja), parsear desde el origen con la Enhanced Transactions API y
// quedarse con las primeras `limit` COMPRAS pump.fun (wallet recibe el token y
// paga SOL).
//
// CLAVE (fix de truncado): getSignaturesForAddress devuelve nuevas→viejas y
// pagina hacia atrás con `before`. Con un tope bajo (antes 30 páginas = 30k
// firmas) un token muy activo nunca llegaba al génesis: el reverse() tomaba como
// "rank 1" una firma de la MITAD de su vida → early buyers equivocados, SILENCIOSO.
// Ahora el tope es alto (corte normal = batch < 1000 = génesis real) y si igual se
// agota se marca `hitPageCap` → el truncado deja de ser invisible. La paginación
// de firmas es BARATA (no trae cuerpos de tx); lo caro es la Enhanced API, que ya
// se corta al juntar `limit` buyers → llegar al génesis no encarece el parseo.

function heliusKey(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY no configurada en .env.local");
  return k;
}

async function fetchEnhanced(signatures: string[]): Promise<HeliusEnhancedTx[]> {
  const data = await fetchJSON<unknown>(`https://api.helius.xyz/v0/transactions?api-key=${heliusKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: signatures }),
    label: "Helius enhanced",
  });
  return Array.isArray(data) ? (data as HeliusEnhancedTx[]) : [];
}

/**
 * Primeras `limit` compras del token, deduplicadas a la PRIMERA compra por wallet
 * y rankeadas cronológicamente, junto con un diagnóstico (`AnalyzeStats`) que
 * expone cobertura, truncado y migración.
 */
export async function getEarlyBuyers(mint: string, limit: number): Promise<AnalyzeResult> {
  const startedAt = Date.now();
  // pump.fun es MAINNET-only → conexión mainnet fija, sin importar
  // NEXT_PUBLIC_SOLANA_CLUSTER (que es para el toggle devnet del LP manager).
  const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey()}`, "confirmed");
  const mintPk = new PublicKey(mint);

  // Firmas de la BONDING CURVE PDA (no del mint): ahí están solo las compras/ventas
  // de pump.fun, sin el ruido de transfers/ATAs del mint.
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintPk.toBuffer()],
    new PublicKey(PUMP_FUN_PROGRAM)
  );

  // 1. Paginar firmas hasta las más viejas (la API devuelve nuevas→viejas).
  let before: string | undefined;
  const sigs: { signature: string; blockTime: number }[] = [];
  let pagesUsed = 0;
  let hitPageCap = false;
  for (let p = 0; p < MAX_SIGNATURE_PAGES; p++) {
    const batch = await retry(
      () => connection.getSignaturesForAddress(bondingCurve, before ? { limit: 1000, before } : { limit: 1000 }),
      3,
      "getSignaturesForAddress"
    );
    pagesUsed++;
    if (batch.length === 0) break;
    for (const s of batch) sigs.push({ signature: s.signature, blockTime: s.blockTime ?? 0 });
    if (batch.length < 1000) break;                       // batch corto = génesis alcanzado
    before = batch[batch.length - 1].signature;
    if (p === MAX_SIGNATURE_PAGES - 1) hitPageCap = true; // se agotó el tope SIN llegar al génesis
  }
  const chrono = sigs.reverse(); // viejas → nuevas

  // 2. Parsear desde el origen hasta juntar `limit` compradores únicos. Se fetchean
  // hasta ENHANCED_CONCURRENCY batches en paralelo por ola, pero se PROCESAN en
  // orden cronológico estricto (para rankear bien) y se corta al llegar a `limit`
  // (over-fetch acotado a C-1 batches).
  const buyers: EarlyBuyer[] = [];
  const seen = new Set<string>();
  let enhancedTxParsed = 0;
  const waveSize = ENHANCED_BATCH * ENHANCED_CONCURRENCY;
  for (let i = 0; i < chrono.length && buyers.length < limit; i += waveSize) {
    const slices: { signature: string; blockTime: number }[][] = [];
    for (let c = 0; c < ENHANCED_CONCURRENCY; c++) {
      const start = i + c * ENHANCED_BATCH;
      if (start >= chrono.length) break;
      slices.push(chrono.slice(start, start + ENHANCED_BATCH));
    }
    enhancedTxParsed += slices.reduce((s, sl) => s + sl.length, 0);
    const parsedWaves = await Promise.all(slices.map((sl) => fetchEnhanced(sl.map((s) => s.signature))));

    for (let w = 0; w < slices.length && buyers.length < limit; w++) {
      const bySig = new Map(parsedWaves[w].map((t) => [t.signature, t]));
      // Recorrer en orden cronológico (la Enhanced API puede devolver desordenado).
      for (const s of slices[w]) {
        const tx = bySig.get(s.signature);
        if (!tx) continue;
        const b = pumpBuyOf(tx, mint);
        if (!b || seen.has(b.wallet)) continue;
        seen.add(b.wallet);
        buyers.push({
          wallet: b.wallet,
          rank: buyers.length + 1,
          solIn: b.solIn,
          tokensOut: b.tokensOut,
          blockTime: tx.timestamp ?? s.blockTime,
          signature: s.signature,
        });
        if (buyers.length >= limit) break;
      }
    }
  }

  const oldestBlockTime = chrono[0]?.blockTime ?? 0;
  const newestBlockTime = chrono.length ? chrono[chrono.length - 1].blockTime : 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const stats = {
    mint,
    signaturesScanned: sigs.length,
    pagesUsed,
    hitPageCap,
    buyersFound: buyers.length,
    buyersRequested: limit,
    oldestBlockTime,
    newestBlockTime,
    likelyTruncated: hitPageCap, // si se agotó el tope, el set NO arranca en el génesis
    likelyMigrated: newestBlockTime > 0 && nowSec - newestBlockTime > MIGRATION_STALE_SEC,
    enhancedTxParsed,
    elapsedMs: Date.now() - startedAt,
  };
  return { buyers, stats };
}
