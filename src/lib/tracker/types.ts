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
