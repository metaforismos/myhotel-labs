#!/usr/bin/env bash
# End-to-end local smoke test for the Foursquare ingest.
#
# Pulls 30 Chile hotels (with website) from a handful of remote
# Foursquare parquet shards, POSTs them as a bulk job to localhost,
# and lets the orchestrator analyze them. No local DB required.
#
# Usage: bash scripts/tracker/foursquare/sample-local.sh

set -euo pipefail

COUNTRY="${COUNTRY:-CL}"
LIMIT="${LIMIT:-30}"
ENDPOINT="${ENDPOINT:-http://localhost:3000}"

echo "[fsq-sample] country=$COUNTRY limit=$LIMIT endpoint=$ENDPOINT"

# Query 5 shards (enough to find 30 Chilean hotels with website).
SHARDS=(0 1 2 3 4 5 6 7)
URLS=""
for s in "${SHARDS[@]}"; do
  [[ -n "$URLS" ]] && URLS="${URLS}, "
  URLS="${URLS}'https://data.source.coop/fused/fsq-os-places/2024-11-19/places/${s}.parquet'"
done

SQL="INSTALL httpfs; LOAD httpfs; SET http_timeout=60000;
COPY (
  SELECT
    fsq_place_id AS external_id,
    name,
    locality AS city,
    region,
    country,
    website AS url
  FROM read_parquet([${URLS}])
  WHERE country = '${COUNTRY}'
    AND website IS NOT NULL
    AND website <> ''
    AND list_has_any(fsq_category_labels, [
      'Travel and Transportation > Lodging > Hotel',
      'Travel and Transportation > Lodging > Resort',
      'Travel and Transportation > Lodging > Boutique Hotel',
      'Travel and Transportation > Lodging > Hostel',
      'Travel and Transportation > Lodging > Bed and Breakfast',
      'Travel and Transportation > Lodging > Inn'
    ])
  LIMIT ${LIMIT}
) TO '/dev/stdout' (FORMAT JSON, ARRAY FALSE);"

TMP=$(mktemp)
trap "rm -f $TMP" EXIT

echo "[fsq-sample] querying Foursquare..."
duckdb -c "$SQL" > "$TMP"

COUNT=$(wc -l < "$TMP" | tr -d ' ')
echo "[fsq-sample] got $COUNT hotels"
if [[ "$COUNT" == "0" ]]; then
  echo "[fsq-sample] no results — aborting"
  exit 1
fi

# Build JSON body: wrap items in { label, items: [...] } and prefix external_id with fsq:
BODY=$(python3 -c "
import json, sys
items = []
with open('$TMP') as f:
  for line in f:
    line = line.strip()
    if not line: continue
    r = json.loads(line)
    items.append({
      'url': r['url'],
      'name': r.get('name'),
      'city': r.get('city'),
      'region': r.get('region'),
      'country': r.get('country'),
      'external_id': 'fsq:' + r['external_id'],
    })
print(json.dumps({'label': 'Foursquare sample ${COUNTRY}', 'items': items}))
")

echo "[fsq-sample] POST /api/tracker/bulk ..."
RESP=$(curl -s -X POST "$ENDPOINT/api/tracker/bulk" \
  -H 'content-type: application/json' \
  -d "$BODY")

echo "[fsq-sample] response: $RESP"
