"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import StrategySelector from "./StrategySelector";
import ConfigPanel from "./ConfigPanel";
import PositionCalculator from "./PositionCalculator";
import { calculatePosition, shortenAddress, formatUSD } from "@/lib/meteora";
import { STRATEGIES } from "@/lib/meteora";
import { getClusterLabel } from "@/lib/cluster";
import type {
  MarketCondition, TokenAsset, CalculatedPosition, DLMMConfig,
  TokenApiResponse, DLMMPool, PoolSearchResponse,
} from "@/lib/types";
import DAMMv2Creator from "./DAMMv2Creator";

// ─── Types ────────────────────────────────────────────────────────────────────
interface WalletBalance { tokenUI: number; tokenRaw: string; tokenDecimals: number; tokenExists: boolean; solUI: number; }
interface AppState {
  tokenCA: string; usdAmount: string;
  tokenData: TokenAsset | null; tokenPrice: number | null;
  priceSource: "jupiter" | "dexscreener" | "none";
  loading: boolean; error: string | null;
  selectedStrategy: MarketCondition | null;
  pools: DLMMPool[]; bestPool: DLMMPool | null;
  poolLoading: boolean; poolError: string | null;
  walletBalance: WalletBalance | null;
}
const INITIAL: AppState = {
  tokenCA: "", usdAmount: "", tokenData: null, tokenPrice: null,
  priceSource: "none", loading: false, error: null, selectedStrategy: null,
  pools: [], bestPool: null, poolLoading: false, poolError: null, walletBalance: null,
};
type RightTab   = "dlmm" | "damm";
type RightState = "empty" | "create-pool" | "position";

// ─── Matrix Rain ──────────────────────────────────────────────────────────────
function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const glyphs = "アイウエオカクコサシスタツテナニヌネノ0123456789ABCDEF";
    const fontSize = 12; let drops: number[] = [];
    const resize = () => {
      cv.width = cv.clientWidth; cv.height = cv.clientHeight;
      drops = Array.from({ length: Math.floor(cv.width / fontSize) }, () => Math.random() * -20);
    };
    resize(); window.addEventListener("resize", resize);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#34e0a1";
    let raf: number; let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last); last = now;
      ctx.fillStyle = "rgba(5,8,7,.10)"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.font = `${fontSize}px 'IBM Plex Mono',monospace`;
      for (let i = 0; i < drops.length; i++) {
        const x = i * fontSize, y = drops[i] * fontSize;
        ctx.fillStyle = "#d6ffe8"; ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], x, y);
        if (drops[i] > 1) { ctx.fillStyle = accent; ctx.globalAlpha = .55; ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], x, y - fontSize); ctx.globalAlpha = 1; }
        drops[i] += dt * 0.025;
        if (y > cv.height && Math.random() > .975) drops[i] = Math.random() * -20;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <div className="matrix-bg"><canvas ref={ref} style={{ width: "100%", height: "100%" }} /></div>;
}

