// ─── Algoritmos puros de co-ocurrencia + clustering ─────────────────────────
// SIN dependencias de DB ni de Next: funciones puras sobre arrays, para poder
// testearlas en aislamiento (node --test). El adapter cooccurrence.ts las
// alimenta desde sqlite y persiste los resultados.
//
// Por qué existe esto: el código viejo medía UBICUIDAD (en cuántos tokens
// aparece cada wallet), no CO-OCURRENCIA (qué wallets compran los mismos tokens
// JUNTAS). Así no distinguía un cartel real de N snipers independientes que
// coinciden en tokens populares. Acá se calcula la matriz pairwise, se filtra por
// significancia (lift) y se agrupan por componentes conexos.

import type { WalletKind } from "./types";

export interface BuyerRow { token: string; wallet: string; rank: number; blockTime: number }
export interface WalletAgg { wallet: string; tokensCount: number; firstSeen: number | null }
export interface PairAgg { a: string; b: string; shared: number; sumRankGap: number; sumTimeGap: number }
export interface Edge { a: string; b: string }

/** Conteo de tokens distintos + primer block_time por wallet (ubicuidad). */
export function aggregateWallets(rows: BuyerRow[]): WalletAgg[] {
  const byWallet = new Map<string, { tokens: Set<string>; firstSeen: number | null }>();
  for (const r of rows) {
    let e = byWallet.get(r.wallet);
    if (!e) { e = { tokens: new Set(), firstSeen: null }; byWallet.set(r.wallet, e); }
    e.tokens.add(r.token);
    if (r.blockTime > 0 && (e.firstSeen === null || r.blockTime < e.firstSeen)) e.firstSeen = r.blockTime;
  }
  return [...byWallet.entries()].map(([wallet, e]) => ({ wallet, tokensCount: e.tokens.size, firstSeen: e.firstSeen }));
}

/** Wallets que pueden co-ocurrir con alguien (aparecen en ≥2 tokens). */
export function candidateWallets(rows: BuyerRow[]): Set<string> {
  return new Set(aggregateWallets(rows).filter((w) => w.tokensCount >= 2).map((w) => w.wallet));
}

/**
 * Matriz pairwise: para cada par de wallets candidatas, en cuántos tokens fueron
 * AMBAS early buyers, acumulando gaps de rank y de tiempo (señal de timing).
 * `rows` debe venir ya filtrado a los primeros K buyers por token (acota el costo
 * de C(buyers,2) a C(K,2)). Clave canónica a<b.
 */
export function aggregatePairs(rows: BuyerRow[], candidates: Set<string>): PairAgg[] {
  const byToken = new Map<string, BuyerRow[]>();
  for (const r of rows) {
    if (!candidates.has(r.wallet)) continue;
    const arr = byToken.get(r.token);
    if (arr) arr.push(r); else byToken.set(r.token, [r]);
  }
  const pairs = new Map<string, PairAgg>();
  for (const list of byToken.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const ri = list[i], rj = list[j];
        const [a, b] = ri.wallet < rj.wallet ? [ri.wallet, rj.wallet] : [rj.wallet, ri.wallet];
        const key = a + "|" + b;
        const rankGap = Math.abs(ri.rank - rj.rank);
        const timeGap = Math.abs(ri.blockTime - rj.blockTime);
        const e = pairs.get(key);
        if (e) { e.shared++; e.sumRankGap += rankGap; e.sumTimeGap += timeGap; }
        else pairs.set(key, { a, b, shared: 1, sumRankGap: rankGap, sumTimeGap: timeGap });
      }
    }
  }
  return [...pairs.values()];
}

/**
 * Lift = co-ocurrencia observada / esperada bajo independencia. >1 indica que el
 * par aparece junto MÁS de lo que el azar predice (tokens populares con miles de
 * buyers inflan la coincidencia esperada → el lift la descuenta).
 */
export function lift(shared: number, tokensA: number, tokensB: number, totalTokens: number): number {
  if (totalTokens <= 0 || tokensA <= 0 || tokensB <= 0) return 0;
  const expected = (tokensA * tokensB) / totalTokens;
  return expected > 0 ? shared / expected : 0;
}

/**
 * Peso de arista: co-ocurrencia ponderada por cercanía en la cola de compra
 * (rank) y en el tiempo (segundos). Un par siempre adyacente y casi simultáneo
 * pesa más que uno que coincide en posiciones random.
 */
export function edgeWeight(p: PairAgg, rankW: number, timeW: number): number {
  const avgRankGap = p.sumRankGap / p.shared;
  const avgTimeGap = p.sumTimeGap / p.shared;
  const bonus = 1 + rankW / (1 + avgRankGap) + timeW / (1 + avgTimeGap);
  return p.shared * bonus;
}

/**
 * Componentes conexos (union-find) sobre las aristas. Devuelve los clusters como
 * arrays de wallets, ordenados de forma estable (por la wallet mínima) para que
 * los group_id sean determinísticos entre corridas. Solo entran wallets con arista.
 */
export function connectedComponents(edges: Edge[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) { const next = parent.get(x)!; parent.set(x, root); x = next; }
    return root;
  };
  const ensure = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (const { a, b } of edges) { ensure(a); ensure(b); union(a, b); }

  const groups = new Map<string, string[]>();
  for (const w of parent.keys()) {
    const r = find(w);
    const arr = groups.get(r);
    if (arr) arr.push(w); else groups.set(r, [w]);
  }
  const comps = [...groups.values()].map((c) => c.sort());
  comps.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return comps;
}

/** Densidad interna de un cluster: 2E/(V(V-1)). 1 = clique, 0 = sin aristas. */
export function density(members: string[], edges: Edge[]): number {
  const set = new Set(members);
  const v = members.length;
  if (v < 2) return 0;
  let e = 0;
  for (const edge of edges) if (set.has(edge.a) && set.has(edge.b)) e++;
  return (2 * e) / (v * (v - 1));
}

export interface ClassifyOpts { universalRatio: number; universalMinTokens: number; minSupportTokens: number }

/**
 * Clasificación de una wallet. Importante: 'group' SOLO si está en un cluster
 * (groupId != null) — antes bastaba count≥2, que es ruido. La ubicuidad altísima
 * se marca 'universal_sniper' (bot) y NO entra a clusters (es puente que fusiona
 * cartels distintos).
 */
export function classify(
  count: number, ratio: number, totalTokens: number, groupId: number | null, opts: ClassifyOpts
): WalletKind {
  if (totalTokens >= opts.universalMinTokens && ratio >= opts.universalRatio) return "universal_sniper";
  if (totalTokens >= opts.minSupportTokens && groupId !== null) return "group";
  return "unknown";
}
