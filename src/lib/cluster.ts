// ─── Cluster Configuration ───────────────────────────────────────────────────
// Todas las decisiones de mainnet vs devnet pasan por acá.
// NEXT_PUBLIC_ permite leerlo tanto en server como en client.

export type SolanaCluster = "mainnet-beta" | "devnet";

export function getCluster(): SolanaCluster {
  return process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet"
    ? "devnet"
    : "mainnet-beta";
}

export const isDevnet = (): boolean => getCluster() === "devnet";
export const isMainnet = (): boolean => !isDevnet();

/** URL de Helius RPC para el cluster actual */
export function getHeliusRpcUrl(): string {
  const key = process.env.HELIUS_API_KEY ?? "";
  return isDevnet()
    ? `https://devnet.helius-rpc.com/?api-key=${key}`
    : `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

/** Etiqueta legible para mostrar en la UI */
export function getClusterLabel(): string {
  return isDevnet() ? "DEVNET" : "MAINNET";
}
