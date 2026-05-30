const JUPITER_BASE = "https://api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";

function getApiKey(): string {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new Error("JUPITER_API_KEY no configurada en .env.local");
  return key;
}

function authHeaders(): HeadersInit {
  return { "x-api-key": getApiKey(), "Content-Type": "application/json" };
}

// ─── Price (cache 15s) ────────────────────────────────────────────────────────

interface PriceCacheEntry { price: number; ts: number }
const _priceCache = new Map<string, PriceCacheEntry>();
const PRICE_TTL = 15_000;

export async function getJupiterPrice(mint: string): Promise<number | null> {
  const cached = _priceCache.get(mint);
  if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.price;

  try {
    const res = await fetch(`${JUPITER_BASE}/price/v3?ids=${mint}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data?.[mint] ?? data?.data?.[mint];
    const priceRaw = entry?.usdPrice ?? entry?.price;
    const price = typeof priceRaw === "number" ? priceRaw : parseFloat(priceRaw);
    if (price > 0) { _priceCache.set(mint, { price, ts: Date.now() }); return price; }
    return null;
  } catch { return null; }
}

export async function getSOLPrice(): Promise<number> {
  const price = await getJupiterPrice(SOL_MINT);
  if (price) return price;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`);
    const data = await res.json();
    const p = parseFloat(data?.pairs?.[0]?.priceUsd);
    if (p > 0) return p;
  } catch { /* fallback */ }
  return 170;
}

// ─── Swap Quote ───────────────────────────────────────────────────────────────

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: { ammKey: string; label?: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string; feeAmount: string; feeMint: string };
    percent: number;
  }>;
}

export interface SwapQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string | bigint | number;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
}

export async function getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
  const { inputMint, outputMint, amount, slippageBps = 100, swapMode = "ExactIn" } = params;
  const url = new URL(`${JUPITER_BASE}/swap/v1/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount.toString());
  url.searchParams.set("slippageBps", slippageBps.toString());
  url.searchParams.set("swapMode", swapMode);
  url.searchParams.set("restrictIntermediateTokens", "true");

  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`Jupiter quote ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// ─── Swap Transaction ─────────────────────────────────────────────────────────

export interface BuildSwapTxResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

export async function buildSwapTransaction(params: {
  quote: SwapQuote;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
}): Promise<BuildSwapTxResponse> {
  const { quote, userPublicKey, wrapAndUnwrapSol = true } = params;
  const res = await fetch(`${JUPITER_BASE}/swap/v1/swap`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol,
      computeUnitPriceMicroLamports: "auto",
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap build ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}
