-- Migration: 1031_config_governance_foundation.sql
-- Purpose:  Add governance columns (effective_from, effective_to, version_number,
--           status, updated_by, change_reason) to the two highest-risk config
--           tables that currently have zero versioning:
--             - leave_policy_config  (Migration 150)
--             - kpi_master_config    (Migration 160)
-- Safety:   All ADD COLUMN statements are guarded by INFORMATION_SCHEMA existence
--           checks (MySQL 8.0 does not support ADD COLUMN IF NOT EXISTS).
--           All new columns are nullable or have safe defaults so existing rows
--           are unaffected. No data is modified. No DROP, no DELETE.
--           NOT EXECUTED AUTOMATICALLY — run manually on staging first.
-- Created:  2026-07-31

-- ─── leave_policy_config ──────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS _add_leave_governance_cols;
DELIMITER $$
CREATE PROCEDURE _add_leave_governance_cols()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_policy_config'
                 AND COLUMN_NAME = 'effective_from') THEN
    ALTER TABLE leave_policy_config
      ADD COLUMN effective_from DATE NULL
        COMMENT 'Date from which this policy version becomes active. NULL = always active.'
        AFTER max_days_per_occurrence;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_policy_config'
                 AND COLUMN_NAME = 'effective_to') THEN
    ALTER TABLE leave_policy_config
      ADD COLUMN effective_to DATE NULL
        COMMENT 'Date on which this policy version expires. NULL = no expiry.'
        AFTER effective_from;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_policy_config'
                 AND COLUMN_NAME = 'version_number') THEN
    ALTER TABLE leave_policy_config
      ADD COLUMN version_number INT NOT NULL DEFAULT 1
        COMMENT 'Monotonically increasing version counter per leave_type_id.'
        AFTER effective_to;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_policy_config'
                 AND COLUMN_NAME = 'status') THEN
    ALTER TABLE leave_policy_config
      ADD COLUMN status ENUM('active','draft','expired') NOT NULL DEFAULT 'active'
        COMMENT 'Lifecycle status of this policy record.'
        AFTER version_number;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_policy_config'
                 AND COLUMN_NAME = 'updated_by') THEN
    ALTER TABLE leave_policy_config
      ADD COLUMN updated_by CHAR(36) NULL
        COMMENT 'User ID of the last editor.'
        AFTER status;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_policy_config'
                 AND COLUMN_NAME = 'change_reason') THEN
    ALTER TABLE leave_policy_config
      ADD COLUMN change_reason TEXT NULL
        COMMENT 'Mandatory reason for changes to active policy.'
        AFTER updated_by;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_policy_config'
                 AND COLUMN_NAME = 'updated_at') THEN
    ALTER TABLE leave_policy_config
      ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP
        COMMENT 'Auto-updated timestamp of last modification.'
        AFTER change_reason;
  END IF;
END$$
DELIMITER ;
CALL _add_leave_governance_cols();
DROP PROCEDURE IF EXISTS _add_leave_governance_cols;

-- ─── kpi_master_config ────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS _add_kpi_governance_cols;
DELIMITER $$
CREATE PROCEDURE _add_kpi_governance_cols()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_master_config'
                 AND COLUMN_NAME = 'effective_from') THEN
    ALTER TABLE kpi_master_config
      ADD COLUMN effective_from DATE NULL
        COMMENT 'Date from which this KPI target version is active. NULL = always active.'
        AFTER is_active;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_master_config'
                 AND COLUMN_NAME = 'effective_to') THEN
    ALTER TABLE kpi_master_config
      ADD COLUMN effective_to DATE NULL
        COMMENT 'Date on which this KPI target version expires. NULL = no expiry.'
        AFTER effective_from;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_master_config'
                 AND COLUMN_NAME = 'version_number') THEN
    ALTER TABLE kpi_master_config
      ADD COLUMN version_number INT NOT NULL DEFAULT 1
        COMMENT 'Monotonically increasing version counter per metric+org_unit combination.'
        AFTER effective_to;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_master_config'
                 AND COLUMN_NAME = 'change_reason') THEN
    ALTER TABLE kpi_master_config
      ADD COLUMN change_reason TEXT NULL
        COMMENT 'Mandatory reason for target changes.'
        AFTER version_number;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_master_config'
                 AND COLUMN_NAME = 'approved_by') THEN
    ALTER TABLE kpi_master_config
      ADD COLUMN approved_by CHAR(36) NULL
        COMMENT 'User ID who approved this target version.'
        AFTER change_reason;
  END IF;
END$$
DELIMITER ;
CALL _add_kpi_governance_cols();
DROP PROCEDURE IF EXISTS _add_kpi_governance_cols;

-- Verification:
-- SHOW COLUMNS FROM leave_policy_config;
-- SHOW COLUMNS FROM kpi_master_config;
