import { test } from "node:test";
import assert from "node:assert/strict";
import { pumpBuyOf, detectPumpBuys, type HeliusEnhancedTx } from "../src/lib/tracker/pumpfun.ts";

const MINT = "AAApump";
const BUYER = "Buyer1111111111111111111111111111111111111";
const OTHER = "Other2222222222222222222222222222222222222";

// Compra real: el feePayer recibe el token y paga SOL.
function realBuyTx(buyer = BUYER, mint = MINT): HeliusEnhancedTx {
  return {
    signature: "sig-real",
    timestamp: 1_700_000_000,
    source: "PUMP_FUN",
    feePayer: buyer,
    tokenTransfers: [{ toUserAccount: buyer, mint, tokenAmount: 1000 }],
    nativeTransfers: [{ fromUserAccount: buyer, amount: 500_000_000 }], // 0.5 SOL
  };
}

// Airdrop/transfer: el wallet RECIBE el token pero NO paga SOL.
function airdropTx(buyer = BUYER, mint = MINT): HeliusEnhancedTx {
  return {
    signature: "sig-airdrop",
    timestamp: 1_700_000_000,
    source: "PUMP_FUN",
    feePayer: buyer,
    tokenTransfers: [{ toUserAccount: buyer, mint, tokenAmount: 1000 }],
    nativeTransfers: [], // 0 SOL
  };
}

test("pumpBuyOf: compra real → match con solIn/tokensOut", () => {
  const b = pumpBuyOf(realBuyTx(), MINT);
  assert.ok(b);
  assert.equal(b!.wallet, BUYER);
  assert.equal(b!.mint, MINT);
  assert.equal(b!.solIn, 0.5);
  assert.equal(b!.tokensOut, 1000);
});

test("pumpBuyOf: airdrop (solIn=0) → null (descarta el falso positivo)", () => {
  assert.equal(pumpBuyOf(airdropTx(), MINT), null);
});

test("pumpBuyOf: feePayer no recibió el token → null", () => {
  const tx = realBuyTx();
  tx.tokenTransfers = [{ toUserAccount: OTHER, mint: MINT, tokenAmount: 1000 }];
  assert.equal(pumpBuyOf(tx, MINT), null);
});

test("pumpBuyOf: con mint filtrado, otro mint → null", () => {
  assert.equal(pumpBuyOf(realBuyTx(BUYER, "ZZZpump"), MINT), null);
});

test("pumpBuyOf: sin mint, detecta compra de cualquier token", () => {
  const b = pumpBuyOf(realBuyTx(BUYER, "ZZZpump"));
  assert.ok(b);
  assert.equal(b!.mint, "ZZZpump");
});

test("detectPumpBuys: compra real de wallet monitoreada → alerta", () => {
  const out = detectPumpBuys(realBuyTx(), new Set([BUYER]));
  assert.equal(out.length, 1);
  assert.equal(out[0].wallet, BUYER);
  assert.equal(out[0].solIn, 0.5);
});

test("detectPumpBuys: airdrop a wallet monitoreada → SIN alerta (fix)", () => {
  assert.deepEqual(detectPumpBuys(airdropTx(), new Set([BUYER])), []);
});

test("detectPumpBuys: compra real pero wallet NO monitoreada → sin alerta", () => {
  assert.deepEqual(detectPumpBuys(realBuyTx(), new Set([OTHER])), []);
});

test("detectPumpBuys: tx que no toca pump.fun → sin alerta", () => {
  const tx = realBuyTx();
  tx.source = "SYSTEM_PROGRAM";
  tx.instructions = [];
  assert.deepEqual(detectPumpBuys(tx, new Set([BUYER])), []);
});
