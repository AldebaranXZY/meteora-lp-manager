"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatUSD } from "@/lib/meteora";
import { STRATEGIES } from "@/lib/meteora";
import type { CalculatedPosition, MarketCondition, TokenAsset, DLMMPool, PositionMode, DLMMConfig } from "@/lib/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";

interface WalletBalance {
  tokenUI: number;
  tokenRaw: string;
  tokenDecimals: number;
  tokenExists: boolean;
  solUI: number;
}

interface PositionCalculatorProps {
  position: CalculatedPosition;
  condition: MarketCondition;
  config: DLMMConfig;
  tokenPrice: number;
  usdAmount: string;
  asset: TokenAsset;
  pool: DLMMPool;
  tokenCA: string;
  walletBalance: WalletBalance | null;
  solPrice: number | null;
}

type TxStatus = "idle" | "processing" | "confirmed" | "error";

export default function PositionCalculator({
  position, condition, config, tokenPrice, usdAmount, asset, pool, tokenCA, walletBalance, solPrice,
}: PositionCalculatorProps) {
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txResult, setTxResult] = useState<{ openHash: string; swapHash: string | null } | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [swapQuoteLoading, setSwapQuoteLoading] = useState(false);
  const [swapQuote, setSwapQuote] = useState<{ solIn: number; priceImpact: string } | null>(null);

  const strategy = STRATEGIES[condition];
  const symbol = asset.token_info?.symbol ?? asset.content?.metadata?.symbol ?? "TOKEN";
  const decimals = asset.token_info?.decimals ?? 9;
  const totalUSD = parseFloat(usdAmount);
  const mode: PositionMode = position.mode;

  // ── Pre-flight ────────────────────────────────────────────────────────────
  const preFlight = useMemo(() => {
    if (mode === "single-sol-bid") {
      // Usar el precio real de SOL; 170 queda solo como fallback si aún no cargó.
      const solNeeded = totalUSD / (solPrice || 170);
      const solHave = walletBalance?.solUI ?? 0;
      return { type: "sol" as const, solNeeded, solHave, canProceed: solHave >= solNeeded * 0.99, needsSwap: false, tokenDeficit: 0 };
    }
    const tokenNeeded = parseFloat(position.tokenAmount);
    const tokenHave = walletBalance?.tokenUI ?? 0;
    const tokenDeficit = Math.max(0, tokenNeeded - tokenHave);
    return { type: "token" as const, solNeeded: 0, solHave: walletBalance?.solUI ?? 0, canProceed: true, needsSwap: tokenDeficit > 0, tokenNeeded, tokenHave, tokenDeficit };
  }, [mode, totalUSD, walletBalance, position.tokenAmount, solPrice]);

  // ── Swap quote ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!preFlight.needsSwap) { setSwapQuote(null); return; }
    let cancelled = false;
    setSwapQuoteLoading(true);
    const raw = Math.floor((preFlight.tokenDeficit ?? 0) * Math.pow(10, decimals));
    fetch(`/api/swap/quote?input=${SOL_MINT}&output=${tokenCA}&amount=${raw}&swapMode=ExactOut&slippageBps=200`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setSwapQuote({ solIn: Number(d.inAmount) / 1e9, priceImpact: d.priceImpactPct ?? "0" });
        setSwapQuoteLoading(false);
      })
      .catch(() => { if (!cancelled) setSwapQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [preFlight.needsSwap, preFlight.tokenDeficit, decimals, tokenCA]);

  // ── Open ──────────────────────────────────────────────────────────────────
  const handleOpen = useCallback(async () => {
    setTxStatus("processing"); setTxError(null); setTxResult(null);
    try {
      const res = await fetch("/api/position/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolAddress: pool.address,
          tokenMint: tokenCA,
          strategyType: config.strategy,
          minBinId: config.minBinId,
          maxBinId: config.maxBinId,
          usdAmount: totalUSD,
          tokenPriceUSD: tokenPrice,
          tokenDecimals: decimals,
          skewBelow: config.skew?.below ?? 50,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `Error ${res.status}`);
      setTxResult({ openHash: data.open.txHash, swapHash: data.swap?.txHash ?? null });
      setTxStatus("confirmed");
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : "Error");
      setTxStatus("error");
    }
  }, [pool, tokenCA, config, totalUSD, tokenPrice, decimals]);

  const getBtn = (): string => {
    switch (txStatus) {
      case "processing": return preFlight.needsSwap ? "COMPRANDO Y ABRIENDO..." : "ABRIENDO...";
      case "confirmed": return "✓ POSICIÓN ABIERTA";
      case "error": return "REINTENTAR";
      default:
        if (mode === "single-sol-bid") return "ABRIR BID-SIDE (Solo SOL) ↓";
        if (mode === "single-token-ask" && preFlight.needsSwap) return "COMPRAR TOKEN Y ABRIR ↑";
        if (mode === "single-token-ask") return "ABRIR ASK-SIDE (Solo TOKEN) ↑";
        return preFlight.needsSwap ? "COMPRAR Y ABRIR ↔" : "ABRIR POSICIÓN ↔";
    }
  };

  const btnColor = mode === "single-sol-bid" ? "var(--amber)" : mode === "single-token-ask" ? "var(--green)" : "#a78bfa";
  const isDisabled = txStatus === "processing" || txStatus === "confirmed"
    || (mode === "single-sol-bid" && !preFlight.canProceed) || swapQuoteLoading;

  return (
    <div className="lp-card p-5 fade-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="section-label">Posición calculada</span>
        <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)" }}>{formatUSD(totalUSD)} total</span>
      </div>

      {/* Amounts — both in USD */}
      <div style={{ background: "var(--bg-base)", border: "1px solid var(--border-dim)", borderRadius: 3, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 0" }}>
        <Cell label={`${symbol}`} value={mode === "single-sol-bid" ? "$0" : `$${position.tokenAmountUSD}`} muted={mode === "single-sol-bid"} />
        <Cell label="SOL" value={mode === "single-token-ask" ? "$0" : `$${position.quoteAmount}`} muted={mode === "single-token-ask"} />
        <Cell label="Rango" value={`${position.lowerPrice} → ${position.upperPrice}`} span />
        <Cell label="Rango %" value={`${position.priceRangePct}%`} />
        <Cell label="Total bins" value={String(position.totalBins)} />
        <Cell label="Precio/bin" value={position.pricePerBin} accent accentColor={strategy.color} />
      </div>

      {/* Pre-flight */}
      {walletBalance && (
        <div style={{
          background: (() => { if (mode === "single-sol-bid") return preFlight.canProceed ? "rgba(0,232,122,0.06)" : "var(--red-dim)"; return preFlight.needsSwap ? "var(--amber-dim)" : "rgba(0,232,122,0.06)"; })(),
          border: `1px solid ${(() => { if (mode === "single-sol-bid") return preFlight.canProceed ? "rgba(0,232,122,0.25)" : "rgba(255,61,90,0.25)"; return preFlight.needsSwap ? "rgba(240,165,0,0.25)" : "rgba(0,232,122,0.25)"; })()}`,
          borderRadius: 3, padding: "11px 14px",
        }}>
          <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, color: mode === "single-sol-bid" ? (preFlight.canProceed ? "var(--green)" : "var(--red)") : preFlight.needsSwap ? "var(--amber)" : "var(--green)" }}>
            {mode === "single-sol-bid" ? (preFlight.canProceed ? "✓ SOL suficiente" : "✗ SOL insuficiente") : preFlight.needsSwap ? "⚡ Compra automática" : "✓ Balance suficiente"}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 12px", fontFamily: "var(--font-jetbrains)", fontSize: 10 }}>
            {mode === "single-sol-bid" ? (
              <>
                <Row l="SOL necesario" v={`${preFlight.solNeeded.toFixed(4)} SOL`} />
                <Row l="SOL en wallet" v={`${preFlight.solHave.toFixed(4)} SOL`} c={preFlight.canProceed ? "var(--green)" : "var(--red)"} />
              </>
            ) : preFlight.type !== "sol" ? (
              <>
                <Row l={`${symbol} necesario`} v={preFlight.tokenNeeded?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "0"} />
                <Row l={`${symbol} en wallet`} v={preFlight.tokenHave?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "0"} />
                {preFlight.needsSwap && (
                  <>
                    <Row l="A comprar" v={`${preFlight.tokenDeficit.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`} c="var(--amber)" />
                    {swapQuoteLoading
                      ? <Row l="Costo swap" v="calculando..." />
                      : swapQuote
                        ? <>
                            <Row l="SOL a gastar" v={`${swapQuote.solIn.toFixed(4)} SOL`} c="var(--amber)" />
                            <Row l="Price impact" v={`${parseFloat(swapQuote.priceImpact).toFixed(2)}%`} c={Math.abs(parseFloat(swapQuote.priceImpact)) > 5 ? "var(--red)" : undefined} />
                          </>
                        : null
                    }
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* MEV */}
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", background: "rgba(240,165,0,0.06)", border: "1px solid rgba(240,165,0,0.15)", borderRadius: 3 }}>
        <span style={{ color: "var(--amber)", fontSize: 11 }}>⚡</span>
        <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)", lineHeight: 1.5 }}>
          TX vía <span style={{ color: "var(--amber)" }}>Helius</span> + <span style={{ color: "var(--amber)" }}>rebate-address</span> — 50% del MEV vuelve a tu wallet.
        </p>
      </div>

      {/* Results */}
      {txResult && txStatus === "confirmed" && (
        <div className="fade-in" style={{ background: "rgba(0,232,122,0.08)", border: "1px solid rgba(0,232,122,0.25)", borderRadius: 3, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5 }}>
          <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 11, color: "var(--green)" }}>✓ Posición abierta</p>
          {txResult.swapHash && <TxLink hash={txResult.swapHash} label="Swap TX" />}
          <TxLink hash={txResult.openHash} label="LP TX" />
        </div>
      )}
      {txError && txStatus === "error" && (
        <div className="fade-in" style={{ background: "var(--red-dim)", border: "1px solid rgba(255,61,90,0.25)", borderRadius: 3, padding: "10px 14px" }}>
          <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 11, color: "var(--red)", wordBreak: "break-word" }}>✗ {txError}</p>
        </div>
      )}

      <button className="lp-btn primary"
        style={{ opacity: isDisabled && txStatus !== "confirmed" ? 0.6 : 1 }}
        onClick={handleOpen} disabled={isDisabled}>
        {getBtn()}
      </button>
    </div>
  );
}

function Cell({ label, value, accent, accentColor, muted, span }: { label: string; value: string; accent?: boolean; accentColor?: string; muted?: boolean; span?: boolean }) {
  return (
    <div style={span ? { gridColumn: "1 / -1" } : {}}>
      <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 9, color: "var(--tx-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>{label}</p>
      <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 13, fontWeight: 500, color: muted ? "var(--tx-muted)" : accent && accentColor ? accentColor : "var(--tx-primary)" }}>{value}</p>
    </div>
  );
}
function Row({ l, v, c }: { l: string; v: string; c?: string }) {
  return (<><span style={{ color: "var(--tx-muted)" }}>{l}</span><span style={{ color: c ?? "var(--tx-primary)", textAlign: "right" }}>{v}</span></>);
}
function TxLink({ hash, label }: { hash: string; label: string }) {
  return <a href={`https://solscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)", textDecoration: "underline" }}>{label} →</a>;
}
