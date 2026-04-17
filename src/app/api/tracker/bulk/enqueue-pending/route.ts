import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// Crea un bulk job automáticamente desde hoteles en tracker_hotels
// que tienen website_url y (a) nunca fueron analizados o (b) el último
// análisis es más viejo que `older_than_days`.
//
// Uso típico: desde Browse el PO filtra por país + `pending=true` y
// dispara un batch de N hoteles sin escribir URLs manualmente.

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: {
    country?: string;
    city?: string;
    limit?: number;
    older_than_days?: number;
    label?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body allowed */
  }

  const limit = Math.min(2000, Math.max(1, body.limit ?? 500));
  const olderThan = body.older_than_days ?? null;

  const where: string[] = ["website_url IS NOT NULL"];
  const values: unknown[] = [];

  if (body.country) {
    values.push(body.country);
    where.push(`country = $${values.length}`);
  }
  if (body.city) {
    values.push(body.city);
    where.push(`city = $${values.length}`);
  }
  if (olderThan === null) {
    where.push(`last_enriched_at IS NULL`);
  } else {
    values.push(olderThan);
    where.push(
      `(last_enriched_at IS NULL OR last_enriched_at < NOW() - ($${values.length} || ' days')::interval)`
    );
  }

  const client = await pool.connect();
  try {
    values.push(limit);
    const candidatesRes = await client.query<{
      id: string;
      website_url: string;
      canonical_name: string;
      country: string | null;
      city: string | null;
      region: string | null;
      external_id: string | null;
      is_customer: boolean;
    }>(
      `SELECT id, website_url, canonical_name, country, city, region,
              external_id, is_customer
       FROM tracker_hotels
       WHERE ${where.join(" AND ")}
       ORDER BY last_enriched_at NULLS FIRST, canonical_name
       LIMIT $${values.length}`,
      values
    );

    if (candidatesRes.rowCount === 0) {
      return NextResponse.json({
        job_id: null,
        accepted: 0,
        message: "no_hotels_to_enqueue",
      });
    }

    await client.query("BEGIN");
    const label =
      body.label ??
      (body.country
        ? `Pending · ${body.country} · ${candidatesRes.rowCount}`
        : `Pending · ${candidatesRes.rowCount} hoteles`);

    const jobRes = await client.query<{ id: string }>(
      `INSERT INTO tracker_bulk_jobs (label, total, status)
       VALUES ($1, $2, 'created')
       RETURNING id`,
      [label, candidatesRes.rowCount]
    );
    const jobId = jobRes.rows[0].id;

    for (let i = 0; i < candidatesRes.rows.length; i++) {
      const h = candidatesRes.rows[i];
      await client.query(
        `INSERT INTO tracker_bulk_job_items (job_id, idx, url, input)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          jobId,
          i,
          h.website_url,
          JSON.stringify({
            name: h.canonical_name,
            city: h.city,
            region: h.region,
            country: h.country,
            external_id: h.external_id,
            is_customer: h.is_customer,
            hotel_id: h.id,
          }),
        ]
      );
    }

    await client.query("COMMIT");

    return NextResponse.json(
      {
        job_id: jobId,
        accepted: candidatesRes.rowCount,
        label,
      },
      { status: 201 }
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[bulk/enqueue-pending]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  } finally {
    client.release();
  }
}
