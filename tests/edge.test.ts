import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRealizedPnL, aggregateWallets, type BuyerRow } from "../src/lib/tracker/coalgo.ts";

test("computeRealizedPnL: venta sin compra previa → todo el SOL es realized (costo 0)", () => {
  const pnl = computeRealizedPnL([{ wallet: "A", token: "T1", side: "sell", sol: 2, tokens: 50 }]);
  assert.equal(pnl.get("A")!.realizedPnl, 2);
  assert.equal(pnl.get("A")!.pnlTokens, 1);
});

test("computeRealizedPnL: múltiples wallets independientes", () => {
  const pnl = computeRealizedPnL([
    { wallet: "A", token: "T1", side: "buy", sol: 1, tokens: 100 },
    { wallet: "A", token: "T1", side: "sell", sol: 2, tokens: 100 },
    { wallet: "B", token: "T1", side: "buy", sol: 1, tokens: 100 },
    { wallet: "B", token: "T1", side: "sell", sol: 0.5, tokens: 100 },
  ]);
  assert.equal(pnl.get("A")!.realizedPnl, 1);    // 2 - 1
  assert.equal(pnl.get("B")!.realizedPnl, -0.5); // 0.5 - 1 (pérdida)
});

test("aggregateWallets: firstSeen ignora blockTime=0", () => {
  const rows: BuyerRow[] = [
    { token: "T1", wallet: "A", rank: 1, blockTime: 0 },
    { token: "T2", wallet: "A", rank: 1, blockTime: 50 },
  ];
  const a = aggregateWallets(rows).find((w) => w.wallet === "A")!;
  assert.equal(a.tokensCount, 2);
  assert.equal(a.firstSeen, 50); // el 0 no cuenta como "más viejo"
});

test("aggregateWallets: wallet en 1 solo token", () => {
  const a = aggregateWallets([{ token: "T1", wallet: "B", rank: 5, blockTime: 10 }]).find((w) => w.wallet === "B")!;
  assert.equal(a.tokensCount, 1);
  assert.equal(a.firstSeen, 10);
});
