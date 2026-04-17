// Auto-start the tracker bulk orchestrator when the Next.js server boots.
//
// Next.js calls `register()` once per server process (both in dev and in
// production, Node runtime only). This lets the orchestrator survive
// Railway restarts/redeploys without requiring a manual POST to the
// start endpoint. No-op in edge or build contexts.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.TRACKER_ORCHESTRATOR_AUTOSTART === "0") return;

  // Give the server a moment to be ready for DB queries.
  setTimeout(async () => {
    try {
      const mod = await import("@/lib/tracker/bulk-orchestrator");
      mod.startOrchestrator();
    } catch (err) {
      console.error("[instrumentation] failed to start orchestrator", err);
    }
  }, 2000);
}
