// ─── Tracker — tipos compartidos (API ↔ UI) ─────────────────────────────────

export interface TrackedToken {
  mint: string;
  symbol: string | null;
  name: string | null;
  addedAt: number;
  analyzedAt: number | null;
  buyersFetched: number;
  stats: AnalyzeStats | null;   // diagnóstico del último análisis (truncado/migrado/cobertura)
}

export interface EarlyBuyer {
  wallet: string;
  rank: number;
  solIn: number;
  tokensOut: number;
  blockTime: number;
  signature: string;
}

/**
 * Diagnóstico de un análisis de early buyers (ventana de data dura para verificar
 * contra la realidad, no contra hipótesis). `hitPageCap`/`likelyTruncated` exponen
 * el bug histórico de truncado: si el token tiene más firmas que el tope de
 * paginación, los "rank 1..N" NO eran del origen sino de la mitad de la vida.
 */
export interface AnalyzeStats {
  mint: string;
  signaturesScanned: number;   // total de firmas de la bonding curve recorridas
  pagesUsed: number;           // páginas de getSignaturesForAddress
  hitPageCap: boolean;         // se agotó el tope SIN llegar al génesis → truncado
  buyersFound: number;         // compradores únicos detectados
  buyersRequested: number;     // limit pedido
  oldestBlockTime: number;     // blockTime de la firma más vieja vista (supuesto rank 1)
  newestBlockTime: number;     // blockTime de la más nueva
  likelyTruncated: boolean;    // = hitPageCap: el set NO arranca en el génesis real
  likelyMigrated: boolean;     // sin actividad reciente en la curva (migró/murió)
  enhancedTxParsed: number;    // firmas enviadas a la Enhanced API (señal de costo)
  elapsedMs: number;
}

/** Resultado de un análisis: compradores + diagnóstico. */
export interface AnalyzeResult {
  buyers: EarlyBuyer[];
  stats: AnalyzeStats;
}

/** Diagnóstico del recálculo de co-ocurrencia (ventana para verificar que los
 * 'grupo' descansan en evidencia real, no en coincidencia). */
export interface RecomputeStats {
  totalTokens: number;        // tokens analizados (denominador de ubicuidad/lift)
  candidateWallets: number;   // wallets que aparecen en ≥2 tokens
  pairsAboveSupport: number;  // pares con co-ocurrencia significativa
  groupsFound: number;        // clusters coordinados detectados
  largestGroupSize: number;
  medianLift: number;         // lift mediano de los pares retenidos
  elapsedMs: number;
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
  groupId: number | null;          // cluster coordinado al que pertenece (o null)
  cooccurrenceScore: number;       // peso de la arista más fuerte (ranking)
}

/** Resumen de un cluster coordinado para la vista de grupos. */
export interface GroupSummary {
  groupId: number;
  size: number;
  sharedTokens: number;            // proxy de tokens co-comprados (max shared de un par)
  avgEdgeWeight: number;
  cohesion: number;                // densidad interna 0..1
  wallets: string[];
}

/** Detalle de una wallet (drill-down): qué compró y con quién co-ocurre. */
export interface WalletTokenHit {
  mint: string;
  symbol: string | null;
  rank: number;
  solIn: number;
  blockTime: number;
}
export interface CoBuyer {
  wallet: string;
  shared: number;                  // tokens comprados en común
  lift: number;
  weight: number;
}
export interface WalletDetail {
  wallet: string;
  kind: WalletKind;
  tokensCount: number;
  ubiquityRatio: number;
  groupId: number | null;
  tokens: WalletTokenHit[];
  coBuyers: CoBuyer[];
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
