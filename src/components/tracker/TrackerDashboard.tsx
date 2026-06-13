"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { shortenAddress, formatUSD } from "@/lib/meteora";
import DiscoverPanel from "./DiscoverPanel";
import type { TrackedToken, WalletRow, TrackerAlert, WalletKind, TokenInfo, GroupSummary, WalletDetail, RecomputeStats, TokenOutcome } from "@/lib/tracker/types";

const KIND_BADGE: Record<WalletKind, { label: string; color: string }> = {
  group:            { label: "🟢 grupo",   color: "var(--accent)" },
  universal_sniper: { label: "🤖 bot",      color: "var(--warn)" },
  unknown:          { label: "· s/d",       color: "var(--ink-3)" },
};

const OUTCOME_BADGE: Record<TokenOutcome, { label: string; color: string }> = {
  winner:  { label: "ganó",  color: "var(--accent)" },
  rug:     { label: "rug",   color: "var(--danger)" },
  pending: { label: "abierto", color: "var(--ink-3)" },
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
  const [deepAnalyzing, setDeepAnalyzing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [minTokens, setMinTokens] = useState(2);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [showBots, setShowBots] = useState(true);
  const [onlyProfitable, setOnlyProfitable] = useState(false);

  const [monitoring, setMonitoring] = useState(false);
  const [monitorMsg, setMonitorMsg] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<TrackerAlert[]>([]);

  const [view, setView] = useState<"analisis" | "descubrir">("analisis");
  const [tokenInfo, setTokenInfo] = useState<Record<string, TokenInfo>>({});

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [recomputeStats, setRecomputeStats] = useState<RecomputeStats | null>(null);
  const [detail, setDetail] = useState<WalletDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadTokens = useCallback(async () => {
    try { const d = await (await fetch("/api/tracker/tokens")).json(); setTokens(d.tokens ?? []); } catch {}
  }, []);

  const loadWallets = useCallback(async (k: number) => {
    try { const d = await (await fetch(`/api/tracker/wallets?minTokens=${k}`)).json(); setWallets(d.wallets ?? []); } catch {}
  }, []);

  const loadGroups = useCallback(async () => {
    try { const d = await (await fetch("/api/tracker/groups")).json(); setGroups(d.groups ?? []); } catch {}
  }, []);

  const onDiscoverAdded = useCallback(() => {
    loadTokens();
    loadWallets(minTokens);
    loadGroups();
    setView("analisis");
  }, [loadTokens, loadWallets, loadGroups, minTokens]);

  useEffect(() => { loadTokens(); loadGroups(); }, [loadTokens, loadGroups]);

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
      // Recompute de co-ocurrencia tras el análisis single (el batch del discover
      // lo hace en su propio flujo).
      const rc = await (await fetch("/api/tracker/recompute", { method: "POST" })).json();
      if (rc.stats) setRecomputeStats(rc.stats);
      setCa("");
      await loadTokens();
      await loadWallets(minTokens);
      await loadGroups();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setAnalyzing(false);
    }
  };

  const deepAnalyze = async (mint: string) => {
    setDeepAnalyzing(mint); setError(null);
    try {
      const res = await fetch("/api/tracker/deep-analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? "Error");
      if (d.recomputeStats) setRecomputeStats(d.recomputeStats);
      await loadTokens();
      await loadWallets(minTokens);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setDeepAnalyzing(null);
    }
  };

  const openDetail = async (wallet: string) => {
    setDetailLoading(true); setDetail(null);
    try {
      const d = await (await fetch(`/api/tracker/wallet?address=${wallet}`)).json();
      if (d.detail) setDetail(d.detail);
    } catch { /* noop */ } finally { setDetailLoading(false); }
  };

  const exportGroup = (g: GroupSummary) => {
    const csv = "wallet\n" + g.wallets.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `grupo-${g.groupId}.csv`; a.click();
    URL.revokeObjectURL(url);
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

  // "Rentable" = buen win-rate (buen picker) O PnL realizado positivo (plata real).
  const isProfitable = (w: WalletRow) => (w.plays >= 2 && w.winRate >= 0.5) || w.realizedPnl > 0;
  const visibleWallets = wallets
    .filter((w) => showBots || w.kind !== "universal_sniper")
    .filter((w) => !onlyProfitable || isProfitable(w));

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
                      {t.stats?.likelyTruncated && (
                        <span title={`Tope de paginación alcanzado (${t.stats.signaturesScanned} firmas, ${t.stats.pagesUsed} páginas): los early buyers pueden NO arrancar en el origen.`}
                          style={{ color: "var(--danger)", fontSize: 9.5, fontWeight: 600 }}>⚠ truncado</span>
                      )}
                      {t.stats?.likelyMigrated && !t.stats?.likelyTruncated && (
                        <span title="Sin actividad reciente en la bonding curve: probablemente migró o murió." style={{ color: "var(--warn)", fontSize: 9.5 }}>migrado</span>
                      )}
                      {t.outcome !== "pending" && (
                        <span title="desenlace del token (para win-rate)" style={{ color: OUTCOME_BADGE[t.outcome].color, fontSize: 9.5, fontWeight: 600 }}>{OUTCOME_BADGE[t.outcome].label}</span>
                      )}
                      {info?.dexes.map((d) => <span key={d} className="chip" style={{ padding: "1px 6px", fontSize: 9, cursor: "default" }}>{d}</span>)}
                      <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                        <button onClick={() => deepAnalyze(t.mint)} disabled={deepAnalyzing === t.mint}
                          title={t.deepAnalyzed ? "ledger bajado — recalcular PnL realizado" : "bajar ledger completo (buys+sells) y computar PnL realizado — CARO, parsea todas las firmas"}
                          className="chip" style={{ cursor: "pointer", fontSize: 9, color: t.deepAnalyzed ? "var(--accent)" : "var(--ink-2)", opacity: deepAnalyzing === t.mint ? 0.6 : 1 }}>
                          {deepAnalyzing === t.mint ? "PnL…" : t.deepAnalyzed ? "PnL ✓" : "PnL"}
                        </button>
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
                    {t.stats && (
                      <div style={{ display: "flex", gap: 12, marginTop: 4, color: "var(--ink-3)", fontSize: 10, flexWrap: "wrap" }}>
                        <span>{t.stats.buyersFound} buyers</span>
                        <span>{t.stats.signaturesScanned.toLocaleString()} firmas · {t.stats.pagesUsed}p</span>
                        {t.stats.hitPageCap && <span style={{ color: "var(--danger)" }}>tope alcanzado (sin génesis)</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Grupos coordinados ───────────────────────────────────────────────── */}
        {groups.length > 0 && (
          <div className="card">
            <div className="card-h" style={{ marginBottom: 12 }}>
              <div className="title"><span className="led" />Grupos coordinados</div>
              <div className="meta">{groups.length} clusters detectados por co-ocurrencia</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {groups.map((g) => (
                <div key={g.groupId} style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(0,232,122,0.06)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>G{g.groupId}</span>
                    <span style={{ color: "var(--ink-2)" }}>{g.size} wallets</span>
                    <span style={{ color: "var(--ink-3)" }} title="densidad interna del cluster">cohesión {(g.cohesion * 100).toFixed(0)}%</span>
                    <span style={{ color: "var(--ink-3)" }} title="tokens co-comprados (máx de un par)">≤{g.sharedTokens} tokens en común</span>
                    <button className="chip" style={{ marginLeft: "auto", cursor: "pointer", fontSize: 9.5 }} onClick={() => exportGroup(g)}>export CSV</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {g.wallets.slice(0, 12).map((w) => (
                      <button key={w} onClick={() => openDetail(w)} title="ver detalle"
                        style={{ background: "rgba(255,255,255,.04)", border: "none", borderRadius: 6, padding: "2px 6px", color: "var(--ink-2)", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 10 }}>
                        {shortenAddress(w, 4)}
                      </button>
                    ))}
                    {g.wallets.length > 12 && <span style={{ color: "var(--ink-3)", fontSize: 10 }}>+{g.wallets.length - 12}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Wallets co-ocurrentes ────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-h" style={{ marginBottom: 12 }}>
            <div className="title"><span className="led" />Wallets co-ocurrentes</div>
            <div className="meta">
              {visibleWallets.length} wallets · ≥ {minTokens} tokens
              {recomputeStats && ` · ${recomputeStats.groupsFound} grupos · ${recomputeStats.profitableWallets} rentables · lift med ${recomputeStats.medianLift.toFixed(1)}`}
            </div>
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
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", cursor: "pointer" }}>
              <input type="checkbox" checked={onlyProfitable} onChange={(e) => setOnlyProfitable(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
              solo rentables
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
                <div key={w.wallet} style={{ display: "grid", gridTemplateColumns: "1fr 60px 66px 66px 60px 56px", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: w.isIgnored ? "rgba(255,255,255,.02)" : "rgba(255,255,255,.04)", opacity: w.isIgnored ? 0.45 : 1, fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <button onClick={() => openDetail(w.wallet)} title="ver detalle (tokens + co-buyers)"
                      style={{ background: "none", border: "none", padding: 0, color: "var(--ink)", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11.5 }}>
                      {shortenAddress(w.wallet, 6)}{w.isMonitored && <span style={{ color: "var(--accent)" }}> ●</span>}
                    </button>
                    {w.groupId !== null && <span className="chip" style={{ padding: "1px 6px", fontSize: 9, cursor: "default", color: "var(--accent)" }}>G{w.groupId}</span>}
                    <a href={`https://solscan.io/account/${w.wallet}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: 10 }}>↗</a>
                  </div>
                  <span style={{ color: KIND_BADGE[w.kind].color }}>{KIND_BADGE[w.kind].label}</span>
                  <span style={{ color: "var(--ink-2)" }}>{w.tokensCount} tokens</span>
                  <span title={w.pnlTokens > 0 ? `PnL realizado ${w.realizedPnl.toFixed(3)} SOL (${w.pnlTokens} tokens con ledger). Tocá "PnL" en un token para bajarlo.` : "sin deep-analyze: tocá \"PnL\" en un token para computar PnL realizado"}
                    style={{ textAlign: "right", color: w.pnlTokens === 0 ? "var(--ink-3)" : w.realizedPnl >= 0 ? "var(--accent)" : "var(--danger)" }}>
                    {w.pnlTokens > 0 ? `${w.realizedPnl >= 0 ? "+" : ""}${w.realizedPnl.toFixed(1)}◎` : "—"}
                  </span>
                  <span title={w.plays > 0 ? `win-rate ${(w.winRate * 100).toFixed(0)}% — ${w.wins}/${w.plays} tokens con desenlace` : "sin tokens con desenlace todavía"}
                    style={{ textAlign: "right", color: w.plays >= 2 && w.winRate >= 0.5 ? "var(--accent)" : "var(--ink-3)" }}>
                    {w.plays > 0 ? `${w.wins}/${w.plays} ${(w.winRate * 100).toFixed(0)}%` : "—"}
                  </span>
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

      {/* ── Drill-down de wallet (overlay) ───────────────────────────────────── */}
      {(detail || detailLoading) && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 640, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <div className="card-h" style={{ marginBottom: 12 }}>
              <div className="title"><span className="led" />Detalle de wallet</div>
              <button className="chip" style={{ cursor: "pointer" }} onClick={() => setDetail(null)}>cerrar</button>
            </div>
            {detailLoading ? (
              <p style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>Cargando…</p>
            ) : detail ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "var(--mono)", fontSize: 11.5 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <a href={`https://solscan.io/account/${detail.wallet}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)" }}>{shortenAddress(detail.wallet, 8)}</a>
                  <span style={{ color: KIND_BADGE[detail.kind].color }}>{KIND_BADGE[detail.kind].label}</span>
                  {detail.groupId !== null && <span className="chip" style={{ color: "var(--accent)" }}>G{detail.groupId}</span>}
                  <span style={{ color: "var(--ink-3)" }}>{detail.tokensCount} tokens · {(detail.ubiquityRatio * 100).toFixed(0)}%</span>
                  <span title="win-rate sobre tokens con desenlace" style={{ color: detail.plays >= 2 && detail.winRate >= 0.5 ? "var(--accent)" : "var(--ink-3)" }}>
                    win-rate {detail.plays > 0 ? `${(detail.winRate * 100).toFixed(0)}% (${detail.wins}/${detail.plays})` : "s/d"}
                  </span>
                  <span title="PnL realizado en SOL (tokens con ledger)" style={{ color: detail.pnlTokens === 0 ? "var(--ink-3)" : detail.realizedPnl >= 0 ? "var(--accent)" : "var(--danger)" }}>
                    PnL {detail.pnlTokens > 0 ? `${detail.realizedPnl >= 0 ? "+" : ""}${detail.realizedPnl.toFixed(2)} SOL` : "s/d"}
                  </span>
                </div>
                <div>
                  <div style={{ color: "var(--ink-3)", fontSize: 10, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".1em" }}>Tokens comprados ({detail.tokens.length})</div>
                  {detail.tokens.map((t) => (
                    <div key={t.mint} style={{ display: "flex", gap: 10, padding: "3px 0", color: "var(--ink-2)", alignItems: "center" }}>
                      <a href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", flex: 1, textDecoration: "none" }}>{t.symbol ?? shortenAddress(t.mint, 5)}</a>
                      <span style={{ color: OUTCOME_BADGE[t.outcome].color, fontSize: 10 }}>{OUTCOME_BADGE[t.outcome].label}</span>
                      <span style={{ color: "var(--ink-3)" }}>#{t.rank}</span>
                      <span style={{ color: "var(--warn)" }}>{t.solIn.toFixed(3)} SOL</span>
                      {t.realizedPnl !== null && (
                        <span title="PnL realizado de este token" style={{ color: t.realizedPnl >= 0 ? "var(--accent)" : "var(--danger)", minWidth: 64, textAlign: "right" }}>
                          {t.realizedPnl >= 0 ? "+" : ""}{t.realizedPnl.toFixed(2)}◎
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ color: "var(--ink-3)", fontSize: 10, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".1em" }}>Co-buyers ({detail.coBuyers.length})</div>
                  {detail.coBuyers.length === 0 ? (
                    <span style={{ color: "var(--ink-3)" }}>Sin co-ocurrencias significativas.</span>
                  ) : detail.coBuyers.map((c) => (
                    <div key={c.wallet} style={{ display: "flex", gap: 10, padding: "3px 0", alignItems: "center" }}>
                      <button onClick={() => openDetail(c.wallet)} style={{ background: "none", border: "none", padding: 0, color: "var(--ink)", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11.5, flex: 1, textAlign: "left" }}>{shortenAddress(c.wallet, 6)}</button>
                      <span style={{ color: "var(--ink-3)" }}>{c.shared} en común</span>
                      <span style={{ color: "var(--accent)" }}>lift {c.lift.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
