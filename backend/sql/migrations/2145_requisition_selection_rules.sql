-- 2145: Selection criteria (plan 2026-10-09, S2). The job requisition is the single source of truth for criteria.
-- job_requisition.selection_rules holds only what has no column yet: per-rule MUST/PREFER mode, weight, missing-data policy
-- (with per-source overrides) and the values of the new rule kinds ({schema:1,...}; NULL = legacy compile).
-- job_requisition_criteria_version: one row per saved criteria state (hash-deduplicated by the writer, S5).
-- job_requisition_criteria_audit: append-only field-level change log (old/new, actor, reason, approval status at change).
-- qualified_followup gains the version/verdict it was last checked against (skipped where that table is absent).
-- Additive and re-runnable: CREATE TABLE IF NOT EXISTS; ALTERs guarded through information_schema + PREPARE. No foreign keys.
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'selection_rules') = 0, "ALTER TABLE job_requisition ADD COLUMN selection_rules JSON NULL COMMENT 'Selection rule metadata {schema:1}; NULL = legacy criteria'", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS job_requisition_criteria_version (
  id CHAR(36) NOT NULL PRIMARY KEY,
  requisition_id CHAR(36) NOT NULL,
  version_no INT NOT NULL,
  criteria_hash CHAR(64) NOT NULL,
  compiled_json JSON NOT NULL,
  columns_json JSON NOT NULL COMMENT 'snapshot of every criteria column + selection_rules + meta_screening_config',
  engine_version SMALLINT NOT NULL,
  source VARCHAR(16) NOT NULL COMMENT 'form | criteria_panel | bulk | copy | template | backfill',
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR(300) NULL,
  UNIQUE KEY uq_rcv (requisition_id, version_no),
  KEY idx_rcv_hash (requisition_id, criteria_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_requisition_criteria_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requisition_id CHAR(36) NOT NULL,
  version_id CHAR(36) NOT NULL,
  field VARCHAR(64) NOT NULL,
  old_json JSON NULL,
  new_json JSON NULL,
  actor_id CHAR(36) NOT NULL,
  actor_role VARCHAR(40) NULL,
  source VARCHAR(16) NOT NULL,
  reason VARCHAR(300) NULL,
  approval_status_at_change VARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rca_req (requisition_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'criteria_version_id') = 0, "ALTER TABLE qualified_followup ADD COLUMN criteria_version_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'criteria_verdict') = 0, "ALTER TABLE qualified_followup ADD COLUMN criteria_verdict VARCHAR(8) COLLATE utf8mb4_unicode_ci NULL COMMENT 'pass | fail | review'", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'criteria_checked_at') = 0, "ALTER TABLE qualified_followup ADD COLUMN criteria_checked_at DATETIME NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
