-- =============================================================================
-- Migration 345: Onboarding status pipeline extended ENUM values
-- Scope: HR onboarding request completion flow with full status pipeline
--
-- Idempotent and rerunnable: creates _migrations before checking, uses dynamic
-- SQL to skip ALTER TABLE after successful application, and uses DATABASE()
-- instead of a hard-coded schema name for metadata checks.
-- =============================================================================

CREATE TABLE IF NOT EXISTS _migrations (
  migration_id VARCHAR(100) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) DEFAULT NULL
) ENGINE=InnoDB;

SET @migration_id = '345_onboarding_status_pipeline_extended';
SET @migration_checksum = SHA2('phase5-onboarding-status-pipeline-v2-full-enum', 256);
SET @migration_applied = (
  SELECT COUNT(*) FROM _migrations WHERE migration_id = @migration_id AND checksum = @migration_checksum
);

SELECT IF(@migration_applied > 0, 'SKIPPED', 'APPLYING') AS migration_345;

-- Full lifecycle status pipeline. Existing legacy statuses are retained for
-- backward compatibility with older rows and screens.
SET @status_alter_sql = IF(@migration_applied = 0,
  "ALTER TABLE ats_onboarding_request
     MODIFY COLUMN `status` ENUM(
       'pending',
       'in_progress',
       'approved',
       'selected',
       'onboarding_link_sent',
       'profile_in_progress',
       'profile_submitted',
       'hr_review',
       'hr_pushback',
       'hr_approved',
       'offer_draft',
       'offer_submitted',
       'branch_head_pending',
       'branch_head_approved',
       'payroll_pending',
       'payroll_approved',
       'payroll_hr_pending',
       'payroll_hr_approved',
       'bgv_pending',
       'bgv_completed',
       'appointment_pending',
       'appointment_sent',
       'appointment_signed',
       'employee_creation_pending',
       'employee_created',
       'onboarded',
       'rejected',
       'cancelled'
     ) NOT NULL DEFAULT 'pending'",
  "SELECT 'status enum already current' AS skipped_status_enum"
);
PREPARE stmt FROM @status_alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add missing index for candidate_id in ats_employment_offer if absent.
SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_employment_offer'
    AND INDEX_NAME = 'idx_offr_candidate'
);
SET @idx_sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_offr_candidate ON ats_employment_offer(candidate_id)',
  'SELECT "idx_offr_candidate already exists" AS skipped_idx_offr_candidate'
);
PREPARE stmt FROM @idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for review status queries on candidate_onboarding_profile if absent.
SET @idx2_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'candidate_onboarding_profile'
    AND INDEX_NAME = 'idx_prof_reviewed'
);
SET @idx2_sql = IF(@idx2_exists = 0,
  'CREATE INDEX idx_prof_reviewed ON candidate_onboarding_profile(reviewed_by, reviewed_at)',
  'SELECT "idx_prof_reviewed already exists" AS skipped_idx_prof_reviewed'
);
PREPARE stmt FROM @idx2_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO _migrations (migration_id, applied_at, checksum)
VALUES (@migration_id, NOW(), @migration_checksum)
ON DUPLICATE KEY UPDATE applied_at = NOW(), checksum = VALUES(checksum);

SELECT 'Migration 345 completed successfully' AS status;
