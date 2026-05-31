// ─── Tracker — tipos compartidos (API ↔ UI) ─────────────────────────────────

export interface TrackedToken {
  mint: string;
  symbol: string | null;
  name: string | null;
  addedAt: number;
  analyzedAt: number | null;
  buyersFetched: number;
}

export interface EarlyBuyer {
  wallet: string;
  rank: number;
  solIn: number;
  tokensOut: number;
  blockTime: number;
  signature: string;
}

/** group = posible grupo coordinado · universal_sniper = bot que compra todo */
export type WalletKind = "group" | "universal_sniper" | "unknown";

export interface WalletRow {
  wallet: string;
  tokensCount: number;
  ubiquityRatio: number;
  kind: WalletKind;
  firstSeen: number | null;
  isMonitored: boolean;
  isIgnored: boolean;
  note: string | null;
}

export interface DiscoveredToken {
  mint: string;
  symbol: string | null;
  name: string | null;
  volumeUsd: number;        // stats24h: buyVolume + sellVolume
  mcap: number;
  holders: number;
  organicScore: number;     // 0–100, anti wash-trade (Jupiter)
  dev: string | null;       // wallet del creador del token
  createdAt: string | null;
}

/** Enriquecimiento de un token vía DexScreener (momentum + links). */
export interface TokenInfo {
  mint: string;
  mcap: number;
  liquidityUsd: number;
  volume24h: number;
  buys24h: number;
  sells24h: number;
  priceChange24h: number;
  dexes: string[];
  pairCreatedAt: number | null;   // ms epoch del par más viejo
  socials: { type: string; url: string }[];
  websites: { label: string | null; url: string }[];
}

export interface TrackerAlert {
  id: number;
  wallet: string;
  tokenMint: string | null;
  signature: string | null;
  solIn: number | null;
  blockTime: number | null;
  receivedAt: number;
  seen: boolean;
}
