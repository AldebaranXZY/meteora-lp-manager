// ─── Parámetros tuneables del tracker ────────────────────────────────────────
// Centralizados acá (antes hardcodeados en cada módulo). Defaults conservadores;
// tunear con datos reales. Heurísticas aproximadas — ver cooccurrence.ts/coalgo.ts.

// ── Indexer (early buyers on-chain) ──
export const MAX_SIGNATURE_PAGES = 200;   // 200k firmas; el corte NORMAL es el génesis (batch < 1000)
export const ENHANCED_BATCH = 100;        // máx firmas por request de la Enhanced API de Helius
export const ENHANCED_CONCURRENCY = 4;    // batches enhanced en paralelo por ola (acota over-fetch a C-1)
export const MIGRATION_STALE_SEC = 3600;  // sin actividad en la curva > 1h → probable migrado/muerto

// ── Clasificación de ubicuidad (bot que compra todo) ──
export const UNIVERSAL_RATIO = 0.8;       // aparece en ≥80% de los tokens analizados
export const UNIVERSAL_MIN_TOKENS = 4;    // recién con ≥4 tokens tiene sentido juzgar ubicuidad

// ── Co-ocurrencia pairwise + clustering ──
export const MIN_SUPPORT_TOKENS = 5;      // mínimo de tokens analizados para etiquetar grupos (significancia)
export const K_PAIR = 50;                 // solo los primeros K buyers por token entran a los pares
export const MIN_SHARED = 2;              // un par necesita compartir ≥2 tokens para registrarse
export const EDGE_MIN_WEIGHT = 2;         // peso mínimo de arista para entrar al grafo de clustering
export const MIN_LIFT = 3;                // lift (observado/esperado bajo independencia) mínimo para coordinación
export const MIN_GROUP_DENSITY = 0.2;     // densidad interna mínima de un cluster (descarta cadenas sueltas)
export const TIMING_RANK_WEIGHT = 1;      // peso del bonus por cercanía de rank en la cola de compra
export const TIMING_TIME_WEIGHT = 1;      // peso del bonus por cercanía temporal (segundos)

// ── Outcome de token (ganó / rugueó) para win-rate ──
// pump.fun gradúa (migra a un AMM real) cerca de ~$69k mcap → migración = winner.
export const WINNER_MIN_MCAP_USD = 60_000;  // mcap actual alto que cuenta como ganador (aunque no se vea migración)
export const RUG_MAX_LIQ_USD = 1_000;       // liquidez por debajo de esto (sin migrar) = muerto
export const RUG_MAX_MCAP_USD = 15_000;     // mcap por debajo de esto (+ poca liq) = rug

// ── Alerts (retención) ──
export const ALERTS_RETENTION_DAYS = 30;  // se limpian alertas más viejas que esto
export const ALERTS_MAX_ROWS = 5000;      // tope duro de filas de alertas
