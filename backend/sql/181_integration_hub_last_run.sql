-- Migration 181: Add last_run_at column to integration_config
-- Purpose: Track last sync time for each integration connector
-- Date: 2026-06-14

-- Add last_run_at column
ALTER TABLE integration_config
ADD COLUMN last_run_at DATETIME NULL
AFTER active_status;

-- Update from existing run history
UPDATE integration_config ic
SET last_run_at = (
  SELECT MAX(started_at)
  FROM integration_connector_run icr
  WHERE icr.integration_key = ic.integration_key
)
WHERE EXISTS (
  SELECT 1
  FROM integration_connector_run icr2
  WHERE icr2.integration_key = ic.integration_key
);

-- Add index for performance
CREATE INDEX idx_integration_config_last_run
ON integration_config(last_run_at);

-- Verify
SELECT
  integration_key,
  integration_name,
  last_run_at,
  TIMESTAMPDIFF(HOUR, last_run_at, NOW()) as hours_since_last_run
FROM integration_config
WHERE active_status = 1
ORDER BY last_run_at DESC;
