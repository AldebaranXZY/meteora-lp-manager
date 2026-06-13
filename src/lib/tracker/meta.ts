import { getHeliusRpcUrl } from "../cluster";
import { fetchResilient } from "./http";

// ─── Metadata del token (Helius DAS getAsset) ────────────────────────────────
// Reusa el RPC cluster-aware. Best-effort: si falla, devuelve nulls.

export async function getTokenMeta(mint: string): Promise<{ symbol: string | null; name: string | null }> {
  try {
    const res = await fetchResilient(getHeliusRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "meta", method: "getAsset", params: { id: mint } }),
      label: "Helius getAsset",
    });
    if (!res.ok) return { symbol: null, name: null };
    const data = await res.json();
    const a = data?.result;
    return {
      symbol: a?.token_info?.symbol ?? a?.content?.metadata?.symbol ?? null,
      name: a?.content?.metadata?.name ?? null,
    };
  } catch {
    return { symbol: null, name: null };
  }
}
