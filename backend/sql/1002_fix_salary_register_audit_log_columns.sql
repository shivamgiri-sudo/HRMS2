-- Migration 1002: Fix salary_register_audit_log schema conflict
-- Problem: Migration 306 defined different columns than what JCR service writes
-- Solution: Add missing columns expected by joining-control-room.service.ts lockSalaryRegister()

ALTER TABLE salary_register_audit_log
  ADD COLUMN IF NOT EXISTS candidate_id   INT          NULL AFTER salary_register_id,
  ADD COLUMN IF NOT EXISTS actor_id       INT          NULL AFTER candidate_id,
  ADD COLUMN IF NOT EXISTS action         VARCHAR(100) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS payload_json   LONGTEXT     NULL AFTER action;

-- Add index for candidate lookups
CREATE INDEX IF NOT EXISTS idx_sral_candidate ON salary_register_audit_log(candidate_id);
