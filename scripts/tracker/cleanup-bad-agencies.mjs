#!/usr/bin/env node
// Limpia agencias falsas/ruido en tracker_hotel_agency: plataformas
// (Cloudbeds, WordPress themes), stop words (por, el), emails y
// fragmentos HTML rotos.
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

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// 1) Preview: mostrar qué va a borrar.
const { rows: preview } = await client.query(
  `SELECT agency_name, COUNT(*)::int AS n
   FROM tracker_hotel_agency
   WHERE
     -- Plataformas conocidas
     LOWER(agency_name) IN (
       'cloudbeds','siteminder','mews','asksuite','synxis','sabre',
       'wordpress','wix','squarespace','webflow','shopify','drupal',
       'elegant themes','ultimatelysocial','jetpack','elementor',
       'divi','oceanwp','ocean wp','astra','generatepress','yoast',
       'woocommerce','tambourine','umi','fnsbooking','omnibees',
       'hotetec','availpro','d-edge','profitroom','travelclick',
       'ihotelier','roomcloud','vertical booking','pegasus',
       'little hotelier','guestline','html','html5','bootstrap',
       'jquery','fontawesome','google','facebook',
       'canvas','siteminder canvas','blogger','blogspot',
       'litespeed','litespeed web server','litespeed technologies',
       'litespeed technologies inc',
       'please be advised that litespeed technologies inc'
     )
     OR LOWER(agency_name) IN ('por','de','the','a','an','la','el','los','las','and','y','para','with','con','our','we','us','team','staff','services','services on your own','all rights reserved','copyright')
     OR agency_name ~ '@'           -- emails
     OR agency_name ~ 'onerror='    -- HTML attribute leakage
     OR agency_name ~ 'onclick='
     OR agency_name ~ 'onload='
     OR agency_name LIKE '%"%'      -- quote leakage
     OR agency_name LIKE '%=%'      -- attr leakage
     OR agency_name ~ '^https?://'
     OR LENGTH(agency_name) < 3
   GROUP BY agency_name
   ORDER BY n DESC`
);

console.log(`[cleanup] se borrarán ${preview.length} agencias distintas:`);
console.table(preview);

const { rowCount } = await client.query(
  `DELETE FROM tracker_hotel_agency
   WHERE
     LOWER(agency_name) IN (
       'cloudbeds','siteminder','mews','asksuite','synxis','sabre',
       'wordpress','wix','squarespace','webflow','shopify','drupal',
       'elegant themes','ultimatelysocial','jetpack','elementor',
       'divi','oceanwp','ocean wp','astra','generatepress','yoast',
       'woocommerce','tambourine','umi','fnsbooking','omnibees',
       'hotetec','availpro','d-edge','profitroom','travelclick',
       'ihotelier','roomcloud','vertical booking','pegasus',
       'little hotelier','guestline','html','html5','bootstrap',
       'jquery','fontawesome','google','facebook',
       'canvas','siteminder canvas','blogger','blogspot',
       'litespeed','litespeed web server','litespeed technologies',
       'litespeed technologies inc',
       'please be advised that litespeed technologies inc'
     )
     OR LOWER(agency_name) IN ('por','de','the','a','an','la','el','los','las','and','y','para','with','con','our','we','us','team','staff','services','services on your own','all rights reserved','copyright')
     OR agency_name ~ '@'
     OR agency_name ~ 'onerror='
     OR agency_name ~ 'onclick='
     OR agency_name ~ 'onload='
     OR agency_name LIKE '%"%'
     OR agency_name LIKE '%=%'
     OR agency_name ~ '^https?://'
     OR LENGTH(agency_name) < 3`
);
console.log(`[cleanup] borradas ${rowCount} filas (por nombre).`);

// 2) URL-based cleanup: cualquier agencia cuyo agency_url apunte a un host
// de plataforma conocido es reconocimiento de producto, no agencia.
const PLATFORM_HOST_PATTERN = [
  "siteminder.com",
  "cloudbeds.com",
  "mews.com",
  "profitroom.com",
  "profitroom.pl",
  "hotetec.com",
  "d-edge.com",
  "availpro.com",
  "synxis.com",
  "ihotelier.com",
  "travelclick.com",
  "amadeus-hospitality.com",
  "sabrehospitality.com",
  "littlehotelier.com",
  "guestline.com",
  "hotelrunner.com",
  "omnibees.com",
  "roomcloud.net",
  "asksuite.com",
  "bookingcore.com",
  "wordpress.com",
  "wordpress.org",
  "wix.com",
  "squarespace.com",
  "webflow.com",
  "shopify.com",
  "blogger.com",
  "blogspot.com",
  "google.com",
  "litespeedtech.com",
  "litespeed.com",
  "godaddy.com",
  "wpengine.com",
].map((h) => h.replace(/\./g, "\\."));
const hostRegex = "(^https?://)([^/]*\\.)?(" + PLATFORM_HOST_PATTERN.join("|") + ")(/|$|:)";

const { rowCount: urlDeleted } = await client.query(
  `DELETE FROM tracker_hotel_agency
   WHERE agency_url ~* $1`,
  [hostRegex]
);
console.log(`[cleanup] borradas ${urlDeleted} filas (por host plataforma).`);

await client.end();
