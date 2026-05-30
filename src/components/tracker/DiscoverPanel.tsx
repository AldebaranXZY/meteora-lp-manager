"use client";

import { useState } from "react";
import { formatUSD, shortenAddress } from "@/lib/meteora";
import type { DiscoveredToken } from "@/lib/tracker/types";

export default function DiscoverPanel({ onAdded }: { onAdded: () => void }) {
  const [day, setDay] = useState<1 | 2 | null>(null);
  const [tokens, setTokens] = useState<DiscoveredToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);

  const load = async (d: 1 | 2) => {
    setDay(d); setLoading(true); setError(null); setSelected(new Set());
    try {
      const res = await fetch(`/api/tracker/discover?day=${d}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error");
      setTokens(data.tokens ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
      setTokens([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (mint: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(mint)) next.delete(mint); else next.add(mint);
      return next;
    });
  };

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
        <div className="title"><span className="led" />Descubrir top de pump.fun</div>
        <div className="meta">{day ? `${tokens.length} memes · ${day === 1 ? "ayer" : "antes de ayer"}` : "elegí un día"}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button className={`btn${day === 1 ? " btn-primary" : "-ghost"}`} style={{ width: "auto" }}
          onClick={() => load(1)} disabled={loading}>Top de ayer</button>
        <button className={`btn${day === 2 ? " btn-primary" : "-ghost"}`} style={{ width: "auto" }}
          onClick={() => load(2)} disabled={loading}>Antes de ayer</button>
        {selected.size > 0 && (
          <button className="btn-ghost" style={{ marginLeft: "auto", color: "var(--accent)", borderColor: "color-mix(in oklab, var(--accent) 45%, transparent)", opacity: adding ? 0.6 : 1 }}
            onClick={addSelected} disabled={!!adding}>
            {adding ? `AGREGANDO ${adding.done}/${adding.total}…` : `+ Agregar a análisis (${selected.size})`}
          </button>
        )}
      </div>

      {error && <div className="banner" style={{ marginBottom: 12, color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 28%, transparent)", background: "color-mix(in oklab, var(--danger) 10%, transparent)" }}>{error}</div>}

      {loading ? (
        <p style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>Buscando en Bitquery…</p>
      ) : tokens.length === 0 ? (
        <p style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>
          {day ? "Sin resultados para ese día." : "Tocá \"Top de ayer\" para traer las memes con más volumen."}
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 110px 110px 110px", gap: 8, padding: "6px 10px", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            <span /><span>Ticker</span><span style={{ textAlign: "right" }}>Volumen</span><span style={{ textAlign: "right" }}>Mcap máx</span><span style={{ textAlign: "right" }}>Mcap actual</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 520, overflowY: "auto" }}>
            {tokens.map((t) => {
              const dumped = t.mcapMax > 0 && t.mcapNow < t.mcapMax * 0.5;
              return (
                <div key={t.mint} style={{ display: "grid", gridTemplateColumns: "24px 1fr 110px 110px 110px", gap: 8, alignItems: "center", padding: "7px 10px", borderRadius: 8, background: selected.has(t.mint) ? "color-mix(in oklab, var(--accent) 10%, transparent)" : "rgba(255,255,255,.03)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  <input type="checkbox" checked={selected.has(t.mint)} onChange={() => toggle(t.mint)} style={{ accentColor: "var(--accent)" }} />
                  <a href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", textDecoration: "none" }}>
                    {t.symbol || shortenAddress(t.mint, 5)}
                  </a>
                  <span style={{ textAlign: "right", color: "var(--ink-2)" }}>{formatUSD(t.volumeUsd)}</span>
                  <span style={{ textAlign: "right", color: "var(--ink-3)" }}>{formatUSD(t.mcapMax)}</span>
                  <span style={{ textAlign: "right", color: dumped ? "var(--danger)" : "var(--accent)" }}>{formatUSD(t.mcapNow)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
