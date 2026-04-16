-- Tracker — schema base (Fase 0)
-- Ver docs/PRD-Tracker.md §8. Tablas core para v1; v2+ agregan hotel_contacts,
-- hotel_discovery_jobs, hotel_chains. Postura: proveniencia trazable, confianza
-- por señal, versionado temporal (no sobrescribir stack).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Identidad canónica del hotel
CREATE TABLE IF NOT EXISTS tracker_hotels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  TEXT NOT NULL,
  slug            TEXT,
  country         TEXT,              -- ISO-2 cuando sea posible, free-text para seed
  region          TEXT,
  city            TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  category        TEXT,              -- hotel | apart-hotel | hostel | cabañas | resort
  stars           SMALLINT,
  rooms_estimate  INTEGER,
  website_url     TEXT,
  brand           TEXT,
  chain_id        UUID,              -- fk futura a tracker_chains
  is_customer     BOOLEAN NOT NULL DEFAULT FALSE,
  external_id     TEXT,              -- id_hotel del seed u otros sistemas
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_enriched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tracker_hotels_country_city
  ON tracker_hotels (country, city);
CREATE INDEX IF NOT EXISTS idx_tracker_hotels_is_customer
  ON tracker_hotels (is_customer) WHERE is_customer = TRUE;
CREATE INDEX IF NOT EXISTS idx_tracker_hotels_external_id
  ON tracker_hotels (external_id);
CREATE INDEX IF NOT EXISTS idx_tracker_hotels_name_trgm
  ON tracker_hotels USING gin (canonical_name gin_trgm_ops);

-- URLs del hotel (oficial, landing, subdominios)
CREATE TABLE IF NOT EXISTS tracker_hotel_urls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     UUID NOT NULL REFERENCES tracker_hotels(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  kind         TEXT NOT NULL,        -- official | landing | subdomain
  verified_at  TIMESTAMPTZ,
  confidence   NUMERIC(3,2),         -- 0..1
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_hotel_urls_hotel_id
  ON tracker_hotel_urls (hotel_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_hotel_urls_hotel_url
  ON tracker_hotel_urls (hotel_id, url);

-- Stack tecnológico detectado
CREATE TABLE IF NOT EXISTS tracker_hotel_stack (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       UUID NOT NULL REFERENCES tracker_hotels(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,      -- cms | booking_engine | pms | channel_mgr | analytics | chat | reviews | ads | other
  vendor         TEXT NOT NULL,
  product        TEXT,
  version        TEXT,
  detected_via   TEXT NOT NULL,      -- wappalyzer | rule | llm | manual
  evidence_url   TEXT,
  evidence       JSONB,              -- snippet, selector, etc.
  confidence     NUMERIC(3,2),
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_tracker_hotel_stack_hotel_id
  ON tracker_hotel_stack (hotel_id);
CREATE INDEX IF NOT EXISTS idx_tracker_hotel_stack_category_vendor
  ON tracker_hotel_stack (category, vendor) WHERE active = TRUE;

-- Presencia en OTAs
CREATE TABLE IF NOT EXISTS tracker_hotel_ota_presence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID NOT NULL REFERENCES tracker_hotels(id) ON DELETE CASCADE,
  ota              TEXT NOT NULL,    -- booking | expedia | tripadvisor | airbnb | vrbo | hotels | agoda | google
  profile_url      TEXT,
  external_id      TEXT,
  verified_at      TIMESTAMPTZ,
  confidence       NUMERIC(3,2),
  review_count     INTEGER,
  rating           NUMERIC(3,2),
  last_scraped_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_hotel_ota_hotel_id
  ON tracker_hotel_ota_presence (hotel_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_hotel_ota
  ON tracker_hotel_ota_presence (hotel_id, ota);

-- Agencia web asociada
CREATE TABLE IF NOT EXISTS tracker_hotel_agency (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     UUID NOT NULL REFERENCES tracker_hotels(id) ON DELETE CASCADE,
  agency_name  TEXT NOT NULL,
  agency_url   TEXT,
  evidence     JSONB,
  confidence   NUMERIC(3,2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_hotel_agency_hotel_id
  ON tracker_hotel_agency (hotel_id);

-- Eventos / auditoría (cambios de stack, altas de OTAs, etc.)
CREATE TABLE IF NOT EXISTS tracker_hotel_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     UUID NOT NULL REFERENCES tracker_hotels(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  payload      JSONB,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_hotel_events_hotel_time
  ON tracker_hotel_events (hotel_id, observed_at DESC);

-- Proveniencia (raw de cada fuente que aportó datos)
CREATE TABLE IF NOT EXISTS tracker_hotel_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID NOT NULL REFERENCES tracker_hotels(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,         -- mapbox | serpapi | wappalyzer | apollo | linkedin | manual | csv_seed_2025_06 | csv_bulk
  raw         JSONB,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_hotel_sources_hotel_id
  ON tracker_hotel_sources (hotel_id);
CREATE INDEX IF NOT EXISTS idx_tracker_hotel_sources_source
  ON tracker_hotel_sources (source);
