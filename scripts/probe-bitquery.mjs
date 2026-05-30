#!/usr/bin/env node
// Probe aislado de Bitquery: valida auth + endpoint + esquema sin tocar la app.
// Lee BITQUERY_API_KEY de .env.local y NUNCA lo imprime. Solo status y datos públicos.
//
// Modos:
//   node scripts/probe-bitquery.mjs              → últimas compras pump.fun (valida getEarlyBuyers)
//   node scripts/probe-bitquery.mjs <mint>       → primeras compras de un mint
//   node scripts/probe-bitquery.mjs --discover   → top tokens por volumen de ayer (valida discover)

import { readFileSync } from "node:fs";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const ENDPOINT = "https://streaming.bitquery.io/eap";

function readKey() {
  let txt = "";
  try { txt = readFileSync(".env.local", "utf8"); } catch { /* no file */ }
  const m = txt.match(/^\s*BITQUERY_API_KEY\s*=\s*(.+)\s*$/m);
  return (m?.[1] ?? process.env.BITQUERY_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
}

const key = readKey();
if (!key) { console.error("✗ No encontré BITQUERY_API_KEY en .env.local"); process.exit(2); }
console.log(`Key cargada (oculta): ${"*".repeat(8)}${key.slice(-4)}\n`);

async function gql(q) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
  if (json?.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 500)}`);
  return json?.data?.Solana ?? {};
}

function dayWindow(offset) {
  const now = new Date();
  const startToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    since: new Date(startToday - offset * 86400000).toISOString(),
    till: new Date(startToday - (offset - 1) * 86400000).toISOString(),
  };
}

// ─── Modo DISCOVER ────────────────────────────────────────────────────────────
async function discover() {
  const { since, till } = dayWindow(1);
  console.log(`DISCOVER — ventana ayer (UTC): ${since} → ${till}\n`);

  // Fase 1: top tokens por volumen en pump.fun en la ventana.
  const q1 = `{
    Solana {
      DEXTradeByTokens(
        where: { Trade: { Dex: { ProgramAddress: { is: "${PUMP}" } } }, Block: { Time: { since: "${since}", till: "${till}" } } }
        orderBy: { descendingByField: "volumeUsd" }
        limit: { count: 8 }
      ) {
        Trade { Currency { MintAddress Symbol Name } }
        volumeUsd: sum(of: Trade_Side_AmountInUSD)
        trades: count
      }
    }
  }`;
  console.log("Fase 1 — top por volumen…");
  const d1 = await gql(q1);
  const top = d1?.DEXTradeByTokens ?? [];
  console.log(`   ✓ ${top.length} tokens`);
  for (const t of top.slice(0, 5)) {
    console.log(`   ${t?.Trade?.Currency?.Symbol ?? "?"} (${t?.Trade?.Currency?.MintAddress?.slice(0, 6)}…) · vol $${Number(t.volumeUsd).toLocaleString()} · ${t.trades} trades`);
  }
  const mints = top.map((t) => t?.Trade?.Currency?.MintAddress).filter(Boolean);
  if (mints.length === 0) { console.log("   (sin tokens — ¿ventana/field mal?)"); return; }

  // Fase 2: first-trade + max/last price (global) para esos mints.
  const list = mints.map((m) => `"${m}"`).join(", ");
  const q2 = `{
    Solana {
      DEXTradeByTokens(
        where: { Trade: { Currency: { MintAddress: { in: [${list}] } }, Dex: { ProgramAddress: { is: "${PUMP}" } } } }
        limit: { count: 50 }
      ) {
        Trade {
          Currency { MintAddress Symbol }
          maxPriceUsd: PriceInUSD(maximum: Trade_PriceInUSD)
          lastPriceUsd: PriceInUSD(maximum: Block_Time)
        }
        Block { firstTrade: Time(minimum: Block_Time) }
      }
    }
  }`;
  console.log("\nFase 2 — first-trade + precios…");
  const d2 = await gql(q2);
  const rows = d2?.DEXTradeByTokens ?? [];
  console.log(`   ✓ ${rows.length} filas`);
  for (const r of rows.slice(0, 5)) {
    const mcapMax = Number(r?.Trade?.maxPriceUsd) * 1e9;
    const mcapNow = Number(r?.Trade?.lastPriceUsd) * 1e9;
    console.log(`   ${r?.Trade?.Currency?.Symbol ?? "?"} · first=${r?.Block?.firstTrade} · mcapMax≈$${mcapMax.toLocaleString(undefined, { maximumFractionDigits: 0 })} · mcapNow≈$${mcapNow.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  }
  console.log(`\n⇒ Validado. since/till para filtrar "creadas ayer": ${since} → ${till}`);
}

// ─── Modo EARLY BUYERS (default) ──────────────────────────────────────────────
async function earlyBuyers(mint) {
  let target = mint;
  if (!target) {
    const generic = `{ Solana { DEXTrades(limit: {count: 1}, orderBy: {descending: Block_Time}, where: {Instruction: {Program: {Address: {is: "${PUMP}"}}}}) { Trade { Buy { Currency { MintAddress Symbol } } } } } }`;
    const d = await gql(generic);
    target = d?.DEXTrades?.[0]?.Trade?.Buy?.Currency?.MintAddress;
    console.log(`última trade pump.fun: mint=${target}\n`);
  }
  if (!target) { console.error("✗ no pude obtener un mint"); process.exit(1); }
  const q = `{ Solana { DEXTrades(limit: {count: 300}, orderBy: {ascending: Block_Time}, where: {Trade: {Buy: {Currency: {MintAddress: {is: "${target}"}}}}, Instruction: {Program: {Address: {is: "${PUMP}"}}}}) { Transaction { Signature } Trade { Buy { Account { Address } } Sell { Amount } } } } }`;
  const d = await gql(q);
  const trades = d?.DEXTrades ?? [];
  const seen = new Set(trades.map((t) => t?.Trade?.Buy?.Account?.Address).filter(Boolean));
  console.log(`primeras compras de ${target.slice(0, 8)}…: ${trades.length} trades · ${seen.size} compradores únicos`);
}

try {
  if (process.argv.includes("--discover")) await discover();
  else await earlyBuyers(process.argv[2]?.startsWith("--") ? undefined : process.argv[2]);
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
