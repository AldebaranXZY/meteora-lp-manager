import type { TokenInfo } from "./types";

// ─── Enriquecimiento de token (DexScreener, gratis keyless) ──────────────────
// Batch lookup de pares por mint. Agrega por token (un token puede tener varios
// pares/DEX). Campos de momentum (mcap/vol/txns/priceChange/dex/edad) vienen
// siempre; socials/websites/liquidity solo si el token los tiene → manejo graceful.

const BASE = "https://api.dexscreener.com/tokens/v1/solana";
const CACHE_TTL = 5 * 60_000;
const BATCH = 30;

interface CacheEntry { ts: number; info: TokenInfo }
const _cache = new Map<string, CacheEntry>();

interface DexPair {
  dexId?: string;
  baseToken?: { address?: string };
  txns?: { h24?: { buys?: number; sells?: number } };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { socials?: { type?: string; url?: string }[]; websites?: { label?: string; url?: string }[] };
}

function aggregate(mint: string, pairs: DexPair[]): TokenInfo {
  const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const sum = (f: (p: DexPair) => number) => pairs.reduce((s, p) => s + (f(p) || 0), 0);
  const created = pairs.map((p) => p.pairCreatedAt).filter((t): t is number => typeof t === "number");
  return {
    mint,
    mcap: best?.marketCap ?? best?.fdv ?? 0,
    liquidityUsd: sum((p) => p.liquidity?.usd ?? 0),
    volume24h: sum((p) => p.volume?.h24 ?? 0),
    buys24h: sum((p) => p.txns?.h24?.buys ?? 0),
    sells24h: sum((p) => p.txns?.h24?.sells ?? 0),
    priceChange24h: best?.priceChange?.h24 ?? 0,
    dexes: [...new Set(pairs.map((p) => p.dexId).filter((d): d is string => !!d))],
    pairCreatedAt: created.length ? Math.min(...created) : null,
    socials: (best?.info?.socials ?? []).filter((s) => s.url).map((s) => ({ type: s.type ?? "link", url: s.url! })),
    websites: (best?.info?.websites ?? []).filter((w) => w.url).map((w) => ({ label: w.label ?? null, url: w.url! })),
  };
}

const EMPTY = (mint: string): TokenInfo => ({
  mint, mcap: 0, liquidityUsd: 0, volume24h: 0, buys24h: 0, sells24h: 0,
  priceChange24h: 0, dexes: [], pairCreatedAt: null, socials: [], websites: [],
});

/** Info de momentum + links por mint. Cache 5 min; chunks de 30; falla suave. */
export async function getTokensInfo(mints: string[]): Promise<Record<string, TokenInfo>> {
  const now = Date.now();
  const out: Record<string, TokenInfo> = {};
  const toFetch: string[] = [];
  for (const m of mints) {
    const c = _cache.get(m);
    if (c && now - c.ts < CACHE_TTL) out[m] = c.info;
    else toFetch.push(m);
  }

  for (let i = 0; i < toFetch.length; i += BATCH) {
    const chunk = toFetch.slice(i, i + BATCH);
    let pairs: DexPair[] = [];
    try {
      const res = await fetch(`${BASE}/${chunk.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) pairs = data;
      }
    } catch { /* falla suave: quedan EMPTY */ }

    const byMint = new Map<string, DexPair[]>();
    for (const p of pairs) {
      const mint = p.baseToken?.address;
      if (!mint) continue;
      const arr = byMint.get(mint);
      if (arr) arr.push(p); else byMint.set(mint, [p]);
    }
    for (const m of chunk) {
      const ps = byMint.get(m);
      const info = ps && ps.length ? aggregate(m, ps) : EMPTY(m);
      out[m] = info;
      _cache.set(m, { ts: now, info });
    }
  }
  return out;
}
