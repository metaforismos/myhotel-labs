"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Bucket = {
  top: { vendor: string; hotels: number }[];
  others: number;
  totalDetected: number;
};

type Response = {
  country: string | null;
  total_hotels: number;
  categories: Record<string, Bucket>;
  agency: Bucket;
  countries: { country: string; hotels: number }[];
  generated_at: string;
};

// Orden editorial + labels en español.
const CATEGORY_LABELS: { key: string; label: string; hint: string }[] = [
  { key: "booking_engine", label: "Booking engines", hint: "Quién mueve las reservas directas" },
  { key: "cms", label: "CMS / Website builders", hint: "Qué plataforma construye el sitio" },
  { key: "agency", label: "Agencias web", hint: "Quién les hace el sitio" },
  { key: "pms", label: "PMS (inferido)", hint: "Sistema de propiedad — mayormente inferido vía BE" },
  { key: "chat", label: "Chat / Concierge", hint: "Asksuite, WhatsApp, Zendesk, etc." },
  { key: "analytics", label: "Analytics", hint: "GA, GTM, Matomo, Hotjar" },
  { key: "reviews", label: "Reviews widgets", hint: "TripAdvisor, Revinate, TrustYou" },
  { key: "ads", label: "Ads / Remarketing", hint: "Meta, Google Ads, criteo" },
];

const COUNTRY_NAMES: Record<string, string> = {
  MX: "México",
  BR: "Brasil",
  AR: "Argentina",
  CO: "Colombia",
  PE: "Perú",
  CL: "Chile",
  EC: "Ecuador",
  CR: "Costa Rica",
  BO: "Bolivia",
  VE: "Venezuela",
  UY: "Uruguay",
  PY: "Paraguay",
  PA: "Panamá",
  DO: "R. Dominicana",
  GT: "Guatemala",
  PR: "Puerto Rico",
  NI: "Nicaragua",
  HN: "Honduras",
  SV: "El Salvador",
  CU: "Cuba",
  HT: "Haití",
  JM: "Jamaica",
  BZ: "Belice",
  BS: "Bahamas",
  TT: "Trinidad y Tobago",
  BB: "Barbados",
  SR: "Surinam",
  GY: "Guyana",
  US: "Estados Unidos",
};

function countryLabel(iso: string): string {
  return COUNTRY_NAMES[iso] ?? iso;
}

function formatPct(count: number, base: number): string {
  if (!base) return "0%";
  const pct = (count / base) * 100;
  if (pct < 0.5) return "<1%";
  return `${Math.round(pct)}%`;
}

function CategoryCard({
  label,
  hint,
  bucket,
  denominator,
}: {
  label: string;
  hint: string;
  bucket: Bucket;
  denominator: number;
}) {
  const rows = bucket.top;
  const max = Math.max(
    ...rows.map((r) => r.hotels),
    bucket.others,
    1
  );

  return (
    <div className="border border-border rounded-md bg-surface p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{label}</div>
          <div className="text-[11px] text-text-dim mt-0.5">{hint}</div>
        </div>
        <div className="text-[10px] font-mono text-text-dim whitespace-nowrap">
          {bucket.totalDetected} detect. · {formatPct(bucket.totalDetected, denominator)} base
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs text-text-dim italic py-2">
          Sin detecciones en este filtro.
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.vendor} className="flex items-center gap-2">
              <div
                className="w-32 shrink-0 text-xs text-text-muted truncate"
                title={r.vendor}
              >
                {r.vendor}
              </div>
              <div className="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                <div
                  className="h-full bg-accent/70"
                  style={{
                    width: `${(r.hotels / max) * 100}%`,
                    minWidth: r.hotels > 0 ? "3px" : "0",
                  }}
                />
              </div>
              <div className="w-20 shrink-0 text-right text-[11px] font-mono tabular-nums text-text">
                {r.hotels} <span className="text-text-dim">· {formatPct(r.hotels, denominator)}</span>
              </div>
            </div>
          ))}
          {bucket.others > 0 && (
            <div className="flex items-center gap-2 pt-1 border-t border-border">
              <div className="w-32 shrink-0 text-xs text-text-dim italic">
                Otros
              </div>
              <div className="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                <div
                  className="h-full bg-text-dim/30"
                  style={{
                    width: `${(bucket.others / max) * 100}%`,
                    minWidth: bucket.others > 0 ? "3px" : "0",
                  }}
                />
              </div>
              <div className="w-20 shrink-0 text-right text-[11px] font-mono tabular-nums text-text-dim">
                {bucket.others} <span>· {formatPct(bucket.others, denominator)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TopVendorsByCategory() {
  const [country, setCountry] = useState<string>("");
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selected: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = selected ? `?country=${selected}` : "";
      const r = await fetch(`/api/tracker/stats/vendors${qs}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(country);
  }, [country, load]);

  // Auto-revalidate when window regains focus — keeps the dashboard fresh
  // after orchestrator/cleanup runs in the background.
  useEffect(() => {
    const onFocus = () => load(country);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [country, load]);

  const denominator = data?.total_hotels ?? 0;

  const cards = useMemo(() => {
    if (!data) return null;
    return CATEGORY_LABELS.map(({ key, label, hint }) => {
      const bucket =
        key === "agency" ? data.agency : data.categories[key] ?? {
          top: [],
          others: 0,
          totalDetected: 0,
        };
      return (
        <CategoryCard
          key={key}
          label={label}
          hint={hint}
          bucket={bucket}
          denominator={denominator}
        />
      );
    });
  }, [data, denominator]);

  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim">
            Top proveedores por categoría
          </h2>
          <p className="text-xs text-text-dim mt-1 max-w-xl">
            Concentración de vendors detectados en los hoteles. Usalo para
            dimensionar partnerships — quién tiene mercado, quién tiene espacio.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[11px] text-text-dim">
            <span className="mr-2 uppercase tracking-wider">País</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="px-2 py-1 text-xs bg-surface border border-border rounded font-mono min-w-[180px]"
            >
              <option value="">Todos LATAM+USA</option>
              {data?.countries.map((c) => (
                <option key={c.country} value={c.country}>
                  {countryLabel(c.country)} ({c.hotels.toLocaleString("es-CL")})
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => load(country)}
            disabled={loading}
            className="px-2.5 py-1 text-[11px] font-medium rounded border border-border hover:border-border-light disabled:opacity-50"
            title="Refrescar desde la DB (útil tras correr limpieza o re-análisis)"
          >
            {loading ? "Cargando…" : "Refrescar"}
          </button>
        </div>
      </div>

      {data && (
        <div className="text-[11px] text-text-dim mb-3 font-mono">
          Base en scope: <span className="text-text">{denominator.toLocaleString("es-CL")} hoteles</span>
          {" · "}
          Actualizado: <span className="text-text">{new Date(data.generated_at).toLocaleTimeString("es-CL")}</span>
        </div>
      )}

      {error && (
        <div className="text-xs text-negative border border-negative/30 bg-negative-muted rounded px-3 py-2 mb-3">
          Error cargando stats: {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{cards}</div>
    </section>
  );
}
