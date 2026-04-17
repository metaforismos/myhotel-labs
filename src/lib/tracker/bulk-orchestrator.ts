// Autonomous orchestrator for tracker bulk jobs.
//
// Lives in the Next.js server process (Railway long-running Node). Polls the
// DB on a fixed interval, finds every active job with pending items, and
// fires processBulkBatch in parallel for each. A per-job reentrancy guard
// prevents the same job from being driven concurrently by this loop (the
// DB-level claim `FOR UPDATE SKIP LOCKED` makes parallel drivers safe, but
// we don't need the extra pressure — one in-flight tick per job is enough).
//
// The orchestrator is module-scoped and singleton. Calling start() when it
// is already running is a no-op. It resumes automatically on server boot
// via src/instrumentation.ts so Railway restarts don't require manual
// re-activation.

import {
  listActiveJobs,
  processBulkBatch,
  BULK_MAX_BATCH,
} from "./bulk-run";

const TICK_MS = 2000;
// Upper bound on concurrent jobs driven per tick. With CONCURRENCY=3 inside
// processBulkBatch, MAX_PARALLEL_JOBS=6 means up to 18 analyzeUrl calls in
// flight at once — matches DB pool (max=10) + LLM rate limits comfortably.
const MAX_PARALLEL_JOBS = 6;

type OrchestratorState = {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastTickProcessed: number;
  totalTicks: number;
  totalProcessed: number;
  lastError: string | null;
  activeJobs: number;
};

const state: OrchestratorState = {
  running: false,
  startedAt: null,
  lastTickAt: null,
  lastTickProcessed: 0,
  totalTicks: 0,
  totalProcessed: 0,
  lastError: null,
  activeJobs: 0,
};

let timer: NodeJS.Timeout | null = null;
const inFlight = new Set<string>();

async function tick(): Promise<void> {
  try {
    const jobs = await listActiveJobs();
    state.activeJobs = jobs.length;
    if (jobs.length === 0) return;

    // Only drive jobs that aren't already being processed by this loop.
    const candidates = jobs
      .filter((j) => !inFlight.has(j.id))
      .slice(0, MAX_PARALLEL_JOBS);

    const results = await Promise.all(
      candidates.map(async (job) => {
        inFlight.add(job.id);
        try {
          return await processBulkBatch(job.id, BULK_MAX_BATCH);
        } catch (err) {
          state.lastError = err instanceof Error ? err.message : String(err);
          console.error("[bulk-orchestrator] job", job.id, err);
          return null;
        } finally {
          inFlight.delete(job.id);
        }
      })
    );

    const processed = results.reduce(
      (sum, r) => sum + (r?.processed ?? 0),
      0
    );
    state.lastTickAt = new Date().toISOString();
    state.lastTickProcessed = processed;
    state.totalTicks += 1;
    state.totalProcessed += processed;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    console.error("[bulk-orchestrator] tick error", err);
  }
}

export function startOrchestrator(): { started: boolean; state: OrchestratorState } {
  if (state.running) {
    return { started: false, state };
  }
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;

  // Fire-and-forget first tick immediately so the user sees progress.
  tick();
  timer = setInterval(() => {
    // Don't overlap ticks — if the previous tick is still running
    // because MAX_PARALLEL_JOBS jobs are in flight, wait it out.
    if (inFlight.size >= MAX_PARALLEL_JOBS) return;
    tick();
  }, TICK_MS);

  // Railway hot-reload safety: allow process to exit if only the timer is
  // keeping it alive (the Next.js server keeps it alive anyway).
  timer.unref?.();

  console.log("[bulk-orchestrator] started");
  return { started: true, state };
}

export function stopOrchestrator(): { stopped: boolean; state: OrchestratorState } {
  if (!state.running) {
    return { stopped: false, state };
  }
  state.running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  console.log("[bulk-orchestrator] stopped");
  return { stopped: true, state };
}

export function getOrchestratorState(): OrchestratorState & { inFlightJobs: string[] } {
  return { ...state, inFlightJobs: Array.from(inFlight) };
}
