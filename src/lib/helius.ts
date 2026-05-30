import {
  Transaction,
  VersionedTransaction,
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getConnection } from "./solana";
import { getHeliusRpcUrl } from "./cluster";

// ─── Priority Fee ─────────────────────────────────────────────────────────────

async function getPriorityFeeEstimate(serializedTxBase64: string): Promise<number> {
  try {
    const res = await fetch(getHeliusRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "1",
        method: "getPriorityFeeEstimate",
        params: [{ transaction: serializedTxBase64, options: { priorityLevel: "High", evaluateEmptySlotAsZero: true } }],
      }),
    });
    const data = await res.json();
    return Math.ceil(data?.result?.priorityFeeEstimate ?? 10_000);
  } catch {
    return 10_000;
  }
}

// ─── Send via Helius (con rebate-address para capturar MEV) ──────────────────

async function sendWithRebate(signedTx: Buffer, rebateAddress: string): Promise<string> {
  const url = `${getHeliusRpcUrl()}&rebate-address=${rebateAddress}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1",
      method: "sendTransaction",
      params: [
        signedTx.toString("base64"),
        { encoding: "base64", skipPreflight: true, preflightCommitment: "processed" },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Send error: ${data.error.message ?? JSON.stringify(data.error)}`);
  return data.result;
}

// ─── Submit Legacy Transaction ────────────────────────────────────────────────

export interface SubmitResult {
  txHash: string;
  priorityFeeMicroLamports: number;
  computeUnits: number;
  rebateAddress: string;
}

export async function submitSmartTransaction(
  tx: Transaction,
  signers: Keypair[],
  options: { rebateAddress?: string } = {}
): Promise<SubmitResult> {
  const connection = getConnection();
  const payer = signers[0].publicKey;
  const rebateAddress = options.rebateAddress ?? process.env.REBATE_ADDRESS ?? payer.toBase58();
  new PublicKey(rebateAddress);

  // 1. Blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;

  // 2. Simular para CUs
  let computeUnits = 400_000;
  try {
    const simTx = new Transaction();
    simTx.add(...tx.instructions);
    simTx.feePayer = payer;
    simTx.recentBlockhash = blockhash;
    simTx.sign(...signers);
    const sim = await connection.simulateTransaction(simTx);
    if (sim.value.err) console.warn("[helius] sim error:", sim.value.err);
    if (sim.value.unitsConsumed) computeUnits = Math.ceil(sim.value.unitsConsumed * 1.15);
  } catch (e) {
    console.warn("[helius] sim falló, default 400k CUs:", e);
  }

  // 3. Priority fee
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const priorityFee = await getPriorityFeeEstimate(serialized);

  // 4. Reconstruir con compute budget
  const optimizedTx = new Transaction();
  optimizedTx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    ...tx.instructions
  );
  optimizedTx.feePayer = payer;
  optimizedTx.recentBlockhash = blockhash;
  optimizedTx.sign(...signers);

  // 5. Enviar + confirmar
  const txHash = await sendWithRebate(optimizedTx.serialize(), rebateAddress);
  const conf = await connection.confirmTransaction(
    { signature: txHash, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (conf.value.err) throw new Error(`TX fallida: ${JSON.stringify(conf.value.err)} — ${txHash}`);

  return { txHash, priorityFeeMicroLamports: priorityFee, computeUnits, rebateAddress };
}

// ─── Submit Versioned Transaction (Jupiter swaps) ────────────────────────────

export async function submitVersionedTransaction(
  tx: VersionedTransaction,
  signers: Keypair[],
  options: { rebateAddress?: string; lastValidBlockHeight?: number } = {}
): Promise<SubmitResult> {
  const connection = getConnection();
  const payer = signers[0].publicKey;
  const rebateAddress = options.rebateAddress ?? process.env.REBATE_ADDRESS ?? payer.toBase58();

  tx.sign(signers);

  const txHash = await sendWithRebate(Buffer.from(tx.serialize()), rebateAddress);
  const { blockhash, lastValidBlockHeight: freshHeight } = await connection.getLatestBlockhash("confirmed");
  const conf = await connection.confirmTransaction(
    { signature: txHash, blockhash, lastValidBlockHeight: options.lastValidBlockHeight ?? freshHeight },
    "confirmed"
  );
  if (conf.value.err) throw new Error(`TX fallida: ${JSON.stringify(conf.value.err)} — ${txHash}`);

  return { txHash, priorityFeeMicroLamports: 0, computeUnits: 0, rebateAddress };
}
