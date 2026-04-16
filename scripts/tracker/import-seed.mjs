#!/usr/bin/env node
// Import seed CSV (hotel-scraper/scraper_latam/hoteles.csv) into tracker_hotels.
// Usage: node scripts/tracker/import-seed.mjs [<csv-path>] [--limit=N] [--reset]
//
// - Maps: id_hotel→external_id, nombre→canonical_name, ciudad→city,
//   estado/region→region, pais→country, latitud→lat, longitud→lng.
// - Does NOT import url_* fields (most are OTAs; Fase 1 se encarga del linkage).
// - Idempotente: upsert por external_id + source=csv_seed_2025_06.
// - Cada row agrega fila en tracker_hotel_sources con raw payload.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, "..", "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SOURCE_TAG = "csv_seed_2025_06";
const DEFAULT_CSV = "/Users/andresjohnson/proyectos/hotel-scraper/scraper_latam/hoteles.csv";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? "true"];
    })
);

const csvPath = positional[0] || DEFAULT_CSV;
const limit = flags.limit ? parseInt(flags.limit, 10) : Infinity;
const reset = flags.reset === "true";
const samplePerCountry = flags["sample-per-country"]
  ? parseInt(flags["sample-per-country"], 10)
  : null;

if (!fs.existsSync(csvPath)) {
  console.error(`csv not found: ${csvPath}`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

// CSV can contain multi-line quoted fields. Assemble logical rows.
function* iterRows(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let buffer = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        buffer += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        buffer += ch;
      }
    } else if (ch === "\n" && !inQuotes) {
      if (buffer.trim()) yield buffer;
      buffer = "";
    } else if (ch === "\r" && !inQuotes) {
      // skip — handled by \n
    } else {
      buffer += ch;
    }
  }
  if (buffer.trim()) yield buffer;
}

function slugify(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

function toFloat(v) {
  if (v === "" || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function countryIso(countryRaw) {
  if (!countryRaw) return null;
  const c = countryRaw.trim().toLowerCase();
  const map = {
    argentina: "AR",
    bolivia: "BO",
    brasil: "BR",
    brazil: "BR",
    chile: "CL",
    colombia: "CO",
    "costa rica": "CR",
    cuba: "CU",
    ecuador: "EC",
    "el salvador": "SV",
    guatemala: "GT",
    honduras: "HN",
    mexico: "MX",
    méxico: "MX",
    nicaragua: "NI",
    panama: "PA",
    panamá: "PA",
    paraguay: "PY",
    peru: "PE",
    perú: "PE",
    "puerto rico": "PR",
    "republica dominicana": "DO",
    "república dominicana": "DO",
    uruguay: "UY",
    venezuela: "VE",
    usa: "US",
    "united states": "US",
    "estados unidos": "US",
  };
  return map[c] || countryRaw.slice(0, 2).toUpperCase();
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway.internal") ? false : { rejectUnauthorized: false },
});

await client.connect();

if (reset) {
  console.log(`[seed] --reset: borrando filas con source=${SOURCE_TAG}...`);
  await client.query(
    `DELETE FROM tracker_hotels
     WHERE id IN (SELECT hotel_id FROM tracker_hotel_sources WHERE source = $1)`,
    [SOURCE_TAG]
  );
}

const rowIter = iterRows(csvPath);
const headerLine = rowIter.next().value;
const headers = parseCsvLine(headerLine);

const idx = (name) => headers.indexOf(name);
const H = {
  id_hotel: idx("id_hotel"),
  nombre: idx("nombre"),
  suburbio: idx("suburbio"),
  barrio: idx("barrio"),
  ciudad: idx("ciudad"),
  ciudad_geopy: idx("ciudad_geopy"),
  estado: idx("estado"),
  region: idx("region"),
  pais: idx("pais"),
  codigo_postal: idx("codigo_postal"),
  latitud: idx("latitud"),
  longitud: idx("longitud"),
  direccion: idx("direccion_formateada"),
  geosource: idx("geosource"),
  fuente: idx("fuente_geodata"),
};

let total = 0;
let inserted = 0;
let updated = 0;
let skipped = 0;
const countryCount = new Map();

const BATCH = 500;
let batch = [];

async function flushBatch() {
  if (!batch.length) return;
  await client.query("BEGIN");
  try {
    for (const row of batch) {
      const {
        external_id,
        canonical_name,
        slug,
        country,
        region,
        city,
        lat,
        lng,
        raw,
      } = row;

      const res = await client.query(
        `INSERT INTO tracker_hotels (canonical_name, slug, country, region, city, lat, lng, external_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET
           canonical_name = EXCLUDED.canonical_name,
           slug = EXCLUDED.slug,
           country = COALESCE(EXCLUDED.country, tracker_hotels.country),
           region = COALESCE(EXCLUDED.region, tracker_hotels.region),
           city = COALESCE(EXCLUDED.city, tracker_hotels.city),
           lat = COALESCE(EXCLUDED.lat, tracker_hotels.lat),
           lng = COALESCE(EXCLUDED.lng, tracker_hotels.lng),
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [canonical_name, slug, country, region, city, lat, lng, external_id]
      );
      const { id, inserted: wasInserted } = res.rows[0];
      if (wasInserted) inserted++;
      else updated++;

      await client.query(
        `INSERT INTO tracker_hotel_sources (hotel_id, source, raw)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, SOURCE_TAG, raw]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  batch = [];
}

// Add UNIQUE on external_id if missing (needed for ON CONFLICT)
await client.query(
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_hotels_external_id
     ON tracker_hotels (external_id)
   WHERE external_id IS NOT NULL`
);

for (const line of rowIter) {
  if (total >= limit) break;
  total++;

  const fields = parseCsvLine(line);
  const external_id = (fields[H.id_hotel] || "").trim();
  const canonical_name = (fields[H.nombre] || "").trim();
  if (!external_id || !canonical_name) {
    skipped++;
    continue;
  }

  const city = (fields[H.ciudad] || fields[H.ciudad_geopy] || "").trim() || null;
  const region = (fields[H.estado] || fields[H.region] || "").trim() || null;
  const country = countryIso((fields[H.pais] || "").trim());
  const lat = toFloat(fields[H.latitud]);
  const lng = toFloat(fields[H.longitud]);

  if (samplePerCountry !== null) {
    const key = country || "_unknown";
    const n = countryCount.get(key) || 0;
    if (n >= samplePerCountry) {
      skipped++;
      continue;
    }
    countryCount.set(key, n + 1);
  }

  const raw = {
    id_hotel: external_id,
    nombre: canonical_name,
    city,
    region,
    country: fields[H.pais]?.trim() || null,
    direccion: fields[H.direccion]?.trim() || null,
    geosource: fields[H.geosource]?.trim() || null,
    fuente: fields[H.fuente]?.trim() || null,
  };

  batch.push({
    external_id,
    canonical_name,
    slug: slugify(canonical_name),
    country,
    region,
    city,
    lat,
    lng,
    raw,
  });

  if (batch.length >= BATCH) {
    await flushBatch();
    if (total % 5000 === 0) {
      console.log(`  …procesados ${total} (ins=${inserted} upd=${updated} skip=${skipped})`);
    }
  }
}

await flushBatch();
await client.end();

console.log(
  `[seed] total=${total} inserted=${inserted} updated=${updated} skipped=${skipped}`
);
if (samplePerCountry !== null) {
  console.log("[seed] por país:");
  for (const [k, v] of [...countryCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}
