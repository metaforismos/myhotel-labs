#!/usr/bin/env node
// Retroactive cleanup of false-positive "Custom / self-hosted" BE
// detections. The original heuristic was too permissive (any same-host
// anchor whose text OR path contained "reserv"/"book" matched), so the
// category exploded with non-booking pages: #fragments, /contact,
// /how-to-book, /manage-reservation, /privacy-policy, etc.
//
// Applies the same strict BOOKING_ENDPOINT / BOOKING_NEGATIVE regexes
// that the new detector now uses. Rows that no longer qualify are
// deleted. A residual count remains for the genuinely self-hosted sites
// (PHP booking pages, /reservas endpoints, etc.).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const envFile = path.resolve(repoRoot, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Same regexes as selfhosted.ts — kept in sync.
const BOOKING_ENDPOINT =
  /\/(?:book(?:ing)?|reserv(?:a|ar|as|e|ation|ations)?|checkout|engine|hotel[-_]booking|make[-_]reservation|new[-_]reservation)\/?(?:\?|$)|\.(?:php|aspx|jsp|cfm)(?:\?|$)/i;
const BOOKING_NEGATIVE =
  /\/(?:how[-_]?to[-_]?book|manage[-_]?(?:my[-_]?)?reservation|find[-_]?reservation|reservation[-_]?policy|revisar[-_]?reserva|contrato[-_]?(?:de[-_]?)?hospeda|contact|contacto|terms|privacy|about|sobre)\b/i;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(2);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway.internal")
    ? false
    : { rejectUnauthorized: false },
});
await client.connect();

const rows = await client.query(
  `SELECT id, evidence, evidence_url
   FROM tracker_hotel_stack
   WHERE category='booking_engine'
     AND vendor='Custom / self-hosted'`
);

console.log(`[cleanup-selfhosted] rows to evaluate: ${rows.rowCount}`);

let toDelete = [];
let reasonCounts = { fragment: 0, negative_path: 0, non_booking_path: 0, unparseable: 0, kept: 0 };

for (const r of rows.rows) {
  const url = r.evidence?.[0]?.matched;
  if (!url) {
    // Form actions with unparseable evidence — keep (conservative).
    reasonCounts.kept++;
    continue;
  }
  if (url.startsWith("#")) {
    toDelete.push({ id: r.id, reason: "fragment", url });
    reasonCounts.fragment++;
    continue;
  }
  let pathPart;
  try {
    // Resolve relative to the hotel URL if needed.
    const base = r.evidence_url || "https://example.com";
    pathPart = new URL(url, base).pathname;
  } catch {
    toDelete.push({ id: r.id, reason: "unparseable", url });
    reasonCounts.unparseable++;
    continue;
  }
  if (BOOKING_NEGATIVE.test(pathPart)) {
    toDelete.push({ id: r.id, reason: "negative_path", url });
    reasonCounts.negative_path++;
    continue;
  }
  if (!BOOKING_ENDPOINT.test(pathPart)) {
    toDelete.push({ id: r.id, reason: "non_booking_path", url });
    reasonCounts.non_booking_path++;
    continue;
  }
  reasonCounts.kept++;
}

console.log("[cleanup-selfhosted] breakdown:", reasonCounts);
console.log(`[cleanup-selfhosted] will delete ${toDelete.length} rows`);

if (toDelete.length > 0) {
  // Sample a few
  console.log("sample deletes:");
  for (const d of toDelete.slice(0, 6)) console.log(`  [${d.reason}] ${d.url?.slice(0, 100)}`);

  const ids = toDelete.map((x) => x.id);
  const CHUNK = 1000;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await client.query(
      "DELETE FROM tracker_hotel_stack WHERE id = ANY($1::uuid[])",
      [chunk]
    );
    deleted += res.rowCount;
  }
  console.log(`[cleanup-selfhosted] deleted ${deleted} rows`);
}

await client.end();
