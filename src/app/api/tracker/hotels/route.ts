import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

const SORTABLE = new Set([
  "canonical_name",
  "country",
  "city",
  "is_customer",
  "created_at",
  "updated_at",
  "last_enriched_at",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const country = searchParams.get("country")?.trim() || null;
  const city = searchParams.get("city")?.trim() || null;
  const q = searchParams.get("q")?.trim() || null;
  const isCustomerParam = searchParams.get("is_customer");
  const isCustomer =
    isCustomerParam === "true"
      ? true
      : isCustomerParam === "false"
        ? false
        : null;

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("page_size") || "50", 10))
  );
  const offset = (page - 1) * pageSize;

  const sortRaw = searchParams.get("sort") || "canonical_name";
  const sortCol = SORTABLE.has(sortRaw) ? sortRaw : "canonical_name";
  const dir = searchParams.get("dir") === "desc" ? "DESC" : "ASC";

  const where: string[] = [];
  const values: unknown[] = [];

  if (country) {
    values.push(country);
    where.push(`country = $${values.length}`);
  }
  if (city) {
    values.push(city);
    where.push(`city = $${values.length}`);
  }
  if (isCustomer !== null) {
    values.push(isCustomer);
    where.push(`is_customer = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(`canonical_name ILIKE $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tracker_hotels ${whereSql}`,
      values
    );
    const total = countRes.rows[0].n as number;

    values.push(pageSize, offset);
    const listRes = await pool.query(
      `SELECT id, canonical_name, slug, country, region, city, lat, lng,
              category, stars, rooms_estimate, website_url, is_customer,
              external_id, created_at, updated_at, last_enriched_at
       FROM tracker_hotels
       ${whereSql}
       ORDER BY ${sortCol} ${dir} NULLS LAST, canonical_name ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return NextResponse.json({
      hotels: listRes.rows,
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("[Tracker Hotels GET]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
