-- 052_legacy_migration_tables.sql
-- Additive: creates tables for legacy migration and alters employees.
-- Safe to run multiple times. Do NOT run on production without approval.
USE mas_hrms;

-- ── ALTER TABLE employees: add legacy-origin columns ─────────────────────────

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='biometric_code')=0,
  'ALTER TABLE employees ADD COLUMN biometric_code VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='band')=0,
  'ALTER TABLE employees ADD COLUMN band VARCHAR(10) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='stream')=0,
  'ALTER TABLE employees ADD COLUMN stream VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='profile_type')=0,
  'ALTER TABLE employees ADD COLUMN profile_type VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='source_type')=0,
  'ALTER TABLE employees ADD COLUMN source_type VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='source')=0,
  'ALTER TABLE employees ADD COLUMN source VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='legacy_emp_id')=0,
  'ALTER TABLE employees ADD COLUMN legacy_emp_id BIGINT NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- ── employee_statutory_info ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_statutory_info (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36)     NOT NULL UNIQUE,
  epf_number   VARCHAR(100),
  esi_number   VARCHAR(100),
  uan_number   VARCHAR(50),
  pan_number   VARCHAR(20),
  aadhaar_id   VARCHAR(50),
  pf_eligible  TINYINT(1)   NOT NULL DEFAULT 0,
  esi_eligible TINYINT(1)   NOT NULL DEFAULT 0,
  epf_date     DATE,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_statutory_emp (employee_id)
);

-- ── employee_salary_snapshot ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_salary_snapshot (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id         CHAR(36)      NOT NULL UNIQUE,
  snapshot_date       DATE          NOT NULL,
  basic               DECIMAL(12,2) DEFAULT 0,
  hra                 DECIMAL(12,2) DEFAULT 0,
  conveyance          DECIMAL(12,2) DEFAULT 0,
  da                  DECIMAL(12,2) DEFAULT 0,
  portfolio_allowance DECIMAL(12,2) DEFAULT 0,
  medical_allowance   DECIMAL(12,2) DEFAULT 0,
  lta                 DECIMAL(12,2) DEFAULT 0,
  mobile_allowance    DECIMAL(12,2) DEFAULT 0,
  special_allowance   DECIMAL(12,2) DEFAULT 0,
  other_allowance     DECIMAL(12,2) DEFAULT 0,
  bonus               DECIMAL(12,2) DEFAULT 0,
  gross               DECIMAL(12,2) DEFAULT 0,
  net_in_hand         DECIMAL(12,2) DEFAULT 0,
  ctc_offered         DECIMAL(12,2) DEFAULT 0,
  package             DECIMAL(12,2) DEFAULT 0,
  epf_employee        DECIMAL(12,2) DEFAULT 0,
  esic_employee       DECIMAL(12,2) DEFAULT 0,
  epf_employer        DECIMAL(12,2) DEFAULT 0,
  esic_employer       DECIMAL(12,2) DEFAULT 0,
  professional_tax    DECIMAL(12,2) DEFAULT 0,
  gratuity            DECIMAL(12,2) DEFAULT 0,
  admin_charges       DECIMAL(12,2) DEFAULT 0,
  pli                 DECIMAL(12,2) DEFAULT 0,
  pay_mode            VARCHAR(50),
  salary_payment_mode VARCHAR(50),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_salary_emp (employee_id)
);

-- ── employee_client_mapping ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_client_mapping (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id    CHAR(36)     NOT NULL,
  client_name    VARCHAR(255),
  cost_center    VARCHAR(255),
  emp_for        VARCHAR(50),
  effective_from DATE,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_emp_client (employee_id),
  INDEX idx_client_map_emp (employee_id)
);

-- ── employee_kpi_assignment ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_kpi_assignment (
  id            CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)    NOT NULL,
  legacy_kpi_id VARCHAR(50),
  assign_date   DATE,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_emp_kpi (employee_id, legacy_kpi_id),
  INDEX idx_kpi_assign_emp (employee_id)
);

-- ── employee_legacy_meta ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_legacy_meta (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL UNIQUE,
  father_name          VARCHAR(255),
  relationship_type    VARCHAR(50),
  acc_holder_name      VARCHAR(255),
  blood_group          VARCHAR(10),
  qualification        VARCHAR(255),
  marital_status       VARCHAR(50),
  permanent_address    TEXT,
  temporary_address    TEXT,
  land_line_p          VARCHAR(50),
  land_line_t          VARCHAR(50),
  passport_no          VARCHAR(100),
  dl_no                VARCHAR(100),
  offer_no             VARCHAR(100),
  box_file_no          VARCHAR(100),
  appoint_print_date   DATE,
  document_done        VARCHAR(10),
  account_flag         VARCHAR(10),
  ac_validation_date   DATE,
  ac_validated_by      VARCHAR(255),
  ac_rejection_remarks TEXT,
  updated_by           VARCHAR(255),
  official_email       VARCHAR(255),
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_legacy_meta_emp (employee_id)
);

-- ── Additional legacy leave type codes ───────────────────────────────────────

INSERT INTO leave_type_master
  (leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave)
VALUES
  ('DL',   'Duty Leave',                0, 0, 1, 1),
  ('PTRL', 'Paternity Leave (Legacy)',  5, 0, 1, 1),
  ('MTRL', 'Maternity Leave (Legacy)', 90, 0, 1, 1)
ON DUPLICATE KEY UPDATE leave_name = VALUES(leave_name);

-- ── Idempotency constraint for leave migration ────────────────────────────────

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='leave_request'
     AND CONSTRAINT_NAME='uq_leave_req')=0,
  'ALTER TABLE leave_request ADD UNIQUE KEY uq_leave_req (employee_id, leave_type_id, from_date, to_date)',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;
