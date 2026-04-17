import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// Categorías visibles en "Top proveedores por categoría". Agencias se
// calculan aparte (viven en tracker_hotel_agency, no en _stack).
const SHOWN_CATEGORIES = [
  "booking_engine",
  "cms",
  "pms",
  "chat",
  "analytics",
  "reviews",
  "ads",
  "channel_mgr",
] as const;

type Row = { category: string; vendor: string; hotels: number };
type AgencyRow = { agency_name: string; hotels: number };

export async function GET(request: NextRequest) {
  const country = request.nextUrl.searchParams.get("country") || null;
  const topN = Math.min(
    20,
    Math.max(1, parseInt(request.nextUrl.searchParams.get("top") || "5", 10))
  );

  try {
    // Stack vendors — dedup por hotel x vendor x categoría.
    const stackRes = await pool.query<Row>(
      `SELECT s.category, s.vendor, COUNT(DISTINCT s.hotel_id)::int AS hotels
       FROM tracker_hotel_stack s
       JOIN tracker_hotels h ON h.id = s.hotel_id
       WHERE s.vendor IS NOT NULL AND s.vendor <> ''
         AND ($1::text IS NULL OR h.country = $1)
         AND s.category = ANY($2::text[])
       GROUP BY s.category, s.vendor
       ORDER BY s.category, hotels DESC`,
      [country, SHOWN_CATEGORIES]
    );

    // Agencias — sólo las verificadas como agency o aún sin verificar.
    // Descarta platform / noise (exclusión consistente con /api/tracker/stats).
    const agencyRes = await pool.query<AgencyRow>(
      `SELECT a.agency_name, COUNT(DISTINCT a.hotel_id)::int AS hotels
       FROM tracker_hotel_agency a
       JOIN tracker_hotels h ON h.id = a.hotel_id
       WHERE (a.llm_verdict IS NULL OR a.llm_verdict = 'agency')
         AND ($1::text IS NULL OR h.country = $1)
       GROUP BY a.agency_name
       ORDER BY hotels DESC`,
      [country]
    );

    // Total de hoteles en el scope (para % de penetración en el cliente).
    const totalRes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM tracker_hotels h
       WHERE ($1::text IS NULL OR h.country = $1)`,
      [country]
    );
    const totalHotels = totalRes.rows[0]?.n ?? 0;

    // Partición por categoría con top N + "Otros" como bucket residual.
    const byCategory: Record<
      string,
      {
        top: { vendor: string; hotels: number }[];
        others: number;
        totalDetected: number;
      }
    > = {};

    for (const cat of SHOWN_CATEGORIES) {
      byCategory[cat] = { top: [], others: 0, totalDetected: 0 };
    }

    for (const r of stackRes.rows) {
      const bucket = byCategory[r.category];
      if (!bucket) continue;
      bucket.totalDetected += r.hotels;
      if (bucket.top.length < topN) {
        bucket.top.push({ vendor: r.vendor, hotels: r.hotels });
      } else {
        bucket.others += r.hotels;
      }
    }

    const topAgencies = agencyRes.rows.slice(0, topN);
    const othersAgency = agencyRes.rows
      .slice(topN)
      .reduce((acc, r) => acc + r.hotels, 0);
    const totalAgenciesDetected = agencyRes.rows.reduce(
      (acc, r) => acc + r.hotels,
      0
    );

    // Country list for the dropdown.
    const countries = await pool.query<{ country: string; hotels: number }>(
      `SELECT country, COUNT(*)::int AS hotels
       FROM tracker_hotels
       WHERE country IS NOT NULL AND country <> ''
       GROUP BY country
       ORDER BY hotels DESC`
    );

    return NextResponse.json({
      country,
      total_hotels: totalHotels,
      categories: byCategory,
      agency: {
        top: topAgencies.map((r) => ({ vendor: r.agency_name, hotels: r.hotels })),
        others: othersAgency,
        totalDetected: totalAgenciesDetected,
      },
      countries: countries.rows,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[tracker/stats/vendors]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
