import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getConnection } from "./solana";

// ─── Token Balance ────────────────────────────────────────────────────────────

export interface TokenBalance {
  mint: string;
  /** Raw amount in smallest units (lamports-equivalent) as string */
  amountRaw: string;
  /** Human-readable amount */
  uiAmount: number;
  decimals: number;
  /** True if at least one token account exists (even with 0 balance) */
  exists: boolean;
}

/**
 * Devuelve el balance del token (mint) en la wallet (owner).
 * Suma todas las token accounts en caso de haber múltiples para el mismo mint.
 */
export async function getTokenBalance(
  mint: PublicKey | string,
  owner: PublicKey | string
): Promise<TokenBalance> {
  const connection = getConnection();
  const mintPk = typeof mint === "string" ? new PublicKey(mint) : mint;
  const ownerPk = typeof owner === "string" ? new PublicKey(owner) : owner;

  const accounts = await connection.getParsedTokenAccountsByOwner(ownerPk, {
    mint: mintPk,
  });

  if (accounts.value.length === 0) {
    return {
      mint: mintPk.toBase58(),
      amountRaw: "0",
      uiAmount: 0,
      decimals: 0,
      exists: false,
    };
  }

  let totalRaw = BigInt(0);
  let decimals = 0;

  for (const acc of accounts.value) {
    const tokenAmount = acc.account.data.parsed.info.tokenAmount;
    totalRaw += BigInt(tokenAmount.amount);
    decimals = tokenAmount.decimals;
  }

  return {
    mint: mintPk.toBase58(),
    amountRaw: totalRaw.toString(),
    uiAmount: Number(totalRaw) / Math.pow(10, decimals),
    decimals,
    exists: true,
  };
}

// ─── SOL Balance ──────────────────────────────────────────────────────────────

export interface SOLBalance {
  lamports: string;
  sol: number;
}

export async function getSOLBalance(
  owner: PublicKey | string
): Promise<SOLBalance> {
  const connection = getConnection();
  const ownerPk = typeof owner === "string" ? new PublicKey(owner) : owner;
  const lamports = await connection.getBalance(ownerPk);
  return {
    lamports: lamports.toString(),
    sol: lamports / LAMPORTS_PER_SOL,
  };
}
