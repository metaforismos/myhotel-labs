#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, "..", "..", ".env.local");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r1 = await c.query("SELECT COUNT(*)::int AS n FROM tracker_hotels");
const r2 = await c.query(
  "SELECT canonical_name, country, city, external_id FROM tracker_hotels LIMIT 5"
);
const r3 = await c.query("SELECT COUNT(*)::int AS n FROM tracker_hotel_sources");
const r4 = await c.query(
  "SELECT country, COUNT(*)::int AS n FROM tracker_hotels GROUP BY country ORDER BY n DESC LIMIT 10"
);
console.log("hotels:", r1.rows[0].n, "sources:", r3.rows[0].n);
console.table(r2.rows);
console.log("top countries:");
console.table(r4.rows);
await c.end();
