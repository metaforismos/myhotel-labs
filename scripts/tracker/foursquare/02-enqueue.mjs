#!/usr/bin/env node
// Enqueue Foursquare-sourced hotels into a tracker bulk job.
//
// Reads from the local DuckDB materialized by 01-materialize.sql,
// filters one country, dedups against tracker_hotels (by canonical URL),
// chunks into batches of 2000 items, and POSTs each chunk to
// /api/tracker/bulk. The orchestrator drains them automatically.
//
// Usage:
//   node scripts/tracker/foursquare/02-enqueue.mjs \
//     --country=CL \
//     [--endpoint=http://localhost:3000] \
//     [--require-website]   (default: only enqueue hotels that have a website)
//     [--dry-run]           (print counts, don't post)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
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

const country = (args.country || "").toUpperCase();
if (!/^[A-Z]{2}$/.test(country)) {
  console.error("Usage: --country=CL (ISO-2 code)");
  process.exit(2);
}
const endpoint = args.endpoint || "http://localhost:3000";
const dryRun = args["dry-run"] === "true";
const requireWebsite = args["require-website"] !== "false";
const dbPath = args.db || path.resolve(repoRoot, "data/tracker/foursquare/places.db");
const chunkSize = parseInt(args.chunk || "2000", 10);

if (!fs.existsSync(dbPath)) {
  console.error(`[enqueue] local DuckDB not found: ${dbPath}`);
  console.error(`[enqueue] run 01-materialize.sql first`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

// Canonicalize a URL the same way the tracker seed importer does, so that
// dedup against tracker_hotels.website_url_canonical is apples-to-apples.
function canonicalizeUrl(url) {
  if (!url) return null;
  let s = String(url).trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const p = u.pathname.replace(/\/+$/, "");
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|fbclid|gclid|mc_|ref|ref_source)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const qs = params.length
      ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    return `${host}${p}${qs}`;
  } catch {
    return null;
  }
}

const OTA_HOSTS = new Set([
  "booking.com",
  "expedia.com",
  "hotels.com",
  "tripadvisor.com",
  "airbnb.com",
  "vrbo.com",
  "agoda.com",
  "despegar.com",
  "trivago.com",
  "kayak.com",
  "hostelworld.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "google.com",
  "goo.gl",
]);

function isOta(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (OTA_HOSTS.has(host)) return true;
    for (const o of OTA_HOSTS) if (host.endsWith("." + o)) return true;
    return false;
  } catch {
    return true;
  }
}

// Pull hotels from the local DuckDB as NDJSON so we don't have to worry
// about embedded commas/quotes in names or addresses.
function queryDuckDb() {
  const sql = `
    COPY (
      SELECT
        fsq_place_id,
        name,
        latitude,
        longitude,
        city,
        region,
        country,
        website,
        tel
      FROM places
      WHERE country = '${country}'
        ${requireWebsite ? "AND website IS NOT NULL AND website <> ''" : ""}
    ) TO '/dev/stdout' (FORMAT JSON, ARRAY FALSE);
  `;
  const out = execFileSync("duckdb", [dbPath, "-c", sql], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const rows = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  return rows;
}

async function main() {
  console.log(`[fsq] country=${country} dbPath=${dbPath}`);
  const rows = queryDuckDb();
  console.log(`[fsq] raw rows from Foursquare: ${rows.length}`);

  // Filter OTAs (website field sometimes points at Booking/TripAdvisor).
  const nonOta = rows.filter((r) => !r.website || !isOta(r.website));
  console.log(`[fsq] after OTA filter: ${nonOta.length}`);

  // Dedup against tracker_hotels.website_url_canonical.
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("railway.internal")
      ? false
      : { rejectUnauthorized: false },
  });
  await client.connect();
  const existing = await client.query(
    `SELECT website_url_canonical FROM tracker_hotels
     WHERE website_url_canonical IS NOT NULL`
  );
  const known = new Set(existing.rows.map((r) => r.website_url_canonical));
  console.log(`[fsq] existing canonicals in tracker_hotels: ${known.size}`);

  const items = [];
  let skippedDup = 0;
  let skippedBadUrl = 0;
  for (const r of nonOta) {
    if (!r.website) {
      // Still useful to have the name+location for later Google Places
      // enrichment, but not bulk-analyzable without a URL. Skip.
      continue;
    }
    const canonical = canonicalizeUrl(r.website);
    if (!canonical) {
      skippedBadUrl++;
      continue;
    }
    if (known.has(canonical)) {
      skippedDup++;
      continue;
    }
    known.add(canonical); // avoid intra-batch dupes too
    items.push({
      url: r.website,
      name: r.name || null,
      city: r.city || null,
      region: r.region || null,
      country: r.country || null,
      external_id: `fsq:${r.fsq_place_id}`,
    });
  }
  await client.end();

  console.log(
    `[fsq] dedup: skipped ${skippedDup} already-in-DB, ${skippedBadUrl} bad URLs`
  );
  console.log(`[fsq] ready to enqueue: ${items.length}`);

  if (items.length === 0) {
    console.log("[fsq] nothing to enqueue");
    return;
  }

  if (dryRun) {
    console.log("[fsq] DRY RUN — sample of first 5:");
    for (const s of items.slice(0, 5)) console.log("  ", s);
    return;
  }

  // Chunk and POST.
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  console.log(`[fsq] posting ${chunks.length} batch(es) of up to ${chunkSize}`);

  for (let i = 0; i < chunks.length; i++) {
    const label = `Foursquare ${country} ${i + 1}/${chunks.length}`;
    const res = await fetch(`${endpoint}/api/tracker/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, items: chunks[i] }),
    });
    const j = await res.json();
    if (!res.ok) {
      console.error(`[fsq] chunk ${i + 1} failed`, res.status, j);
      process.exit(1);
    }
    console.log(
      `[fsq] chunk ${i + 1}/${chunks.length} → job=${j.job_id} accepted=${j.accepted} in_flight=${j.in_flight?.length ?? 0} rejected=${j.rejected?.length ?? 0}`
    );
  }

  console.log("[fsq] done — orchestrator will drain the jobs automatically");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
