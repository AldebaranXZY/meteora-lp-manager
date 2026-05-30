"use client";

import { useState, useMemo, useCallback } from "react";
import type { DAMMv2Config, FeeCollectMode, DAMMBaseFeeMode, SchedulerType } from "@/lib/types";
import { DAMM_DURATION_PRESETS } from "@/lib/types";

const DEFAULT_CONFIG: DAMMv2Config = {
  feeCollectMode: 2, compoundingFeePct: 70,
  baseFeeMode: 1, schedulerType: 1,
  initialFeePct: 99, feeTierPct: 1,
  dynamicFee: true, totalDuration: 7200, startNow: true,
};
const FEE_TIERS = [0.25, 0.3, 1, 2, 4, 6];

// ─── Fee curve ────────────────────────────────────────────────────────────────
function buildCurve(cfg: DAMMv2Config, N = 80) {
  if (cfg.baseFeeMode === 0) return [{ t: 0, f: cfg.feeTierPct }, { t: 1, f: cfg.feeTierPct }];
  const final = cfg.feeTierPct, initial = cfg.initialFeePct;
  if (cfg.schedulerType === 1) {
    // Exponential: y = final + (initial-final) * exp(-k*t), k = -ln(0.04) ≈ 3.22
    const k = -Math.log(0.04);
    return Array.from({ length: N + 1 }, (_, i) => ({ t: i/N, f: final + (initial-final) * Math.exp(-k*(i/N)) }));
  }
  return Array.from({ length: N + 1 }, (_, i) => ({ t: i/N, f: initial + (final-initial) * (i/N) }));
}

