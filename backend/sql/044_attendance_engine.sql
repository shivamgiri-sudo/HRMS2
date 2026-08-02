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

-- AGENT designation → dialler (480/240 mins)
-- Seeded only if that designation exists.
--
-- The id below is a production row. On any freshly built database designation_master is
-- empty, so a plain VALUES insert violates attendance_rule_config_ibfk_1 and stops the whole
-- migration chain:
--
--   Cannot add or update a child row: a foreign key constraint fails
--   (`mas_hrms`.`attendance_rule_config`, CONSTRAINT `attendance_rule_config_ibfk_1`
--    FOREIGN KEY (`designation_id`) REFERENCES `designation_master` (`id`))
--
-- INSERT ... SELECT makes the seed conditional on its own foreign key. Where the designation
-- exists — production, and any database restored from it — this inserts exactly the row it
-- always did. Where it does not, it inserts nothing and moves on, which is the correct
-- outcome: a designation-scoped rule for a designation that does not exist has no meaning.
--
-- The global default below is unaffected; its designation_id is NULL by design and it is
-- what catches every other designation.
INSERT INTO attendance_rule_config
  (id, rule_name, scope_type, designation_id, attendance_source, full_day_minutes, half_day_minutes, grace_minutes, effective_from, active_status)
SELECT 'arc-agent-001', 'Agent Dialler Rule', 'designation', d.id, 'dialler', 480, 240, 15, CURDATE(), 1
  FROM designation_master d
 WHERE d.id = '775ef029-5caf-11f1-adb1-00155d0ab410'
ON DUPLICATE KEY UPDATE rule_name = VALUES(rule_name);

-- Global biometric default — catches ALL other designations
INSERT INTO attendance_rule_config
  (id, rule_name, scope_type, designation_id, process_id, branch_id, attendance_source, full_day_minutes, half_day_minutes, grace_minutes, effective_from, active_status)
VALUES
  ('arc-global-001', 'Global Biometric Default', 'global', NULL, NULL, NULL, 'biometric', 540, 270, 15, CURDATE(), 1)
ON DUPLICATE KEY UPDATE rule_name = VALUES(rule_name);
