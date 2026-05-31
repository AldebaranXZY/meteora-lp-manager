#!/usr/bin/env node
// Test de integración (vivo) del pipeline discover→analyze:
//   1) discover (Jupiter, GRATIS keyless): top memes pump.fun por volumen 24h
//   2) early buyers (Helius, bonding-curve PDA): analiza el top 3 y exige buyers > 0
//
// Espeja la lógica de src/lib/tracker/{discover,indexer}.ts. Corre SOLO local
// (Helius usa quota). Se saltea (exit 0) si falta HELIUS_API_KEY.
// Forzar push sin correrlo: git push --no-verify.

import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const JUP = "https://lite-api.jup.ag/tokens/v2";
const ANALYZE_N = 3;
const BUYERS_LIMIT = 100;

function envVal(name) {
  if (process.env[name]) return process.env[name].trim();
  let txt = ""; try { txt = readFileSync(".env.local", "utf8"); } catch { /* no file */ }
  return (txt.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

const HK = envVal("HELIUS_API_KEY");
if (!HK) { console.log("⚠ Falta HELIUS_API_KEY — test salteado (OK)."); process.exit(0); }
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HK}`;

let failures = 0;
const fail = (m) => { console.log(`  ✗ ${m}`); failures++; };

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
  // 1) Discover (Jupiter, keyless): top memes pump.fun por volumen 24h.
  const res = await fetch(`${JUP}/toptraded/24h?limit=100`);
  if (!res.ok) throw new Error(`Jupiter ${res.status}`);
  const arr = await res.json();
  const pump = (Array.isArray(arr) ? arr : []).filter((t) => typeof t.id === "string" && t.id.endsWith("pump"));
  console.log(`Discover (Jupiter): ${pump.length} memes pump.fun en top traded 24h`);
  if (pump.length === 0) fail("Jupiter no devolvió tokens pump.fun");

  // 2) Analizar el top N con Helius — exigir buyers > 0.
  let zeros = 0;
  for (const t of pump.slice(0, ANALYZE_N)) {
    const n = await earlyBuyers(t.id, BUYERS_LIMIT);
    console.log(`  ${n > 0 ? "✓" : "✗"} ${t.symbol || t.id.slice(0, 6)} — ${n} early buyers`);
    if (n === 0) { zeros++; fail(`${t.symbol} devolvió 0 early buyers (¿se rompió getEarlyBuyers?)`); }
  }

  console.log(`\n${failures === 0 ? "✓ OK" : "✗ FALLÓ"} — discover ${pump.length}, analizados ${ANALYZE_N}, ${zeros} en cero, ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error(`✗ Error fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