// ─── ChipSeg ─────────────────────────────────────────────────────────────────
function ChipSeg<T extends string | number>({
  value, options, onChange, className = "",
}: { value: T; options: { label: string; value: T }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`chip-seg ${className}`}>
      {options.map(o => (
        <button key={String(o.value)} className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── RowField ─────────────────────────────────────────────────────────────────
function RowField({ label, tag, children }: { label: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="row-field">
      <div>
        <div className="field-l">{label}</div>
        {tag && <span style={{ display: "inline-block", marginTop: 4, padding: "3px 8px", borderRadius: 6, background: "color-mix(in oklab, var(--accent) 14%, transparent)", color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)" }}>{tag}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
interface DAMMv2CreatorProps {
  tokenCA: string; tokenSymbol: string; tokenDecimals: number; tokenPrice: number;
  onCreated?: (txHash: string) => void;
}
type TxStatus = "idle" | "processing" | "confirmed" | "error";

export default function DAMMv2Creator({ tokenCA, tokenSymbol, tokenDecimals, tokenPrice, onCreated }: DAMMv2CreatorProps) {
  const [cfg, setCfg] = useState<DAMMv2Config>(DEFAULT_CONFIG);
  const [tokenAUSD, setTokenAUSD] = useState("");
  const [tokenBSOL, setTokenBSOL] = useState("");
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof DAMMv2Config>(k: K, v: DAMMv2Config[K]) => setCfg(c => ({ ...c, [k]: v })), []);

  // Fee chart data
  const curve = useMemo(() => buildCurve(cfg), [cfg]);
  const durationMins = cfg.totalDuration / 60;
  const maxFee = cfg.baseFeeMode === 0 ? cfg.feeTierPct : cfg.initialFeePct;

  // SVG dimensions
  const W = 520, H = 180, padL = 28, padR = 10, padT = 10, padB = 24;
  const xS = (t: number) => padL + t * (W - padL - padR);
  const yS = (f: number) => padT + (1 - f / Math.max(maxFee, 1)) * (H - padT - padB);

  const pathD = curve.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.t).toFixed(1)} ${yS(p.f).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${xS(1).toFixed(1)} ${yS(0).toFixed(1)} L ${xS(0).toFixed(1)} ${yS(0).toFixed(1)} Z`;

  const handleCreate = useCallback(async () => {
    if (!tokenCA || !parseFloat(tokenAUSD)) return;
    setTxStatus("processing"); setTxError(null); setTxHash(null);
    try {
      const res = await fetch("/api/damm/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenMint: tokenCA, tokenDecimals, tokenAAmountUSD: parseFloat(tokenAUSD), tokenBAmountSOL: parseFloat(tokenBSOL) || 0, tokenPriceUSD: tokenPrice, config: cfg }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `Error ${res.status}`);
      setTxHash(data.txHash); setTxStatus("confirmed"); onCreated?.(data.txHash);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : "Error"); setTxStatus("error");
    }
  }, [tokenCA, tokenDecimals, tokenAUSD, tokenBSOL, tokenPrice, cfg, onCreated]);

  const sliderPct = cfg.compoundingFeePct + "%";

  return (
    <div className="damm">

      {/* Callout */}
      <div className="damm-callout">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: "-.005em" }}>
            Crear pool <b style={{ color: "var(--accent)" }}>DAMM v2</b> — Memecoin Pool v2
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
            AMM de producto constante · Posición NFT transferible · Fee scheduler exponencial
          </div>
        </div>
      </div>

      {/* Amounts */}
      <div className="amt-grid">
        <div className="amt-card">
          <div className="field-l">Base Token Amount</div>
          <div className="amt-row">
            <div className="amt-ticker">
              <div className="amt-sym">{tokenSymbol.slice(0, 2)}</div>
              <div>
                <div className="amt-name">{tokenSymbol}</div>
                <div className="amt-sub">TOKEN BASE</div>
              </div>
            </div>
            <input className="amt-input" type="number" placeholder="0.00" value={tokenAUSD}
              onChange={e => setTokenAUSD(e.target.value)} />
          </div>
          {tokenAUSD && tokenPrice > 0 && (
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", marginTop: 8, letterSpacing: ".06em" }}>
              ≈ {(parseFloat(tokenAUSD) / tokenPrice).toFixed(2)} {tokenSymbol}
            </div>
          )}
        </div>
        <div className="amt-card">
          <div className="field-l">Quote Token Amount</div>
          <div className="amt-row">
            <div className="amt-ticker">
              <div className="amt-sym sol">◎</div>
              <div>
                <div className="amt-name">SOL</div>
                <div className="amt-sub">QUOTE TOKEN</div>
              </div>
            </div>
            <input className="amt-input" type="number" placeholder="0.00" value={tokenBSOL}
              onChange={e => setTokenBSOL(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Fee settings */}
      <div>
        <RowField label="Fee Collection Mode">
          <ChipSeg value={cfg.feeCollectMode}
            onChange={v => set("feeCollectMode", v as FeeCollectMode)}
            options={[{ label: "Base + Quote", value: 0 }, { label: "Quote", value: 1 }, { label: "Quote + Compounding", value: 2 }]} />
        </RowField>

        {cfg.feeCollectMode === 2 && (
          <RowField label="Compounding Fee">
            <div className="slider-wrap" style={{ width: "100%", maxWidth: 340 }}>
              <input type="range" min={0} max={100} step={5} value={cfg.compoundingFeePct}
                onChange={e => set("compoundingFeePct", parseInt(e.target.value))}
                style={{ "--pct": sliderPct } as React.CSSProperties} />
              <span className="slider-val">{cfg.compoundingFeePct}%</span>
            </div>
          </RowField>
        )}

        <RowField label="Base Fee Mode">
          <ChipSeg value={cfg.baseFeeMode}
            onChange={v => set("baseFeeMode", v as DAMMBaseFeeMode)}
            options={[{ label: "Fixed", value: 0 }, { label: "Time Scheduler", value: 1 }, { label: "Market Cap", value: 2 }]} />
        </RowField>

        {cfg.baseFeeMode !== 0 && <>
          <RowField label="Scheduler Type">
            <ChipSeg value={cfg.schedulerType}
              onChange={v => set("schedulerType", v as SchedulerType)}
              options={[{ label: "Linear", value: 0 }, { label: "Exponential", value: 1 }]} />
          </RowField>

          <RowField label="Initial Fee">
            <ChipSeg value={cfg.initialFeePct}
              onChange={v => set("initialFeePct", v as number)}
              options={[{ label: "50%", value: 50 }, { label: "99%", value: 99 }]} />
          </RowField>

          <RowField label="Duration">
            <ChipSeg value={cfg.totalDuration}
              onChange={v => set("totalDuration", v as number)}
              options={DAMM_DURATION_PRESETS.map(p => ({ label: p.label, value: p.seconds }))} />
          </RowField>
        </>}

        <RowField label="Fee Tier" tag="destino">
          <ChipSeg value={cfg.feeTierPct}
            onChange={v => set("feeTierPct", v as number)}
            options={FEE_TIERS.map(t => ({ label: `${t}%`, value: t }))} />
        </RowField>

        <RowField label="Dynamic Fee">
          <ChipSeg value={cfg.dynamicFee ? 1 : 0}
            onChange={v => set("dynamicFee", v === 1)}
            options={[{ label: "Yes", value: 1 }, { label: "No", value: 0 }]}
            className="yesno" />
        </RowField>

        <RowField label="Start Time">
          <ChipSeg value={cfg.startNow ? 1 : 0}
            onChange={v => set("startNow", v === 1)}
            options={[{ label: "Now", value: 1 }, { label: "Custom", value: 0 }]}
            className="yesno" />
        </RowField>
        {!cfg.startNow && (
          <input type="datetime-local" className="input" style={{ marginTop: 4, fontSize: 11 }}
            onChange={e => set("customStartTs", Math.floor(new Date(e.target.value).getTime() / 1000))} />
        )}
      </div>

      {/* Fee chart */}
      <div className="chart-card">
        <div className="chart-h">
          <span className="field-l">Fee Visualization</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {cfg.baseFeeMode === 0 ? cfg.feeTierPct : cfg.initialFeePct}% → {cfg.feeTierPct}% · {cfg.baseFeeMode === 0 ? "Fija" : `${durationMins.toFixed(0)} min`} · {cfg.schedulerType === 1 ? "Expo" : "Lineal"}
          </span>
        </div>
        <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="feeArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25"/>
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
            </linearGradient>
          </defs>
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={padL} y1={yS(v)} x2={W - padR} y2={yS(v)} stroke="rgba(255,255,255,.05)"/>
              <text x={padL - 6} y={yS(v) + 3} textAnchor="end" className="chart-yt">{v}</text>
            </g>
          ))}
          {[0, .25, .5, .75, 1].map(t => (
            <g key={t}>
              <line x1={xS(t)} y1={H - padB} x2={xS(t)} y2={H - padB + 3} stroke="rgba(255,255,255,.15)"/>
              <text x={xS(t)} y={H - padB + 14} textAnchor="middle" className="chart-xt">{(durationMins * t).toFixed(1)} min</text>
            </g>
          ))}
          <path d={areaD} fill="url(#feeArea)"/>
          <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 4px color-mix(in oklab, var(--accent) 80%, transparent))" }}/>
          <circle cx={xS(0)} cy={yS(cfg.baseFeeMode === 0 ? cfg.feeTierPct : cfg.initialFeePct)} r="3" fill="var(--accent)"/>
          <circle cx={xS(1)} cy={yS(cfg.feeTierPct)} r="3" fill="var(--accent)"/>
        </svg>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <div><div className="sg-l">Fee Inicial</div><div className="sg-v">{cfg.baseFeeMode === 0 ? cfg.feeTierPct : cfg.initialFeePct}%</div></div>
        <div><div className="sg-l">Fee Final</div><div className="sg-v">{cfg.feeTierPct}%</div></div>
        <div><div className="sg-l">Duración</div><div className="sg-v">{cfg.baseFeeMode === 0 ? "Fija" : `${durationMins.toFixed(0)} min`}</div></div>
        <div><div className="sg-l">Dynamic Fee</div><div className={`sg-v${cfg.dynamicFee ? " accent" : ""}`}>{cfg.dynamicFee ? "ON" : "OFF"}</div></div>
        <div><div className="sg-l">Collect</div><div className="sg-v">{["Base+Quote","Quote","Quote+Comp"][cfg.feeCollectMode]}</div></div>
        <div><div className="sg-l">Scheduler</div><div className="sg-v">{cfg.baseFeeMode === 0 ? "Fijo" : cfg.schedulerType === 1 ? "Expo" : "Lineal"}</div></div>
      </div>

      {/* Note */}
      <p className="mono" style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.55 }}>
        <span style={{ color: "var(--accent)" }}>$</span> DAMM v2 crea una posición NFT transferible. La pool usa un AMM de producto constante — diferente al DLMM de bins.
      </p>

      {/* Feedback */}
      {txHash && txStatus === "confirmed" && (
        <div className="fade-in" style={{ padding: "10px 14px", borderRadius: 10, background: "color-mix(in oklab, var(--accent) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)" }}>
          <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent)", marginBottom: 4 }}>✓ Pool DAMM v2 creada</p>
          <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", textDecoration: "underline" }}>Ver TX →</a>
        </div>
      )}
      {txError && txStatus === "error" && (
        <div className="fade-in" style={{ padding: "10px 14px", borderRadius: 10, background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)" }}>
          <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--danger)", wordBreak: "break-word" }}>✗ {txError}</p>
        </div>
      )}

      <button className="btn btn-primary"
        style={{ opacity: txStatus === "processing" || !tokenAUSD ? 0.6 : 1, marginTop: 4 }}
        onClick={handleCreate} disabled={txStatus === "processing" || txStatus === "confirmed" || !tokenAUSD}>
        {txStatus === "processing" ? "CREANDO POOL…" : txStatus === "confirmed" ? "✓ POOL CREADA" : <>Crear Pool DAMM v2 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></>}
      </button>
    </div>
  );
}