// ─── Matrix Logo ──────────────────────────────────────────────────────────────
function MatrixLogo() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const glyphs = "アイウエオカクコサシスタツテ0123456789";
  const cols = 6, rows = 11;
  const colData = useMemo(() => Array.from({ length: cols }, (_, c) => ({
    seq: Array.from({ length: rows * 2 }, (__, r) => glyphs[(c * 47 + r * 31) % glyphs.length]),
    headRow: (c * 13) % rows, dur: 2.4 + c * 0.37, delay: -(c * 0.5),
  })), []);
  const W = 48, H = 48, colW = W / cols, rowH = 4;
  const pills = [
    { key: "l-stem", x:7, y:6, w:6, h:36, c:"red" }, { key: "l-foot", x:7, y:34, w:16, h:8, c:"green" },
    { key: "p-spine", x:25, y:6, w:6, h:36, c:"green" }, { key: "p-top", x:25, y:6, w:16, h:8, c:"red" },
    { key: "p-mid", x:25, y:18, w:16, h:8, c:"red" }, { key: "p-right", x:35, y:6, w:6, h:20, c:"green" },
  ];
  return (
    <div className="logo" aria-label="LPManager">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <clipPath id="logoClip"><rect x="0" y="0" width={W} height={H} rx="5"/></clipPath>
          <linearGradient id="pillRedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff7585"/><stop offset="55%" stopColor="#e6324b"/><stop offset="100%" stopColor="#8e1626"/>
          </linearGradient>
          <linearGradient id="pillGreenGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#84f5c4"/><stop offset="55%" stopColor="#34e0a1"/><stop offset="100%" stopColor="#0a7d50"/>
          </linearGradient>
          <linearGradient id="logoFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity="0.5"/><stop offset="45%" stopColor="#000" stopOpacity="0"/>
            <stop offset="55%" stopColor="#000" stopOpacity="0"/><stop offset="100%" stopColor="#000" stopOpacity="0.5"/>
          </linearGradient>
        </defs>
        <g clipPath="url(#logoClip)" className="rain">
          {mounted && colData.map((col, ci) => (
            <g key={ci} className="col" style={{ animationDuration: col.dur + "s", animationDelay: col.delay + "s" }}>
              {col.seq.map((ch, ri) => {
                const isHead = ri % rows === col.headRow, isBright = ri % rows === ((col.headRow + 1) % rows);
                return <text key={ri} x={ci * colW + colW / 2} y={ri * rowH + 4} textAnchor="middle" className={isHead ? "head" : isBright ? "bright" : ""}>{ch}</text>;
              })}
            </g>
          ))}
          <rect x="0" y="0" width={W} height={H} fill="url(#logoFade)"/>
        </g>
        <g clipPath="url(#logoClip)">
          {pills.map(p => {
            const r = Math.min(p.w, p.h) / 2, horiz = p.w >= p.h;
            return (
              <g key={p.key}>
                <rect className={p.c === "red" ? "pillRed" : "pillGreen"} x={p.x} y={p.y} width={p.w} height={p.h} rx={r} ry={r}/>
                {horiz ? <rect className="pillShine" x={p.x + r * .5} y={p.y + 1.1} width={p.w - r} height={Math.max(.7, p.h * .16)} rx={p.h * .08}/>
                       : <rect className="pillShine" x={p.x + 1.1} y={p.y + r * .5} width={Math.max(.7, p.w * .16)} height={p.h - r} rx={p.w * .08}/>}
                <line className="pillSeam" x1={horiz ? p.x+p.w/2 : p.x+.9} y1={horiz ? p.y+1 : p.y+p.h/2} x2={horiz ? p.x+p.w/2 : p.x+p.w-.9} y2={horiz ? p.y+p.h-1 : p.y+p.h/2}/>
                <rect className="pillRing" x={p.x} y={p.y} width={p.w} height={p.h} rx={r} ry={r}/>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const IcLayers  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5z M3 13l9 5 9-5 M3 17l9 5 9-5"/></svg>;
const IcVault   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18v14H3z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"/></svg>;
const IcWallet  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h12v4 M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H5 M17 13h2"/></svg>;
const IcWarn    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 21h20L12 3z M12 10v5 M12 18v.5"/></svg>;
const IcSparkle = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg>;
const IcArrow   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
const IcRefresh = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15 6.7L3 16 M3 21v-5h5"/></svg>;

// ─── Pre-computed bin heights (deterministic) ──────────────────────────────── 
const BIN_HEIGHTS_29 = Array.from({ length: 29 }, (_, i) => { const x=(i-14)/14, p=((i*2654435761)%256)/256; return Math.exp(-x*x*2.4)*100 + p*8; });
const BIN_HEIGHTS_35 = Array.from({ length: 35 }, (_, i) => { const x=(i-17)/17, p=((i*2654435761)%256)/256; return Math.exp(-x*x*1.8)*100 + p*6; });

// ─── Create Pool Body (right panel — no pool exists) ──────────────────────────
function CreatePoolBody({ tokenCA, tokenSymbol, tokenPrice, solPrice, onCreated }: {
  tokenCA: string; tokenSymbol: string; tokenPrice: number; solPrice: number | null; onCreated: () => void;
}) {
  const [binStep, setBinStep] = useState("80");
  const [baseFee, setBaseFee] = useState("0.50");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bins = [
    { v: "20",  label: "Stables / Baja Vol" },
    { v: "50",  label: "Mid Vol" },
    { v: "80",  label: "Alta Vol / Memes" },
    { v: "100", label: "Muy Alta Vol" },
  ];
  const fees = ["0.25", "0.50", "0.80", "1.00"];

  const handleCreate = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/pool/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenXMint: tokenCA, binStep: parseInt(binStep), feeBps: parseFloat(baseFee) * 100, tokenPriceUSD: tokenPrice }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error");
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const priceInSOL = solPrice && tokenPrice ? tokenPrice / solPrice : null;

  return (
    <div className="create-pool">
      <div className="cp-callout">
        <IcSparkle />
        <div>
          <div className="cp-callout-t">No existe un pool DLMM para <b>{tokenSymbol}/SOL</b></div>
          <div className="cp-callout-s">Podés crearlo y ser el primer LP. La curva inicial se centra en el precio actual.</div>
        </div>
      </div>

      {/* Price reference */}
      <div className="price-row">
        <div>
          <div className="field-l">Precio Referencia</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{formatUSD(tokenPrice)}</div>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 4 }}>fuente: Jupiter</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="field-l">≈ en SOL</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4, color: "var(--accent)" }}>
            {priceInSOL ? formatUSD(priceInSOL) : "—"}
          </div>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 4 }}>
            {solPrice ? `SOL $${solPrice.toFixed(2)}` : ""}
          </div>
        </div>
      </div>

      {/* Bin Step */}
      <div className="cp-section">
        <div className="cp-section-h">
          <div className="field-l">Bin Step</div>
          <div className="field-l" style={{ color: "var(--ink-3)" }}>granularidad de precio por bin</div>
        </div>
        <div className="seg">
          {bins.map(b => (
            <button key={b.v} className={binStep === b.v ? "active" : ""} onClick={() => setBinStep(b.v)}>
              <div className="top">{b.v} <span style={{ fontSize: 10, color: "inherit", opacity: .7 }}>BPS</span></div>
              <div className="bot">{b.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Base Fee */}
      <div className="cp-section">
        <div className="cp-section-h">
          <div className="field-l">Base Fee</div>
          <div className="field-l" style={{ color: "var(--ink-3)" }}>fee inicial para LPs</div>
        </div>
        <div className="seg fee">
          {fees.map(f => (
            <button key={f} className={baseFee === f ? "active" : ""} onClick={() => setBaseFee(f)}>
              <div className="top">{f}<span style={{ fontSize: 10, color: "inherit", opacity: .7 }}>%</span></div>
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="summary">
        <b>{tokenSymbol}/SOL</b>
        <span className="sep">·</span>
        bin step <b>{binStep} bps</b> ({(parseInt(binStep)/100).toFixed(2)}% / bin)
        <span className="sep">·</span>
        fee <b>{baseFee}%</b>
        <span className="sep">·</span>
        precio SOL real vía Jupiter al firmar
      </div>

      {error && (
        <div className="banner" style={{ background: "color-mix(in oklab, var(--danger) 10%, transparent)", borderColor: "color-mix(in oklab, var(--danger) 28%, transparent)", color: "var(--danger)" }}>
          <IcWarn />{error}
        </div>
      )}

      <button className="btn btn-primary" style={{ marginTop: 4, opacity: loading ? .6 : 1 }} onClick={handleCreate} disabled={loading}>
        {loading ? "CREANDO POOL…" : <><IcSparkle /> Crear Pool DLMM <IcArrow /></>}
      </button>
    </div>
  );
}

// ─── Position view (after opening LP) ─────────────────────────────────────────
function PositionView({ pool, tokenSymbol, txHash, swapHash }: {
  pool: DLMMPool; tokenSymbol: string; txHash: string; swapHash?: string;
}) {
  return (
    <div className="pos-grid">
      <div className="pos-card">
        <div className="lbl">Posición abierta</div>
        <div className="val accent">✓ ON-CHAIN</div>
        <div className="delta">{pool.name}</div>
      </div>
      <div className="pos-card">
        <div className="lbl">Fees ganados (24h est.)</div>
        <div className="val accent">—</div>
        <div className="delta">APR: calculando…</div>
      </div>
      <div className="pos-vis">
        <div style={{ position: "absolute", inset: "14px 16px", display: "flex", alignItems: "flex-end", gap: 4 }}>
          {BIN_HEIGHTS_35.map((h, i) => {
            const center = Math.abs(i - 17) < 6;
            return <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: "3px 3px 0 0", background: center ? "linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 35%, transparent))" : "linear-gradient(180deg, rgba(255,255,255,.15), rgba(255,255,255,.04))", opacity: center ? .9 : .5 }} />;
          })}
        </div>
        <div style={{ position: "absolute", left: "50%", top: 10, bottom: 10, width: 1, background: "linear-gradient(180deg, transparent, var(--accent), transparent)" }} />
      </div>
      <div className="pos-card" style={{ gridColumn: "1/-1", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div className="summary" style={{ border: 0, background: "transparent", padding: 0 }}>
          <b>{tokenSymbol}/SOL</b>
          <span className="sep">·</span>
          {pool.bin_step} bps
          <span className="sep">·</span>
          <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>LP TX →</a>
          {swapHash && <><span className="sep">·</span><a href={`https://solscan.io/tx/${swapHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-3)", textDecoration: "underline" }}>Swap TX →</a></>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost">Cerrar</button>
          <button className="btn-ghost" style={{ borderColor: "color-mix(in oklab, var(--accent) 45%, transparent)", color: "var(--accent)" }}>Rebalancear</button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ hasPool }: { hasPool: boolean }) {
  return (
    <div className="empty">
      <div className="vis">
        <div className="bins">
          {BIN_HEIGHTS_29.map((h, i) => <div key={i} className={`bin${Math.abs(i-14)>=4?" dim":""}`} style={{ height: `${h}%` }} />)}
        </div>
        <div className="price-line" />
        <div className="price-tag">precio actual</div>
      </div>
      <div>
        <h2>{hasPool ? "Seleccioná una estrategia" : "Seleccioná o creá un pool"}</h2>
        <p>{hasPool ? "Elegí una condición de mercado para configurar tu posición DLMM." : "Cargá un token para escanear pools o creá el primero."}</p>
      </div>
      <div className="cta-row">
        <span className="chip accent"><IcLayers /> DLMM</span>
        <span className="chip"><IcVault /> DAMM v2</span>
        <span className="chip"><IcRefresh /> Auto‑rebalance</span>
      </div>
    </div>
  );
}

// ─── Token Input (inline — avoids separate file for brevity) ─────────────────
function TokenInput({ tokenCA, usdAmount, loading, onCAChange, onAmountChange, onFetch }: {
  tokenCA: string; usdAmount: string; loading: boolean;
  onCAChange: (v: string) => void; onAmountChange: (v: string) => void; onFetch: () => void;
}) {
  const [pasted, setPasted] = useState(false);
  const isValid = tokenCA.trim().length >= 32 && parseFloat(usdAmount) > 0;
  const handlePaste = async () => {
    try {
      const txt = (await navigator.clipboard.readText()).trim();
      if (txt) { onCAChange(txt); setPasted(true); setTimeout(() => setPasted(false), 1200); }
    } catch { document.querySelector<HTMLInputElement>("input.ca-input")?.focus(); }
  };
  const QUICK = ["10","25","50","100","MAX"];
  return (
    <div className="card">
      <div className="card-h"><div className="title"><span className="led"/>Abrir Posición</div><div className="meta">PASO 1/3</div></div>
      <div className="field">
        <div className="field-l">Contract Address (CA)</div>
        <div className="input-wrap ca-wrap">
          <input className="input ca-input" type="text" value={tokenCA} onChange={e => onCAChange(e.target.value.trim())} spellCheck={false} autoComplete="off" placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"/>
          <button className={`paste-btn${pasted ? " pasted" : ""}`} onClick={handlePaste} title="Pegar">
            {pasted ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>Pegado</> : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 9h10v10H9z M5 15V5h10"/></svg>Pegar</>}
          </button>
        </div>
      </div>
      <div className="field">
        <div className="field-l">Monto a Invertir (USD)</div>
        <div className="input-wrap">
          <span className="pfx">$</span>
          <input className="input prefix" type="number" placeholder="100" min="1" step="any" value={usdAmount} onChange={e => onAmountChange(e.target.value)}/>
          {usdAmount && parseFloat(usdAmount) > 0 && <span className="sfx">USD</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {QUICK.map(v => <button key={v} className="chip" style={{ cursor: "pointer" }} onClick={() => onAmountChange(v==="MAX"?"500":v)}>{v}{v!=="MAX"?"$":""}</button>)}
      </div>
      <button className={`btn lp-btn${isValid && !loading ? " primary" : ""}`}
        style={!isValid||loading ? { background:"rgba(255,255,255,.04)", border:"1px solid var(--line)", color:"var(--ink-4)" } : undefined}
        onClick={onFetch} disabled={!isValid||loading}>
        {loading ? "CONSULTANDO HELIUS…" : <>Cargar Token <IcArrow /></>}
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LPManager() {
  const [state, setState] = useState<AppState>(INITIAL);
  const [editedConfig, setEditedConfig] = useState<DLMMConfig | null>(null);
  const [calculatedPosition, setCalculatedPosition] = useState<CalculatedPosition | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("dlmm");
  const [rightState, setRightState] = useState<RightState>("empty");
  const [openTxHash, setOpenTxHash] = useState<string | null>(null);
  const [openSwapHash, setOpenSwapHash] = useState<string | null>(null);
  const [solPrice, setSolPrice] = useState<number | null>(null);

  const walletAddress = process.env.NEXT_PUBLIC_WALLET_ADDRESS;

  const activeConfig = state.selectedStrategy ? (editedConfig ?? STRATEGIES[state.selectedStrategy].dlmmConfig) : null;
  const tokenImageUrl = state.tokenData?.content?.links?.image ?? state.tokenData?.content?.files?.[0]?.cdn_uri ?? null;

  // SOL price
  useEffect(() => { fetch("/api/price?ca=So11111111111111111111111111111111111111112").then(r=>r.json()).then(d=>{if(d.price)setSolPrice(d.price)}).catch(()=>{}); }, []);

  // Recalculate
  const { selectedStrategy, tokenPrice, usdAmount } = state;
  useEffect(() => {
    if (!selectedStrategy || !tokenPrice || !parseFloat(usdAmount)) { setCalculatedPosition(null); return; }
    const cfg = editedConfig ?? STRATEGIES[selectedStrategy].dlmmConfig;
    setCalculatedPosition(calculatePosition(parseFloat(usdAmount), tokenPrice, cfg));
  }, [editedConfig, selectedStrategy, tokenPrice, usdAmount]);

  // Fetch token
  const handleFetchToken = useCallback(async () => {
    if (!state.tokenCA || !parseFloat(state.usdAmount)) return;
    setState(s => ({ ...s, loading:true, error:null, tokenData:null, tokenPrice:null, priceSource:"none", selectedStrategy:null, pools:[], bestPool:null, poolLoading:true, poolError:null, walletBalance:null }));
    setEditedConfig(null); setCalculatedPosition(null); setRightState("empty"); setOpenTxHash(null);
    try {
      const res = await fetch(`/api/token?ca=${encodeURIComponent(state.tokenCA)}`);
      const data: TokenApiResponse & { error?: string } = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `Error ${res.status}`);
      setState(s => ({ ...s, loading:false, tokenData:data.asset, tokenPrice:data.price, priceSource:data.priceSource??"none" }));
    } catch (err: unknown) {
      setState(s => ({ ...s, loading:false, poolLoading:false, error:err instanceof Error?err.message:"Error" }));
    }
  }, [state.tokenCA, state.usdAmount]);

  // Fetch pools
  useEffect(() => {
    if (!state.tokenData || !state.tokenCA) return;
    let cancelled = false;
    fetch(`/api/pool?mint=${encodeURIComponent(state.tokenCA)}`).then(r=>r.json()).then((data: PoolSearchResponse & { error?: string }) => {
      if (cancelled) return;
      if (data.error) { setState(s=>({...s,poolLoading:false,poolError:data.error??"Error"})); return; }
      const noPool = data.pools.length === 0;
      setState(s=>({...s,poolLoading:false,pools:data.pools,bestPool:data.bestPool,poolError:noPool?"No hay pools DLMM para este token":null}));
      if (noPool) setRightState("create-pool");
    }).catch(()=>{ if(!cancelled) setState(s=>({...s,poolLoading:false,poolError:"Error de red"})); });
    return () => { cancelled = true; };
  }, [state.tokenData, state.tokenCA]);

  // Wallet balance
  useEffect(() => {
    if (!state.tokenData || !state.tokenCA) return;
    let cancelled = false;
    fetch(`/api/balance?mint=${encodeURIComponent(state.tokenCA)}`).then(r=>r.json()).then(data=>{
      if(cancelled||data.error) return;
      setState(s=>({...s,walletBalance:{tokenUI:data.token?.uiAmount??0,tokenRaw:data.token?.amountRaw??"0",tokenDecimals:data.token?.decimals??0,tokenExists:data.token?.exists??false,solUI:data.sol?.sol??0}}));
    }).catch(()=>{});
    return () => { cancelled = true; };
  }, [state.tokenData, state.tokenCA]);

  const handleSelectStrategy = useCallback((condition: MarketCondition) => {
    setEditedConfig(null); setState(s=>({...s,selectedStrategy:condition}));
    setRightState("position");
  }, []);
  const handleConfigChange = useCallback((cfg: DLMMConfig) => setEditedConfig(cfg), []);
  const handleRefreshPrice = useCallback(async () => {
    if (!state.tokenCA) return;
    try { const res = await fetch(`/api/price?ca=${encodeURIComponent(state.tokenCA)}`); const data = await res.json(); if(data.price!=null) setState(s=>({...s,tokenPrice:data.price,priceSource:data.source??s.priceSource})); } catch {}
  }, [state.tokenCA]);
  const handlePoolCreated = useCallback(() => {
    setState(s=>({...s,poolLoading:true,poolError:null}));
    setRightState("empty");
    fetch(`/api/pool?mint=${encodeURIComponent(state.tokenCA)}`).then(r=>r.json()).then(data=>{
      if(data.error){setState(s=>({...s,poolLoading:false,poolError:data.error??""}))}
      else setState(s=>({...s,poolLoading:false,pools:data.pools,bestPool:data.bestPool,poolError:null}));
    }).catch(()=>setState(s=>({...s,poolLoading:false})));
  }, [state.tokenCA]);
  const handlePositionOpened = useCallback((txH: string, swapH?: string) => {
    setOpenTxHash(txH); setOpenSwapHash(swapH ?? null);
    setRightState("position");
  }, []);

  const { tokenData, tokenPrice: tp, loading, error, selectedStrategy: ss, priceSource, bestPool, poolLoading, poolError, walletBalance } = state;
  const symbol  = tokenData?.token_info?.symbol ?? tokenData?.content?.metadata?.symbol ?? "—";
  const name    = tokenData?.content?.metadata?.name ?? "Token desconocido";
  const decimals = tokenData?.token_info?.decimals ?? 9;
  const hasConfig = !!ss && !!calculatedPosition && !!activeConfig && rightState === "position" && !!bestPool;

  // Right panel header meta
  const rcTitle = rightTab === "damm" ? "Pool DAMM v2"
    : rightState === "create-pool" ? "Crear Pool DLMM"
    : "Posición DLMM";
  const rcSub = rightTab === "damm" ? "Constant Product · Vaults · Position NFT"
    : rightState === "create-pool" ? "First LP · Configurá bin step y fee"
    : "Concentrated · Bin liquidity";
  const rcChip = rightTab === "damm" ? { label: "CP‑AMM", accent: true }
    : rightState === "create-pool" ? { label: "Sin pool", warn: true }
    : { label: "Auto · Helius", accent: false };

  return (
    <>
      <MatrixRain />
      <div className="lp-page">

        {/* ═══ TOP BAR ═════════════════════════════════════════════════════ */}
        <header className="lp-header" style={{ paddingBottom: 22 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <MatrixLogo />
              <h1 style={{ fontFamily:"var(--sans)", fontSize:18, fontWeight:600, margin:0, letterSpacing:"-.01em" }}>
                LP<span style={{ color:"var(--ink-3)", fontWeight:500 }}>Manager</span>
              </h1>
              <span style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"5px 9px", borderRadius:999, fontFamily:"var(--mono)", fontSize:10.5, letterSpacing:".14em", textTransform:"uppercase", background:"color-mix(in oklab, var(--accent) 14%, transparent)", color:"var(--accent)", border:"1px solid color-mix(in oklab, var(--accent) 35%, transparent)" }}>
                <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--accent)", boxShadow:"0 0 8px var(--accent)", display:"inline-block" }} className="pulse" />
                {getClusterLabel()}
              </span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {solPrice && <span className="pill"><span className="k">SOL</span><b>${solPrice.toFixed(2)}</b></span>}
              <Link href="/tracker" className="btn-ghost" style={{ textDecoration:"none", fontFamily:"var(--mono)", fontSize:11.5 }}>🎯 Tracker</Link>
              {walletAddress && <button className="btn-ghost" style={{ fontFamily:"var(--mono)", fontSize:11.5 }}><IcWallet /> {shortenAddress(walletAddress)}</button>}
            </div>
          </div>
        </header>

        {/* ═══ LEFT COLUMN ═════════════════════════════════════════════════ */}
        <div className="lp-col-left">
          <TokenInput tokenCA={state.tokenCA} usdAmount={state.usdAmount} loading={loading}
            onCAChange={v=>setState(s=>({...s,tokenCA:v}))} onAmountChange={v=>setState(s=>({...s,usdAmount:v}))} onFetch={handleFetchToken}/>

          {error && <div className="banner fade-in" style={{ background:"color-mix(in oklab, var(--danger) 10%, transparent)", borderColor:"color-mix(in oklab, var(--danger) 28%, transparent)", color:"var(--danger)" }}><IcWarn />{error}</div>}

          {/* Token card */}
          {tokenData && (
            <div className="card fade-in">
              <div className="token">
                {tokenImageUrl
                  ? <img src={tokenImageUrl} alt={symbol} className="avatar" style={{ width:46, height:46, borderRadius:12, objectFit:"cover", border:"1px solid var(--line-2)", flexShrink:0 }} onError={e=>{(e.target as HTMLImageElement).style.display="none"}} />
                  : <div className="avatar" style={{ width:46, height:46, borderRadius:12 }}/>
                }
                <div>
                  <div className="name">{symbol}<span className="alt mono">{name}</span></div>
                  <div className="ca">{shortenAddress(state.tokenCA, 6)}</div>
                </div>
                <div>
                  {tp!=null ? <>
                    <div className="price">{formatUSD(tp)}</div>
                    <div className="src" style={{ cursor:"pointer" }} onClick={handleRefreshPrice}>↧ {priceSource==="jupiter"?"Jupiter":"DexScreener"}</div>
                  </> : <div className="price" style={{ color:"var(--warn)", fontSize:12 }}>sin precio</div>}
                </div>
              </div>
              {walletBalance && <>
                <div className="divider"/>
                <div className="stat-row"><span className="l">Wallet</span><span className="v">{walletBalance.tokenUI.toLocaleString(undefined,{maximumFractionDigits:4})} <span style={{color:"var(--ink-3)"}}>{symbol}</span></span></div>
                <div className="stat-row" style={{ marginTop:8 }}><span className="l">Balance SOL</span><span className={`v${walletBalance.solUI<.001?" danger":""}`}>{walletBalance.solUI.toFixed(4)} SOL</span></div>
              </>}
            </div>
          )}

          {/* Pool status card */}
          {tokenData && (
            <div className="card fade-in">
              <div className="card-h" style={{ marginBottom: bestPool ? 10 : 0 }}>
                <div className="title" style={!bestPool?{color:"var(--warn)"}:{}}>
                  <span className={`led${!bestPool?" warn":""}`}/>Pool DLMM
                </div>
                <div className="meta">{poolLoading?"ESCANEANDO…":bestPool?"ACTIVO":poolError?"0 RESULTS":""}</div>
              </div>
              {bestPool ? (
                <>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                    <span style={{ fontFamily:"var(--mono)", fontSize:12, color:"var(--ink)" }}>{bestPool.name}</span>
                    <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"var(--accent)", background:"color-mix(in oklab, var(--accent) 12%, transparent)", padding:"2px 7px", borderRadius:6, border:"1px solid color-mix(in oklab, var(--accent) 30%, transparent)" }}>{bestPool.bin_step} bps</span>
                  </div>
                  <div style={{ display:"flex", gap:12, fontFamily:"var(--mono)", fontSize:10.5, color:"var(--ink-3)" }}>
                    <span>TVL {formatUSD(parseFloat(bestPool.liquidity)||0)}</span>
                    <span>Vol {formatUSD(bestPool.trade_volume_24h||0)}</span>
                    <span>Fee {bestPool.base_fee_percentage}%</span>
                  </div>
                </>
              ) : poolError ? (
                <>
                  <div className="banner" style={{ marginBottom:12 }}><IcWarn /><div>{poolError}</div></div>
                  <button className="btn btn-warn" onClick={() => { setRightTab("dlmm"); setRightState("create-pool"); }}>
                    <IcSparkle /> Crear el primero
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Strategy selector */}
          {tokenData && tp!=null && bestPool && rightTab === "dlmm" && (
            <StrategySelector selected={ss} onSelect={handleSelectStrategy}/>
          )}
        </div>

        {/* ═══ RIGHT COLUMN ════════════════════════════════════════════════ */}
        <div className="lp-col-right">
          {tokenData ? (
            <div className="card right-card">
              {/* Tabs */}
              <div style={{ padding:"18px 18px 0" }}>
                <div className="tabs">
                  <div className={`tab${rightTab==="dlmm"?" active":""}`} onClick={()=>setRightTab("dlmm")}>
                    <span className="ic"><IcLayers/></span>LP Position (DLMM)<span className="badge">v3</span>
                  </div>
                  <div className={`tab${rightTab==="damm"?" active":""}`} onClick={()=>setRightTab("damm")}>
                    <span className="ic"><IcVault/></span>Crear Pool (DAMM v2)<span className="badge">BETA</span>
                  </div>
                </div>
              </div>

              {/* Sub-header */}
              <div className="rc-head">
                <div className="ttl"><b>{rcTitle}</b><span className="sub">{rcSub}</span></div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  {rcChip.label && (
                    <span className={`chip${rcChip.accent?" accent":""}${(rcChip as {warn?:boolean}).warn?" warn":""}`}
                      style={(rcChip as {warn?:boolean}).warn ? { color:"var(--warn)", background:"color-mix(in oklab, var(--warn) 12%, transparent)", borderColor:"color-mix(in oklab, var(--warn) 28%, transparent)" } : {}}>
                      {(rcChip as {warn?:boolean}).warn && <IcWarn />}{rcChip.label}
                    </span>
                  )}
                  <button className="btn-ghost" style={{ padding:"6px 10px" }}><IcRefresh /> Buscar pool</button>
                </div>
              </div>

              {/* Body */}
              <div className={`rc-body${(rightTab==="damm" || rightState==="create-pool" || (rightState==="position" && hasConfig)) ? " rc-body-form" : ""}`}>
                {rightTab === "damm" ? (
                  tp!=null ? <DAMMv2Creator tokenCA={state.tokenCA} tokenSymbol={symbol} tokenDecimals={decimals} tokenPrice={tp}/> : <EmptyState hasPool={false}/>
                ) : rightState === "create-pool" && tp!=null ? (
                  <CreatePoolBody tokenCA={state.tokenCA} tokenSymbol={symbol} tokenPrice={tp} solPrice={solPrice} onCreated={handlePoolCreated}/>
                ) : rightState === "position" && openTxHash && bestPool ? (
                  <PositionView pool={bestPool} tokenSymbol={symbol} txHash={openTxHash} swapHash={openSwapHash??undefined}/>
                ) : hasConfig && tp && bestPool ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:0, width:"100%" }}>
                    <ConfigPanel condition={ss!} config={activeConfig!} tokenPrice={tp} tokenSymbol={symbol}
                      binStep={bestPool.bin_step} baseFee={bestPool.base_fee_percentage} onConfigChange={handleConfigChange}/>
                    <div style={{ borderTop:"1px solid var(--line)", paddingTop:20, marginTop:4 }}>
                      <PositionCalculator position={calculatedPosition!} condition={ss!} config={activeConfig!}
                        tokenPrice={tp} usdAmount={state.usdAmount} asset={tokenData} pool={bestPool}
                        tokenCA={state.tokenCA} walletBalance={walletBalance} solPrice={solPrice}/>
                    </div>
                  </div>
                ) : (
                  <EmptyState hasPool={!!bestPool}/>
                )}
              </div>
            </div>
          ) : (
            <div className="lp-col-right-placeholder">
              <div className="empty" style={{ maxWidth: 480 }}>
                <div className="vis">
                  <div className="bins">{BIN_HEIGHTS_29.map((h,i)=><div key={i} className={`bin${Math.abs(i-14)>=4?" dim":""}`} style={{height:`${h}%`}}/>)}</div>
                  <div className="price-line"/><div className="price-tag">precio actual</div>
                </div>
                <div><h2>Seleccioná o creá un pool</h2><p>Cargá un token para escanear pools DLMM o creá el primero y configurá el rango de bins.</p></div>
                <div className="cta-row"><span className="chip accent"><IcLayers/> DLMM</span><span className="chip"><IcVault/> DAMM v2</span><span className="chip"><IcRefresh/> Auto‑rebalance</span></div>
              </div>
            </div>
          )}
        </div>

        {/* ═══ STATUS BAR ══════════════════════════════════════════════════ */}
        <div className="statusbar" style={{ gridColumn:"1 / -1" }}>
          <div className="grp"><span><span className="led"/>RPC Helius · MEV rebate</span><span>Jupiter v6 · OK</span><span>Smart TX · Priority fee auto</span></div>
          <div className="grp"><span>DLMM v1.9.9</span><span>DAMM v2 · BETA</span></div>
        </div>
      </div>
    </>
  );
}
