#!/usr/bin/env node
// Usage: node scripts/tracker/apply-migration.mjs <migration.sql>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-migration.mjs <migration.sql>");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const sql = fs.readFileSync(file, "utf8");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway.internal") ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  console.log(`✓ applied ${path.basename(file)}`);
} catch (err) {
  console.error(`✗ failed: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
