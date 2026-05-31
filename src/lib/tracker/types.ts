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
  volumeUsd: number;
  /** market cap pico del día (maxPrice × supply 1e9) */
  mcapMax: number;
  /** market cap actual (último precio × supply 1e9) */
  mcapNow: number;
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
