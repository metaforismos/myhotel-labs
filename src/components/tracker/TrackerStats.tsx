"use client";

import { useEffect, useState } from "react";

type StatsResponse = {
  hotels: { total: number; analyzed: number; analyzed_pct: number };
  chains?: {
    chains: number;
    independents: number;
    unknown: number;
    chain_pct: number;
  };
  roles: {
    role: string;
    hotels_with: number;
    pct_of_analyzed: number;
    domains: number;
    top: {
      registrable_domain: string;
      hotels: number;
      pct_of_analyzed: number;
      vendor_name: string | null;
      classified_by: string | null;
    }[];
  }[];
  classification: { total: number; classified: number; unclassified: number };
  penetration: { key: string; label: string; hotels: number; pct: number }[];
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

const CORE_ROLES = [
  "booking_engine",
  "pms",
  "channel_mgr",
  "cms",
  "reviews",
  "chat",
  "ads",
  "analytics",
];

function pctText(p: number) {
  if (!isFinite(p)) return "—";
  return (p * 100).toFixed(p >= 0.1 ? 0 : 1) + "%";
}

function Bar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="h-1.5 w-full bg-surface-2 rounded overflow-hidden">
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TrackerStats() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/tracker/stats");
        if (!r.ok) throw new Error(`stats ${r.status}`);
        setData(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : "error");
      }
    })();
  }, []);

  if (err)
    return (
      <div className="border border-negative/30 bg-negative-muted rounded-md px-4 py-3 text-sm text-negative">
        {err}
      </div>
    );
  if (!data)
    return (
      <div className="text-sm text-text-dim">Cargando stats…</div>
    );

  const coreRoles = CORE_ROLES.map(
    (r) => data.roles.find((x) => x.role === r) || null
  );
  const otherRoles = data.roles.filter((r) => !CORE_ROLES.includes(r.role));

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
          Cobertura
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-border rounded-md bg-surface px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              Hoteles en base
            </div>
            <div className="text-2xl font-semibold text-text mt-1 tabular-nums">
              {data.hotels.total}
            </div>
          </div>
          <div className="border border-border rounded-md bg-surface px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              Con análisis
            </div>
            <div className="text-2xl font-semibold text-text mt-1 tabular-nums">
              {data.hotels.analyzed}
            </div>
            <div className="text-[11px] text-text-dim mt-0.5">
              {pctText(data.hotels.analyzed_pct)} de la base
            </div>
          </div>
          <div className="border border-border rounded-md bg-surface px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              Dominios únicos
            </div>
            <div className="text-2xl font-semibold text-text mt-1 tabular-nums">
              {data.classification.total}
            </div>
            <div className="text-[11px] text-text-dim mt-0.5">
              en catálogo
            </div>
          </div>
          <div className="border border-border rounded-md bg-surface px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              Clasificados
            </div>
            <div className="text-2xl font-semibold text-text mt-1 tabular-nums">
              {data.classification.classified}
            </div>
            <div className="text-[11px] text-text-dim mt-0.5">
              {data.classification.unclassified} pendientes de LLM
            </div>
          </div>
        </div>
      </section>

      {data.chains && (data.chains.chains + data.chains.independents > 0) && (
        <section>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
            Cadenas vs independientes
          </h2>
          <div className="border border-border rounded-md bg-surface divide-y divide-border">
            <div className="px-4 py-2.5 grid grid-cols-[220px,1fr,80px,80px] items-center gap-3">
              <div className="text-sm text-text">Cadenas hoteleras</div>
              <Bar value={data.chains.chain_pct} />
              <div className="text-right text-xs tabular-nums text-text-muted">
                {data.chains.chains} hoteles
              </div>
              <div className="text-right text-sm font-medium tabular-nums text-text">
                {pctText(data.chains.chain_pct)}
              </div>
            </div>
            <div className="px-4 py-2.5 grid grid-cols-[220px,1fr,80px,80px] items-center gap-3">
              <div className="text-sm text-text">Independientes</div>
              <Bar value={1 - data.chains.chain_pct} />
              <div className="text-right text-xs tabular-nums text-text-muted">
                {data.chains.independents} hoteles
              </div>
              <div className="text-right text-sm font-medium tabular-nums text-text">
                {pctText(1 - data.chains.chain_pct)}
              </div>
            </div>
            {data.chains.unknown > 0 && (
              <div className="px-4 py-1.5 text-[11px] text-text-dim">
                {data.chains.unknown} hoteles analizados antes de Fase 1D.6 (sin
                dato de cadena); re-analiza para completar.
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
          Penetración por capa clave
        </h2>
        <div className="border border-border rounded-md bg-surface divide-y divide-border">
          {data.penetration.map((p) => (
            <div
              key={p.key}
              className="px-4 py-2.5 grid grid-cols-[220px,1fr,80px,80px] items-center gap-3"
            >
              <div className="text-sm text-text">{p.label}</div>
              <Bar value={p.pct} />
              <div className="text-right text-xs tabular-nums text-text-muted">
                {p.hotels} hoteles
              </div>
              <div className="text-right text-sm font-medium tabular-nums text-text">
                {pctText(p.pct)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
          Distribución por rol (top 10 por categoría)
        </h2>
        <div className="space-y-3">
          {coreRoles.map((r, i) =>
            r ? (
              <RoleCard key={r.role} role={r} label={ROLE_LABEL[r.role] || r.role} />
            ) : (
              <div
                key={CORE_ROLES[i]}
                className="border border-border rounded-md bg-surface px-4 py-3 opacity-60"
              >
                <div className="text-[10px] uppercase tracking-wider text-text-dim">
                  {ROLE_LABEL[CORE_ROLES[i]]}
                </div>
                <div className="text-sm text-text-dim mt-1 italic">
                  sin observaciones todavía
                </div>
              </div>
            )
          )}
        </div>
      </section>

      {otherRoles.length > 0 && (
        <section>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
            Capas secundarias (infra, fonts, maps, social…)
          </h2>
          <div className="space-y-3">
            {otherRoles.map((r) => (
              <RoleCard
                key={r.role}
                role={r}
                label={ROLE_LABEL[r.role] || r.role}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RoleCard({
  role,
  label,
}: {
  role: StatsResponse["roles"][number];
  label: string;
}) {
  return (
    <div className="border border-border rounded-md bg-surface overflow-hidden">
      <div className="px-4 py-2 bg-surface-2 border-b border-border flex items-center justify-between">
        <div className="text-sm font-medium text-text">{label}</div>
        <div className="text-[11px] text-text-dim">
          <span className="tabular-nums">{role.hotels_with}</span> hoteles ·{" "}
          <span className="tabular-nums">{role.domains}</span> dominios únicos ·{" "}
          <span className="tabular-nums text-text">
            {pctText(role.pct_of_analyzed)}
          </span>{" "}
          de analizados
        </div>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {role.top.map((t) => (
            <tr
              key={t.registrable_domain}
              className="border-b border-border last:border-0"
            >
              <td className="px-3 py-1.5 font-mono text-xs text-text-muted">
                {t.registrable_domain}
              </td>
              <td className="px-3 py-1.5 text-xs text-text">
                {t.vendor_name || (
                  <span className="text-text-dim italic">sin clasificar</span>
                )}
              </td>
              <td className="px-3 py-1.5 w-36">
                <Bar value={t.pct_of_analyzed} />
              </td>
              <td className="px-3 py-1.5 w-16 text-right text-xs tabular-nums text-text-muted">
                {t.hotels}
              </td>
              <td className="px-3 py-1.5 w-16 text-right text-xs tabular-nums text-text">
                {pctText(t.pct_of_analyzed)}
              </td>
              <td className="px-3 py-1.5 w-16 text-right">
                {t.classified_by ? (
                  <span
                    className={`px-1 py-0 text-[9px] uppercase tracking-wider rounded border ${
                      t.classified_by === "rule"
                        ? "bg-accent/10 text-accent-light border-accent/30"
                        : "bg-neutral-muted text-neutral-sent border-neutral-sent/30"
                    }`}
                  >
                    {t.classified_by}
                  </span>
                ) : (
                  <span className="text-[9px] text-text-dim">—</span>
                )}
              </td>
            </tr>
          ))}
          {role.top.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-3 text-center text-text-dim text-xs">
                Sin dominios observados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
