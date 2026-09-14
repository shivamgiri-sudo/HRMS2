-- =====================================================================
-- Migration 274: Attendance Architecture Gaps Fix
-- Adds: missing_punch / week_off_worked ENUM values, mismatch tracking
--       columns, apr_eligibility_config, attendance_feature_config,
--       attendance_billing_config. All additive and idempotent.
-- =====================================================================

USE mas_hrms;

-- =====================================================================
-- Part 1: Stored-procedure guarded column / ENUM changes
-- =====================================================================
DROP PROCEDURE IF EXISTS _migration_274;

DELIMITER ;;
CREATE PROCEDURE _migration_274()
BEGIN
  -- G3 + G12: Widen attendance_status ENUM to include missing_punch and week_off_worked
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND COLUMN_NAME  = 'attendance_status'
      AND COLUMN_TYPE  LIKE '%missing_punch%'
  ) THEN
    ALTER TABLE attendance_daily_record
      MODIFY COLUMN attendance_status
        ENUM('present','half_day','absent','leave_approved','holiday',
             'week_off','unreconciled','missing_punch','week_off_worked')
        NOT NULL DEFAULT 'unreconciled';
  END IF;

  -- G4: biometric_status — raw biometric classification before APR override
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND COLUMN_NAME  = 'biometric_status'
  ) THEN
    ALTER TABLE attendance_daily_record
      ADD COLUMN biometric_status VARCHAR(20) NULL AFTER biometric_minutes;
  END IF;

  -- G4: apr_status — raw APR classification
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND COLUMN_NAME  = 'apr_status'
  ) THEN
    ALTER TABLE attendance_daily_record
      ADD COLUMN apr_status VARCHAR(20) NULL AFTER biometric_status;
  END IF;

  -- G4: mismatch_flag — 1 when biometric_status and apr_status disagree
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND COLUMN_NAME  = 'mismatch_flag'
  ) THEN
    ALTER TABLE attendance_daily_record
      ADD COLUMN mismatch_flag TINYINT(1) NOT NULL DEFAULT 0 AFTER apr_status;
  END IF;

  -- G4: mismatch_resolved_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND COLUMN_NAME  = 'mismatch_resolved_at'
  ) THEN
    ALTER TABLE attendance_daily_record
      ADD COLUMN mismatch_resolved_at DATETIME NULL AFTER mismatch_flag;
  END IF;

  -- G4: mismatch_resolved_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND COLUMN_NAME  = 'mismatch_resolved_by'
  ) THEN
    ALTER TABLE attendance_daily_record
      ADD COLUMN mismatch_resolved_by CHAR(36) NULL AFTER mismatch_resolved_at;
  END IF;

  -- G4: mismatch_resolution_reason
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'attendance_daily_record'
      AND COLUMN_NAME  = 'mismatch_resolution_reason'
  ) THEN
    ALTER TABLE attendance_daily_record
      ADD COLUMN mismatch_resolution_reason TEXT NULL AFTER mismatch_resolved_by;
  END IF;

  -- G2: Correct global biometric default rule seed — half_day_minutes 270 → 240
  UPDATE attendance_rule_config
    SET half_day_minutes = 240
    WHERE id = 'arc-global-001' AND half_day_minutes = 270;

END;;
DELIMITER ;
CALL _migration_274();
DROP PROCEDURE IF EXISTS _migration_274;

-- =====================================================================
-- Part 2: New tables (CREATE TABLE IF NOT EXISTS — safe to re-run)
-- =====================================================================

