-- Tracker — detección de cadenas vs independientes (Fase 1D.6)
-- is_chain es un booleano determinístico derivado de señales en el HTML
-- (paths de propiedades, JSON-LD con múltiples hoteles, frases tipo
-- "nuestros hoteles"). chain_signals guarda el raw para trazabilidad.

ALTER TABLE tracker_hotels
  ADD COLUMN IF NOT EXISTS is_chain BOOLEAN,
  ADD COLUMN IF NOT EXISTS property_count_estimate INTEGER,
  ADD COLUMN IF NOT EXISTS chain_signals JSONB;

CREATE INDEX IF NOT EXISTS idx_tracker_hotels_is_chain
  ON tracker_hotels (is_chain) WHERE is_chain IS NOT NULL;
