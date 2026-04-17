#!/usr/bin/env node
// Re-analyze a bounded sample of hotels with incomplete stack data, then
// diff before/after to measure the new pipeline's lift (e.g. Tier-4 LLM
// agency fallback).
//
// Flow:
//   1. Pick N hotels matching the "incomplete" criteria (default: no
//      agency detected, website_url present, last_enriched_at recent).
//   2. Snapshot each hotel's current state (agency name, stack rows) to
//      /tmp/reanalyze-<stamp>.json.
//   3. Enqueue them as a tracker bulk job — the orchestrator drains.
//   4. After drain (separate invocation with --compare=<stamp>), read the
//      snapshot, query current state, and print a before/after summary.
//
// Usage:
//   DATABASE_URL=... node scripts/tracker/reanalyze-incomplete.mjs \
//     --country=CL --sample=100 [--endpoint=https://...]
//
//   DATABASE_URL=... node scripts/tracker/reanalyze-incomplete.mjs \
//     --compare=2026-04-17T12-40-00-000Z

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

const country = (args.country || "CL").toUpperCase();
const sample = parseInt(args.sample || "100", 10);
const endpoint = args.endpoint || "https://myhotel-labs.up.railway.app";
const compareStamp = args.compare;
const outDir = path.resolve(repoRoot, "data/tracker");
fs.mkdirSync(outDir, { recursive: true });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(2);
}

async function connect() {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("railway.internal")
      ? false
      : { rejectUnauthorized: false },
  });
  await c.connect();
  return c;
}

async function stateForHotels(client, hotelIds) {
  // Returns per-hotel: { agency_names: [], stack_categories: [] }
  const r = await client.query(
    `SELECT
       h.id,
       h.canonical_name,
       h.website_url,
       COALESCE(
         json_agg(DISTINCT jsonb_build_object('name', a.agency_name, 'url', a.agency_url, 'confidence', a.confidence))
           FILTER (WHERE a.agency_name IS NOT NULL), '[]'::json
       ) AS agencies,
       COALESCE(
         json_agg(DISTINCT jsonb_build_object('category', s.category, 'vendor', s.vendor, 'detected_via', s.detected_via, 'confidence', s.confidence))
           FILTER (WHERE s.category IS NOT NULL), '[]'::json
       ) AS stack
     FROM tracker_hotels h
     LEFT JOIN tracker_hotel_agency a ON a.hotel_id = h.id
     LEFT JOIN tracker_hotel_stack s ON s.hotel_id = h.id
     WHERE h.id = ANY($1::uuid[])
     GROUP BY h.id`,
    [hotelIds]
  );
  const map = new Map();
  for (const row of r.rows) {
    map.set(row.id, {
      canonical_name: row.canonical_name,
      website_url: row.website_url,
      agencies: row.agencies,
      stack: row.stack,
    });
  }
  return map;
}

