import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country")?.trim() || null;

  try {
    const countriesPromise = pool.query(
      `SELECT country, COUNT(*)::int AS n
       FROM tracker_hotels
       WHERE country IS NOT NULL
       GROUP BY country
       ORDER BY country ASC`
    );

    const citiesPromise = country
      ? pool.query(
          `SELECT city, COUNT(*)::int AS n
           FROM tracker_hotels
           WHERE country = $1 AND city IS NOT NULL
           GROUP BY city
           ORDER BY n DESC, city ASC
           LIMIT 500`,
          [country]
        )
      : Promise.resolve({ rows: [] as { city: string; n: number }[] });

    const totalsPromise = pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_customer)::int AS customers
       FROM tracker_hotels`
    );

    const [countriesRes, citiesRes, totalsRes] = await Promise.all([
      countriesPromise,
      citiesPromise,
      totalsPromise,
    ]);

    return NextResponse.json({
      countries: countriesRes.rows,
      cities: citiesRes.rows,
      totals: totalsRes.rows[0],
    });
  } catch (err) {
    console.error("[Tracker Hotels Facets GET]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
