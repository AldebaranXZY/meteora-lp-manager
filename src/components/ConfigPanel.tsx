"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { STRATEGIES, binOffsetToPrice, priceToBinOffset, deriveMode } from "@/lib/meteora";
import type { MarketCondition, DLMMConfig, PositionMode, DLMMStrategyType } from "@/lib/types";

const MODE_LABELS: Record<PositionMode, { label: string; color: string }> = {
  "single-sol-bid":   { label: "↓ Solo SOL",   color: "var(--red)" },
  "single-token-ask": { label: "↑ Solo TOKEN",  color: "var(--green)" },
  "bilateral":        { label: "↔ Bilateral",   color: "#a78bfa" },
};

interface ConfigPanelProps {
  condition: MarketCondition;
  config: DLMMConfig;
  tokenPrice: number;
  tokenSymbol: string;
  binStep: number;
  baseFee: string;
  onConfigChange: (cfg: DLMMConfig) => void;
}

export default function ConfigPanel({
  condition, config, tokenPrice, tokenSymbol, binStep, baseFee, onConfigChange,
}: ConfigPanelProps) {
  const s = STRATEGIES[condition];

  // ── Derived values (always before hooks) ─────────────────────────────────
  const safeBinStep = Math.max(1, Number(binStep) || 25);
  const minBinId    = config.minBinId ?? -10;
  const maxBinId    = config.maxBinId ?? 10;
  const totalBins   = maxBinId - minBinId;
  const mode        = deriveMode(minBinId, maxBinId);
  const modeInfo    = MODE_LABELS[mode];
  const isBilateral = mode === "bilateral";
  const skewBelow   = config.skew?.below ?? 50;

  const minPrice = binOffsetToPrice(minBinId, tokenPrice, safeBinStep);
  const maxPrice = binOffsetToPrice(maxBinId, tokenPrice, safeBinStep);

  // ── Slider view range — FIJO en tokenPrice ± 35% ────────────────────────
  // No recalcular en base al rango seleccionado: eso causaba que al mover
  // un handle, el otro pareciera moverse también (viewSpan cambiaba).
  const VIEW_PCT   = 0.35;
  const viewMin    = tokenPrice * (1 - VIEW_PCT);
  const viewMax    = tokenPrice * (1 + VIEW_PCT);
  const viewSpan   = viewMax - viewMin;

  const toPos = (p: number) => Math.max(0, Math.min(100, ((p - viewMin) / viewSpan) * 100));
  const minHandlePos = toPos(minPrice);
  const maxHandlePos = toPos(maxPrice);

  // Tick marks: 5 evenly spaced labels across the view range
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    pct: t * 100,
    label: (viewMin + t * viewSpan).toPrecision(4),
  }));

  // ── Local input strings ───────────────────────────────────────────────────
  const [minStr, setMinStr] = useState(() => tokenPrice > 0 ? minPrice.toPrecision(6) : "");
  const [maxStr, setMaxStr] = useState(() => tokenPrice > 0 ? maxPrice.toPrecision(6) : "");

  useEffect(() => {
    if (tokenPrice <= 0) return;
    setMinStr(binOffsetToPrice(minBinId, tokenPrice, safeBinStep).toPrecision(6));
    setMaxStr(binOffsetToPrice(maxBinId, tokenPrice, safeBinStep).toPrecision(6));
  }, [minBinId, maxBinId, tokenPrice, safeBinStep]); // eslint-disable-line

  // ── Drag state ────────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef  = useRef<"min" | "max" | null>(null);

  const getPriceFromClientX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewMin + pct * viewSpan;
  }, [viewMin, viewSpan]);

  const onHandlePointerDown = useCallback((
    e: React.PointerEvent<HTMLDivElement>, which: "min" | "max"
  ) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = which;
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const price = getPriceFromClientX(e.clientX);
    if (price === null) return;
    const binId = priceToBinOffset(price, tokenPrice, safeBinStep);

    if (dragRef.current === "min") {
      const clamped = Math.min(binId, maxBinId - 1);
      const p = binOffsetToPrice(clamped, tokenPrice, safeBinStep);
      setMinStr(p.toPrecision(6));
      onConfigChange({ ...config, minBinId: clamped });
    } else {
      const clamped = Math.max(binId, minBinId + 1);
      const p = binOffsetToPrice(clamped, tokenPrice, safeBinStep);
      setMaxStr(p.toPrecision(6));
      onConfigChange({ ...config, maxBinId: clamped });
    }
  }, [getPriceFromClientX, tokenPrice, safeBinStep, minBinId, maxBinId, config, onConfigChange]);

  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  // ── Other emitters ────────────────────────────────────────────────────────
  const emit = useCallback((patch: Partial<DLMMConfig>) => {
    onConfigChange({ ...config, ...patch });
  }, [config, onConfigChange]);

  const adjustMin = useCallback((delta: number) => {
    const newMin = Math.min(minBinId + delta, maxBinId - 1);
    setMinStr(binOffsetToPrice(newMin, tokenPrice, safeBinStep).toPrecision(6));
    emit({ minBinId: newMin });
  }, [minBinId, maxBinId, tokenPrice, safeBinStep, emit]);

  const adjustMax = useCallback((delta: number) => {
    const newMax = Math.max(maxBinId + delta, minBinId + 1);
    setMaxStr(binOffsetToPrice(newMax, tokenPrice, safeBinStep).toPrecision(6));
    emit({ maxBinId: newMax });
  }, [maxBinId, minBinId, tokenPrice, safeBinStep, emit]);

  const commitMinPrice = useCallback(() => {
    const val = parseFloat(minStr);
    if (isNaN(val) || val <= 0) return;
    const newMin = priceToBinOffset(val, tokenPrice, safeBinStep);
    emit({ minBinId: Math.min(newMin, maxBinId - 1) });
  }, [minStr, tokenPrice, safeBinStep, maxBinId, emit]);

  const commitMaxPrice = useCallback(() => {
    const val = parseFloat(maxStr);
    if (isNaN(val) || val <= 0) return;
    const newMax = priceToBinOffset(val, tokenPrice, safeBinStep);
    emit({ maxBinId: Math.max(newMax, minBinId + 1) });
  }, [maxStr, tokenPrice, safeBinStep, minBinId, emit]);

  const setStrategy = (strategy: DLMMStrategyType) => emit({ strategy, strategyLabel: strategy });
  const setSkew = (below: number) => emit({ skew: { below, above: 100 - below } });

  const pct = (price: number) => {
    if (tokenPrice <= 0 || !isFinite(price)) return "0%";
    const diff = ((price - tokenPrice) / tokenPrice) * 100;
    return `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`;
  };

  // ── Handle styles (inline — NO sub-component para evitar remount) ──────────
  const handleStyle = (pos: number): React.CSSProperties => ({
    position: "absolute",
    top: "50%",
    left: `${pos}%`,
    width: 14, height: 14,
    borderRadius: "50%",
    background: "var(--amber)",
    border: "2px solid rgba(255,255,255,0.3)",
    transform: "translate(-50%, -50%)",
    cursor: "grab",
    zIndex: 2,
    userSelect: "none",
    touchAction: "none",
    boxShadow: "0 0 6px rgba(240,165,0,0.6)",
  });

  return (
    <div className="lp-card fade-in" style={{ overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, color: s.color }}>{s.icon}</span>
          <span style={{ fontFamily: "var(--font-syne)", fontWeight: 700, fontSize: 14, color: s.color }}>{s.label}</span>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: `${modeInfo.color}15`, border: `1px solid ${modeInfo.color}40` }}>
          <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: modeInfo.color, fontWeight: 600 }}>{modeInfo.label}</span>
        </div>
      </div>

      {/* Strategy */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)" }}>
        <p className="section-label" style={{ marginBottom: 8 }}>Strategy</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {(["Spot", "Curve", "BidAsk"] as DLMMStrategyType[]).map((st) => {
            const active = config.strategy === st;
            return (
              <button key={st} onClick={() => setStrategy(st)} className="lp-btn"
                style={{ padding: "8px 0", fontSize: 11, background: active ? `${s.color}20` : "var(--bg-base)", border: `1px solid ${active ? s.color : "var(--border-dim)"}`, color: active ? s.color : "var(--tx-muted)" }}>
                {st === "BidAsk" ? "Bid Ask" : st}
              </button>
            );
          })}
        </div>
      </div>

      {/* Price Range */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <p className="section-label">Price Range</p>
          <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)" }}>{tokenSymbol}/SOL</span>
        </div>

        {/* Slider */}
        <div style={{ marginBottom: 6 }}>
          {/* Track + handles */}
          <div ref={trackRef} style={{ position: "relative", height: 20, userSelect: "none" }}>
            {/* Track background */}
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 3, transform: "translateY(-50%)", background: "var(--border-mid)", borderRadius: 2 }} />
            {/* Active range fill */}
            <div style={{
              position: "absolute", top: "50%",
              left: `${minHandlePos}%`,
              right: `${100 - maxHandlePos}%`,
              height: 3, transform: "translateY(-50%)",
              background: "var(--amber)", borderRadius: 2,
              minWidth: 2,
            }} />
            {/* Min handle — inlineado, sin sub-componente */}
            <div
              onPointerDown={(e) => onHandlePointerDown(e, "min")}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              style={handleStyle(minHandlePos)}
            />
            {/* Max handle — inlineado, sin sub-componente */}
            <div
              onPointerDown={(e) => onHandlePointerDown(e, "max")}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              style={handleStyle(maxHandlePos)}
            />
          </div>

          {/* Tick labels */}
          <div style={{ position: "relative", height: 14, marginTop: 2 }}>
            {ticks.map((t, i) => (
              <span key={i} style={{
                position: "absolute",
                left: `${t.pct}%`,
                transform: "translateX(-50%)",
                fontFamily: "var(--font-jetbrains)",
                fontSize: 8,
                color: "var(--tx-muted)",
                whiteSpace: "nowrap",
              }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* Min / Max inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
          <div>
            <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 9, color: "var(--tx-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Min Price</p>
            <div style={{ display: "flex", gap: 4 }}>
              <input className="lp-input" style={{ flex: 1, fontSize: 12, padding: "7px 8px" }}
                value={minStr} onChange={(e) => setMinStr(e.target.value)}
                onBlur={commitMinPrice} onKeyDown={(e) => e.key === "Enter" && commitMinPrice()} />
              <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)", alignSelf: "center", whiteSpace: "nowrap", minWidth: 42, textAlign: "center" }}>{pct(minPrice)}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <BinBtn onClick={() => adjustMin(1)} label="+" />
                <BinBtn onClick={() => adjustMin(-1)} label="−" />
              </div>
            </div>
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-jetbrains)", fontSize: 9, color: "var(--tx-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Max Price</p>
            <div style={{ display: "flex", gap: 4 }}>
              <input className="lp-input" style={{ flex: 1, fontSize: 12, padding: "7px 8px" }}
                value={maxStr} onChange={(e) => setMaxStr(e.target.value)}
                onBlur={commitMaxPrice} onKeyDown={(e) => e.key === "Enter" && commitMaxPrice()} />
              <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)", alignSelf: "center", whiteSpace: "nowrap", minWidth: 42, textAlign: "center" }}>{pct(maxPrice)}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <BinBtn onClick={() => adjustMax(1)} label="+" />
                <BinBtn onClick={() => adjustMax(-1)} label="−" />
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)" }}>
          <span>Total Bins: <span style={{ color: "var(--tx-primary)" }}>{totalBins}</span></span>
          <span>Bin Step: <span style={{ color: "var(--tx-primary)" }}>{safeBinStep} bps</span></span>
          <span>Fee: <span style={{ color: "var(--green)" }}>{baseFee}%</span></span>
        </div>
      </div>

      {/* Split (bilateral only) */}
      {isBilateral && (
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)" }}>
          <p className="section-label" style={{ marginBottom: 10 }}>Split</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--amber)", width: 36, textAlign: "right" }}>{skewBelow}%</span>
            <input type="range" min={0} max={100} step={5} value={skewBelow}
              onChange={(e) => setSkew(parseInt(e.target.value))}
              style={{ flex: 1, accentColor: s.color }} />
            <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "#a78bfa", width: 36 }}>{100 - skewBelow}%</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-jetbrains)", fontSize: 9, color: "var(--tx-muted)", marginTop: 4 }}>
            <span>{tokenSymbol}</span>
            <span>SOL</span>
          </div>
        </div>
      )}

      {/* Rationale */}
      <div style={{ padding: "14px 16px" }}>
        <p className="section-label" style={{ marginBottom: 8 }}>Por qué esta config</p>
        <ul style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {s.rationale.map((point, i) => (
            <li key={i} style={{ display: "flex", gap: 8 }}>
              <span style={{ color: s.color, fontFamily: "var(--font-jetbrains)", fontSize: 10, flexShrink: 0 }}>→</span>
              <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: "var(--tx-muted)", lineHeight: 1.5 }}>{point}</span>
            </li>
          ))}
        </ul>
      </div>

    </div>
  );
}

function BinBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      style={{ width: 24, height: 18, background: "var(--bg-base)", border: "1px solid var(--border-mid)", borderRadius: 2, color: "var(--tx-primary)", fontFamily: "var(--font-jetbrains)", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {label}
    </button>
  );
}
