-- 508_ats_onboarding_bridge_code_columns.sql
-- Adds employee_code and bridge_status columns to ats_onboarding_bridge.
-- These columns are written by employee-code-gate.routes.ts at code-generation time
-- but were never defined in any migration file, causing silent UPDATE failures on
-- fresh schema installs. This migration makes the schema match the runtime code.
-- Additive only — no existing columns altered, no data deleted.

ALTER TABLE ats_onboarding_bridge
  ADD COLUMN IF NOT EXISTS employee_code  VARCHAR(30)  NULL          COMMENT 'Denormalized copy of generated employee code for quick gate queries',
  ADD COLUMN IF NOT EXISTS bridge_status  VARCHAR(50)  NOT NULL DEFAULT 'pending' COMMENT 'Lifecycle: pending | code_generated | employee_created | activated',
  ADD COLUMN IF NOT EXISTS updated_at     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last updated timestamp';

-- Index for gate-check queries that filter by bridge_status
CREATE INDEX IF NOT EXISTS idx_aob_bridge_status ON ats_onboarding_bridge (bridge_status);
-- Index for reverse-lookup by employee_code
CREATE INDEX IF NOT EXISTS idx_aob_employee_code ON ats_onboarding_bridge (employee_code);
