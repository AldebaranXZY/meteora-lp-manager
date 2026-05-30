import type { MarketCondition, StrategyMap, DLMMConfig, CalculatedPosition, PositionMode } from "./types";

// ─── Helpers: precio ↔ bin offset ────────────────────────────────────────────

/** Cuántos bins desde el precio actual hasta targetPrice */
export function priceToBinOffset(targetPrice: number, currentPrice: number, binStep: number): number {
  if (currentPrice <= 0 || targetPrice <= 0) return 0;
  return Math.round(Math.log(targetPrice / currentPrice) / Math.log(1 + binStep / 10_000));
}

/** Precio correspondiente a un bin offset desde el precio actual */
export function binOffsetToPrice(binOffset: number, currentPrice: number, binStep: number): number {
  return currentPrice * Math.pow(1 + binStep / 10_000, binOffset);
}

/**
 * Deriva el mode de posición según dónde cae el rango respecto al active bin:
 *   minBinId >= 0  → rango entero por arriba → single-token-ask
 *   maxBinId <= 0  → rango entero por abajo  → single-sol-bid
 *   else           → rango cruza el active    → bilateral
 */
export function deriveMode(minBinId: number, maxBinId: number): PositionMode {
  if (minBinId >= 0) return "single-token-ask";
  if (maxBinId <= 0) return "single-sol-bid";
  return "bilateral";
}

// ─── Strategies (defaults MD-aligned) ────────────────────────────────────────
// El mode ya NO está hardcodeado — se deriva del rango en el momento de calcular.

export const STRATEGIES: StrategyMap = {

  falling: {
    label: "Bearish / Rebote",
    icon: "↓",
    color: "var(--red)",
    glowColor: "rgba(255,61,90,0.15)",
    borderColor: "rgba(255,61,90,0.3)",
    description: "Bins debajo del precio. SOL compra token barato si rebota.",
    rationale: [
      "Solo SOL en bins por debajo del precio actual (bid-side)",
      "Si el precio cae y rebota, el SOL se convierte en token a precios bajos",
      "BidAsk concentra liquidez cerca del active bin y en el fondo del rango",
      "Bin step 100 → mayor rango por bin, menos rebalanceos en la caída",
      "No necesitás tener el token — solo SOL",
    ],
    dlmmConfig: {
      strategy: "BidAsk",
      strategyLabel: "Bid-Ask",
      binStep: 100,
      minBinId: -10,
      maxBinId: 0,
      baseFee: "0.20",
      autoFee: true,
    },
  },

  consolidating: {
    label: "Consolidación",
    icon: "↔",
    color: "var(--amber)",
    glowColor: "rgba(240,165,0,0.15)",
    borderColor: "rgba(240,165,0,0.3)",
    description: "Rango simétrico. Mayor fee/dólar con volumen lateral.",
    rationale: [
      "Spot: liquidez uniforme en todo el rango",
      "Bin step 25 → bins apretados, máxima concentración de fees",
      "Bilateral 50/50 TOKEN + SOL",
      "Fee baja (0.25%) para rango lateral sin volatilidad explosiva",
      "Cerrar y reabrir si el precio rompe el rango",
    ],
    dlmmConfig: {
      strategy: "Spot",
      strategyLabel: "Spot",
      binStep: 25,
      minBinId: -10,
      maxBinId: 10,
      skew: { below: 50, above: 50 },
      baseFee: "0.25",
      autoFee: true,
    },
  },

  rising: {
    label: "Bullish / Pump",
    icon: "↑",
    color: "var(--green)",
    glowColor: "rgba(0,232,122,0.15)",
    borderColor: "rgba(0,232,122,0.3)",
    description: "Bins arriba del precio. Token se vende mientras sube.",
    rationale: [
      "Solo TOKEN en bins por encima del precio actual (ask-side)",
      "Cada bin cruzado vende token y acumula SOL + fees",
      "Bin step 150 → cada bin abarca más precio, dynamic fee sube con cada cruce",
      "BidAsk concentra en el active bin y en el techo del rango",
      "Trailing: mover el rango arriba cuando el precio se acerque al techo",
    ],
    dlmmConfig: {
      strategy: "BidAsk",
      strategyLabel: "Bid-Ask",
      binStep: 150,
      minBinId: 0,
      maxBinId: 12,
      baseFee: "0.20",
      autoFee: true,
    },
  },
};

// ─── Position Calculator ──────────────────────────────────────────────────────

export function calculatePosition(
  usdAmount: number,
  tokenPriceUSD: number,
  config: DLMMConfig
): CalculatedPosition {
  const { minBinId, maxBinId, binStep, skew } = config;

  const totalBins = maxBinId - minBinId;
  const binStepDecimal = binStep / 10_000;
  const mode = deriveMode(minBinId, maxBinId);

  const priceLower = tokenPriceUSD * Math.pow(1 + binStepDecimal, minBinId);
  const priceUpper = tokenPriceUSD * Math.pow(1 + binStepDecimal, maxBinId);
  const priceRangePct = (Math.abs(priceUpper - priceLower) / tokenPriceUSD * 100).toFixed(1);
  const pricePerBin = totalBins > 0 ? Math.abs(priceUpper - priceLower) / totalBins : 0;

  let tokenAmountUSD: number;
  let quoteAmountUSD: number;

  if (mode === "single-sol-bid") {
    tokenAmountUSD = 0;
    quoteAmountUSD = usdAmount;
  } else if (mode === "single-token-ask") {
    tokenAmountUSD = usdAmount;
    quoteAmountUSD = 0;
  } else {
    const below = skew?.below ?? 50;
    const above = skew?.above ?? 50;
    tokenAmountUSD = usdAmount * below / 100;
    quoteAmountUSD = usdAmount * above / 100;
  }

  const tokenAmount = tokenPriceUSD > 0 ? tokenAmountUSD / tokenPriceUSD : 0;

  return {
    tokenAmount: formatTokenAmount(tokenAmount),
    tokenAmountUSD: tokenAmountUSD.toFixed(2),
    quoteAmount: quoteAmountUSD.toFixed(2),
    lowerPrice: formatUSD(Math.min(priceLower, priceUpper)),
    upperPrice: formatUSD(Math.max(priceLower, priceUpper)),
    totalBins,
    priceRangePct,
    pricePerBin: formatUSD(pricePerBin),
    mode,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatUSD(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "$0";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1000) return "$" + abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (abs >= 1) return "$" + abs.toFixed(4);
  if (abs >= 0.001) return "$" + abs.toFixed(6);
  const str = abs.toFixed(20);
  const match = str.match(/^0\.(0+)(\d{1,6})/);
  if (match) {
    const zeros = match[1].length;
    const significant = match[2];
    if (zeros >= 2) {
      const sub = "₀₁₂₃₄₅₆₇₈₉";
      const subscript = zeros.toString().split("").map((d) => sub[parseInt(d)]).join("");
      return `$0.0${subscript}${significant}`;
    }
    return "$" + abs.toFixed(zeros + 4);
  }
  return "$" + abs.toFixed(8);
}

export function formatPrice(v: number): string { return formatUSD(v); }

function formatTokenAmount(value: number): string {
  if (value === 0) return "0";
  if (!isFinite(value) || isNaN(value)) return "0";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(8);
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
