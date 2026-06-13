// ─── pump.fun — constantes + detección de compra ────────────────────────────

export const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Forma (parcial) de un tx "enhanced" del webhook de Helius.
interface HeliusTokenTransfer { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }
interface HeliusNativeTransfer { fromUserAccount?: string; toUserAccount?: string; amount?: number }
interface HeliusInstruction { programId?: string; innerInstructions?: HeliusInstruction[] }
export interface HeliusEnhancedTx {
  signature?: string;
  timestamp?: number;
  source?: string;
  type?: string;
  feePayer?: string;
  tokenTransfers?: HeliusTokenTransfer[];
  nativeTransfers?: HeliusNativeTransfer[];
  instructions?: HeliusInstruction[];
}

export interface PumpBuy {
  wallet: string;
  mint: string;
  solIn: number;
  signature: string;
  blockTime: number;
}

/** Match de una compra pump.fun parseada de un tx enhanced. */
export interface PumpBuyMatch {
  wallet: string;
  mint: string;
  solIn: number;
  tokensOut: number;
}

// Piso de SOL para considerar "pagó" (descarta transfers/airdrops sin pago).
// Único punto de verdad para AMBOS paths (indexer offline + webhook en vivo).
export const MIN_SOL_IN = 0;

function involvesPumpFun(tx: HeliusEnhancedTx): boolean {
  if (tx.source === "PUMP_FUN") return true;
  const scan = (ix?: HeliusInstruction[]): boolean =>
    !!ix?.some((i) => i.programId === PUMP_FUN_PROGRAM || scan(i.innerInstructions));
  return scan(tx.instructions);
}

/**
 * Predicado ÚNICO de compra (validado contra datos reales): el `feePayer` RECIBIÓ
 * el token y PAGÓ SOL. Usado por el indexer (offline) y el webhook (en vivo) para
 * que ambos coincidan exactamente — antes divergían y el webhook contaba airdrops.
 *
 * Si se pasa `mint`, exige que sea ese token; si se omite, detecta compra de
 * CUALQUIER mint (el webhook no sabe de antemano qué se compró).
 *
 * Nota: se ancla al `feePayer` (quien inició y pagó la tx). El caso raro de un
 * relayer/bundle que paga por otra wallet queda fuera — no aplica a buys directos
 * de la bonding curve de pump.fun.
 */
export function pumpBuyOf(tx: HeliusEnhancedTx, mint?: string): PumpBuyMatch | null {
  const buyer = tx.feePayer;
  if (!buyer) return null;
  const received = (tx.tokenTransfers ?? []).find(
    (tt) => tt.toUserAccount === buyer && (mint ? tt.mint === mint : !!tt.mint)
  );
  if (!received || !received.mint) return null;
  const solIn = (tx.nativeTransfers ?? [])
    .filter((n) => n.fromUserAccount === buyer)
    .reduce((s, n) => s + (n.amount ?? 0), 0) / 1e9;
  if (solIn <= MIN_SOL_IN) return null; // pagó SOL → compra real (descarta transfers/airdrops)
  return { wallet: buyer, mint: received.mint, solIn, tokensOut: received.tokenAmount ?? 0 };
}

/** Match de una venta pump.fun: el `feePayer` ENVIÓ el token y RECIBIÓ SOL. */
export interface PumpSellMatch {
  wallet: string;
  mint: string;
  solOut: number;   // SOL recibido por la venta
  tokensIn: number; // tokens que salieron de la wallet (vendidos)
}

/**
 * Predicado de venta, espejo de `pumpBuyOf`: el `feePayer` mandó el token a la
 * curva y recibió SOL. Junto con la compra permite el ledger completo (PnL real).
 */
export function pumpSellOf(tx: HeliusEnhancedTx, mint?: string): PumpSellMatch | null {
  const seller = tx.feePayer;
  if (!seller) return null;
  const sent = (tx.tokenTransfers ?? []).find(
    (tt) => tt.fromUserAccount === seller && (mint ? tt.mint === mint : !!tt.mint)
  );
  if (!sent || !sent.mint) return null;
  const solOut = (tx.nativeTransfers ?? [])
    .filter((n) => n.toUserAccount === seller)
    .reduce((s, n) => s + (n.amount ?? 0), 0) / 1e9;
  if (solOut <= MIN_SOL_IN) return null; // recibió SOL → venta real
  return { wallet: seller, mint: sent.mint, solOut, tokensIn: sent.tokenAmount ?? 0 };
}

/** Trade pump.fun (compra o venta) del feePayer — reusa los predicados únicos. */
export interface PumpTrade {
  wallet: string;
  mint: string;
  side: "buy" | "sell";
  sol: number;     // SOL gastado (buy) o recibido (sell)
  tokens: number;  // tokens recibidos (buy) o vendidos (sell)
}

export function pumpTradeOf(tx: HeliusEnhancedTx, mint?: string): PumpTrade | null {
  const b = pumpBuyOf(tx, mint);
  if (b) return { wallet: b.wallet, mint: b.mint, side: "buy", sol: b.solIn, tokens: b.tokensOut };
  const s = pumpSellOf(tx, mint);
  if (s) return { wallet: s.wallet, mint: s.mint, side: "sell", sol: s.solOut, tokens: s.tokensIn };
  return null;
}

/**
 * Compra pump.fun de una wallet MONITOREADA, para el receptor del webhook.
 * Gate de pertenencia al programa (el webhook ve txs arbitrarias) + el mismo
 * predicado `pumpBuyOf` que el indexer → un airdrop (solIn=0) ya NO genera alerta.
 */
export function detectPumpBuys(tx: HeliusEnhancedTx, monitored: Set<string>): PumpBuy[] {
  if (!involvesPumpFun(tx)) return [];
  const b = pumpBuyOf(tx);
  if (!b || !monitored.has(b.wallet)) return [];
  return [{ wallet: b.wallet, mint: b.mint, solIn: b.solIn, signature: tx.signature ?? "", blockTime: tx.timestamp ?? 0 }];
}
