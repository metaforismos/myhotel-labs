"use client";

import { useCallback, useEffect, useState } from "react";
import { PLGFunnelChart } from "@/components/analytics/PLGFunnelChart";
import type { GA4FunnelStepResult } from "@/lib/analytics/ga4-client";

interface BranchResult {
  id: string;
  title: string;
  steps: GA4FunnelStepResult[];
  totalConversion: number;
}

interface FunnelResponse {
  dateRange: { startDate: string; endDate: string };
  branches: BranchResult[];
  generatedAt: string;
}

type PresetKey = "7d" | "30d" | "90d" | "custom";

function formatDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function rangeFromPreset(preset: Exclude<PresetKey, "custom">): {
  startDate: string;
  endDate: string;
} {
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const end = new Date();
  const start = new Date();
  start.setUTCDate(end.getUTCDate() - (days - 1));
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

const pct = (v: number) =>
  `${(v * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

export default function ConciergePLGFunnelPage() {
  const [preset, setPreset] = useState<PresetKey>("30d");
  const initial = rangeFromPreset("30d");
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);

  const fetchFunnel = useCallback(
    async (
      s: string,
      e: string,
      opts: { bypassCache?: boolean } = {},
    ) => {
      setLoading(true);
      setError(null);
      try {
        const qs = opts.bypassCache ? "?nocache=1" : "";
        const res = await fetch(`/api/analytics/funnels/concierge-plg${qs}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: s, endDate: e }),
        });
        setCacheStatus(res.headers.get("x-cache"));
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? `Request failed (${res.status})`);
          setData(null);
        } else {
          setData(json);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchFunnel(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = (p: Exclude<PresetKey, "custom">) => {
    const r = rangeFromPreset(p);
    setPreset(p);
    setStartDate(r.startDate);
    setEndDate(r.endDate);
    fetchFunnel(r.startDate, r.endDate);
  };

  const applyCustom = () => {
    setPreset("custom");
    fetchFunnel(startDate, endDate);
  };

  const winner =
    data && data.branches.length > 1
      ? [...data.branches].sort((a, b) => b.totalConversion - a.totalConversion)[0]
      : null;

  return (
    <div className="pt-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Concierge PLG Funnel</h1>
        <p className="text-sm text-text-muted max-w-2xl">
          Conversión desde que un hotel abre el producto Concierge hasta que agenda una demo o
          completa el free trial por WhatsApp. Datos en vivo desde GA4.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left: filters (sticky) */}
        <div className="lg:sticky lg:top-6 lg:self-start space-y-4">
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
              Rango
            </div>

            <div className="flex gap-1 p-0.5 bg-surface-2 rounded-md mb-3">
              {(["7d", "30d", "90d"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => applyPreset(p)}
                  className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${
                    preset === p
                      ? "bg-surface text-text shadow-sm"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  {p === "7d" ? "7 días" : p === "30d" ? "30 días" : "90 días"}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="block">
                <span className="text-[11px] text-text-dim">Desde</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPreset("custom");
                  }}
                  max={endDate}
                  className="mt-0.5 w-full bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent/50"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-text-dim">Hasta</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPreset("custom");
                  }}
                  min={startDate}
                  className="mt-0.5 w-full bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent/50"
                />
              </label>
            </div>

            <button
              onClick={applyCustom}
              disabled={loading}
              className="mt-3 w-full bg-accent/20 text-accent-light px-3 py-2 rounded-md text-xs font-medium hover:bg-accent/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Cargando…" : "Aplicar"}
            </button>

            <button
              onClick={() => fetchFunnel(startDate, endDate, { bypassCache: true })}
              disabled={loading}
              className="mt-1.5 w-full text-[11px] text-text-dim hover:text-text transition-colors py-1 disabled:opacity-50"
            >
              Refrescar (ignorar caché)
            </button>
          </div>

          {data && (
            <div className="bg-surface border border-border rounded-lg p-4 text-[11px] text-text-dim space-y-1">
              <div>
                Generado:{" "}
                <span className="font-mono text-text-muted">
                  {new Date(data.generatedAt).toLocaleString()}
                </span>
              </div>
              {cacheStatus && (
                <div>
                  Caché: <span className="font-mono text-text-muted">{cacheStatus}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: content */}
        <div className="min-w-0">
          {error && (
            <div className="mb-4 bg-negative-muted/30 border border-negative/30 rounded-lg p-4 text-sm text-negative">
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[0, 1].map((i) => (
                <div key={i} className="bg-surface border border-border rounded-lg p-5 space-y-3">
                  <div className="h-4 w-32 rounded bg-surface-2 animate-pulse" />
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="space-y-2">
                      <div className="h-3 w-full rounded bg-surface-2 animate-pulse" />
                      <div className="h-2 rounded bg-surface-2 animate-pulse" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {data && !loading && data.branches.every((b) => (b.steps[0]?.users ?? 0) === 0) && (
            <div className="bg-surface border border-border rounded-lg p-12 text-center">
              <p className="text-sm text-text-dim">
                Sin eventos para el rango seleccionado.
              </p>
            </div>
          )}

          {data && data.branches.some((b) => (b.steps[0]?.users ?? 0) > 0) && (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
                {data.branches.map((b) => (
                  <div
                    key={b.id}
                    className="bg-surface border border-border rounded-lg p-4"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-1">
                      {b.title}
                    </div>
                    <div className="text-2xl font-bold text-text font-mono tabular-nums">
                      {pct(b.totalConversion)}
                    </div>
                    <div className="text-[11px] text-text-dim mt-0.5">
                      end-to-end conversion
                    </div>
                  </div>
                ))}
                {winner && (
                  <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-accent-light mb-1">
                      Winner
                    </div>
                    <div className="text-base font-bold text-text">{winner.title}</div>
                    <div className="text-[11px] text-text-dim mt-0.5 font-mono tabular-nums">
                      {pct(winner.totalConversion)} vs{" "}
                      {pct(
                        data.branches
                          .filter((b) => b.id !== winner.id)
                          .reduce((acc, b) => acc + b.totalConversion, 0) /
                          Math.max(1, data.branches.length - 1),
                      )}{" "}
                      avg
                    </div>
                  </div>
                )}
              </div>

              {/* Funnels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.branches.map((b) => (
                  <PLGFunnelChart key={b.id} title={b.title} steps={b.steps} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
