import type { DiscoveredToken } from "./types";
import { PUMP_FUN_PROGRAM } from "./pumpfun";

// ─── Discover: top memecoins CREADAS un día dado en pump.fun ─────────────────
// 2 fases (sintaxis de agregación validada con scripts/probe-bitquery.mjs):
//   1) ranking por volumen en la ventana del día
//   2) first-trade global + max/last price → filtrar a "creadas ese día" + mcaps
// Supply pump.fun = 1e9 (estándar) → mcap = price × supply.

const BITQUERY_EAP = "https://streaming.bitquery.io/eap";
const PUMP_SUPPLY = 1_000_000_000;
const RANK_LIMIT = 300; // bajamos 300 por volumen; tras filtrar "creadas ayer" deben quedar 100+
const TOP = 100;
const CACHE_TTL = 10 * 60_000;

interface CacheEntry { ts: number; data: DiscoveredToken[] }
const _cache = new Map<number, CacheEntry>();

async function gql<T>(query: string): Promise<T> {
  const key = process.env.BITQUERY_API_KEY;
  if (!key) throw new Error("BITQUERY_API_KEY no configurada en .env.local");
  const res = await fetch(BITQUERY_EAP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Bitquery ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Bitquery: ${JSON.stringify(json.errors)}`);
  return json.data.Solana as T;
}

/** Ventana UTC del día: offset 1 = ayer, 2 = antes de ayer. */
function dayWindow(offset: number): { since: string; till: string } {
  const now = new Date();
  const startToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    since: new Date(startToday - offset * 86_400_000).toISOString(),
    till: new Date(startToday - (offset - 1) * 86_400_000).toISOString(),
  };
}

interface P1Row { Trade?: { Currency?: { MintAddress?: string; Symbol?: string; Name?: string } }; volumeUsd?: string }
interface P2Row { Trade?: { Currency?: { MintAddress?: string }; maxPriceUsd?: string; lastPriceUsd?: string }; Block?: { firstTrade?: string } }

export async function getTopCreatedTokens(dayOffset: 1 | 2): Promise<DiscoveredToken[]> {
  const cached = _cache.get(dayOffset);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const { since, till } = dayWindow(dayOffset);

  // ── Fase 1: ranking por volumen en la ventana ──────────────────────────────
  const q1 = `{ Solana { DEXTradeByTokens(
    where: { Trade: { Dex: { ProgramAddress: { is: "${PUMP_FUN_PROGRAM}" } } }, Block: { Time: { since: "${since}", till: "${till}" } } }
    orderBy: { descendingByField: "volumeUsd" }
    limit: { count: ${RANK_LIMIT} }
  ) { Trade { Currency { MintAddress Symbol Name } } volumeUsd: sum(of: Trade_Side_AmountInUSD) } } }`;
  const d1 = await gql<{ DEXTradeByTokens?: P1Row[] }>(q1);

  // Dedup por mint (Bitquery puede partir por símbolo nulo/variante) → sumar volumen.
  const vol = new Map<string, { symbol: string | null; name: string | null; volumeUsd: number }>();
  for (const r of d1.DEXTradeByTokens ?? []) {
    const mint = r.Trade?.Currency?.MintAddress;
    if (!mint) continue;
    const v = Number(r.volumeUsd ?? 0);
    const prev = vol.get(mint);
    if (prev) { prev.volumeUsd += v; prev.symbol ??= r.Trade?.Currency?.Symbol || null; prev.name ??= r.Trade?.Currency?.Name || null; }
    else vol.set(mint, { symbol: r.Trade?.Currency?.Symbol || null, name: r.Trade?.Currency?.Name || null, volumeUsd: v });
  }
  const mints = [...vol.keys()];
  if (mints.length === 0) { _cache.set(dayOffset, { ts: Date.now(), data: [] }); return []; }

  // ── Fase 2: first-trade global + precios (solo MintAddress → 1 fila/mint) ───
  const list = mints.map((m) => `"${m}"`).join(", ");
  const q2 = `{ Solana { DEXTradeByTokens(
    where: { Trade: { Currency: { MintAddress: { in: [${list}] } }, Dex: { ProgramAddress: { is: "${PUMP_FUN_PROGRAM}" } } } }
    limit: { count: ${RANK_LIMIT * 3} }
  ) { Trade { Currency { MintAddress } maxPriceUsd: PriceInUSD(maximum: Trade_PriceInUSD) lastPriceUsd: PriceInUSD(maximum: Block_Time) } Block { firstTrade: Time(minimum: Block_Time) } } } }`;
  const d2 = await gql<{ DEXTradeByTokens?: P2Row[] }>(q2);

  const meta = new Map<string, { firstTrade: number; maxPrice: number; lastPrice: number }>();
  for (const r of d2.DEXTradeByTokens ?? []) {
    const mint = r.Trade?.Currency?.MintAddress;
    if (!mint || meta.has(mint)) continue;
    meta.set(mint, {
      firstTrade: Math.floor(new Date(r.Block?.firstTrade ?? 0).getTime() / 1000),
      maxPrice: Number(r.Trade?.maxPriceUsd ?? 0),
      lastPrice: Number(r.Trade?.lastPriceUsd ?? 0),
    });
  }

  const sinceSec = Math.floor(new Date(since).getTime() / 1000);
  const tillSec = Math.floor(new Date(till).getTime() / 1000);

  const out: DiscoveredToken[] = [];
  for (const [mint, v] of vol) {
    const m = meta.get(mint);
    if (!m) continue;
    if (m.firstTrade < sinceSec || m.firstTrade >= tillSec) continue; // solo creadas ese día
    out.push({
      mint, symbol: v.symbol, name: v.name,
      volumeUsd: v.volumeUsd,
      mcapMax: m.maxPrice * PUMP_SUPPLY,
      mcapNow: m.lastPrice * PUMP_SUPPLY,
    });
  }
  out.sort((a, b) => b.volumeUsd - a.volumeUsd);
  const top = out.slice(0, TOP);
  _cache.set(dayOffset, { ts: Date.now(), data: top });
  return top;
}
