#!/usr/bin/env node
// Targeted agency backfill. Walks every hotel where agency is still
// null, fetches the homepage HTML, runs the full agency detector
// pipeline (regex + <meta name="author/owner/designer"> + optional
// LLM fallback) and writes the result to tracker_hotel_agency.
//
// Skips the rest of analyzeUrl (no stack classification, no resource
// enrichment, no persist) — this is ~10× cheaper than a full
// re-analyze when the only thing we want is agencies.
//
// Usage:
//   DATABASE_URL=... node scripts/tracker/backfill-agencies.mjs \
//     [--limit=N]          (cap hotels processed; default all)
//     [--concurrency=6]    (in-flight HTTP fetches)
//     [--with-llm]         (also run agency-llm fallback if regex null)
//     [--country=CL]       (restrict to one ISO-2)

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

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? "true"];
    })
);

const limit = args.limit ? parseInt(args.limit, 10) : null;
const concurrency = Math.max(1, parseInt(args.concurrency || "6", 10));
const withLlm = args["with-llm"] === "true";
const country = (args.country || "").toUpperCase();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(2);
}

const { fetchHtml } = await import("../../src/lib/tracker/fetcher.ts");
const { detectAgency } = await import("../../src/lib/tracker/agency.ts");
let detectAgencyWithLlm = null;
if (withLlm) {
  ({ detectAgencyWithLlm } = await import(
    "../../src/lib/tracker/agency-llm.ts"
  ));
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway.internal")
    ? false
    : { rejectUnauthorized: false },
});
await client.connect();

const params = [];
let where = `h.website_url IS NOT NULL
  AND h.last_enriched_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tracker_hotel_agency a
    WHERE a.hotel_id = h.id
      AND (a.llm_verdict IS NULL OR a.llm_verdict = 'agency')
  )`;
if (country) {
  params.push(country);
  where += ` AND h.country = $${params.length}`;
}
let sql = `SELECT h.id, h.website_url FROM tracker_hotels h WHERE ${where} ORDER BY h.id`;
if (limit) {
  params.push(limit);
  sql += ` LIMIT $${params.length}`;
}

const r = await client.query(sql, params);
const targets = r.rows;
console.log(
  `[backfill-agencies] targets=${targets.length} concurrency=${concurrency} withLlm=${withLlm}${country ? " country=" + country : ""}`
);

let processed = 0;
let foundRegex = 0;
let foundMeta = 0;
let foundLlm = 0;
let errorCount = 0;
let skipped = 0;
const started = Date.now();

async function processOne(hotel) {
  processed++;
  try {
    const res = await fetchHtml(hotel.website_url, 15000);
    if (!res.ok) {
      errorCount++;
      return;
    }
    let baseHost = "";
    try {
      baseHost = new URL(res.final_url).hostname;
    } catch {
      /* ignore */
    }

    let agency = detectAgency(res.html, baseHost);
    let source = null;
    if (agency) {
      // Meta-tag hits go through the same detectAgency (tier 1 pass).
      // We differentiate only by the phrase prefix "meta[name=...]".
      source = agency.phrase?.startsWith("meta[name=") ? "meta" : "regex";
    } else if (withLlm && detectAgencyWithLlm) {
      agency = await detectAgencyWithLlm(res.html, baseHost);
      if (agency) source = "llm";
    }

    if (!agency) {
      skipped++;
      return;
    }

    await client.query(
      `INSERT INTO tracker_hotel_agency
         (hotel_id, agency_name, agency_url, evidence, confidence)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (hotel_id, agency_name) DO UPDATE SET
         agency_url = COALESCE(EXCLUDED.agency_url, tracker_hotel_agency.agency_url),
         evidence = EXCLUDED.evidence,
         confidence = GREATEST(EXCLUDED.confidence, tracker_hotel_agency.confidence)`,
      [
        hotel.id,
        agency.name.slice(0, 160),
        agency.url,
        JSON.stringify({
          phrase: agency.phrase,
          source,
          backfilled_at: new Date().toISOString(),
        }),
        agency.confidence,
      ]
    );

    if (source === "meta") foundMeta++;
    else if (source === "llm") foundLlm++;
    else foundRegex++;
  } catch (err) {
    errorCount++;
    if (errorCount < 5) console.warn("err:", err instanceof Error ? err.message : err);
  }
}

async function runPool(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
      if (processed % 50 === 0) {
        const elapsed = Math.round((Date.now() - started) / 1000);
        console.log(
          `  …${processed}/${items.length} (${elapsed}s) regex=${foundRegex} meta=${foundMeta} llm=${foundLlm} skip=${skipped} err=${errorCount}`
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
}

await runPool(targets, concurrency, processOne);

const elapsed = Math.round((Date.now() - started) / 1000);
console.log(`[backfill-agencies] done in ${elapsed}s`);
console.log(
  `  regex_hits=${foundRegex} meta_hits=${foundMeta} llm_hits=${foundLlm} no_agency=${skipped} errors=${errorCount}`
);

await client.end();
