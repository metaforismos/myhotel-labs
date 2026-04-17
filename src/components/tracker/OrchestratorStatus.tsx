"use client";

import { useCallback, useEffect, useState } from "react";

type State = {
  running: boolean;
  paused: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastTickProcessed: number;
  totalTicks: number;
  totalProcessed: number;
  lastError: string | null;
  activeJobs: number;
  inFlightJobs: string[];
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `hace ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `hace ${Math.round(ms / 60_000)}m`;
  return `hace ${Math.round(ms / 3_600_000)}h`;
}

export function OrchestratorStatus() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tracker/bulk/orchestrator");
      if (r.ok) setState(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  // Persistent pause is the only real off-switch: calling DELETE alone
  // does nothing lasting because the watchdog restarts the orchestrator
  // on the next GET when there's pending work. So "Detener" = pause flag.
  const stop = async () => {
    setBusy(true);
    try {
      await fetch("/api/tracker/bulk/orchestrator", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: true }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      await fetch("/api/tracker/bulk/orchestrator", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: false }),
      });
      await fetch("/api/tracker/bulk/orchestrator", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="border border-border rounded-md bg-surface p-3 text-xs text-text-dim font-mono">
        Orchestrator: cargando…
      </div>
    );
  }

  const idle = state.running && !state.paused && state.activeJobs === 0;

  const dot = state.paused
    ? "bg-amber-500"
    : state.running && state.activeJobs > 0
    ? "bg-emerald-500 animate-pulse"
    : state.running
    ? "bg-sky-500"
    : "bg-zinc-500";

  const badge = state.paused
    ? { cls: "bg-amber-500/10 text-amber-600", label: "PAUSED" }
    : idle
    ? { cls: "bg-sky-500/10 text-sky-600", label: "IDLE" }
    : state.running
    ? { cls: "bg-emerald-500/10 text-emerald-600", label: "ON" }
    : { cls: "bg-zinc-500/10 text-zinc-600", label: "OFF" };

  return (
    <div className="border border-border rounded-md bg-surface p-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
        <span className="text-xs font-semibold uppercase tracking-wider text-text">
          Orchestrator server-side
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <div className="text-[11px] font-mono text-text-dim flex gap-4 flex-wrap">
        <span>
          jobs activos: <span className="text-text">{state.activeJobs}</span>
        </span>
        <span>
          en vuelo: <span className="text-text">{state.inFlightJobs.length}</span>
        </span>
        <span>
          último tick: <span className="text-text">{fmtAgo(state.lastTickAt)}</span>
        </span>
        <span>
          procesados (tick/total):{" "}
          <span className="text-text">
            {state.lastTickProcessed}/{state.totalProcessed}
          </span>
        </span>
        {state.lastError && (
          <span className="text-red-500 truncate max-w-[280px]">
            err: {state.lastError}
          </span>
        )}
      </div>
      <div className="ml-auto flex gap-2">
        {state.paused ? (
          <button
            onClick={resume}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] font-medium rounded border border-accent text-accent hover:bg-accent/10 disabled:opacity-50"
            title="Quita la pausa persistente y arranca el orquestador."
          >
            Reanudar
          </button>
        ) : state.running ? (
          <button
            onClick={stop}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] font-medium rounded border border-amber-500 text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
            title="Pausa persistente — sobrevive restarts. Reanudar cuando quieras."
          >
            Detener
          </button>
        ) : (
          <button
            onClick={resume}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] font-medium rounded border border-accent text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            Iniciar
          </button>
        )}
      </div>
    </div>
  );
}
