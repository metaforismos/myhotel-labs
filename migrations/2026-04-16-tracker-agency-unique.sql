-- Tracker — idempotencia en tracker_hotel_agency (Fase 1D.7)
-- Sin unique, cada re-análisis de un hotel insertaba una nueva fila.
-- Con (hotel_id, agency_name) único podemos usar UPSERT.

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_hotel_agency
  ON tracker_hotel_agency (hotel_id, agency_name);
