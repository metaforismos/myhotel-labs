// Core batch processing for tracker bulk jobs.
// Extracted from /api/tracker/bulk/[id]/run so that both the HTTP endpoint
// (user-triggered, UI orchestrated) and the in-process orchestrator
// (Railway-backed autonomous loop) share the exact same logic.
//
// Claims up to `batchSize` pending items for the given job, processes them
// concurrently, writes results back, and recomputes the job's aggregate
// status. Uses FOR UPDATE SKIP LOCKED so multiple concurrent callers are
// safe — each claim is atomic and non-overlapping.

import pool from "@/lib/db";
import { analyzeUrl } from "@/lib/tracker/analyze";
import { extractOtaPresence } from "@/lib/tracker/ota";
import { compactStackSummary, synthesizeStack } from "@/lib/tracker/stack";

export const BULK_DEFAULT_BATCH = 5;
export const BULK_MAX_BATCH = 10;
// Per-batch in-flight analyze calls. Each call holds a pool connection
// for ~500ms around its DB writes (INSERT into tracker_hotels +
// tracker_hotel_stack). Combined with MAX_PARALLEL_JOBS=3 this caps
// concurrent pool usage to ~6 connections at peak (plus UI polling).
export const BULK_CONCURRENCY = 2;

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

export type ProcessBatchResult = {
  processed: number;
  remaining: number;
  done: number;
  error: number;
  job_status: "created" | "running" | "done" | "error" | "unknown";
};

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

export async function processBulkBatch(
  jobId: string,
  batchSize: number = BULK_DEFAULT_BATCH
): Promise<ProcessBatchResult> {
  const size = Math.min(BULK_MAX_BATCH, Math.max(1, batchSize));

  const client = await pool.connect();
  let items: ItemRow[] = [];
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tracker_bulk_jobs
       SET status = 'running',
           started_at = COALESCE(started_at, NOW())
       WHERE id = $1`,
      [jobId]
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
      [jobId, size]
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
    throw err;
  }
  client.release();

  await runWithConcurrency(items, BULK_CONCURRENCY, async (item) => {
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
        return;
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
        [item.id, r.persisted?.hotel_id ?? null, JSON.stringify(summary)]
      );
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
    }
  });

  const remaining = await pool.query<{
    pending: number;
    running: number;
    done: number;
    error: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE status = 'done')::int    AS done,
       COUNT(*) FILTER (WHERE status = 'error')::int   AS error
     FROM tracker_bulk_job_items WHERE job_id = $1`,
    [jobId]
  );
  const { pending, running, done, error } = remaining.rows[0];

  let jobStatus: ProcessBatchResult["job_status"] = "unknown";
  if (pending === 0 && running === 0) {
    await pool.query(
      `UPDATE tracker_bulk_jobs
       SET status = 'done', finished_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
    jobStatus = "done";
  } else {
    jobStatus = "running";
  }

  return {
    processed: items.length,
    remaining: pending,
    done,
    error,
    job_status: jobStatus,
  };
}

export type ActiveJob = {
  id: string;
  label: string | null;
  status: string;
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
};

export async function listActiveJobs(): Promise<ActiveJob[]> {
  // A job is "active" when it is not terminally done AND it still has
  // work to do (pending items) OR claimed-but-unfinished items (running).
  const res = await pool.query<ActiveJob>(
    `SELECT
       j.id,
       j.label,
       j.status,
       j.total,
       COALESCE(agg.pending, 0)::int AS pending,
       COALESCE(agg.running, 0)::int AS running,
       COALESCE(agg.done,    0)::int AS done,
       COALESCE(agg.error,   0)::int AS error
     FROM tracker_bulk_jobs j
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'running')::int AS running,
         COUNT(*) FILTER (WHERE status = 'done')::int    AS done,
         COUNT(*) FILTER (WHERE status = 'error')::int   AS error
       FROM tracker_bulk_job_items
       WHERE job_id = j.id
     ) agg ON TRUE
     WHERE j.status IN ('created', 'running')
       AND COALESCE(agg.pending, 0) > 0
     ORDER BY j.created_at ASC`
  );
  return res.rows;
}
