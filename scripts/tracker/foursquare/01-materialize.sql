-- One-time extract: Foursquare OS Places → local DuckDB table
-- with only hotels/lodging in LATAM + USA. Subsequent per-country
-- queries run instantly from the local DB.
--
-- Source: https://source.coop/fused/fsq-os-places (Nov 2024 snapshot).
-- The dataset is Apache 2.0 licensed; no auth required on source.coop.
--
-- Usage:
--   duckdb data/tracker/foursquare/places.db < scripts/tracker/foursquare/01-materialize.sql
--
-- Takes ~10-15 min over HTTPS. Output file ~30-60 MB.

INSTALL httpfs;
LOAD httpfs;
SET http_timeout = 120000;
SET memory_limit = '4GB';

CREATE TABLE IF NOT EXISTS places AS
SELECT
  fsq_place_id,
  name,
  latitude,
  longitude,
  address,
  locality   AS city,
  region,
  postcode,
  country,
  website,
  tel,
  email,
  fsq_category_labels,
  date_refreshed
FROM read_parquet([
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/0.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/1.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/2.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/3.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/4.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/5.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/6.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/7.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/8.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/9.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/10.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/11.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/12.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/13.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/14.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/15.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/16.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/17.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/18.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/19.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/20.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/21.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/22.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/23.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/24.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/25.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/26.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/27.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/28.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/29.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/30.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/31.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/32.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/33.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/34.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/35.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/36.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/37.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/38.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/39.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/40.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/41.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/42.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/43.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/44.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/45.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/46.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/47.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/48.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/49.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/50.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/51.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/52.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/53.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/54.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/55.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/56.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/57.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/58.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/59.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/60.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/61.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/62.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/63.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/64.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/65.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/66.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/67.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/68.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/69.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/70.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/71.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/72.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/73.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/74.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/75.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/76.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/77.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/78.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/79.parquet',
  'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/80.parquet'
])
WHERE country IN (
  -- LATAM
  'MX','GT','BZ','SV','HN','NI','CR','PA',
  'CU','DO','PR','HT','JM','TT','BS','BB',
  'VE','CO','EC','PE','BO','CL','AR','PY','UY','BR','GY','SR',
  -- USA
  'US'
)
AND list_has_any(fsq_category_labels, [
  'Travel and Transportation > Lodging > Hotel',
  'Travel and Transportation > Lodging > Resort',
  'Travel and Transportation > Lodging > Boutique Hotel',
  'Travel and Transportation > Lodging > Hostel',
  'Travel and Transportation > Lodging > Motel',
  'Travel and Transportation > Lodging > Bed and Breakfast',
  'Travel and Transportation > Lodging > Inn',
  'Travel and Transportation > Lodging > Vacation Rental'
]);

CREATE INDEX IF NOT EXISTS idx_places_country ON places(country);

SELECT country, COUNT(*) AS total, COUNT(website) AS with_website
FROM places
GROUP BY country
ORDER BY total DESC;
