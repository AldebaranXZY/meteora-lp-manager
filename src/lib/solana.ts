import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getHeliusRpcUrl } from "./cluster";

// ─── Connection (cluster-aware via Helius) ───────────────────────────────────
// La URL (mainnet/devnet) la decide cluster.ts. getHeliusRpcUrl vive ahí — NO
// duplicar acá (antes había una copia hardcodeada a mainnet que ignoraba el cluster).

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (_connection) return _connection;

  if (!process.env.HELIUS_API_KEY) {
    throw new Error("HELIUS_API_KEY no configurada en .env.local");
  }

  _connection = new Connection(getHeliusRpcUrl(), {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
  return _connection;
}

// ─── Wallet Keypair (server-side only) ───────────────────────────────────────
// Soporta JSON array [1,2,...,64] (Solana CLI) o base58 (Phantom export)

export function getWalletKeypair(): Keypair {
  const pk = process.env.WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("WALLET_PRIVATE_KEY no configurada en .env.local");

  const trimmed = pk.trim();

  if (trimmed.startsWith("[")) {
    try {
      const bytes: number[] = JSON.parse(trimmed);
      if (bytes.length !== 64) throw new Error(`Esperaba 64 bytes, tiene ${bytes.length}`);
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    } catch (e: unknown) {
      throw new Error(`WALLET_PRIVATE_KEY JSON inválido: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length !== 64) throw new Error(`Decodifica a ${decoded.length} bytes — ¿usaste la public key?`);
    return Keypair.fromSecretKey(decoded);
  } catch (e: unknown) {
    throw new Error(`WALLET_PRIVATE_KEY inválida: ${e instanceof Error ? e.message : e}`);
  }
}
