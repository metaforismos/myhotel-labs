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
import { isOrchestratorPaused } from "./kv";

const TICK_MS = 2000;
// Upper bound on concurrent jobs driven per tick. Kept conservative to
// stay well under Railway Postgres max_connections=100 even during
// rolling-deploy overlap (old + new process both connected). With pool
// max=8 and CONCURRENCY=2 inside processBulkBatch, MAX_PARALLEL_JOBS=3
// gives peak ~6 in-flight analyze calls + claim transactions, i.e. ~8
// connections per replica — leaves headroom for UI polling and a second
// process during deploy.
const MAX_PARALLEL_JOBS = 3;

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
    // Respect the persistent pause flag. If paused, we still stay
    // "running" so the caller sees we are alive, but we do nothing —
    // this way unpausing is instant (no need to restart) while zero
    // items are processed.
    if (await isOrchestratorPaused()) {
      state.activeJobs = 0;
      return;
    }
    const jobs = await listActiveJobs();
    state.activeJobs = jobs.length;

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
    // Always advance tick counters so the UI can show liveness even when
    // there are no active jobs (idle loop). Without this, an orchestrator
    // that just started and has nothing to do looks identical to a dead
    // one ("último tick: nunca").
    state.lastTickAt = new Date().toISOString();
    state.lastTickProcessed = processed;
    state.totalTicks += 1;
    state.totalProcessed += processed;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    console.error("[bulk-orchestrator] tick error", err);
  }
}

export async function startOrchestrator(): Promise<{ started: boolean; state: OrchestratorState }> {
  if (state.running) {
    return { started: false, state };
  }
  // Respect the persistent pause flag on start — skip entirely if paused.
  // Tick itself also checks, but this avoids setting up a timer we don't
  // need.
  if (await isOrchestratorPaused()) {
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

// Self-start on module load. instrumentation.ts is the ideal trigger
// (fires at server boot) but in some runtimes that hook doesn't run
// reliably. Having the side-effect here means the orchestrator also
// boots the first time any /api/tracker/bulk route is hit — either way
// it ends up running without manual intervention.
if (
  typeof process !== "undefined" &&
  process.env.NEXT_RUNTIME === "nodejs" &&
  process.env.TRACKER_ORCHESTRATOR_AUTOSTART !== "0"
) {
  setTimeout(() => {
    startOrchestrator().catch((err) => {
      console.error("[bulk-orchestrator] autostart failed", err);
    });
  }, 500);
}
