import type { EarlyBuyer } from "./types";
import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_FUN_PROGRAM, type HeliusEnhancedTx } from "./pumpfun";

// ─── Early buyers de un token (on-chain vía Helius) ──────────────────────────
// Antes esto usaba Bitquery, pero el EAP free tier cuenta los trades pero solo
// deja ENUMERAR ~8-12 filas individuales por token → perdía los early buyers de
// tokens activos/migrados (lo detectó scripts/test-discover.mjs). Helius da la
// historia on-chain completa y determinística.
//
// Estrategia: paginar getSignaturesForAddress(mint) hasta las firmas más viejas,
// parsear desde el origen con la Enhanced Transactions API y quedarse con las
// primeras `limit` COMPRAS pump.fun (wallet recibe el token y paga SOL).

const MAX_PAGES = 30;        // tope de paginación (30k firmas) para acotar costo
const ENHANCED_BATCH = 100;  // máx por request de la Enhanced API

function heliusKey(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY no configurada en .env.local");
  return k;
}

async function fetchEnhanced(signatures: string[]): Promise<HeliusEnhancedTx[]> {
  const res = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${heliusKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: signatures }),
  });
  if (!res.ok) throw new Error(`Helius enhanced ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Si el tx es una compra del `mint`, devuelve el comprador.
 * Criterio (validado contra datos reales): el feePayer RECIBIÓ el token y PAGÓ SOL.
 * No filtramos por type/source: Helius etiqueta muchas compras de la bonding curve
 * como TRANSFER/SYSTEM_PROGRAM, no como SWAP/PUMP_FUN.
 */
function pumpBuyerOf(tx: HeliusEnhancedTx, mint: string): { wallet: string; solIn: number; tokensOut: number } | null {
  const buyer = tx.feePayer;
  if (!buyer) return null;
  const received = (tx.tokenTransfers ?? []).find((tt) => tt.mint === mint && tt.toUserAccount === buyer);
  if (!received) return null;
  const solIn = (tx.nativeTransfers ?? [])
    .filter((n) => n.fromUserAccount === buyer)
    .reduce((s, n) => s + (n.amount ?? 0), 0) / 1e9;
  if (solIn <= 0) return null; // pagó SOL → compra real (descarta transfers/airdrops)
  return { wallet: buyer, solIn, tokensOut: received.tokenAmount ?? 0 };
}

/**
 * Primeras `limit` compras del token, deduplicadas a la PRIMERA compra por wallet
 * y rankeadas cronológicamente.
 */
export async function getEarlyBuyers(mint: string, limit: number): Promise<EarlyBuyer[]> {
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
  for (let p = 0; p < MAX_PAGES; p++) {
    const batch = await connection.getSignaturesForAddress(
      bondingCurve,
      before ? { limit: 1000, before } : { limit: 1000 }
    );
    if (batch.length === 0) break;
    for (const s of batch) sigs.push({ signature: s.signature, blockTime: s.blockTime ?? 0 });
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  const chrono = sigs.reverse(); // viejas → nuevas

  // 2. Parsear desde el origen hasta juntar `limit` compradores únicos.
  const buyers: EarlyBuyer[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < chrono.length && buyers.length < limit; i += ENHANCED_BATCH) {
    const slice = chrono.slice(i, i + ENHANCED_BATCH);
    const parsed = await fetchEnhanced(slice.map((s) => s.signature));
    const bySig = new Map(parsed.map((t) => [t.signature, t]));
    // Recorrer en orden cronológico (la Enhanced API puede devolver desordenado).
    for (const s of slice) {
      const tx = bySig.get(s.signature);
      if (!tx) continue;
      const b = pumpBuyerOf(tx, mint);
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
  return buyers;
}
