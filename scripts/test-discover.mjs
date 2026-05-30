#!/usr/bin/env node
// Test de integración (vivo): toma el top 20 de ayer (discover) y "analiza" cada
// uno (early buyers), verificando que el pipeline anda contra datos reales.
//
// Se SALTEA (exit 0) si no hay BITQUERY_API_KEY → seguro para CI sin secret.
// Lee la key de process.env (CI) o de .env.local (local). Nunca la imprime.
//
// Uso: npm run test:discover

import { readFileSync } from "node:fs";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const ENDPOINT = "https://streaming.bitquery.io/eap";
const N = 20;

function readKey() {
  if (process.env.BITQUERY_API_KEY) return process.env.BITQUERY_API_KEY.trim();
  let txt = "";
  try { txt = readFileSync(".env.local", "utf8"); } catch { /* sin archivo */ }
  const m = txt.match(/^\s*BITQUERY_API_KEY\s*=\s*(.+)\s*$/m);
  return (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

const key = readKey();
if (!key) {
  console.log("⚠ BITQUERY_API_KEY ausente — test de integración salteado (OK para CI sin secret).");
  process.exit(0);
}

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
  return json?.data?.Solana ?? {};
}

function yesterdayWindow() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { since: new Date(start - 86_400_000).toISOString(), till: new Date(start).toISOString() };
}

let failures = 0;
const fail = (msg) => { console.log(`  ✗ ${msg}`); failures++; };

try {
  // 1) Top N por volumen de ayer (fase 1 del discover).
  const { since, till } = yesterdayWindow();
  const q1 = `{ Solana { DEXTradeByTokens(
    where: { Trade: { Dex: { ProgramAddress: { is: "${PUMP}" } } }, Block: { Time: { since: "${since}", till: "${till}" } } }
    orderBy: { descendingByField: "volumeUsd" } limit: { count: ${N} }
  ) { Trade { Currency { MintAddress Symbol } } volumeUsd: sum(of: Trade_Side_AmountInUSD) } } }`;
  const top = (await gql(q1)).DEXTradeByTokens ?? [];
  console.log(`Top ${top.length} de ayer (UTC ${since} → ${till}):`);
  if (top.length === 0) fail("discover devolvió 0 tokens");

  // 2) Analizar cada uno (early buyers) — el pipeline real.
  let analyzed = 0, totalBuyers = 0, zeros = 0;
  for (const t of top) {
    const mint = t?.Trade?.Currency?.MintAddress;
    const sym = t?.Trade?.Currency?.Symbol || mint?.slice(0, 6);
    if (!mint) { fail("token sin mint"); continue; }
    try {
      const q2 = `{ Solana { DEXTrades(
        limit: { count: 300 } orderBy: { ascending: Block_Time }
        where: { Trade: { Buy: { Currency: { MintAddress: { is: "${mint}" } } } }, Instruction: { Program: { Address: { is: "${PUMP}" } } } }
      ) { Trade { Buy { Account { Address } } } } } }`;
      const trades = (await gql(q2)).DEXTrades ?? [];
      const buyers = new Set(trades.map((x) => x?.Trade?.Buy?.Account?.Address).filter(Boolean));
      analyzed++; totalBuyers += buyers.size;
      if (buyers.size === 0) zeros++;
      console.log(`  ✓ ${sym} — ${buyers.size} compradores`);
    } catch (e) {
      fail(`analyze falló para ${sym}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 3) Asserts de sanidad (el test guarda la ESTRUCTURA del pipeline).
  if (top.length > 0 && analyzed !== top.length) fail(`solo se analizaron ${analyzed}/${top.length} (query error en alguno)`);
  if (top.length > 0 && totalBuyers === 0) fail("0 compradores en TODOS — pipeline roto");
  if (top.length > 0 && zeros === top.length) fail("todos los tokens dieron 0 compradores");

  // Aviso de calidad de datos (no rompe): getEarlyBuyers pierde tokens migrados.
  if (top.length > 0 && zeros / top.length > 0.3) {
    console.log(`\n⚠ ADVERTENCIA: ${zeros}/${top.length} tokens dieron 0 compradores.`);
    console.log("  getEarlyBuyers no captura tokens que migraron (Bitquery registra esas");
    console.log("  compras del lado opuesto). Ver TODO en src/lib/tracker/indexer.ts.");
  }

  console.log(`\n${failures === 0 ? "✓ OK" : "✗ FALLÓ"} — ${analyzed} tokens, ${totalBuyers} compradores, ${zeros} en cero, ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error(`✗ Error fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
