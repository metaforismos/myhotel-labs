# Foursquare OS Places → Tracker

Ingests hotels/lodging from the [Foursquare Open Source Places](https://opensource.foursquare.com/os-places/) dataset
into the tracker pipeline. Used to expand the base beyond what came from
OpenStreetMap in the original seed.

**Dataset:** Apache 2.0. Hosted ungated on [source.coop/fused/fsq-os-places](https://source.coop/fused/fsq-os-places) (Nov 2024 snapshot).

## Flow

1. **Materialize** (one-time, ~10-15 min, ~60 MB local) — downloads and
   filters the 10 GB upstream to just LATAM + USA lodging rows into a
   local DuckDB file:

   ```bash
   duckdb data/tracker/foursquare/places.db \
     < scripts/tracker/foursquare/01-materialize.sql
   ```

2. **Enqueue** (per country, instant) — reads the local DB, dedups
   against `tracker_hotels.website_url_canonical`, filters OTA links,
   and POSTs batches of up to 2000 items to `/api/tracker/bulk`. The
   orchestrator drains them automatically.

   ```bash
   # Dry run (shows counts, doesn't post):
   node scripts/tracker/foursquare/02-enqueue.mjs --country=CL --dry-run

   # Live (posts to localhost by default):
   node scripts/tracker/foursquare/02-enqueue.mjs --country=CL

   # Against Railway:
   node scripts/tracker/foursquare/02-enqueue.mjs \
     --country=CL \
     --endpoint=https://myhotel-labs.up.railway.app
   ```

## Notes

- `--require-website=false` keeps hotels without a website — useful
  once the Google Places enricher is wired up (they become candidates
  for URL recovery).
- External IDs are prefixed `fsq:` so they don't collide with the
  `id_hotel` IDs from the OSM-based seed.
- Rerunning is safe: the API dedups URLs already pending/running in
  other jobs, and canonical URLs already in `tracker_hotels` are
  filtered before posting.
