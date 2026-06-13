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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Retry con backoff (espeja el helper resiliente de producción: las APIs free
// rate-limitan con 429 → sin esto el test es flaky).
async function withRetry(fn, label, retries = 5) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i === retries) break; await sleep(400 * 2 ** i); }
  }
  throw new Error(`${label}: ${lastErr?.message ?? lastErr}`);
}

async function rpc(method, params) {
  return withRetry(async () => {
    const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!r.ok) throw new Error(`${method} ${r.status}`);
    const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
  }, `rpc ${method}`);
}

// Early buyers vía bonding-curve PDA (espejo de indexer.ts getEarlyBuyers).
// MAX_PAGES alto (200): el corte normal es génesis (batch < 1000). Si se agota el
// tope, reachedGenesis=false → los "early buyers" estarían truncados (bug viejo).
const MAX_PAGES = 200;
async function earlyBuyers(mint, limit) {
  const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP);
  let before, sigs = [], pages = 0, reachedGenesis = false;
  while (pages < MAX_PAGES) {
    const b = await rpc("getSignaturesForAddress", [bc.toBase58(), before ? { limit: 1000, before } : { limit: 1000 }]);
    if (!b?.length) { reachedGenesis = true; break; }
    for (const s of b) sigs.push(s.signature); pages++;
    if (b.length < 1000) { reachedGenesis = true; break; }
    before = b[b.length - 1].signature;
  }
  const chrono = sigs.reverse();
  const buyers = new Set();
  const times = []; // block_time del primer buy de cada wallet, en orden
  for (let i = 0; i < chrono.length && buyers.size < limit; i += 100) {
    const slice = chrono.slice(i, i + 100);
    const parsed = await withRetry(async () => {
      const er = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HK}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactions: slice }) });
      if (!er.ok) throw new Error(`enhanced ${er.status}`);
      return er.json();
    }, "enhanced");
    const bySig = new Map((Array.isArray(parsed) ? parsed : []).map((t) => [t.signature, t]));
    for (const sig of slice) {
      const tx = bySig.get(sig); if (!tx) continue;
      const buyer = tx.feePayer; if (!buyer || buyers.has(buyer)) continue;
      const recv = (tx.tokenTransfers ?? []).find((tt) => tt.mint === mint && tt.toUserAccount === buyer);
      const solIn = (tx.nativeTransfers ?? []).filter((n) => n.fromUserAccount === buyer).reduce((s, n) => s + (n.amount ?? 0), 0);
      if (recv && solIn > 0) { buyers.add(buyer); times.push(tx.timestamp ?? 0); }
      if (buyers.size >= limit) break;
    }
  }
  const chronological = times.every((t, i) => i === 0 || t >= times[i - 1]);
  return { count: buyers.size, sigs: sigs.length, reachedGenesis, chronological };
}

try {
  // 1) Discover (Jupiter, keyless): top memes pump.fun por volumen 24h.
  const res = await fetch(`${JUP}/toptraded/24h?limit=100`);
  if (!res.ok) throw new Error(`Jupiter ${res.status}`);
  const arr = await res.json();
  const pump = (Array.isArray(arr) ? arr : []).filter((t) => typeof t.id === "string" && t.id.endsWith("pump"));
  console.log(`Discover (Jupiter): ${pump.length} memes pump.fun en top traded 24h`);
  if (pump.length === 0) fail("Jupiter no devolvió tokens pump.fun");

  // 2) Analizar el top N (alto volumen = caso representativo, no recién creados).
  //    Exigir buyers > 0 y ranking cronológico; reportar cobertura/truncado.
  let zeros = 0;
  for (const t of pump.slice(0, ANALYZE_N)) {
    const r = await earlyBuyers(t.id, BUYERS_LIMIT);
    const flag = r.reachedGenesis ? "" : " ⚠TRUNCADO";
    console.log(`  ${r.count > 0 ? "✓" : "✗"} ${t.symbol || t.id.slice(0, 6)} — ${r.count} early buyers · ${r.sigs} firmas${flag}`);
    if (r.count === 0) { zeros++; fail(`${t.symbol} devolvió 0 early buyers (¿se rompió getEarlyBuyers?)`); }
    if (!r.chronological) fail(`${t.symbol}: early buyers NO están en orden cronológico (rank roto)`);
    // No falla por truncado (depende del token), pero lo deja VISIBLE en el log.
  }

  console.log(`\n${failures === 0 ? "✓ OK" : "✗ FALLÓ"} — discover ${pump.length}, analizados ${ANALYZE_N}, ${zeros} en cero, ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error(`✗ Error fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
