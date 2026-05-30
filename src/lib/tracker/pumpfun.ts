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

function involvesPumpFun(tx: HeliusEnhancedTx): boolean {
  if (tx.source === "PUMP_FUN") return true;
  const scan = (ix?: HeliusInstruction[]): boolean =>
    !!ix?.some((i) => i.programId === PUMP_FUN_PROGRAM || scan(i.innerInstructions));
  return scan(tx.instructions);
}

/**
 * Heurística: una wallet monitoreada "compró" si recibió tokens (tokenTransfer.to)
 * en un tx que toca el programa de pump.fun, y gastó SOL en esa misma tx.
 */
export function detectPumpBuys(tx: HeliusEnhancedTx, monitored: Set<string>): PumpBuy[] {
  if (!involvesPumpFun(tx)) return [];
  const signature = tx.signature ?? "";
  const blockTime = tx.timestamp ?? 0;
  const out: PumpBuy[] = [];
  const seen = new Set<string>();

  for (const tt of tx.tokenTransfers ?? []) {
    const wallet = tt.toUserAccount;
    if (!wallet || !tt.mint || !monitored.has(wallet) || seen.has(wallet)) continue;
    seen.add(wallet);
    const solIn = (tx.nativeTransfers ?? [])
      .filter((n) => n.fromUserAccount === wallet)
      .reduce((s, n) => s + (n.amount ?? 0), 0) / 1e9;
    out.push({ wallet, mint: tt.mint, solIn, signature, blockTime });
  }
  return out;
}
