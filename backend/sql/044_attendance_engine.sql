-- =====================================================
-- Attendance Engine Schema
-- File: 044_attendance_engine.sql
-- Description: Role-based daily attendance processing engine
--              Tables: attendance_rule_config, attendance_daily_record
-- =====================================================

USE mas_hrms;

-- =====================================================
-- 1. ATTENDANCE RULE CONFIG
-- =====================================================
CREATE TABLE IF NOT EXISTS attendance_rule_config (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  rule_name        VARCHAR(255) NOT NULL,
  scope_type       ENUM('designation','process','branch','process_designation','branch_process','global') NOT NULL,
  designation_id   CHAR(36)     NULL,
  process_id       CHAR(36)     NULL,
  branch_id        CHAR(36)     NULL,
  attendance_source ENUM('dialler','biometric') NOT NULL DEFAULT 'biometric',
  full_day_minutes INT          NOT NULL DEFAULT 540,
  half_day_minutes INT          NOT NULL DEFAULT 270,
  grace_minutes    INT          NOT NULL DEFAULT 15,
  effective_from   DATE         NOT NULL DEFAULT (CURDATE()),
  effective_to     DATE         NULL,
  notes            TEXT         NULL,
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arc_designation (designation_id),
  INDEX idx_arc_process     (process_id),
  INDEX idx_arc_branch      (branch_id),
  INDEX idx_arc_active      (active_status, effective_from, effective_to),
  FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE SET NULL,
  FOREIGN KEY (process_id)     REFERENCES process_master(id)     ON DELETE SET NULL,
  FOREIGN KEY (branch_id)      REFERENCES branch_master(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. ATTENDANCE DAILY RECORD
-- =====================================================
CREATE TABLE IF NOT EXISTS attendance_daily_record (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id         CHAR(36)      NOT NULL,
  record_date         DATE          NOT NULL,
  process_id          CHAR(36)      NULL,
  branch_id           CHAR(36)      NULL,
  attendance_source   ENUM('dialler','biometric') NOT NULL DEFAULT 'biometric',
  dialler_minutes     INT           NULL,
  biometric_minutes   INT           NULL,
  raw_minutes         INT           NOT NULL DEFAULT 0,
  attendance_status   ENUM('present','half_day','absent','leave_approved','holiday','week_off','unreconciled') NOT NULL DEFAULT 'unreconciled',
  lwp_value           DECIMAL(4,2)  NOT NULL DEFAULT 0.00,
  late_mark           TINYINT(1)    NOT NULL DEFAULT 0,
  late_by_minutes     INT           NOT NULL DEFAULT 0,
  rule_config_id      CHAR(36)      NULL,
  regularization_id   CHAR(36)      NULL,
  override_by         CHAR(36)      NULL,
  override_reason     TEXT          NULL,
  is_locked           TINYINT(1)    NOT NULL DEFAULT 0,
  processed_at        DATETIME      NULL,
  created_by          VARCHAR(100)  NOT NULL DEFAULT 'system',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_date (employee_id, record_date),
  INDEX idx_adr_date        (record_date),
  INDEX idx_adr_status      (attendance_status),
  INDEX idx_adr_process     (process_id),
  INDEX idx_adr_locked      (is_locked),
  FOREIGN KEY (employee_id)       REFERENCES employees(id)              ON DELETE CASCADE,
  FOREIGN KEY (process_id)        REFERENCES process_master(id)         ON DELETE SET NULL,
  FOREIGN KEY (branch_id)         REFERENCES branch_master(id)          ON DELETE SET NULL,
  FOREIGN KEY (rule_config_id)    REFERENCES attendance_rule_config(id) ON DELETE SET NULL,
  FOREIGN KEY (regularization_id) REFERENCES attendance_regularization(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. SEED DATA
-- =====================================================

-- Agent designation → dialler (480/240 mins).
--
-- The original migration hardcoded one production designation UUID. That UUID
-- does not exist on a clean database and caused the foreign key insert to abort
-- the complete migration chain. Resolve the designation through stable master
-- data instead. If an environment has not seeded an Agent designation yet, this
-- optional scoped rule is intentionally skipped and the global biometric rule
-- below remains the safe default.
INSERT INTO attendance_rule_config
  (id, rule_name, scope_type, designation_id, attendance_source,
   full_day_minutes, half_day_minutes, grace_minutes, effective_from, active_status)
SELECT
  'arc-agent-001', 'Agent Dialler Rule', 'designation', d.id, 'dialler',
  480, 240, 15, CURDATE(), 1
FROM designation_master d
WHERE d.active_status = 1
  AND (
    UPPER(TRIM(d.designation_code)) = 'AGENT'
    OR UPPER(TRIM(d.designation_name)) = 'AGENT'
  )
ORDER BY
  CASE WHEN UPPER(TRIM(d.designation_code)) = 'AGENT' THEN 0 ELSE 1 END,
  d.created_at ASC,
  d.id ASC
LIMIT 1
ON DUPLICATE KEY UPDATE
  rule_name = VALUES(rule_name),
  designation_id = VALUES(designation_id),
  attendance_source = VALUES(attendance_source),
  full_day_minutes = VALUES(full_day_minutes),
  half_day_minutes = VALUES(half_day_minutes),
  grace_minutes = VALUES(grace_minutes),
  active_status = VALUES(active_status);

-- Global biometric default — catches ALL other designations and is also the
-- only rule on a clean installation until designation master data is loaded.
INSERT INTO attendance_rule_config
  (id, rule_name, scope_type, designation_id, process_id, branch_id, attendance_source, full_day_minutes, half_day_minutes, grace_minutes, effective_from, active_status)
VALUES
  ('arc-global-001', 'Global Biometric Default', 'global', NULL, NULL, NULL, 'biometric', 540, 270, 15, CURDATE(), 1)
ON DUPLICATE KEY UPDATE
  rule_name = VALUES(rule_name),
  attendance_source = VALUES(attendance_source),
  full_day_minutes = VALUES(full_day_minutes),
  half_day_minutes = VALUES(half_day_minutes),
  grace_minutes = VALUES(grace_minutes),
  active_status = VALUES(active_status);
