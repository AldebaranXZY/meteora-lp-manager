"use client";

import { STRATEGIES, deriveMode } from "@/lib/meteora";
import type { MarketCondition } from "@/lib/types";

const MODE_SUB: Record<string, string> = {
  "single-sol-bid":   "Solo SOL · bid",
  "single-token-ask": "Solo Token · ask",
  "bilateral":        "Bilateral · spot",
};

const ICONS: Record<MarketCondition, string> = {
  falling:      "↓",
  consolidating: "↔",
  rising:       "↑",
};

interface StrategySelectorProps {
  selected: MarketCondition | null;
  onSelect: (c: MarketCondition) => void;
}

export default function StrategySelector({ selected, onSelect }: StrategySelectorProps) {
  const conditions: MarketCondition[] = ["falling", "consolidating", "rising"];

  return (
    <div className="card p-4 fade-in">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p className="section-label">Condición de Mercado</p>
        {selected && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: ".1em", textTransform: "uppercase" }}>
            {STRATEGIES[selected].dlmmConfig.binStep} bps
          </span>
        )}
      </div>

      <div className="seg-grid">
        {conditions.map((cond) => {
          const s = STRATEGIES[cond];
          const mode = deriveMode(s.dlmmConfig.minBinId, s.dlmmConfig.maxBinId);
          const isActive = selected === cond;

          return (
            <button
              key={cond}
              onClick={() => onSelect(cond)}
              className={`seg-btn${isActive ? " active" : ""}`}
            >
              <div className="seg-top">{ICONS[cond]}</div>
              <div className="seg-bot">{s.label}</div>
              <div style={{
                fontFamily: "var(--mono)",
                fontSize: 8.5,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                marginTop: 5,
                color: isActive ? "var(--warn)" : "var(--ink-4)",
                opacity: isActive ? 1 : 0.7,
              }}>
                {MODE_SUB[mode]}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
