-- ============================================================================
-- Migration 345: extend ATS onboarding status pipeline safely and idempotently
-- ============================================================================

CREATE TABLE IF NOT EXISTS _migrations (
  migration_id VARCHAR(100) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) DEFAULT NULL
) ENGINE=InnoDB;

SET @migration_id = '345_onboarding_status_pipeline_extended';
SET @schema_name = DATABASE();
SET @migration_applied = (
  SELECT COUNT(*)
    FROM _migrations
   WHERE migration_id = @migration_id
);

SELECT IF(@migration_applied > 0, 'SKIPPED_ALREADY_APPLIED', 'APPLYING') AS migration_345_status;

SET @status_column_exists = (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'ats_onboarding_request'
     AND COLUMN_NAME = 'status'
);

SET @alter_status_sql = IF(
  @migration_applied > 0 OR @status_column_exists = 0,
  'SELECT ''Skipping ats_onboarding_request.status change'' AS note',
  'ALTER TABLE ats_onboarding_request
      MODIFY COLUMN `status` ENUM(
        ''pending'',
        ''in_progress'',
        ''approved'',
        ''selected'',
        ''onboarding_link_sent'',
        ''profile_in_progress'',
        ''profile_submitted'',
        ''hr_review'',
        ''hr_pushback'',
        ''hr_approved'',
        ''offer_draft'',
        ''offer_submitted'',
        ''branch_head_pending'',
        ''branch_head_approved'',
        ''payroll_hr_pending'',
        ''payroll_hr_approved'',
        ''bgv_pending'',
        ''bgv_completed'',
        ''appointment_pending'',
        ''appointment_sent'',
        ''appointment_signed'',
        ''employee_creation_pending'',
        ''employee_created'',
        ''onboarded'',
        ''rejected'',
        ''cancelled'',
        ''payroll_pending'',
        ''payroll_approved''
      ) NOT NULL DEFAULT ''pending'''
);
PREPARE stmt_status FROM @alter_status_sql;
EXECUTE stmt_status;
DEALLOCATE PREPARE stmt_status;

SET @idx_offer_exists = (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'ats_employment_offer'
     AND INDEX_NAME = 'idx_offr_candidate'
);
SET @offer_table_exists = (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'ats_employment_offer'
);

SET @idx_offer_sql = IF(
  @migration_applied > 0 OR @offer_table_exists = 0 OR @idx_offer_exists > 0,
  'SELECT ''Skipping idx_offr_candidate'' AS note',
  'CREATE INDEX idx_offr_candidate ON ats_employment_offer(candidate_id)'
);
PREPARE stmt_offer_idx FROM @idx_offer_sql;
EXECUTE stmt_offer_idx;
DEALLOCATE PREPARE stmt_offer_idx;

SET @idx_profile_exists = (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'candidate_onboarding_profile'
     AND INDEX_NAME = 'idx_prof_reviewed'
);
SET @profile_table_exists = (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'candidate_onboarding_profile'
);

SET @idx_profile_sql = IF(
  @migration_applied > 0 OR @profile_table_exists = 0 OR @idx_profile_exists > 0,
  'SELECT ''Skipping idx_prof_reviewed'' AS note',
  'CREATE INDEX idx_prof_reviewed ON candidate_onboarding_profile(reviewed_by, reviewed_at)'
);
PREPARE stmt_profile_idx FROM @idx_profile_sql;
EXECUTE stmt_profile_idx;
DEALLOCATE PREPARE stmt_profile_idx;

INSERT INTO _migrations (migration_id, applied_at, checksum)
SELECT @migration_id, NOW(), SHA2('phase5-onboarding-status-pipeline-v2', 256)
WHERE @migration_applied = 0
ON DUPLICATE KEY UPDATE migration_id = migration_id;

SELECT 'Migration 345 completed successfully' AS status;
