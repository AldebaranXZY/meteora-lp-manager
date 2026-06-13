import { test } from "node:test";
import assert from "node:assert/strict";
import { pumpSellOf, pumpTradeOf, type HeliusEnhancedTx } from "../src/lib/tracker/pumpfun.ts";
import { computeRealizedPnL } from "../src/lib/tracker/coalgo.ts";

const MINT = "AAApump";
const W = "Wallet1111111111111111111111111111111111111";

function buyTx(): HeliusEnhancedTx {
  return {
    signature: "buy", timestamp: 1, source: "PUMP_FUN", feePayer: W,
    tokenTransfers: [{ toUserAccount: W, mint: MINT, tokenAmount: 100 }],
    nativeTransfers: [{ fromUserAccount: W, amount: 1_000_000_000 }], // paga 1 SOL
  };
}
function sellTx(): HeliusEnhancedTx {
  return {
    signature: "sell", timestamp: 2, source: "PUMP_FUN", feePayer: W,
    tokenTransfers: [{ fromUserAccount: W, mint: MINT, tokenAmount: 100 }],
    nativeTransfers: [{ toUserAccount: W, amount: 1_500_000_000 }], // recibe 1.5 SOL
  };
}

test("pumpSellOf: envió token + recibió SOL → venta", () => {
  const s = pumpSellOf(sellTx(), MINT);
  assert.ok(s);
  assert.equal(s!.wallet, W);
  assert.equal(s!.solOut, 1.5);
  assert.equal(s!.tokensIn, 100);
});

test("pumpSellOf: envió token pero NO recibió SOL → null", () => {
  const tx = sellTx();
  tx.nativeTransfers = [];
  assert.equal(pumpSellOf(tx, MINT), null);
});

test("pumpTradeOf: distingue buy de sell", () => {
  assert.equal(pumpTradeOf(buyTx(), MINT)?.side, "buy");
  assert.equal(pumpTradeOf(sellTx(), MINT)?.side, "sell");
});

test("pumpTradeOf: tx que no es trade → null", () => {
  const tx = buyTx();
  tx.tokenTransfers = [];
  assert.equal(pumpTradeOf(tx, MINT), null);
});

test("computeRealizedPnL: buy+sell completo → ganancia correcta", () => {
  // compró 100 tok por 1 SOL (costo 0.01/tok), vendió 100 por 1.5 → realized 0.5
  const rows = [
    { wallet: "A", token: "T1", side: "buy" as const, sol: 1, tokens: 100 },
    { wallet: "A", token: "T1", side: "sell" as const, sol: 1.5, tokens: 100 },
  ];
  const pnl = computeRealizedPnL(rows);
  assert.equal(pnl.get("A")!.realizedPnl, 0.5);
  assert.equal(pnl.get("A")!.pnlTokens, 1);
});

test("computeRealizedPnL: comprado sin vender → realized 0 en ese token", () => {
  const rows = [
    { wallet: "A", token: "T1", side: "buy" as const, sol: 1, tokens: 100 },
    { wallet: "A", token: "T1", side: "sell" as const, sol: 1.5, tokens: 100 },
    { wallet: "A", token: "T2", side: "buy" as const, sol: 2, tokens: 200 }, // hold, sin venta
  ];
  const pnl = computeRealizedPnL(rows);
  assert.equal(pnl.get("A")!.realizedPnl, 0.5); // solo T1 cuenta
  assert.equal(pnl.get("A")!.pnlTokens, 2);     // ambos tokens tienen trades
});

test("computeRealizedPnL: venta parcial usa costo promedio", () => {
  // compró 100 por 1 SOL (0.01/tok), vendió 50 por 1 SOL → 1 - 0.01*50 = 0.5
  const rows = [
    { wallet: "A", token: "T1", side: "buy" as const, sol: 1, tokens: 100 },
    { wallet: "A", token: "T1", side: "sell" as const, sol: 1, tokens: 50 },
  ];
  assert.equal(computeRealizedPnL(rows).get("A")!.realizedPnl, 0.5);
});
