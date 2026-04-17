"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Hotel = {
  id: string;
  canonical_name: string;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  website_url: string | null;
  is_customer: boolean;
  external_id: string | null;
  last_enriched_at: string | null;
};

type Facets = {
  countries: { country: string; n: number }[];
  cities: { city: string; n: number }[];
  totals: { total: number; customers: number };
};

type ListResponse = {
  hotels: Hotel[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

const PAGE_SIZE = 50;

export function TrackerBrowse() {
  const [country, setCountry] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [isCustomer, setIsCustomer] = useState<"" | "true" | "false">("");
  const [q, setQ] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  const [facets, setFacets] = useState<Facets | null>(null);
  const [list, setList] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enqueuing, setEnqueuing] = useState(false);
  const [enqueueMsg, setEnqueueMsg] = useState<string | null>(null);

  const loadFacets = useCallback(async () => {
    try {
      const u = new URL("/api/tracker/hotels/facets", window.location.origin);
      if (country) u.searchParams.set("country", country);
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error(`facets ${r.status}`);
      setFacets(await r.json());
    } catch (e) {
      console.error(e);
    }
  }, [country]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = new URL("/api/tracker/hotels", window.location.origin);
      u.searchParams.set("page", String(page));
      u.searchParams.set("page_size", String(PAGE_SIZE));
      if (country) u.searchParams.set("country", country);
      if (city) u.searchParams.set("city", city);
      if (isCustomer) u.searchParams.set("is_customer", isCustomer);
      if (q.trim()) u.searchParams.set("q", q.trim());
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error(`list ${r.status}`);
      setList(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }, [page, country, city, isCustomer, q]);

  useEffect(() => {
    loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    const t = setTimeout(() => loadList(), 200);
    return () => clearTimeout(t);
  }, [loadList]);

  const onResetFilters = () => {
    setCountry("");
    setCity("");
    setIsCustomer("");
    setQ("");
    setPage(1);
  };

  const onEnqueuePending = async () => {
    if (!confirm(
      `Crear un batch con hasta 500 hoteles pendientes de analizar${country ? ` (país: ${country})` : ""}${city ? ` (ciudad: ${city})` : ""}? Solo incluye los que tienen website_url.`
    )) {
      return;
    }
    setEnqueuing(true);
    setEnqueueMsg(null);
    try {
      const r = await fetch("/api/tracker/bulk/enqueue-pending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          country: country || undefined,
          city: city || undefined,
          limit: 500,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setEnqueueMsg(`Error: ${d.error || r.status}`);
        return;
      }
      if (d.accepted === 0) {
        setEnqueueMsg("No hay hoteles pendientes con ese filtro.");
        return;
      }
      setEnqueueMsg(
        `Batch ${d.job_id.slice(0, 8)} creado con ${d.accepted} hoteles. Redirigiendo…`
      );
      setTimeout(() => {
        window.location.href = `/tracker/bulk`;
      }, 800);
    } catch (e) {
      setEnqueueMsg(e instanceof Error ? e.message : "error");
    } finally {
      setEnqueuing(false);
    }
  };

  const toggleCustomer = async (h: Hotel) => {
    const next = !h.is_customer;
    setList((prev) =>
      prev
        ? {
            ...prev,
            hotels: prev.hotels.map((x) =>
              x.id === h.id ? { ...x, is_customer: next } : x
            ),
          }
        : prev
    );
    try {
      const r = await fetch(`/api/tracker/hotels/${h.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_customer: next }),
      });
      if (!r.ok) throw new Error(`patch ${r.status}`);
      loadFacets();
    } catch (e) {
      console.error(e);
      setList((prev) =>
        prev
          ? {
              ...prev,
              hotels: prev.hotels.map((x) =>
                x.id === h.id ? { ...x, is_customer: !next } : x
              ),
            }
          : prev
      );
    }
  };

  const totalPages = list?.total_pages || 1;
  const showing = useMemo(() => {
    if (!list) return "";
    const start = (list.page - 1) * list.page_size + 1;
    const end = Math.min(start + list.hotels.length - 1, list.total);
    return `${start}–${end} de ${list.total.toLocaleString("es-CL")}`;
  }, [list]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 p-3 border border-border rounded-md bg-surface">
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
            placeholder="Nombre del hotel"
            className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-dim">
            País
          </label>
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setCity("");
              setPage(1);
            }}
            className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent min-w-[140px]"
          >
            <option value="">Todos</option>
            {facets?.countries.map((c) => (
              <option key={c.country} value={c.country}>
                {c.country} ({c.n})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-dim">
            Ciudad
          </label>
          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setPage(1);
            }}
            disabled={!country}
            className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent min-w-[160px] disabled:opacity-50"
          >
            <option value="">Todas</option>
            {facets?.cities.map((c) => (
              <option key={c.city} value={c.city}>
                {c.city} ({c.n})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-dim">
            Cliente myHotel
          </label>
          <select
            value={isCustomer}
            onChange={(e) => {
              setIsCustomer(e.target.value as "" | "true" | "false");
              setPage(1);
            }}
            className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent"
          >
            <option value="">Todos</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </div>
        <button
          onClick={onResetFilters}
          className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:border-border-light"
        >
          Limpiar
        </button>
        <button
          onClick={onEnqueuePending}
          disabled={enqueuing}
          className="px-3 py-1.5 text-xs font-medium rounded border border-accent/40 bg-accent/10 text-accent-light hover:bg-accent/20 disabled:opacity-50"
          title="Crea un bulk job con hoteles del filtro actual que tengan URL pero no hayan sido analizados todavía. Redirecciona al job."
        >
          {enqueuing ? "Creando…" : "Enqueue pendientes →"}
        </button>
        <div className="ml-auto text-xs text-text-dim">
          {facets ? (
            <>
              Base: <span className="tabular-nums">{facets.totals.total}</span> hoteles
              · clientes <span className="tabular-nums">{facets.totals.customers}</span>
            </>
          ) : (
            "…"
          )}
        </div>
      </div>
      {enqueueMsg && (
        <div className="text-xs text-text-muted px-1">{enqueueMsg}</div>
      )}

      <div className="border border-border rounded-md bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2 font-semibold">Hotel</th>
              <th className="px-3 py-2 font-semibold">País</th>
              <th className="px-3 py-2 font-semibold">Región</th>
              <th className="px-3 py-2 font-semibold">Ciudad</th>
              <th className="px-3 py-2 font-semibold">Geo</th>
              <th className="px-3 py-2 font-semibold text-center">Cliente</th>
              <th className="px-3 py-2 font-semibold text-right">ID</th>
            </tr>
          </thead>
          <tbody>
            {loading && !list && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-dim">
                  Cargando…
                </td>
              </tr>
            )}
            {err && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-negative">
                  {err}
                </td>
              </tr>
            )}
            {list?.hotels.map((h) => (
              <tr
                key={h.id}
                className="border-b border-border last:border-0 hover:bg-surface-2/60"
              >
                <td className="px-3 py-2 font-medium text-text">
                  {h.canonical_name}
                </td>
                <td className="px-3 py-2 text-text-muted tabular-nums">
                  {h.country || "—"}
                </td>
                <td className="px-3 py-2 text-text-muted truncate max-w-[180px]">
                  {h.region || "—"}
                </td>
                <td className="px-3 py-2 text-text-muted truncate max-w-[160px]">
                  {h.city || "—"}
                </td>
                <td className="px-3 py-2 text-text-dim text-[11px] tabular-nums">
                  {h.lat != null && h.lng != null
                    ? `${h.lat.toFixed(3)}, ${h.lng.toFixed(3)}`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => toggleCustomer(h)}
                    className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${
                      h.is_customer
                        ? "bg-positive-muted text-positive border-positive/30"
                        : "bg-surface-2 text-text-dim border-border hover:border-border-light"
                    }`}
                  >
                    {h.is_customer ? "Sí" : "No"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right text-text-dim text-[11px] tabular-nums">
                  {h.external_id || "—"}
                </td>
              </tr>
            ))}
            {list && list.hotels.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-dim">
                  Sin resultados para los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-text-dim">
        <div>{showing}</div>
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
