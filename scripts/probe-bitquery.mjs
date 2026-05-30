#!/usr/bin/env node
// Probe aislado de Bitquery: valida auth + endpoint + esquema sin tocar la app.
// Lee BITQUERY_API_KEY de .env.local y NUNCA lo imprime. Solo status y datos públicos.
// Uso: node scripts/probe-bitquery.mjs [mintOpcional]

import { readFileSync } from "node:fs";

function readKey() {
  let txt = "";
  try { txt = readFileSync(".env.local", "utf8"); } catch { /* no file */ }
  const m = txt.match(/^\s*BITQUERY_API_KEY\s*=\s*(.+)\s*$/m);
  const fromEnv = process.env.BITQUERY_API_KEY;
  const key = (m?.[1] ?? fromEnv ?? "").trim().replace(/^["']|["']$/g, "");
  return key;
}

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const mint = process.argv[2];

const query = mint
  ? `{ Solana { DEXTrades(limit: {count: 5}, orderBy: {ascending: Block_Time}, where: {Trade: {Buy: {Currency: {MintAddress: {is: "${mint}"}}}}, Instruction: {Program: {Address: {is: "${PUMP}"}}}}) { Block { Time } Transaction { Signature } Trade { Buy { Account { Address } Amount } Sell { Amount } } } } }`
  : `{ Solana { DEXTrades(limit: {count: 3}, orderBy: {descending: Block_Time}, where: {Instruction: {Program: {Address: {is: "${PUMP}"}}}}) { Block { Time } Transaction { Signature } Trade { Buy { Account { Address } Amount Currency { MintAddress Symbol } } Sell { Amount } } } } }`;

const key = readKey();
if (!key) { console.error("✗ No encontré BITQUERY_API_KEY en .env.local"); process.exit(2); }
console.log(`Key cargada (oculta): ${"*".repeat(8)}${key.slice(-4)}  ·  modo: ${mint ? "mint " + mint.slice(0, 6) + "…" : "últimas trades pump.fun"}\n`);

const ENDPOINT = "https://streaming.bitquery.io/eap";

async function gql(q) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  if (json?.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json?.data?.Solana?.DEXTrades ?? [];
}

try {
  // Fase 1: conseguir un mint real (o usar el pasado por arg).
  let target = mint;
  if (!target) {
    const recent = await gql(query);
    target = recent?.[0]?.Trade?.Buy?.Currency?.MintAddress;
    console.log(`Fase 1 — última trade pump.fun: mint=${target} (symbol ${recent?.[0]?.Trade?.Buy?.Currency?.Symbol ?? "?"})\n`);
  }
  if (!target) { console.error("✗ no pude obtener un mint"); process.exit(1); }

  // Fase 2: la query EXACTA del indexer (primeras compras del mint, asc por tiempo).
  const earlyQ = `{ Solana { DEXTrades(limit: {count: 300}, orderBy: {ascending: Block_Time}, where: {Trade: {Buy: {Currency: {MintAddress: {is: "${target}"}}}}, Instruction: {Program: {Address: {is: "${PUMP}"}}}}) { Block { Time } Transaction { Signature } Trade { Buy { Account { Address } Amount } Sell { Amount } } } } }`;
  const trades = await gql(earlyQ);

  const seen = new Set();
  for (const t of trades) { const w = t?.Trade?.Buy?.Account?.Address; if (w) seen.add(w); }

  console.log(`Fase 2 — primeras compras de ${target.slice(0, 8)}…`);
  console.log(`   ✓ ${trades.length} trades · ${seen.size} compradores únicos`);
  const f = trades[0];
  console.log(`   primer comprador → ${f?.Trade?.Buy?.Account?.Address?.slice(0, 8)}… ` +
    `· ${f?.Trade?.Sell?.Amount} SOL · ${f?.Block?.Time}`);
  console.log(`\n⇒ indexer.ts está correcto. Mint de prueba para la app: ${target}`);
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
