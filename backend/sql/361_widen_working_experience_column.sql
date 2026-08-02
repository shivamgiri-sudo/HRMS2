-- Widen working_experience column to hold longer UI labels
-- Guarded 2026-08-03: candidate_onboarding_experience has no CREATE TABLE anywhere in sql/, so this ALTER
-- stops the chain on any fresh database. Guarding lets the build proceed; it does NOT give
-- the table a definition. Whether candidate_onboarding_experience should exist is an owner decision, recorded in
-- docs/release/migration-reconciliation.md.
SET @tbl_candidate_on_1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_experience');
SET @sql = IF(@tbl_candidate_on_1 > 0,
  'ALTER TABLE candidate_onboarding_experience MODIFY COLUMN working_experience VARCHAR(50) NULL',
  'SELECT ''candidate_onboarding_experience does not exist on this database; statement skipped'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
