import { Pool } from "pg";

// Pool sizing: Railway Postgres has max_connections=100 shared across
// all replicas, running processes (during rolling deploys old + new
// overlap for 10-30s), and anyone else connecting. We keep max low and
// close idle connections aggressively so deploy churn doesn't pile up
// "sorry, too many clients already" errors.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway.internal")
    ? false
    : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 5_000,
  // Cap how long we wait for a connection; fail fast instead of
  // piling up pending requests when the DB is saturated.
  connectionTimeoutMillis: 10_000,
});

// Close the pool gracefully on shutdown so Postgres reclaims the slots
// immediately instead of waiting on its own idle timeout. Railway sends
// SIGTERM on redeploy.
if (typeof process !== "undefined" && !(globalThis as { __trackerPoolHooks?: boolean }).__trackerPoolHooks) {
  (globalThis as { __trackerPoolHooks?: boolean }).__trackerPoolHooks = true;
  const cleanup = () => {
    pool.end().catch(() => {});
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

export default pool;
