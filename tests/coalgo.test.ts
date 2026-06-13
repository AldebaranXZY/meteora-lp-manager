import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateWallets, candidateWallets, aggregatePairs, lift, edgeWeight,
  connectedComponents, density, classify, type BuyerRow,
} from "../src/lib/tracker/coalgo.ts";

const opts = { universalRatio: 0.8, universalMinTokens: 4, minSupportTokens: 5 };

// Helper: arma rows de un token con wallets en orden de rank.
function token(mint: string, wallets: string[], t0 = 1000): BuyerRow[] {
  return wallets.map((wallet, i) => ({ token: mint, wallet, rank: i + 1, blockTime: t0 + i }));
}

test("aggregateWallets: cuenta tokens distintos + firstSeen", () => {
  const rows = [...token("T1", ["A", "B"], 100), ...token("T2", ["A", "C"], 50)];
  const agg = aggregateWallets(rows);
  const a = agg.find((w) => w.wallet === "A")!;
  assert.equal(a.tokensCount, 2);
  assert.equal(a.firstSeen, 50); // mínimo block_time entre T1(100) y T2(50)
});

test("candidateWallets: solo wallets en ≥2 tokens", () => {
  const rows = [...token("T1", ["A", "B"]), ...token("T2", ["A", "C"])];
  const cands = candidateWallets(rows);
  assert.ok(cands.has("A"));   // en 2 tokens
  assert.ok(!cands.has("B"));  // en 1
  assert.ok(!cands.has("C"));  // en 1
});

test("aggregatePairs: un cartel co-ocurre, pares correctos", () => {
  // C1,C2,C3 compran juntos T1,T2,T3. N es ruido (1 token).
  const rows = [
    ...token("T1", ["C1", "C2", "C3", "N1"]),
    ...token("T2", ["C1", "C2", "C3"]),
    ...token("T3", ["C1", "C2", "C3"]),
  ];
  const cands = candidateWallets(rows);
  const pairs = aggregatePairs(rows, cands);
  const get = (a: string, b: string) => pairs.find((p) => p.a === [a, b].sort()[0] && p.b === [a, b].sort()[1]);
  assert.equal(get("C1", "C2")!.shared, 3);
  assert.equal(get("C1", "C3")!.shared, 3);
  assert.equal(get("C2", "C3")!.shared, 3);
  // N1 aparece en 1 token → no es candidata → no genera pares
  assert.ok(!pairs.some((p) => p.a === "N1" || p.b === "N1"));
});

test("lift: descuenta la coincidencia esperada por azar", () => {
  // Cartel: 4 co-ocurrencias con pocas apariciones c/u sobre 10 tokens → lift alto.
  assert.ok(lift(4, 4, 4, 10) > 2);
  // Snipers ubicuos: 2 co-ocurrencias pero cada uno en 8 tokens → esperado alto → lift bajo.
  assert.ok(lift(2, 8, 8, 10) < 1.5);
});

test("edgeWeight: timing más ajustado pesa más", () => {
  const tight = { a: "A", b: "B", shared: 3, sumRankGap: 0, sumTimeGap: 0 };
  const loose = { a: "A", b: "B", shared: 3, sumRankGap: 90, sumTimeGap: 9000 };
  assert.ok(edgeWeight(tight, 1, 1) > edgeWeight(loose, 1, 1));
});

test("connectedComponents: separa y agrupa", () => {
  assert.equal(connectedComponents([{ a: "A", b: "B" }, { a: "C", b: "D" }]).length, 2);
  assert.equal(connectedComponents([{ a: "A", b: "B" }, { a: "B", b: "C" }]).length, 1);
});

test("connectedComponents: un puente fusiona grupos (por eso se excluyen bots)", () => {
  const sep = connectedComponents([{ a: "A", b: "B" }, { a: "C", b: "D" }]);
  assert.equal(sep.length, 2);
  // BOT conecta B y C → colapsa a 1. Confirma por qué el adapter saca a los universal_sniper.
  const merged = connectedComponents([{ a: "A", b: "B" }, { a: "C", b: "D" }, { a: "B", b: "C" }]);
  assert.equal(merged.length, 1);
});

test("density: clique=1, cadena<1", () => {
  const triangle = [{ a: "A", b: "B" }, { a: "B", b: "C" }, { a: "A", b: "C" }];
  assert.equal(density(["A", "B", "C"], triangle), 1);
  const chain = [{ a: "A", b: "B" }, { a: "B", b: "C" }];
  assert.ok(density(["A", "B", "C"], chain) < 1);
});

test("classify: 'group' solo con cluster y soporte suficiente", () => {
  // group válido: en cluster, suficientes tokens, ratio no-bot
  assert.equal(classify(3, 0.3, 10, 1, opts), "group");
  // sin cluster → unknown aunque count alto
  assert.equal(classify(3, 0.3, 10, null, opts), "unknown");
  // pocos tokens analizados → unknown aunque tenga cluster
  assert.equal(classify(2, 0.5, 3, 1, opts), "unknown");
  // ubicuo → bot
  assert.equal(classify(9, 0.9, 10, 1, opts), "universal_sniper");
});
