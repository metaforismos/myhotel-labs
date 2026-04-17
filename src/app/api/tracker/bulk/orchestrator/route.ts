import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getOrchestratorState,
  startOrchestrator,
  stopOrchestrator,
} from "@/lib/tracker/bulk-orchestrator";
import { isOrchestratorPaused, setOrchestratorPaused } from "@/lib/tracker/kv";

export const dynamic = "force-dynamic";

// Watchdog: if the orchestrator is not running but there is pending work
// AND the persistent pause flag is off, restart it. Keeps the system
// self-healing across deploys/restarts when the UI (or anything else)
// polls this endpoint.
async function watchdog() {
  if (process.env.TRACKER_ORCHESTRATOR_AUTOSTART === "0") return;
  if (await isOrchestratorPaused()) return;
  const state = getOrchestratorState();
  if (state.running) return;
  try {
    const r = await pool.query<{ pending: number }>(
      `SELECT COUNT(*)::int AS pending
       FROM tracker_bulk_job_items
       WHERE status = 'pending'`
    );
    if ((r.rows[0]?.pending ?? 0) > 0) {
      await startOrchestrator();
    }
  } catch {
    /* ignore — next poll retries */
  }
}

export async function GET() {
  await watchdog();
  const state = getOrchestratorState();
  const paused = await isOrchestratorPaused();
  return NextResponse.json({ ...state, paused });
}

export async function POST() {
  // Unpause by default when something explicitly hits start.
  if (await isOrchestratorPaused()) {
    await setOrchestratorPaused(false);
  }
  const r = await startOrchestrator();
  return NextResponse.json(r);
}

export async function DELETE() {
  const r = stopOrchestrator();
  return NextResponse.json(r);
}

// PATCH { paused: true | false } — flip the persistent pause flag.
// When paused=true we also stop any currently running orchestrator so
// the effect is immediate; unpause does NOT auto-start (caller must POST
// or the watchdog will pick it up on the next GET).
export async function PATCH(request: NextRequest) {
  let body: { paused?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body allowed */
  }
  if (typeof body.paused !== "boolean") {
    return NextResponse.json({ error: "paused_bool_required" }, { status: 400 });
  }
  await setOrchestratorPaused(body.paused);
  if (body.paused) stopOrchestrator();
  return NextResponse.json({
    paused: body.paused,
    state: getOrchestratorState(),
  });
}
