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

  // Guard anti-duplicado: excluye hoteles cuya website_url ya está
  // siendo analizada en otro job pending/running. Evita gasto de API
  // quota por batches paralelos que se solapan.
  const where: string[] = [
    "h.website_url IS NOT NULL",
    `NOT EXISTS (
       SELECT 1 FROM tracker_bulk_job_items i
       WHERE i.status IN ('pending','running') AND i.url = h.website_url
     )`,
  ];
  const values: unknown[] = [];

  if (body.country) {
    values.push(body.country);
    where.push(`h.country = $${values.length}`);
  }
  if (body.city) {
    values.push(body.city);
    where.push(`h.city = $${values.length}`);
  }
  if (olderThan === null) {
    where.push(`h.last_enriched_at IS NULL`);
  } else {
    values.push(olderThan);
    where.push(
      `(h.last_enriched_at IS NULL OR h.last_enriched_at < NOW() - ($${values.length} || ' days')::interval)`
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
      `SELECT h.id, h.website_url, h.canonical_name, h.country, h.city, h.region,
              h.external_id, h.is_customer
       FROM tracker_hotels h
       WHERE ${where.join(" AND ")}
       ORDER BY h.last_enriched_at NULLS FIRST, h.canonical_name
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
