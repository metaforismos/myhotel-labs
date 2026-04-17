import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { analyzeUrl } from "@/lib/tracker/analyze";
import { extractOtaPresence } from "@/lib/tracker/ota";
import { compactStackSummary, synthesizeStack } from "@/lib/tracker/stack";

export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;
const CONCURRENCY = 3;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return out;
}

type ItemRow = {
  id: string;
  url: string;
  input: {
    name?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    external_id?: string | null;
    is_customer?: boolean | null;
  };
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let body: { batch_size?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body allowed */
  }
  const batchSize = Math.min(
    MAX_BATCH,
    Math.max(1, body.batch_size ?? DEFAULT_BATCH)
  );

  // Mark job as running and fetch next pending items atomically.
  const client = await pool.connect();
  let items: ItemRow[] = [];
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tracker_bulk_jobs
       SET status = 'running',
           started_at = COALESCE(started_at, NOW())
       WHERE id = $1`,
      [id]
    );
    const res = await client.query<ItemRow>(
      `SELECT i.id, i.url, i.input
       FROM tracker_bulk_job_items i
       WHERE i.job_id = $1 AND i.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM tracker_bulk_job_items other
           WHERE other.url = i.url
             AND other.status = 'running'
             AND other.job_id <> i.job_id
         )
       ORDER BY i.idx ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [id, batchSize]
    );
    items = res.rows;
    if (items.length > 0) {
      await client.query(
        `UPDATE tracker_bulk_job_items
         SET status = 'running', started_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [items.map((it) => it.id)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    console.error("[bulk/:id/run claim]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  client.release();

  // Process claimed items concurrently.
  const results = await runWithConcurrency(items, CONCURRENCY, async (item) => {
    const prefill = {
      canonical_name: item.input?.name ?? undefined,
      city: item.input?.city ?? undefined,
      region: item.input?.region ?? undefined,
      country: item.input?.country ?? undefined,
      external_id: item.input?.external_id ?? undefined,
      is_customer:
        typeof item.input?.is_customer === "boolean"
          ? item.input.is_customer
          : undefined,
    };

    try {
      const r = await analyzeUrl({
        url: item.url,
        save: true,
        prefill,
        timeoutMs: 15000,
      });

      if ("ok" in r && r.ok === false) {
        await pool.query(
          `UPDATE tracker_bulk_job_items
           SET status = 'error',
               error = $2,
               finished_at = NOW()
           WHERE id = $1`,
          [item.id, `${r.error}${r.error_code ? ` [${r.error_code}]` : ""}`]
        );
        return { item_id: item.id, ok: false, error: r.error };
      }

      const stack = synthesizeStack(r.detections, r.resources);
      const compact = compactStackSummary(stack);
      const otas = extractOtaPresence(r.outbound_links || []);
      const summary = {
        final_url: r.final_url,
        status: r.status,
        duration_ms: r.duration_ms,
        title: r.title,
        detections_count: r.detections.length,
        resources_count: r.resources.length,
        insecure_tls: r.insecure_tls ?? false,
        rendered_via_browser: r.rendered_via_browser ?? false,
        is_chain: r.chain.is_chain,
        property_count_estimate: r.chain.property_count_estimate,
        chain_signals: r.chain.signals,
        agency: r.agency
          ? {
              name: r.agency.name,
              url: r.agency.url,
              confidence: r.agency.confidence,
            }
          : null,
        otas: otas.map((o) => ({ ota: o.ota, profile_url: o.profile_url })),
        stack,
        ...compact,
      };
      await pool.query(
        `UPDATE tracker_bulk_job_items
         SET status = 'done',
             hotel_id = $2,
             result_summary = $3::jsonb,
             finished_at = NOW()
         WHERE id = $1`,
        [
          item.id,
          r.persisted?.hotel_id ?? null,
          JSON.stringify(summary),
        ]
      );
      return { item_id: item.id, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE tracker_bulk_job_items
         SET status = 'error',
             error = $2,
             finished_at = NOW()
         WHERE id = $1`,
        [item.id, msg.slice(0, 500)]
      );
      return { item_id: item.id, ok: false, error: msg };
    }
  });

  // Recompute job status.
  const remaining = await pool.query<{
    pending: number;
    running: number;
    error: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE status = 'error')::int AS error
     FROM tracker_bulk_job_items WHERE job_id = $1`,
    [id]
  );
  const { pending, running, error } = remaining.rows[0];
  if (pending === 0 && running === 0) {
    const finalStatus = error > 0 ? "done" : "done";
    await pool.query(
      `UPDATE tracker_bulk_jobs
       SET status = $2, finished_at = NOW()
       WHERE id = $1`,
      [id, finalStatus]
    );
  }

  return NextResponse.json({
    processed: items.length,
    remaining: pending,
    results,
  });
}
