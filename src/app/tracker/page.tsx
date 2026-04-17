import Link from "next/link";
import pool from "@/lib/db";
import { TopVendorsByCategory } from "@/components/tracker/TopVendorsByCategory";

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

      <TopVendorsByCategory />

      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Link
            href="/tracker/browse"
            className="border border-border rounded-md bg-surface px-4 py-3 hover:border-border-light transition-colors"
          >
            <div className="text-sm font-medium text-text">Hoteles</div>
            <div className="text-xs text-text-dim mt-1">
              Explorar la base con filtros por país, ciudad y cliente.
            </div>
          </Link>
          <Link
            href="/tracker/search"
            className="border border-border rounded-md bg-surface px-4 py-3 hover:border-border-light transition-colors"
          >
            <div className="text-sm font-medium text-text">Analizar URL</div>
            <div className="text-xs text-text-dim mt-1">
              Correr el análisis sobre un hotel nuevo o puntual.
            </div>
          </Link>
          <Link
            href="/tracker/bulk"
            className="border border-border rounded-md bg-surface px-4 py-3 hover:border-border-light transition-colors"
          >
            <div className="text-sm font-medium text-text">Lotes</div>
            <div className="text-xs text-text-dim mt-1">
              Subir CSV y analizar cientos en segundo plano.
            </div>
          </Link>
          <Link
            href="/tracker/stats"
            className="border border-border rounded-md bg-surface px-4 py-3 hover:border-border-light transition-colors"
          >
            <div className="text-sm font-medium text-text">Métricas</div>
            <div className="text-xs text-text-dim mt-1">
              Top agencias, vendors por categoría y cobertura por país.
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