async function run() {
  if (compareStamp) {
    await runCompare();
    return;
  }

  const client = await connect();
  // "Incomplete": no agency + has website + was analyzed before. This is
  // exactly the gap the Tier-4 LLM fallback is supposed to close.
  const cand = await client.query(
    `SELECT h.id, h.canonical_name, h.website_url
     FROM tracker_hotels h
     WHERE h.country = $1
       AND h.website_url IS NOT NULL
       AND h.last_enriched_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM tracker_hotel_agency a WHERE a.hotel_id = h.id
       )
     ORDER BY random()
     LIMIT $2`,
    [country, sample]
  );
  const hotels = cand.rows;
  console.log(`[reanalyze] picked ${hotels.length} ${country} hotels with incomplete data`);
  if (hotels.length === 0) {
    await client.end();
    return;
  }

  const before = await stateForHotels(client, hotels.map((h) => h.id));
  await client.end();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotFile = path.join(outDir, `reanalyze-${stamp}.json`);
  fs.writeFileSync(
    snapshotFile,
    JSON.stringify(
      {
        country,
        sample,
        taken_at: new Date().toISOString(),
        hotels: hotels.map((h) => ({
          id: h.id,
          url: h.website_url,
          before: before.get(h.id),
        })),
      },
      null,
      2
    )
  );
  console.log(`[reanalyze] snapshot: ${snapshotFile}`);
  console.log(`[reanalyze] stamp: ${stamp}`);

  // Enqueue as a bulk job.
  const body = {
    label: `Reanalyze incomplete ${country} (${stamp})`,
    items: hotels.map((h) => ({
      url: h.website_url,
      name: h.canonical_name,
      country,
      external_id: `reanalyze:${h.id}`,
    })),
  };
  const res = await fetch(`${endpoint}/api/tracker/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) {
    console.error(`[reanalyze] enqueue failed`, res.status, j);
    process.exit(1);
  }
  console.log(
    `[reanalyze] job_id=${j.job_id}  accepted=${j.accepted}  in_flight=${j.in_flight?.length ?? 0}  rejected=${j.rejected?.length ?? 0}`
  );
  console.log();
  console.log(`When the job finishes, run:`);
  console.log(`  node scripts/tracker/reanalyze-incomplete.mjs --compare=${stamp}`);
}

async function runCompare() {
  const snapshotFile = path.join(outDir, `reanalyze-${compareStamp}.json`);
  if (!fs.existsSync(snapshotFile)) {
    console.error(`snapshot not found: ${snapshotFile}`);
    process.exit(2);
  }
  const snap = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  const ids = snap.hotels.map((h) => h.id);

  const client = await connect();
  const after = await stateForHotels(client, ids);
  await client.end();

  let gainedAgency = 0;
  let gainedStack = 0;
  let noChange = 0;
  const newAgencyDetails = [];
  const newStackDetails = [];

  for (const h of snap.hotels) {
    const bef = h.before;
    const aft = after.get(h.id);
    if (!aft) continue;
    const befAgencies = (bef.agencies || []).map((a) => a.name).filter(Boolean);
    const aftAgencies = (aft.agencies || []).map((a) => a.name).filter(Boolean);
    const befStack = new Set(
      (bef.stack || [])
        .filter((s) => s.vendor)
        .map((s) => `${s.category}:${s.vendor}`)
    );
    const aftStack = new Set(
      (aft.stack || [])
        .filter((s) => s.vendor)
        .map((s) => `${s.category}:${s.vendor}`)
    );

    const newAgencies = aftAgencies.filter((a) => !befAgencies.includes(a));
    const newStack = [...aftStack].filter((s) => !befStack.has(s));

    if (newAgencies.length > 0) {
      gainedAgency++;
      newAgencyDetails.push({
        hotel: bef.canonical_name,
        url: bef.website_url,
        newAgencies,
      });
    }
    if (newStack.length > 0) gainedStack++;
    if (newAgencies.length > 0 || newStack.length > 0) {
      // counts above
    } else noChange++;

    if (newStack.length > 0) {
      newStackDetails.push({
        hotel: bef.canonical_name,
        url: bef.website_url,
        newStack,
      });
    }
  }

  console.log(`=== DIFF (${snap.country}, ${snap.hotels.length} hotels) ===`);
  console.log(`  gained agency:  ${gainedAgency}`);
  console.log(`  gained stack:   ${gainedStack}`);
  console.log(`  no change:      ${noChange}`);
  console.log();
  console.log(`=== NEW AGENCIES (first 15) ===`);
  for (const d of newAgencyDetails.slice(0, 15)) {
    console.log(`  ${d.hotel?.slice(0, 40) ?? "?"}: ${d.newAgencies.join(", ")}  [${d.url}]`);
  }
  console.log();
  console.log(`=== NEW STACK ENTRIES (first 15) ===`);
  for (const d of newStackDetails.slice(0, 15)) {
    console.log(`  ${d.hotel?.slice(0, 40) ?? "?"}: ${d.newStack.join(", ")}  [${d.url}]`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
