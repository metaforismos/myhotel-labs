import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { normalizeUrl } from "@/lib/tracker/fetcher";

type BulkItemInput = {
  url: string;
  name?: string;
  city?: string;
  country?: string;
  region?: string;
  external_id?: string;
  is_customer?: boolean;
};

export async function GET() {
  try {
    const jobs = await pool.query(
      `SELECT j.id, j.label, j.total, j.status, j.created_at, j.started_at, j.finished_at,
              (SELECT COUNT(*) FROM tracker_bulk_job_items i WHERE i.job_id = j.id AND i.status = 'done')::int AS done,
              (SELECT COUNT(*) FROM tracker_bulk_job_items i WHERE i.job_id = j.id AND i.status = 'error')::int AS failed,
              (SELECT COUNT(*) FROM tracker_bulk_job_items i WHERE i.job_id = j.id AND i.status = 'pending')::int AS pending
       FROM tracker_bulk_jobs j
       ORDER BY j.created_at DESC
       LIMIT 50`
    );
    return NextResponse.json({ jobs: jobs.rows });
  } catch (err) {
    console.error("[bulk GET]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: { label?: string; items?: BulkItemInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "no_items" }, { status: 400 });
  }
  if (body.items.length > 2000) {
    return NextResponse.json(
      { error: "too_many_items_max_2000" },
      { status: 400 }
    );
  }

  const normalized: { idx: number; url: string; input: BulkItemInput }[] = [];
  const rejected: { idx: number; raw: string; reason: string }[] = [];

  body.items.forEach((raw, idx) => {
    const url = normalizeUrl(raw?.url || "");
    if (!url) {
      rejected.push({ idx, raw: raw?.url || "", reason: "invalid_url" });
      return;
    }
    normalized.push({ idx, url, input: raw });
  });

  if (normalized.length === 0) {
    return NextResponse.json(
      { error: "no_valid_items", rejected },
      { status: 400 }
    );
  }

  // Dedup contra URLs ya en vuelo en OTROS jobs (pending / running).
  // Evita que dos batches paralelos consuman API quota analizando la
  // misma URL. La segunda la marca como "in_flight" y se descarta.
  const inFlightRes = await pool.query<{ url: string }>(
    `SELECT DISTINCT url FROM tracker_bulk_job_items
     WHERE status IN ('pending','running')
       AND url = ANY($1::text[])`,
    [normalized.map((n) => n.url)]
  );
  const inFlightSet = new Set(inFlightRes.rows.map((r) => r.url));
  const inFlight: { idx: number; url: string }[] = [];
  const filtered = normalized.filter((n) => {
    if (inFlightSet.has(n.url)) {
      inFlight.push({ idx: n.idx, url: n.url });
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return NextResponse.json(
      {
        error: "all_urls_in_flight",
        rejected,
        in_flight: inFlight,
      },
      { status: 409 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await client.query<{ id: string }>(
      `INSERT INTO tracker_bulk_jobs (label, total, status)
       VALUES ($1, $2, 'created')
       RETURNING id`,
      [body.label ?? null, filtered.length]
    );
    const jobId = job.rows[0].id;

    for (const item of filtered) {
      const { url, input } = item;
      await client.query(
        `INSERT INTO tracker_bulk_job_items (job_id, idx, url, input)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          jobId,
          item.idx,
          url,
          JSON.stringify({
            name: input.name ?? null,
            city: input.city ?? null,
            region: input.region ?? null,
            country: input.country ?? null,
            external_id: input.external_id ?? null,
            is_customer:
              typeof input.is_customer === "boolean"
                ? input.is_customer
                : null,
          }),
        ]
      );
    }
    await client.query("COMMIT");
    return NextResponse.json(
      {
        job_id: jobId,
        accepted: filtered.length,
        rejected,
        in_flight: inFlight,
      },
      { status: 201 }
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[bulk POST]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  } finally {
    client.release();
  }
}
