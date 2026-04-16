import Link from "next/link";
import pool from "@/lib/db";

type Totals = { total: number; customers: number; with_stack: number; countries: number };

async function getTotals(): Promise<Totals> {
  try {
    const [hotels, stack, countries] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_customer)::int AS customers
         FROM tracker_hotels`
      ),
      pool.query(
        `SELECT COUNT(DISTINCT hotel_id)::int AS n FROM tracker_hotel_stack`
      ),
      pool.query(
        `SELECT COUNT(DISTINCT country)::int AS n
         FROM tracker_hotels WHERE country IS NOT NULL`
      ),
    ]);
    return {
      total: hotels.rows[0].total,
      customers: hotels.rows[0].customers,
      with_stack: stack.rows[0].n,
      countries: countries.rows[0].n,
    };
  } catch {
    return { total: 0, customers: 0, with_stack: 0, countries: 0 };
  }
}

const phases = [
  {
    phase: "Fase 0",
    title: "Fundación",
    desc: "Schema DB, seed import, shell UI navegable.",
    status: "in-progress" as const,
  },
  {
    phase: "Fase 1A",
    title: "Detector por reglas",
    desc: "HTML estático + reglas JSON + endpoint síncrono /api/tracker/analyze.",
    status: "pending" as const,
  },
  {
    phase: "Fase 1B",
    title: "Wappalyzer + agencia web",
    desc: "Ampliar detección con Wappalyzer y reglas de agencias LatAm.",
    status: "pending" as const,
  },
  {
    phase: "Fase 1C",
    title: "OTA linkage",
    desc: "Extraer links outbound + fallback SerpAPI/Serper para matching por nombre+geo.",
    status: "pending" as const,
  },
  {
    phase: "Fase 1D",
    title: "Persistencia + Bulk",
    desc: "Guardar análisis en DB, subida CSV batch, export CSV/JSON.",
    status: "pending" as const,
  },
  {
    phase: "Fase 1E",
    title: "Headless browser fallback",
    desc: "Playwright/crawl4ai para sitios JS-heavy con estrategia 2 pasadas.",
    status: "pending" as const,
  },
  {
    phase: "Fase 2",
    title: "Discovery geográfico",
    desc: "Workers Python portados, cola de jobs, dedupe fuzzy + geo.",
    status: "pending" as const,
  },
  {
    phase: "Fase 3",
    title: "Contactos",
    desc: "Apollo + Hunter + LinkedIn, validación email, UI contactos. Gate legal previo.",
    status: "blocked" as const,
  },
  {
    phase: "Fase 4",
    title: "Prospecting",
    desc: "Secuencias multicanal + voz Vapi/Retell + Slack/HubSpot handoff.",
    status: "blocked" as const,
  },
];

const statusStyle: Record<(typeof phases)[number]["status"], string> = {
  "in-progress": "bg-accent/15 text-accent-light border-accent/40",
  pending: "bg-surface-2 text-text-dim border-border",
  blocked: "bg-negative-muted text-negative border-negative/30",
};

export default async function TrackerOverviewPage() {
  const totals = await getTotals();

  const stats = [
    { label: "Hoteles en base", value: totals.total.toLocaleString("es-CL") },
    { label: "Países", value: totals.countries },
    { label: "Clientes myHotel", value: totals.customers },
    { label: "Con stack detectado", value: totals.with_stack },
  ];

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
          Estado actual
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="border border-border rounded-md bg-surface px-4 py-3"
            >
              <div className="text-[11px] text-text-dim uppercase tracking-wider">
                {s.label}
              </div>
              <div className="text-2xl font-semibold text-text mt-1 tabular-nums">
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
          Roadmap
        </h2>
        <div className="border border-border rounded-md bg-surface divide-y divide-border">
          {phases.map((p) => (
            <div key={p.phase} className="px-4 py-3 flex items-start gap-4">
              <div className="w-20 shrink-0">
                <span
                  className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded ${statusStyle[p.status]}`}
                >
                  {p.phase}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text">{p.title}</div>
                <div className="text-xs text-text-dim mt-0.5">{p.desc}</div>
              </div>
              <div className="text-[10px] text-text-dim uppercase tracking-wider shrink-0 self-center">
                {p.status === "in-progress"
                  ? "en curso"
                  : p.status === "blocked"
                    ? "gate legal"
                    : "pendiente"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Link
            href="/tracker/browse"
            className="border border-border rounded-md bg-surface px-4 py-3 hover:border-border-light transition-colors"
          >
            <div className="text-sm font-medium text-text">Browse</div>
            <div className="text-xs text-text-dim mt-1">
              Explorar la base con filtros por país, ciudad y cliente.
            </div>
          </Link>
          <Link
            href="/tracker/search"
            className="border border-border rounded-md bg-surface px-4 py-3 hover:border-border-light transition-colors"
          >
            <div className="text-sm font-medium text-text">Search</div>
            <div className="text-xs text-text-dim mt-1">
              Analizar una URL individual. Disponible en Fase 1A.
            </div>
          </Link>
          <Link
            href="/tracker/bulk"
            className="border border-border rounded-md bg-surface px-4 py-3 hover:border-border-light transition-colors"
          >
            <div className="text-sm font-medium text-text">Bulk</div>
            <div className="text-xs text-text-dim mt-1">
              Subir CSV y analizar en batch. Disponible en Fase 1D.
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
