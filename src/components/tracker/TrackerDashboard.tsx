"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { shortenAddress, formatUSD } from "@/lib/meteora";
import DiscoverPanel from "./DiscoverPanel";
import type { TrackedToken, WalletRow, TrackerAlert, WalletKind, TokenInfo } from "@/lib/tracker/types";

const KIND_BADGE: Record<WalletKind, { label: string; color: string }> = {
  group:            { label: "🟢 grupo",   color: "var(--accent)" },
  universal_sniper: { label: "🤖 bot",      color: "var(--warn)" },
  unknown:          { label: "· s/d",       color: "var(--ink-3)" },
};

function fmtAge(ms: number | null): string {
  if (!ms) return "—";
  const h = (Date.now() - ms) / 3_600_000;
  return h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`;
}
function socialLabel(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("twitter") || t === "x") return "𝕏";
  if (t.includes("telegram")) return "TG";
  if (t.includes("discord")) return "DC";
  return "↗";
}

export default function TrackerDashboard() {
  const [tokens, setTokens] = useState<TrackedToken[]>([]);
  const [ca, setCa] = useState("");
  const [limit, setLimit] = useState("1000");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [minTokens, setMinTokens] = useState(2);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [showBots, setShowBots] = useState(true);

  const [monitoring, setMonitoring] = useState(false);
  const [monitorMsg, setMonitorMsg] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<TrackerAlert[]>([]);

  const [view, setView] = useState<"analisis" | "descubrir">("analisis");
  const [tokenInfo, setTokenInfo] = useState<Record<string, TokenInfo>>({});

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadTokens = useCallback(async () => {
    try { const d = await (await fetch("/api/tracker/tokens")).json(); setTokens(d.tokens ?? []); } catch {}
  }, []);

  const loadWallets = useCallback(async (k: number) => {
    try { const d = await (await fetch(`/api/tracker/wallets?minTokens=${k}`)).json(); setWallets(d.wallets ?? []); } catch {}
  }, []);

  const onDiscoverAdded = useCallback(() => {
    loadTokens();
    loadWallets(minTokens);
    setView("analisis");
  }, [loadTokens, loadWallets, minTokens]);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  // Enriquecimiento DexScreener (batch) cuando cambia la lista de tokens trackeados.
  const tokenMints = tokens.map((t) => t.mint).join(",");
  useEffect(() => {
    if (!tokenMints) { setTokenInfo({}); return; }
    let cancelled = false;
    fetch(`/api/tracker/token-info?mints=${tokenMints}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.info) setTokenInfo(d.info); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tokenMints]);
  useEffect(() => { loadWallets(minTokens); }, [minTokens, loadWallets]);

  // Poll de alertas cada 5s
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try { const d = await (await fetch("/api/tracker/alerts")).json(); if (!cancelled) setAlerts(d.alerts ?? []); } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const analyze = async () => {
    const mint = ca.trim();
    if (!mint) return;
    setAnalyzing(true); setError(null);
    try {
      const res = await fetch("/api/tracker/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint, limit: parseInt(limit) || 1000 }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? "Error");
      setCa("");
      await loadTokens();
      await loadWallets(minTokens);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleIgnore = async (wallet: string, isIgnored: boolean) => {
    setWallets((ws) => ws.map((w) => w.wallet === wallet ? { ...w, isIgnored } : w));
    try {
      await fetch("/api/tracker/wallets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, isIgnored }),
      });
    } catch {}
  };

  const monitor = async () => {
    setMonitoring(true); setMonitorMsg(null); setError(null);
    try {
      const res = await fetch("/api/tracker/monitor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minTokens }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? "Error");
      setMonitorMsg(`Monitoreando ${d.monitored} wallets (${d.sync?.action ?? "sync"}).`);
      await loadWallets(minTokens);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setMonitoring(false);
    }
  };

  const visibleWallets = showBots ? wallets : wallets.filter((w) => w.kind !== "universal_sniper");

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="lp-page" style={{ maxWidth: 1100 }}>
      <header className="lp-header" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 18 }}>
        <h1 style={{ fontFamily: "var(--sans)", fontSize: 18, fontWeight: 600, margin: 0 }}>
          Wallet<span style={{ color: "var(--ink-3)", fontWeight: 500 }}>Tracker</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", marginLeft: 10 }}>pump.fun · co-ocurrencia</span>
        </h1>
        <Link href="/" className="btn-ghost" style={{ textDecoration: "none", fontSize: 12 }}>← LP Manager</Link>
      </header>

      {/* Tabs */}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={view === "descubrir" ? "btn btn-primary" : "btn-ghost"} style={{ width: "auto" }} onClick={() => setView("descubrir")}>🔎 Descubrir</button>
        <button className={view === "analisis" ? "btn btn-primary" : "btn-ghost"} style={{ width: "auto" }} onClick={() => setView("analisis")}>🎯 Análisis</button>
      </div>

      <div style={{ gridColumn: "1 / -1", display: view === "descubrir" ? "block" : "none" }}>
        <DiscoverPanel onAdded={onDiscoverAdded} />
      </div>

      <div style={{ gridColumn: "1 / -1", display: view === "analisis" ? "flex" : "none", flexDirection: "column", gap: 14 }}>

        {/* ── Agregar / analizar token ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-h"><div className="title"><span className="led" />Analizar token</div></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" style={{ flex: 1, minWidth: 280 }} placeholder="Contract Address del token pump.fun"
              value={ca} onChange={(e) => setCa(e.target.value.trim())} spellCheck={false} />
            <input className="input" style={{ width: 110 }} type="number" min="1" max="10000" value={limit}
              onChange={(e) => setLimit(e.target.value)} title="primeras N compras" />
            <button className="btn btn-primary" style={{ width: "auto", opacity: analyzing ? 0.6 : 1 }}
              onClick={analyze} disabled={analyzing || !ca.trim()}>
              {analyzing ? "ANALIZANDO…" : "Analizar"}
            </button>
          </div>
          {error && <div className="banner" style={{ marginTop: 12, color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 28%, transparent)", background: "color-mix(in oklab, var(--danger) 10%, transparent)" }}>{error}</div>}
          {tokens.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {tokens.map((t) => {
                const info = tokenInfo[t.mint];
                const totalTx = info ? info.buys24h + info.sells24h : 0;
                const buyPct = totalTx > 0 ? Math.round((info!.buys24h / totalTx) * 100) : null;
                return (
                  <div key={t.mint} style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.03)", fontFamily: "var(--mono)", fontSize: 11 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <a href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 600 }}>
                        {t.symbol ?? shortenAddress(t.mint)}
                      </a>
                      <span title={t.buyersFetched ? "analizado" : "sin analizar"} style={{ color: t.buyersFetched ? "var(--accent)" : "var(--ink-3)" }}>{t.buyersFetched ? "✓" : "…"}</span>
                      {info?.dexes.map((d) => <span key={d} className="chip" style={{ padding: "1px 6px", fontSize: 9, cursor: "default" }}>{d}</span>)}
                      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        {info?.socials.slice(0, 3).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-3)", textDecoration: "none" }}>{socialLabel(s.type)}</a>)}
                        {info?.websites[0] && <a href={info.websites[0].url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-3)" }}>web</a>}
                      </span>
                    </div>
                    {info && (info.mcap > 0 || info.volume24h > 0) && (
                      <div style={{ display: "flex", gap: 12, marginTop: 5, color: "var(--ink-3)", flexWrap: "wrap" }}>
                        <span>mcap {formatUSD(info.mcap)}</span>
                        <span>vol24 {formatUSD(info.volume24h)}</span>
                        {buyPct !== null && <span style={{ color: buyPct >= 50 ? "var(--accent)" : "var(--danger)" }}>{buyPct}% buys</span>}
                        <span style={{ color: info.priceChange24h >= 0 ? "var(--accent)" : "var(--danger)" }}>{info.priceChange24h >= 0 ? "+" : ""}{info.priceChange24h.toFixed(1)}%</span>
                        <span>edad {fmtAge(info.pairCreatedAt)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Wallets co-ocurrentes ────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-h" style={{ marginBottom: 12 }}>
            <div className="title"><span className="led" />Wallets co-ocurrentes</div>
            <div className="meta">{visibleWallets.length} wallets · aparecen en ≥ {minTokens} tokens</div>
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
              Umbral
              <input type="range" min={1} max={Math.max(2, tokens.length)} value={minTokens}
                onChange={(e) => setMinTokens(parseInt(e.target.value))} style={{ accentColor: "var(--accent)" }} />
              <span style={{ color: "var(--ink)", minWidth: 16 }}>{minTokens}</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", cursor: "pointer" }}>
              <input type="checkbox" checked={showBots} onChange={(e) => setShowBots(e.target.checked)} style={{ accentColor: "var(--warn)" }} />
              mostrar bots
            </label>
            <button className="btn-ghost" style={{ marginLeft: "auto", color: "var(--accent)", borderColor: "color-mix(in oklab, var(--accent) 45%, transparent)", opacity: monitoring ? 0.6 : 1 }}
              onClick={monitor} disabled={monitoring}>
              {monitoring ? "SYNC…" : "⚡ Monitorear el grupo"}
            </button>
          </div>
          {monitorMsg && <div className="banner" style={{ marginBottom: 12, color: "var(--accent)", borderColor: "color-mix(in oklab, var(--accent) 28%, transparent)", background: "color-mix(in oklab, var(--accent) 10%, transparent)" }}>{monitorMsg}</div>}

          {visibleWallets.length === 0 ? (
            <p style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>
              Analizá varios tokens para que aparezcan wallets repetidas.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {visibleWallets.map((w) => (
                <div key={w.wallet} style={{ display: "grid", gridTemplateColumns: "1fr 70px 90px 70px 70px", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: w.isIgnored ? "rgba(255,255,255,.02)" : "rgba(255,255,255,.04)", opacity: w.isIgnored ? 0.45 : 1, fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  <a href={`https://solscan.io/account/${w.wallet}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", textDecoration: "none" }}>
                    {shortenAddress(w.wallet, 6)}{w.isMonitored && <span style={{ color: "var(--accent)" }}> ●</span>}
                  </a>
                  <span style={{ color: KIND_BADGE[w.kind].color }}>{KIND_BADGE[w.kind].label}</span>
                  <span style={{ color: "var(--ink-2)" }}>{w.tokensCount} tokens</span>
                  <span style={{ color: "var(--ink-3)" }}>{(w.ubiquityRatio * 100).toFixed(0)}%</span>
                  <button className="chip" style={{ cursor: "pointer", fontSize: 9.5 }} onClick={() => toggleIgnore(w.wallet, !w.isIgnored)}>
                    {w.isIgnored ? "incluir" : "ignorar"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Alertas en vivo ──────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-h" style={{ marginBottom: 12 }}>
            <div className="title"><span className="led" />Alertas en vivo</div>
            <div className="meta">{alerts.length} eventos</div>
          </div>
          {alerts.length === 0 ? (
            <p style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>
              Sin alertas todavía. Cuando una wallet monitoreada compre un token, aparece acá.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {alerts.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(0,232,122,0.06)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  <a href={`https://solscan.io/account/${a.wallet}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>{shortenAddress(a.wallet, 5)}</a>
                  <span style={{ color: "var(--ink-3)" }}>compró</span>
                  <a href={a.tokenMint ? `https://solscan.io/token/${a.tokenMint}` : "#"} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", textDecoration: "none", flex: 1 }}>{a.tokenMint ? shortenAddress(a.tokenMint, 5) : "—"}</a>
                  <span style={{ color: "var(--warn)" }}>{a.solIn ? `${a.solIn.toFixed(3)} SOL` : ""}</span>
                  {a.signature && <a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-3)", textDecoration: "underline" }}>tx</a>}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
