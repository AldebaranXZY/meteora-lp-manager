import type { DiscoveredToken } from "./types";

// ─── Discover: top memecoins pump.fun (Jupiter Token API V2) ─────────────────
// Antes usaba Bitquery (consumía créditos). Jupiter Token API V2 es GRATIS y sin
// API key vía lite-api.jup.ag (tier keyless), con la misma data y frescura que Pro.
//
// Jupiter da ventanas móviles (no días históricos): por eso los modos son
// "top24h" / "trending" / "recent" en vez de ayer/antes-de-ayer. Filtramos a
// pump.fun por el sufijo "pump" del mint (vanity address de la plataforma).

const JUP = "https://lite-api.jup.ag/tokens/v2";
const CACHE_TTL = 10 * 60_000;

export type DiscoverMode = "top24h" | "trending" | "recent";

interface CacheEntry { ts: number; data: DiscoveredToken[] }
const _cache = new Map<DiscoverMode, CacheEntry>();

interface JupStats { buyVolume?: number; sellVolume?: number }
interface JupToken {
  id?: string; symbol?: string; name?: string;
  mcap?: number; holderCount?: number; organicScore?: number;
  dev?: string; createdAt?: string;
  firstPool?: { createdAt?: string };
  stats24h?: JupStats;
}

function mapToken(t: JupToken): DiscoveredToken {
  const vol = (t.stats24h?.buyVolume ?? 0) + (t.stats24h?.sellVolume ?? 0);
  return {
    mint: t.id ?? "",
    symbol: t.symbol ?? null,
    name: t.name ?? null,
    volumeUsd: vol,
    mcap: t.mcap ?? 0,
    holders: t.holderCount ?? 0,
    organicScore: t.organicScore ?? 0,
    dev: t.dev ?? null,
    createdAt: t.createdAt ?? t.firstPool?.createdAt ?? null,
  };
}

const URLS: Record<DiscoverMode, string> = {
  top24h: `${JUP}/toptraded/24h?limit=100`,
  trending: `${JUP}/toptrending/24h?limit=100`,
  recent: `${JUP}/recent`,
};

/** Top memecoins de pump.fun según el modo. Gratis (keyless), cacheado 10 min. */
export async function getTopTokens(mode: DiscoverMode): Promise<DiscoveredToken[]> {
  const cached = _cache.get(mode);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const res = await fetch(URLS[mode]);
  if (!res.ok) throw new Error(`Jupiter ${res.status}: ${await res.text().catch(() => "")}`);
  const arr = await res.json();

  const out = (Array.isArray(arr) ? (arr as JupToken[]) : [])
    .filter((t) => typeof t.id === "string" && t.id.endsWith("pump")) // pump.fun
    .map(mapToken)
    .sort((a, b) => b.volumeUsd - a.volumeUsd);

  _cache.set(mode, { ts: Date.now(), data: out });
  return out;
}
