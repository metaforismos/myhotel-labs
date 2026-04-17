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

// OTAs / agregadores / redes sociales — url_N que matchee estos dominios
// no se usa como website_url. El sitio "oficial" es la primera url_N
// cuyo dominio NO está en esta lista.
const OTA_DOMAINS = new Set([
  "booking.com",
  "expedia.com",
  "expedia.cl",
  "expedia.com.ar",
  "expedia.com.br",
  "expedia.mx",
  "hotels.com",
  "tripadvisor.com",
  "tripadvisor.cl",
  "tripadvisor.com.ar",
  "tripadvisor.com.br",
  "tripadvisor.com.mx",
  "tripadvisor.es",
  "airbnb.com",
  "airbnb.cl",
  "airbnb.com.ar",
  "airbnb.com.br",
  "airbnb.com.mx",
  "vrbo.com",
  "agoda.com",
  "despegar.com",
  "despegar.com.ar",
  "despegar.cl",
  "despegar.com.mx",
  "decolar.com",
  "kayak.com",
  "trivago.com",
  "trivago.cl",
  "trivago.com.ar",
  "trivago.com.mx",
  "trivago.com.br",
  "travelocity.com",
  "priceline.com",
  "orbitz.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "pinterest.com",
  "wikipedia.org",
  "google.com",
  "maps.google.com",
  "goo.gl",
  "bing.com",
  "yandex.com",
  "yelp.com",
  "foursquare.com",
  "hoteles.com",
  "hotelscombined.com",
  "hotelbeds.com",
  "cuponatic.com",
  "groupon.com",
  "linkedin.com",
  "wa.me",
  "t.me",
]);

function extractHost(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOta(host) {
  if (!host) return true;
  if (OTA_DOMAINS.has(host)) return true;
  return [...OTA_DOMAINS].some((o) => host.endsWith("." + o));
}

function canonicalizeUrl(url) {
  if (!url) return null;
  let s = url.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|fbclid|gclid|mc_|ref|ref_source)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const qs = params.length
      ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    return `${host}${path}${qs}`;
  } catch {
    return null;
  }
}

function pickOfficialUrl(fields, urlIdxList) {
  for (const idx of urlIdxList) {
    if (idx < 0) continue;
    const url = (fields[idx] || "").trim();
    if (!url) continue;
    const host = extractHost(url);
    if (!host || isOta(host)) continue;
    // Normaliza: agrega scheme si falta
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return withScheme;
  }
  return null;
}

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

// Columnas url_1..url_10 para pickOfficialUrl.
const URL_IDX = [];
for (let i = 1; i <= 10; i++) URL_IDX.push(idx(`url_${i}`));

let total = 0;
let inserted = 0;
let updated = 0;
let skipped = 0;
let urlsFound = 0;
let canonicalCollisions = 0;
const countryCount = new Map();
// First-wins dedup en memoria: la primera fila con un canonical se
// queda con él; las demás quedan con website_url pero
// website_url_canonical=null. Típico caso: cadenas del CSV apuntan al
// mismo dominio raíz (marriott.com × 26 hoteles).
const seenCanonicals = new Set();

const BATCH = 500;
let batch = [];

async function flushBatch() {
  if (!batch.length) return;
  await client.query("BEGIN");
  try {
    // Multi-row UPSERT de tracker_hotels. 10 columnas × N filas.
    const hotelParams = [];
    const hotelValues = [];
    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      const base = i * 10;
      hotelValues.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`
      );
      hotelParams.push(
        r.canonical_name,
        r.slug,
        r.country,
        r.region,
        r.city,
        r.lat,
        r.lng,
        r.external_id,
        r.website_url,
        r.website_url_canonical
      );
    }

    const hotelRes = await client.query(
      `INSERT INTO tracker_hotels
         (canonical_name, slug, country, region, city, lat, lng,
          external_id, website_url, website_url_canonical)
       VALUES ${hotelValues.join(",")}
       ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         canonical_name = EXCLUDED.canonical_name,
         slug = EXCLUDED.slug,
         country = COALESCE(EXCLUDED.country, tracker_hotels.country),
         region = COALESCE(EXCLUDED.region, tracker_hotels.region),
         city = COALESCE(EXCLUDED.city, tracker_hotels.city),
         lat = COALESCE(EXCLUDED.lat, tracker_hotels.lat),
         lng = COALESCE(EXCLUDED.lng, tracker_hotels.lng),
         website_url = COALESCE(tracker_hotels.website_url, EXCLUDED.website_url),
         website_url_canonical = COALESCE(tracker_hotels.website_url_canonical, EXCLUDED.website_url_canonical),
         updated_at = NOW()
       RETURNING id, external_id, (xmax = 0) AS inserted`,
      hotelParams
    );

    // Mapear external_id → hotel_id para insertar sources.
    const idByExt = new Map();
    for (const row of hotelRes.rows) {
      idByExt.set(row.external_id, row.id);
      if (row.inserted) inserted++;
      else updated++;
    }

    // Multi-row INSERT de sources. ON CONFLICT DO NOTHING en caso de
    // re-run (source tag + hotel_id no tiene unique real, así que
    // agregaría duplicados en re-runs — toleramos y limpiamos aparte).
    const srcParams = [];
    const srcValues = [];
    let srcIdx = 0;
    for (const r of batch) {
      const hotelId = idByExt.get(r.external_id);
      if (!hotelId) continue;
      const base = srcIdx * 3;
      srcValues.push(`($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`);
      srcParams.push(hotelId, SOURCE_TAG, JSON.stringify(r.raw));
      srcIdx++;
    }
    if (srcValues.length > 0) {
      await client.query(
        `INSERT INTO tracker_hotel_sources (hotel_id, source, raw)
         VALUES ${srcValues.join(",")}
         ON CONFLICT DO NOTHING`,
        srcParams
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

// Precarga canonicals ya presentes en DB (de corridas previas)
// para no colisionar durante el import in-memory dedup.
{
  const existing = await client.query(
    "SELECT website_url_canonical FROM tracker_hotels WHERE website_url_canonical IS NOT NULL"
  );
  for (const row of existing.rows) seenCanonicals.add(row.website_url_canonical);
  console.log(`[seed] precarga canonicals existentes: ${seenCanonicals.size}`);
}

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

  // Extrae la primera URL que NO sea OTA → website_url oficial candidato.
  const website_url = pickOfficialUrl(fields, URL_IDX);
  let website_url_canonical = website_url ? canonicalizeUrl(website_url) : null;
  if (website_url) urlsFound++;
  // Dedup in-memory: primera fila con ese canonical se lo queda.
  if (website_url_canonical) {
    if (seenCanonicals.has(website_url_canonical)) {
      website_url_canonical = null;
      canonicalCollisions++;
    } else {
      seenCanonicals.add(website_url_canonical);
    }
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
    website_url,
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
    website_url,
    website_url_canonical,
    raw,
  });

  if (batch.length >= BATCH) {
    await flushBatch();
    console.log(
      `  …procesados ${total} (ins=${inserted} upd=${updated} skip=${skipped} urls=${urlsFound})`
    );
  }
}

await flushBatch();
await client.end();

console.log(
  `[seed] total=${total} inserted=${inserted} updated=${updated} skipped=${skipped} urls_found=${urlsFound} canonical_collisions=${canonicalCollisions}`
);
if (samplePerCountry !== null) {
  console.log("[seed] por país:");
  for (const [k, v] of [...countryCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}
