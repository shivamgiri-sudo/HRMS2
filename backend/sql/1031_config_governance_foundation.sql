-- Migration: 1031_config_governance_foundation.sql
-- Purpose:  Add governance columns (effective_from, effective_to, version_number,
--           status, updated_by, change_reason) to the two highest-risk config
--           tables that currently have zero versioning:
--             - leave_policy_config  (Migration 150)
--             - kpi_master_config    (Migration 160)
-- Safety:   ALTER TABLE ... ADD COLUMN IF NOT EXISTS only. All new columns are
--           nullable or have safe defaults so existing rows are unaffected.
--           No data is modified. No DROP, no DELETE.
--           NOT EXECUTED AUTOMATICALLY — run manually on staging first.
-- Created:  2026-07-31

-- ─── leave_policy_config ──────────────────────────────────────────────────────

ALTER TABLE leave_policy_config
  ADD COLUMN IF NOT EXISTS effective_from  DATE        NULL
    COMMENT 'Date from which this policy version becomes active. NULL = always active.'
    AFTER max_days_per_occurrence,
  ADD COLUMN IF NOT EXISTS effective_to    DATE        NULL
    COMMENT 'Date on which this policy version expires. NULL = no expiry.'
    AFTER effective_from,
  ADD COLUMN IF NOT EXISTS version_number  INT         NOT NULL DEFAULT 1
    COMMENT 'Monotonically increasing version counter per leave_type_id.'
    AFTER effective_to,
  ADD COLUMN IF NOT EXISTS status          ENUM('active','draft','expired') NOT NULL DEFAULT 'active'
    COMMENT 'Lifecycle status of this policy record.'
    AFTER version_number,
  ADD COLUMN IF NOT EXISTS updated_by      CHAR(36)    NULL
    COMMENT 'User ID of the last editor.'
    AFTER status,
  ADD COLUMN IF NOT EXISTS change_reason   TEXT        NULL
    COMMENT 'Mandatory reason for changes to active policy.'
    AFTER updated_by,
  ADD COLUMN IF NOT EXISTS updated_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP
    COMMENT 'Auto-updated timestamp of last modification.'
    AFTER change_reason;

-- ─── kpi_master_config ────────────────────────────────────────────────────────

ALTER TABLE kpi_master_config
  ADD COLUMN IF NOT EXISTS effective_from  DATE        NULL
    COMMENT 'Date from which this KPI target version is active. NULL = always active.'
    AFTER is_active,
  ADD COLUMN IF NOT EXISTS effective_to    DATE        NULL
    COMMENT 'Date on which this KPI target version expires. NULL = no expiry.'
    AFTER effective_from,
  ADD COLUMN IF NOT EXISTS version_number  INT         NOT NULL DEFAULT 1
    COMMENT 'Monotonically increasing version counter per metric+org_unit combination.'
    AFTER effective_to,
  ADD COLUMN IF NOT EXISTS change_reason   TEXT        NULL
    COMMENT 'Mandatory reason for target changes.'
    AFTER version_number,
  ADD COLUMN IF NOT EXISTS approved_by     CHAR(36)    NULL
    COMMENT 'User ID who approved this target version.'
    AFTER change_reason;

-- Verification:
-- SHOW COLUMNS FROM leave_policy_config;
-- SHOW COLUMNS FROM kpi_master_config;
