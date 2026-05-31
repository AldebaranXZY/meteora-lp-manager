"use client";

import { useState } from "react";
import { formatUSD, shortenAddress } from "@/lib/meteora";
import type { DiscoveredToken } from "@/lib/tracker/types";

type Mode = "top24h" | "trending" | "recent";
const MODES: { key: Mode; label: string }[] = [
  { key: "top24h", label: "Top 24h" },
  { key: "trending", label: "Trending" },
  { key: "recent", label: "Recién creadas" },
];

export default function DiscoverPanel({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [tokens, setTokens] = useState<DiscoveredToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);

  const load = async (m: Mode) => {
    setMode(m); setLoading(true); setError(null); setSelected(new Set());
    try {
      const res = await fetch(`/api/tracker/discover?mode=${m}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error");
      setTokens(data.tokens ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error"); setTokens([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (mint: string) => setSelected((s) => {
    const next = new Set(s); next.has(mint) ? next.delete(mint) : next.add(mint); return next;
  });

  const addSelected = async () => {
    const mints = [...selected];
    if (mints.length === 0) return;
    setAdding({ done: 0, total: mints.length }); setError(null);
    try {
      for (let i = 0; i < mints.length; i++) {
        await fetch("/api/tracker/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mint: mints[i] }),
        });
        setAdding({ done: i + 1, total: mints.length });
      }
      setSelected(new Set());
      onAdded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="card">
      <div className="card-h" style={{ marginBottom: 12 }}>
        <div className="title"><span className="led" />Descubrir memes de pump.fun</div>
        <div className="meta">{mode ? `${tokens.length} tokens · ${MODES.find((x) => x.key === mode)?.label}` : "elegí un modo"}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {MODES.map((m) => (
          <button key={m.key} className={mode === m.key ? "btn btn-primary" : "btn-ghost"} style={{ width: "auto" }}
            onClick={() => load(m.key)} disabled={loading}>{m.label}</button>
        ))}
        {selected.size > 0 && (
          <button className="btn-ghost" style={{ marginLeft: "auto", color: "var(--accent)", borderColor: "color-mix(in oklab, var(--accent) 45%, transparent)", opacity: adding ? 0.6 : 1 }}
            onClick={addSelected} disabled={!!adding}>
            {adding ? `AGREGANDO ${adding.done}/${adding.total}…` : `+ Agregar a análisis (${selected.size})`}
          </button>
        )}
      </div>

      {error && <div className="banner" style={{ marginBottom: 12, color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 28%, transparent)", background: "color-mix(in oklab, var(--danger) 10%, transparent)" }}>{error}</div>}

      {loading ? (
        <p style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>Buscando en Jupiter…</p>
      ) : tokens.length === 0 ? (
        <p style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>
          {mode ? "Sin resultados." : "Elegí un modo para traer las memes de pump.fun más activas."}
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 90px 70px 60px 70px", gap: 8, padding: "6px 10px", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            <span /><span>Ticker</span><span style={{ textAlign: "right" }}>Vol 24h</span><span style={{ textAlign: "right" }}>Mcap</span><span style={{ textAlign: "right" }}>Holders</span><span style={{ textAlign: "right" }}>Organic</span><span style={{ textAlign: "right" }}>Dev</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 520, overflowY: "auto" }}>
            {tokens.map((t) => (
              <div key={t.mint} style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 90px 70px 60px 70px", gap: 8, alignItems: "center", padding: "7px 10px", borderRadius: 8, background: selected.has(t.mint) ? "color-mix(in oklab, var(--accent) 10%, transparent)" : "rgba(255,255,255,.03)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
                <input type="checkbox" checked={selected.has(t.mint)} onChange={() => toggle(t.mint)} style={{ accentColor: "var(--accent)" }} />
                <a href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", textDecoration: "none" }}>
                  {t.symbol || shortenAddress(t.mint, 5)}
                </a>
                <span style={{ textAlign: "right", color: "var(--ink-2)" }}>{formatUSD(t.volumeUsd)}</span>
                <span style={{ textAlign: "right", color: "var(--ink-3)" }}>{formatUSD(t.mcap)}</span>
                <span style={{ textAlign: "right", color: "var(--ink-3)" }}>{t.holders.toLocaleString()}</span>
                <span style={{ textAlign: "right", color: t.organicScore >= 50 ? "var(--accent)" : "var(--warn)" }}>{t.organicScore.toFixed(0)}</span>
                <span style={{ textAlign: "right" }}>
                  {t.dev ? <a href={`https://solscan.io/account/${t.dev}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-3)", textDecoration: "underline" }}>{shortenAddress(t.dev, 3)}</a> : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
