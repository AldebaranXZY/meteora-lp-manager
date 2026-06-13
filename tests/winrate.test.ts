import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome, computeWinRates } from "../src/lib/tracker/coalgo.ts";
import type { TokenOutcome } from "../src/lib/tracker/types.ts";

const opts = { winnerMinMcap: 60_000, winnerMinLiq: 10_000, rugMaxLiq: 1_000, rugMaxMcap: 15_000 };
const info = (o: Partial<{ mcap: number; liquidityUsd: number; volume24h: number; dexes: string[] }>) =>
  ({ mcap: 0, liquidityUsd: 0, volume24h: 0, dexes: [], ...o });

test("classifyOutcome: mcap alto → winner", () => {
  assert.equal(classifyOutcome(info({ mcap: 120_000, liquidityUsd: 5_000 }), opts), "winner");
});

test("classifyOutcome: migrado a AMM real con liquidez → winner", () => {
  assert.equal(classifyOutcome(info({ mcap: 40_000, liquidityUsd: 25_000, dexes: ["raydium"] }), opts), "winner");
});

test("classifyOutcome: liquidez y mcap muertos → rug", () => {
  assert.equal(classifyOutcome(info({ mcap: 4_000, liquidityUsd: 100, volume24h: 30, dexes: ["pumpfun"] }), opts), "rug");
});

test("classifyOutcome: sin data de DexScreener → pending (no concluir)", () => {
  assert.equal(classifyOutcome(info({}), opts), "pending");
});

test("classifyOutcome: todavía en la curva, vivo → pending", () => {
  assert.equal(classifyOutcome(info({ mcap: 30_000, liquidityUsd: 6_000, volume24h: 5_000, dexes: ["pumpfun"] }), opts), "pending");
});

test("computeWinRates: cuenta wins/plays, ignora pending", () => {
  const outcomes = new Map<string, TokenOutcome>([
    ["T1", "winner"], ["T2", "rug"], ["T3", "pending"], ["T4", "winner"],
  ]);
  const plays = [
    { wallet: "A", token: "T1" }, { wallet: "A", token: "T2" }, { wallet: "A", token: "T3" },
    { wallet: "B", token: "T1" }, { wallet: "B", token: "T4" },
  ];
  const wr = computeWinRates(plays, outcomes);
  assert.deepEqual(wr.get("A"), { wins: 1, plays: 2, winRate: 0.5 }); // T3 pending no cuenta
  assert.deepEqual(wr.get("B"), { wins: 2, plays: 2, winRate: 1 });
});

test("computeWinRates: wallet solo con pending → no aparece", () => {
  const outcomes = new Map<string, TokenOutcome>([["T1", "pending"]]);
  const wr = computeWinRates([{ wallet: "A", token: "T1" }], outcomes);
  assert.equal(wr.has("A"), false);
});
