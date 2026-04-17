// Tiny key/value helpers backed by the tracker_kv table. Used for
// runtime-mutable tracker settings that must survive process restarts
// (e.g. the global orchestrator pause flag).

import pool from "@/lib/db";

export async function getKv(key: string): Promise<string | null> {
  const r = await pool.query<{ v: string }>(
    "SELECT v FROM tracker_kv WHERE k = $1",
    [key]
  );
  return r.rows[0]?.v ?? null;
}

export async function setKv(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO tracker_kv (k, v, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (k) DO UPDATE SET
       v = EXCLUDED.v,
       updated_at = NOW()`,
    [key, value]
  );
}

export async function isOrchestratorPaused(): Promise<boolean> {
  try {
    const v = await getKv("orchestrator_paused");
    return v === "true";
  } catch {
    // Table missing or DB unavailable — assume NOT paused so the
    // orchestrator remains usable. Flag only matters when DB works.
    return false;
  }
}

export async function setOrchestratorPaused(paused: boolean): Promise<void> {
  await setKv("orchestrator_paused", paused ? "true" : "false");
}
