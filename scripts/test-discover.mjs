#!/usr/bin/env node
// Test de integración (vivo) del pipeline discover→analyze:
//   1) discover (Bitquery): top de ayer por volumen
//   2) early buyers (Helius, bonding-curve PDA): analiza el top 3 y exige buyers > 0
//
// Espeja la lógica de src/lib/tracker/{discover,indexer}.ts — si tocás esas
// queries, actualizá acá también. Corre SOLO local (usa tus keys + quota).
// Se saltea (exit 0) si falta alguna key. Forzar push sin correrlo: git push --no-verify.

import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

const PUMP_STR = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP = new PublicKey(PUMP_STR);
const EAP = "https://streaming.bitquery.io/eap";
const TOP_N = 10;       // discover
const ANALYZE_N = 3;    // cuántos del top analizar con Helius
const BUYERS_LIMIT = 100;

function envVal(name) {
  if (process.env[name]) return process.env[name].trim();
  let txt = ""; try { txt = readFileSync(".env.local", "utf8"); } catch { /* no file */ }
  return (txt.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

const BQ = envVal("BITQUERY_API_KEY");
const HK = envVal("HELIUS_API_KEY");
if (!BQ || !HK) {
  console.log("⚠ Falta BITQUERY_API_KEY o HELIUS_API_KEY — test salteado (OK).");
  process.exit(0);
}
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HK}`;

let failures = 0;
const fail = (m) => { console.log(`  ✗ ${m}`); failures++; };

async function bitquery(q) {
  const r = await fetch(EAP, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${BQ}` }, body: JSON.stringify({ query: q }) });
  const j = await r.json(); if (j.errors) throw new Error(`Bitquery: ${JSON.stringify(j.errors).slice(0, 200)}`); return j?.data?.Solana ?? {};
}
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
}

// Early buyers vía bonding-curve PDA (espejo de indexer.ts getEarlyBuyers).
async function earlyBuyers(mint, limit) {
  const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP);
  let before, sigs = [], pages = 0;
  while (pages < 30) {
    const b = await rpc("getSignaturesForAddress", [bc.toBase58(), before ? { limit: 1000, before } : { limit: 1000 }]);
    if (!b?.length) break; for (const s of b) sigs.push(s.signature); pages++;
    if (b.length < 1000) break; before = b[b.length - 1].signature;
  }
  const chrono = sigs.reverse();
  const buyers = new Set();
  for (let i = 0; i < chrono.length && buyers.size < limit; i += 100) {
    const slice = chrono.slice(i, i + 100);
    const er = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HK}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactions: slice }) });
    const parsed = await er.json();
    for (const tx of Array.isArray(parsed) ? parsed : []) {
      const buyer = tx.feePayer; if (!buyer) continue;
      const recv = (tx.tokenTransfers ?? []).find((tt) => tt.mint === mint && tt.toUserAccount === buyer);
      const solIn = (tx.nativeTransfers ?? []).filter((n) => n.fromUserAccount === buyer).reduce((s, n) => s + (n.amount ?? 0), 0);
      if (recv && solIn > 0) buyers.add(buyer);
      if (buyers.size >= limit) break;
    }
  }
  return buyers.size;
}

try {
  // 1) Discover top de ayer (Bitquery).
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(start - 86_400_000).toISOString(), till = new Date(start).toISOString();
  const q = `{ Solana { DEXTradeByTokens(where:{Trade:{Dex:{ProgramAddress:{is:"${PUMP_STR}"}}},Block:{Time:{since:"${since}",till:"${till}"}}}, orderBy:{descendingByField:"v"}, limit:{count:${TOP_N}}) { Trade { Currency { MintAddress Symbol } } v: sum(of: Trade_Side_AmountInUSD) } } }`;
  const top = (await bitquery(q)).DEXTradeByTokens ?? [];
  console.log(`Discover: ${top.length} tokens (top de ayer)`);
  if (top.length === 0) fail("discover devolvió 0 tokens");

  // 2) Analizar el top N con Helius — exigir buyers > 0.
  let zeros = 0;
  for (const t of top.slice(0, ANALYZE_N)) {
    const mint = t?.Trade?.Currency?.MintAddress;
    const sym = t?.Trade?.Currency?.Symbol || mint?.slice(0, 6);
    if (!mint) { fail("token sin mint"); continue; }
    const n = await earlyBuyers(mint, BUYERS_LIMIT);
    console.log(`  ${n > 0 ? "✓" : "✗"} ${sym} — ${n} early buyers`);
    if (n === 0) { zeros++; fail(`${sym} devolvió 0 early buyers (¿se rompió getEarlyBuyers?)`); }
  }

  console.log(`\n${failures === 0 ? "✓ OK" : "✗ FALLÓ"} — discover ${top.length}, analizados ${ANALYZE_N}, ${zeros} en cero, ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error(`✗ Error fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
