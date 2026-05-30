import type { EarlyBuyer } from "./types";
import { PUMP_FUN_PROGRAM } from "./pumpfun";

// ─── Indexer: primeras compras de un token pump.fun (Bitquery) ───────────────
// Detrás de una interfaz simple para poder swappear a Moralis/otro después.
//
// NOTA: el endpoint EAP de Bitquery (Solana) usa OAuth Bearer. El esquema exacto
// de DEXTrades puede variar entre versiones — si al enchufar la key real algún
// campo no matchea, ajustar la query/mapeo acá (es el único lugar que toca Bitquery).

const BITQUERY_EAP = "https://streaming.bitquery.io/eap";

const QUERY = `
query EarlyBuyers($mint: String!, $limit: Int!) {
  Solana {
    DEXTrades(
      limit: { count: $limit }
      orderBy: { ascending: Block_Time }
      where: {
        Trade: { Buy: { Currency: { MintAddress: { is: $mint } } } }
        Instruction: { Program: { Address: { is: "${PUMP_FUN_PROGRAM}" } } }
      }
    ) {
      Block { Time }
      Transaction { Signature }
      Trade {
        Buy { Account { Address } Amount }
        Sell { Amount }
      }
    }
  }
}`;

interface BitqueryTrade {
  Block?: { Time?: string };
  Transaction?: { Signature?: string };
  Trade?: {
    Buy?: { Account?: { Address?: string }; Amount?: string };
    Sell?: { Amount?: string };
  };
}

/**
 * Devuelve las primeras `limit` compras del token, deduplicadas a la PRIMERA
 * compra por wallet y rankeadas por orden temporal.
 *
 * TODO (LIMITACIÓN conocida — la detecta scripts/test-discover.mjs):
 * Esta query usa `DEXTrades` con `Trade.Buy.Currency = mint`. Bitquery registra
 * las compras de pump.fun de forma INCONSISTENTE entre el lado Buy/Sell: para
 * tokens que migraron, las compras quedan del otro lado y esta query devuelve
 * ~0. Anda bien para tokens recién creados (aún en bonding curve). Fix pendiente:
 * migrar a `DEXTradeByTokens` (vista token-céntrica, captura ambos lados) y pinear
 * la dirección de "compra". Mientras tanto, el análisis es débil para tokens migrados.
 */
export async function getEarlyBuyers(mint: string, limit: number): Promise<EarlyBuyer[]> {
  const key = process.env.BITQUERY_API_KEY;
  if (!key) throw new Error("BITQUERY_API_KEY no configurada en .env.local");

  const res = await fetch(BITQUERY_EAP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: QUERY, variables: { mint, limit } }),
  });
  if (!res.ok) throw new Error(`Bitquery ${res.status}: ${await res.text().catch(() => "")}`);

  const json = await res.json();
  if (json.errors) throw new Error(`Bitquery: ${JSON.stringify(json.errors)}`);

  const trades: BitqueryTrade[] = json?.data?.Solana?.DEXTrades ?? [];

  const seen = new Set<string>();
  const buyers: EarlyBuyer[] = [];
  for (const t of trades) {
    const wallet = t.Trade?.Buy?.Account?.Address;
    if (!wallet || seen.has(wallet)) continue;
    seen.add(wallet);
    buyers.push({
      wallet,
      rank: buyers.length + 1,
      solIn: Number(t.Trade?.Sell?.Amount ?? 0),
      tokensOut: Number(t.Trade?.Buy?.Amount ?? 0),
      blockTime: Math.floor(new Date(t.Block?.Time ?? 0).getTime() / 1000),
      signature: t.Transaction?.Signature ?? "",
    });
  }
  return buyers;
}
