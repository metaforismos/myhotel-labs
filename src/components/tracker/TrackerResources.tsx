"use client";

import { useCallback, useEffect, useState } from "react";

type ResourceRow = {
  registrable_domain: string;
  primary_role: string | null;
  observed_hotels: number;
  observed_contexts: number;
  vendor_name: string | null;
  vendor_product: string | null;
  classified_by: "rule" | "llm" | "manual" | null;
  classified_at: string | null;
  last_seen_at: string;
};

type ListResponse = {
  resources: ResourceRow[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  roles: { primary_role: string; n: number }[];
  classification: { total: number; classified: number; unclassified: number };
};

const ROLE_LABEL: Record<string, string> = {
  booking_engine: "Booking engine",
  cms: "CMS",
  pms: "PMS",
  channel_mgr: "Channel manager",
  analytics: "Analytics",
  chat: "Chat",
  reviews: "Reviews",
  ads: "Ads",
  ota: "OTA",
  cdn: "CDN / infra",
  fonts: "Fonts",
  maps: "Mapas",
  video: "Video",
  social: "Social",
  consent: "Cookie consent",
  other: "Otros",
  unknown: "Sin clasificar",
};

export function TrackerResources() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [role, setRole] = useState("");
  const [classified, setClassified] = useState<"" | "true" | "false">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [classifying, setClassifying] = useState(false);
  const [classifyMsg, setClassifyMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = new URL("/api/tracker/resources", window.location.origin);
      if (role) u.searchParams.set("role", role);
      if (classified) u.searchParams.set("classified", classified);
      if (q.trim()) u.searchParams.set("q", q.trim());
      u.searchParams.set("page", String(page));
      u.searchParams.set("page_size", "50");
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error(`list ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }, [role, classified, q, page]);

  useEffect(() => {
    const t = setTimeout(() => load(), 150);
    return () => clearTimeout(t);
  }, [load]);

  const classifyPending = useCallback(async () => {
    setClassifying(true);
    setClassifyMsg(null);
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalMs = 0;
    let pass = 0;
    const MAX_PASSES = 15; // safety: ≤600 clasificados por click

    // Poll en vivo: cada pasada al LLM tarda ~40-60s, así que mientras
    // corre refrescamos el contador del catálogo cada 3s para que el
    // usuario vea bajar "sin clasificar" en tiempo real en vez de
    // quedarse mirando el mismo número durante un minuto.
    const livePoll = setInterval(() => {
      load();
    }, 3000);

    try {
      while (pass < MAX_PASSES) {
        pass++;
        setClassifyMsg(
          `Procesando pasada ${pass}… llevamos ${totalSucceeded} clasificados en esta sesión (mirá el contador de catálogo arriba para ver el total en vivo)`
        );
        const r = await fetch("/api/tracker/resources/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batch: true, min_hotels: 1, limit: 15 }),
        });
        const d = await r.json();
        if (!r.ok) {
          setClassifyMsg(`Error: ${d.error || r.status}`);
          return;
        }
        totalSucceeded += d.succeeded || 0;
        totalFailed += d.failed || 0;
        totalMs += d.duration_ms || 0;
        // Reload the page data to reflect progress between passes.
        await load();
        if (!d.processed || d.processed === 0) break;
      }
      setClassifyMsg(
        `Listo: ${totalSucceeded} clasificados · ${totalFailed} fallas · ${Math.round(totalMs / 1000)}s (${pass} pasada${pass === 1 ? "" : "s"})`
      );
    } catch (e) {
      setClassifyMsg(e instanceof Error ? e.message : "error");
    } finally {
      clearInterval(livePoll);
      setClassifying(false);
      await load();
    }
  }, [load]);

  const totalPages = data?.total_pages || 1;

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-md bg-surface p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-dim">
            Buscar
          </label>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Dominio o vendor"
            className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent min-w-[200px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-dim">
            Rol
          </label>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
            className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent min-w-[180px]"
          >
            <option value="">Todos</option>
            {data?.roles.map((r) => (
              <option key={r.primary_role} value={r.primary_role}>
                {ROLE_LABEL[r.primary_role] || r.primary_role} ({r.n})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-dim">
            Clasificación
          </label>
          <select
            value={classified}
            onChange={(e) => {
              setClassified(e.target.value as "" | "true" | "false");
              setPage(1);
            }}
            className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent"
          >
            <option value="">Todos</option>
            <option value="true">Clasificados</option>
            <option value="false">Sin clasificar</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-xs text-text-dim space-y-0.5 text-right">
            {data && (
              <>
                <div>
                  Catálogo:{" "}
                  <span className="tabular-nums">
                    {data.classification.total}
                  </span>{" "}
                  dominios
                </div>
                <div className="text-[10px]">
                  {data.classification.classified} clasificados ·{" "}
                  {data.classification.unclassified} sin clasificar
                </div>
              </>
            )}
          </div>
          <button
            onClick={classifyPending}
            disabled={
              classifying || !data || data.classification.unclassified === 0
            }
            className="px-3 py-1.5 text-xs font-medium rounded border border-accent/40 bg-accent/10 text-accent-light hover:bg-accent/20 disabled:opacity-50"
            title="Envía los dominios sin clasificar a Gemini para inferir rol y vendor"
          >
            {classifying ? "Clasificando…" : "Clasificar pendientes con LLM"}
          </button>
        </div>
      </div>
      {classifyMsg && (
        <div className="text-xs text-text-muted px-1">{classifyMsg}</div>
      )}

      <div className="border border-border rounded-md bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2 font-semibold">Dominio</th>
              <th className="px-3 py-2 font-semibold">Vendor</th>
              <th className="px-3 py-2 font-semibold">Rol</th>
              <th className="px-3 py-2 font-semibold text-right">Hoteles</th>
              <th className="px-3 py-2 font-semibold text-right">Contextos</th>
              <th className="px-3 py-2 font-semibold">Fuente</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-dim">
                  Cargando…
                </td>
              </tr>
            )}
            {err && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-negative">
                  {err}
                </td>
              </tr>
            )}
            {data?.resources.map((r) => (
              <tr
                key={r.registrable_domain}
                className="border-b border-border last:border-0 hover:bg-surface-2/60"
              >
                <td className="px-3 py-2 font-mono text-xs text-text">
                  {r.registrable_domain}
                </td>
                <td className="px-3 py-2">
                  {r.vendor_name ? (
                    <div>
                      <div className="text-sm font-medium text-text">
                        {r.vendor_name}
                      </div>
                      {r.vendor_product && (
                        <div className="text-[11px] text-text-dim">
                          {r.vendor_product}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-text-dim italic">
                      —
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted">
                  {ROLE_LABEL[r.primary_role || ""] || r.primary_role || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.observed_hotels}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-dim">
                  {r.observed_contexts}
                </td>
                <td className="px-3 py-2">
                  {r.classified_by ? (
                    <span
                      className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded border ${
                        r.classified_by === "rule"
                          ? "bg-accent/10 text-accent-light border-accent/30"
                          : r.classified_by === "llm"
                            ? "bg-neutral-muted text-neutral-sent border-neutral-sent/30"
                            : "bg-positive-muted text-positive border-positive/30"
                      }`}
                    >
                      {r.classified_by}
                    </span>
                  ) : (
                    <span className="text-[10px] text-text-dim uppercase tracking-wider">
                      pendiente
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {data && data.resources.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-dim">
                  Sin recursos para los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-text-dim">
        <div>
          {data
            ? `${data.resources.length} de ${data.total.toLocaleString("es-CL")}`
            : ""}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-2 py-1 border border-border rounded disabled:opacity-40 hover:border-border-light"
          >
            ← Anterior
          </button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-2 py-1 border border-border rounded disabled:opacity-40 hover:border-border-light"
          >
            Siguiente →
          </button>
        </div>
      </div>
    </div>
  );
}