-- G1: APR eligibility config (replaces hardcoded isOperationsExecutive)
CREATE TABLE IF NOT EXISTS apr_eligibility_config (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  rule_name      VARCHAR(255)  NOT NULL DEFAULT 'APR Eligibility Rule',
  designation_id CHAR(36)      NULL,
  department_id  CHAR(36)      NULL,
  process_id     CHAR(36)      NULL,
  active_status  TINYINT(1)    NOT NULL DEFAULT 1,
  notes          TEXT          NULL,
  created_by     VARCHAR(100)  NOT NULL DEFAULT 'system',
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_aec_designation (designation_id),
  INDEX idx_aec_department  (department_id),
  INDEX idx_aec_process     (process_id),
  INDEX idx_aec_active      (active_status),
  FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id)  REFERENCES department_master(id)  ON DELETE SET NULL,
  FOREIGN KEY (process_id)     REFERENCES process_master(id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: replicate isOperationsExecutive() logic (dept=Operations, desig=Executive).
-- Engine falls back to regex if table is empty — zero behavioural change on first deploy.
INSERT INTO apr_eligibility_config
  (id, rule_name, designation_id, department_id, active_status, notes, created_by)
SELECT
  'apr-elig-ops-exec',
  'Operations Executive APR Rule',
  d.id,
  dept.id,
  1,
  'Auto-seeded from isOperationsExecutive() regex: dept IN (operations,operation) AND desig MATCHES ^executive(\\s*-\\s*.+)?$',
  'system'
FROM designation_master d
JOIN department_master dept
  ON LOWER(dept.dept_name) IN ('operations', 'operation')
WHERE LOWER(d.designation_name) REGEXP '^executive(\\s*-\\s*.+)?$'
  AND d.active_status = 1
LIMIT 1
ON DUPLICATE KEY UPDATE notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

-- G9: Feature flags table
CREATE TABLE IF NOT EXISTS attendance_feature_config (
  config_key   VARCHAR(100)  NOT NULL PRIMARY KEY,
  config_value VARCHAR(255)  NOT NULL,
  description  TEXT          NULL,
  updated_by   VARCHAR(100)  NULL,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO attendance_feature_config (config_key, config_value, description) VALUES
  ('mismatch_workflow_enabled',           '0', 'Enable APR vs biometric mismatch review queue in WFM dashboard'),
  ('payroll_lock_on_unresolved_mismatch', '0', 'Block payroll run if employee has unresolved mismatch_flag=1 or missing_punch records for the payroll month'),
  ('missing_punch_notification_enabled',  '1', 'Send inbox notification to employee + reporting manager when missing_punch status is written'),
  ('biometric_half_day_floor_minutes',    '240', 'Minimum minutes for biometric half-day classification (default 240 = 4h)'),
  ('doj_holiday_exclusion_enabled',       '1', 'Exclude holidays that fall before employee date_of_joining in their joining month'),
  ('week_off_worked_wfm_review_required', '1', 'Require WFM review before week_off_worked status is payroll-finalised')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- G13: Attendance billing config (Finance Head + Super Admin only)
-- Scope precedence (most-specific wins): employee > designation > branch > process > global
CREATE TABLE IF NOT EXISTS attendance_billing_config (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  scope_type       ENUM('global','process','branch','designation','employee') NOT NULL DEFAULT 'global',
  process_id       CHAR(36)     NULL,
  branch_id        CHAR(36)     NULL,
  designation_id   CHAR(36)     NULL,
  employee_id      CHAR(36)     NULL,
  extra_day_salary_allowed TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1 = allow billing beyond calendar month days; 0 = cap payable days to calendar month days',
  effective_from   DATE         NOT NULL DEFAULT (CURDATE()),
  effective_to     DATE         NULL,
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  change_reason    TEXT         NULL,
  created_by       VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by       VARCHAR(100) NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_abc_scope       (scope_type, active_status),
  INDEX idx_abc_process     (process_id),
  INDEX idx_abc_branch      (branch_id),
  INDEX idx_abc_designation (designation_id),
  INDEX idx_abc_employee    (employee_id),
  FOREIGN KEY (process_id)     REFERENCES process_master(id)     ON DELETE SET NULL,
  FOREIGN KEY (branch_id)      REFERENCES branch_master(id)      ON DELETE SET NULL,
  FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id)    REFERENCES employees(id)          ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default global seed: extra billing allowed (preserves existing payroll behaviour)
INSERT INTO attendance_billing_config
  (id, scope_type, extra_day_salary_allowed, effective_from, created_by, change_reason)
VALUES
  ('abc-global-001', 'global', 1, CURDATE(), 'system',
   'Default global seed — extra billing allowed, preserves existing payroll behaviour (26-day standard)')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
