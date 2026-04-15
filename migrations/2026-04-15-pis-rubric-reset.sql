-- PIS rubric reset — 2026-04-15
--
-- One-shot cleanup after migrating PIS scoring from the 2-score model
-- (pis_score + hypothesis_score) to the 5-axis rubric (Directness / Magnitude /
-- Evidence / Strategic leverage / Delivery confidence).
--
-- Effect:
--   - NULLs every stored score so legacy-shape `scoring_result` blobs don't
--     bleed into the new UI. `hypothesis_score` column is left in place
--     physically (nullable) — we just stop reading/writing it.
--   - Flips `status = 'scored'` rows back to 'draft' so they show up in the
--     "Borradores" filter and get re-evaluated under the new rubric.
--   - Leaves `pre-evaluacion`, `draft`, and `archived` rows' status alone.
--
-- Run once against the production database after deploying the new code.

UPDATE pis_initiatives
SET pis_score = NULL,
    hypothesis_score = NULL,
    scoring_result = NULL,
    model_used = NULL,
    scored_at = NULL,
    status = CASE WHEN status = 'scored' THEN 'draft' ELSE status END,
    updated_at = NOW();

-- Verification query — should return 0 rows with scoring_result populated:
-- SELECT id, status, pis_score, scoring_result
-- FROM pis_initiatives
-- WHERE scoring_result IS NOT NULL;
