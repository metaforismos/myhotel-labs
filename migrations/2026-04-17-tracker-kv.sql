-- Simple key/value table for runtime-mutable tracker settings.
-- Used so operators can pause the autonomous orchestrator without
-- needing a code change or env var + redeploy. Survives restarts.

CREATE TABLE IF NOT EXISTS tracker_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tracker_kv (k, v)
VALUES ('orchestrator_paused', 'false')
ON CONFLICT (k) DO NOTHING;
