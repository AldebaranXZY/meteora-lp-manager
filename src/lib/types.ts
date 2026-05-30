// ─── Market & Strategy ───────────────────────────────────────────────────────

export type MarketCondition = "falling" | "consolidating" | "rising";

export type DLMMStrategyType = "BidAsk" | "Spot" | "Curve";

/**
 * single-sol-bid     → solo SOL en bins debajo del precio (bid-side). No necesitás token.
 * single-token-ask   → solo TOKEN en bins arriba del precio (ask-side). Necesitás token.
 * bilateral          → TOKEN + SOL en el rango (requiere ambos o auto-swap).
 */
export type PositionMode = "single-sol-bid" | "single-token-ask" | "bilateral";

export interface DLMMConfig {
  strategy: DLMMStrategyType;
  strategyLabel: string;
  binStep: number;
  minBinId: number;
  maxBinId: number;
  /** Solo para bilateral — % que va al lado del token */
  skew?: { below: number; above: number };
  baseFee: string;
  autoFee: boolean;
}

export interface StrategyConfig {
  label: string;
  icon: string;
  color: string;
  glowColor: string;
  borderColor: string;
  description: string;
  dlmmConfig: DLMMConfig;
  rationale: string[];
}

export type StrategyMap = Record<MarketCondition, StrategyConfig>;

// ─── Token Data (Helius DAS API) ─────────────────────────────────────────────

export interface TokenContent {
  $schema?: string;
  json_uri?: string;
  metadata?: {
    name?: string;
    symbol?: string;
    description?: string;
  };
  links?: {
    image?: string;
  };
  /** Helius DAS a veces expone la imagen acá en vez de en links.image */
  files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
}

export interface TokenAuthority {
  address: string;
  scopes: string[];
}

export interface TokenAsset {
  id: string;
  interface: string;
  content?: TokenContent;
  authorities?: TokenAuthority[];
  ownership?: {
    frozen: boolean;
    delegated: boolean;
    delegate?: string;
    ownership_model: string;
    owner?: string;
  };
  token_info?: {
    symbol?: string;
    decimals?: number;
    token_program?: string;
    price_info?: {
      price_per_token?: number;
      currency?: string;
    };
  };
  supply?: number;
}

// ─── DAMM v2 ──────────────────────────────────────────────────────────────────

/** 0 = Base+Quote · 1 = Quote only · 2 = Quote+Compounding */
export type FeeCollectMode = 0 | 1 | 2;

/** 0 = Fixed · 1 = Time Scheduler · 2 = Market Cap Scheduler */
export type DAMMBaseFeeMode = 0 | 1 | 2;

/** 0 = Linear · 1 = Exponential */
export type SchedulerType = 0 | 1;

export interface DAMMv2Config {
  feeCollectMode: FeeCollectMode;
  compoundingFeePct: number;      // 0–100, solo cuando feeCollectMode=2
  baseFeeMode: DAMMBaseFeeMode;
  schedulerType: SchedulerType;
  initialFeePct: number;          // 50 o 99
  feeTierPct: number;             // 0.25 | 0.3 | 1 | 2 | 4 | 6
  dynamicFee: boolean;
  totalDuration: number;          // segundos
  startNow: boolean;
  customStartTs?: number;         // unix timestamp
}

export const DAMM_FEE_TIER_OPTIONS = [0.25, 0.3, 1, 2, 4, 6] as const;
export const DAMM_DURATION_PRESETS = [
  { label: "2 min",   seconds: 120 },
  { label: "30 min",  seconds: 1800 },
  { label: "120 min", seconds: 7200 },
] as const;

export interface CalculatedPosition {
  /** Cantidad de tokens (count formateado) */
  tokenAmount: string;
  /** USD del lado token */
  tokenAmountUSD: string;
  /** USD del lado SOL */
  quoteAmount: string;
  lowerPrice: string;
  upperPrice: string;
  totalBins: number;
  priceRangePct: string;
  pricePerBin: string;
  mode: PositionMode;
}

// ─── DLMM Pool (from Meteora API) ────────────────────────────────────────────

export interface DLMMPool {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  bin_step: number;
  base_fee_percentage: string;
  current_price: number;
  liquidity: string;
  trade_volume_24h: number;
  fees_24h: number;
  today_fees: number;
  apr: number;
  hide: boolean;
}

// ─── API Responses ───────────────────────────────────────────────────────────

export interface TokenApiResponse {
  asset: TokenAsset;
  price: number | null;
  priceSource: "jupiter" | "dexscreener" | "none";
}

export interface PriceApiResponse {
  price: number | null;
  mint: string;
  source: string;
}

export interface PoolSearchResponse {
  pools: DLMMPool[];
  bestPool: DLMMPool | null;
}

export interface BuildPositionRequest {
  poolAddress: string;
  userPubkey: string;
  positionPubkey: string;
  strategyType: DLMMStrategyType;
  minBinId: number;
  maxBinId: number;
  totalXAmountLamports: string;
  totalYAmountLamports: string;
}

export interface BuildPositionResponse {
  serializedTx: string;
  activeBinId: number;
  activeBinPrice: string;
  lastValidBlockHeight: number;
  blockhash: string;
}

export interface SendPositionRequest {
  signedTx: string;
}

export interface SendPositionResponse {
  txHash: string;
  confirmed: boolean;
}
