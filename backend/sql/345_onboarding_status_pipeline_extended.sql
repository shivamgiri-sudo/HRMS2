-- =============================================================================
-- Migration 345: Onboarding status pipeline extended ENUM values
-- Scope: Phase 5 — HR onboarding request completion flow with status pipeline
-- 
-- Adds new transition states to ats_onboarding_request.status to support
-- the full onboarding lifecycle: HR review → offer → branch head approval →
-- payroll HR validation → BGV → employee creation.
--
-- Backward-compatible: existing rows keep their current ENUM value.
-- MySQL 8+ ALTER TABLE ENUM is purely metadata; no table rebuild required.
-- =============================================================================

-- Guard: skip if migration 345 already applied
SET @migration_applied = (SELECT COUNT(*) FROM _migrations WHERE migration_id = '345_onboarding_status_pipeline_extended');
SELECT IF(@migration_applied > 0, 'SKIPPED', 'APPLYING') AS migration_345;

-- ── 1. Extend ats_onboarding_request.status ENUM ─────────────────────────────
-- Current: 'pending','in_progress','profile_submitted','offer_submitted','approved','rejected'
-- Extended: adds 'hr_approved','payroll_pending','payroll_approved','bgv_pending','bgv_completed','appointment_pending','employee_created'

ALTER TABLE ats_onboarding_request
  MODIFY COLUMN `status` ENUM(
    'pending',
    'in_progress',
    'profile_submitted',
    'offer_submitted',
    'approved',
    'rejected',
    'hr_approved',
    'payroll_pending',
    'payroll_approved',
    'bgv_pending',
    'bgv_completed',
    'appointment_pending',
    'employee_created'
  ) NOT NULL DEFAULT 'pending';

-- ── 2. Add missing index for candidate_id in ats_employment_offer if absent ──
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = 'mas_hrms' AND TABLE_NAME = 'ats_employment_offer' AND INDEX_NAME = 'idx_offr_candidate');
SELECT IF(@idx_exists > 0, 'INDEX_EXISTS', 'CREATING') AS idx_employment_offer_candidate;
SET @idx_sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_offr_candidate ON ats_employment_offer(candidate_id)',
  'SELECT 1');
PREPARE stmt FROM @idx_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. Add index for review status queries on candidate_onboarding_profile ──
SET @idx2_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = 'mas_hrms' AND TABLE_NAME = 'candidate_onboarding_profile' AND INDEX_NAME = 'idx_prof_reviewed');
SELECT IF(@idx2_exists > 0, 'INDEX_EXISTS', 'CREATING') AS idx_profile_reviewed_by;
SET @idx2_sql = IF(@idx2_exists = 0,
  'CREATE INDEX idx_prof_reviewed ON candidate_onboarding_profile(reviewed_by, reviewed_at)',
  'SELECT 1');
PREPARE stmt FROM @idx2_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 4. Ensure _migrations tracking table exists ──────────────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  migration_id VARCHAR(100) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) DEFAULT NULL
) ENGINE=InnoDB;

-- Record migration as applied
INSERT INTO _migrations (migration_id, applied_at, checksum)
VALUES ('345_onboarding_status_pipeline_extended', NOW(), SHA2('phase5-onboarding-status-pipeline-v1', 256))
ON DUPLICATE KEY UPDATE applied_at = NOW();

SELECT 'Migration 345 completed successfully' AS status;
