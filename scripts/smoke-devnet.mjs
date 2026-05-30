#!/usr/bin/env node
// ─── Smoke test (devnet) ─────────────────────────────────────────────────────
// Ejerce el código REAL de la app vía HTTP contra el dev server, validando el
// wiring devnet sin mover fondos reales.
//
// Prerrequisitos:
//   1. .env.local con NEXT_PUBLIC_SOLANA_CLUSTER=devnet (+ HELIUS_API_KEY,
//      JUPITER_API_KEY, WALLET_PRIVATE_KEY, NEXT_PUBLIC_WALLET_ADDRESS).
//   2. En otra terminal: `npm run dev`.
//   3. Acá: `npm run smoke:devnet`  (o con faucet: `npm run smoke:devnet -- --airdrop`)
//
// Qué valida: conexión RPC cluster-aware, carga de la wallet, balance on-chain,
// precio (Jupiter) y, opcional, el faucet de devnet.
//
// Qué NO valida: crear pool / abrir posición / swap. Esas usan las APIs hosteadas
// de Meteora/Jupiter, que son mainnet-only → no son testeables en devnet por las
// APIs externas, no por el código de la app. Esos flujos se prueban en mainnet
// con montos chicos (decisión del usuario).

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.API_SECRET;
const TOKEN_MINT = process.env.SMOKE_TOKEN_MINT; // mint devnet opcional para probar /api/token
const doAirdrop = process.argv.includes("--airdrop");
const SOL_MINT = "So11111111111111111111111111111111111111112";

let pass = 0;
let fail = 0;
const ok = (name, detail) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? " — " + detail : ""}`); };
const bad = (name, detail) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? " — " + detail : ""}`); };
const skip = (msg) => console.log(`  \x1b[90m·\x1b[0m ${msg}`);

async function req(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (SECRET) headers["Authorization"] = `Bearer ${SECRET}`; // inofensivo en rutas sin auth
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { /* sin body json */ }
  return { res, body };
}

console.log(`\nSmoke test devnet → ${BASE}\n`);

// 0. ¿Server arriba?
try {
  await fetch(BASE, { method: "HEAD" });
} catch {
  console.error(`\x1b[31mNo pude conectar a ${BASE}.\x1b[0m ¿Corriste 'npm run dev' en otra terminal?\n`);
  process.exit(2);
}

// 1. Balance — valida conexión RPC cluster-aware + carga de la wallet keypair.
{
  const { res, body } = await req("/api/balance");
  if (res.ok && body?.wallet && typeof body?.sol?.sol === "number") {
    ok("/api/balance", `wallet ${body.wallet.slice(0, 4)}…${body.wallet.slice(-4)} · ${body.sol.sol.toFixed(4)} SOL`);
    if (body.sol.sol < 0.05 && !doAirdrop) skip("balance bajo: corré con --airdrop para pedir SOL del faucet");
  } else {
    bad("/api/balance", body?.error ?? `HTTP ${res.status}`);
  }
}

// 2. Precio SOL — valida Jupiter (con fallback DexScreener).
{
  const { res, body } = await req(`/api/price?ca=${SOL_MINT}`);
  if (res.ok && typeof body?.price === "number" && body.price > 0) {
    ok("/api/price (SOL)", `$${body.price.toFixed(2)} via ${body.source}`);
  } else {
    bad("/api/price (SOL)", body?.error ?? `HTTP ${res.status}`);
  }
}

// 3. Token metadata (opcional) — valida /api/token (Helius DAS, cluster-aware).
if (TOKEN_MINT) {
  const { res, body } = await req(`/api/token?ca=${TOKEN_MINT}`);
  if (res.ok && body?.asset?.id) {
    const sym = body.asset.token_info?.symbol ?? body.asset.content?.metadata?.symbol ?? "?";
    ok("/api/token", `${sym} · precio ${body.price ?? "—"} (${body.priceSource})`);
  } else {
    bad("/api/token", body?.error ?? `HTTP ${res.status}`);
  }
} else {
  skip("/api/token omitido (seteá SMOKE_TOKEN_MINT=<mint devnet> para probarlo)");
}

// 4. Airdrop (opcional) — valida el path de escritura en devnet (gated por isDevnet).
if (doAirdrop) {
  const { res, body } = await req("/api/airdrop", { method: "POST" });
  if (res.ok && body?.signature) {
    ok("/api/airdrop", `+2 SOL · balance ${body.newBalanceSOL?.toFixed?.(4) ?? "?"} · ${body.signature.slice(0, 8)}…`);
  } else if (res.status === 403) {
    bad("/api/airdrop", "403 — el cluster NO es devnet (seteá NEXT_PUBLIC_SOLANA_CLUSTER=devnet y reiniciá el dev server)");
  } else {
    bad("/api/airdrop", body?.error ?? `HTTP ${res.status}`);
  }
} else {
  skip("/api/airdrop omitido (pasá --airdrop para pedir 2 SOL del faucet)");
}

console.log(`\n${fail === 0 ? "\x1b[32m✓" : "\x1b[31m✗"} ${pass} ok, ${fail} fail\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
