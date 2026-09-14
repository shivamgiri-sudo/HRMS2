-- backend/sql/migrations/436_workforce_mandate_alert_threshold.sql
-- Adds alert_threshold_pct to workforce_mandate so HC-gap alerts can fire
-- when actual coverage falls below the configured minimum coverage percentage.
-- Additive / backward-compatible — safe to apply against existing schema.

ALTER TABLE workforce_mandate
  ADD COLUMN IF NOT EXISTS alert_threshold_pct DECIMAL(5,2) NOT NULL DEFAULT 80.00
    COMMENT 'Minimum coverage % below which HC gap alert fires';
