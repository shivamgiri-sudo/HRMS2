-- backend/sql/136_incentive_module.sql
USE mas_hrms;

-- ── 1. incentive_master ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_master (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  incentive_code   VARCHAR(50)  NOT NULL UNIQUE,
  incentive_name   VARCHAR(255) NOT NULL,
  description      TEXT,
  gl_code          VARCHAR(50)  NULL,
  taxable          TINYINT(1)   NOT NULL DEFAULT 1,
  pf_applicable    TINYINT(1)   NOT NULL DEFAULT 0,
  esic_applicable  TINYINT(1)   NOT NULL DEFAULT 0,
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── 2. incentive_upload_batch ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_upload_batch (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  incentive_id    CHAR(36)       NOT NULL,
  pay_month       VARCHAR(7)     NOT NULL,
  status          ENUM('draft','pending_approval','approved','rejected','applied')
                                 NOT NULL DEFAULT 'draft',
  total_employees INT            NOT NULL DEFAULT 0,
  total_amount    DECIMAL(14,2)  NOT NULL DEFAULT 0,
  uploaded_by     CHAR(36)       NULL,
  upload_filename VARCHAR(512)   NULL,
  remarks         TEXT,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_batch_month (incentive_id, pay_month),
  INDEX idx_ib_month (pay_month),
  FOREIGN KEY (incentive_id) REFERENCES incentive_master(id) ON DELETE RESTRICT
);

-- ── 3. incentive_upload_line ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_upload_line (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id          CHAR(36)      NOT NULL,
  employee_id       CHAR(36)      NOT NULL,
  employee_code     VARCHAR(50)   NOT NULL,
  amount            DECIMAL(10,2) NOT NULL DEFAULT 0,
  remarks           TEXT,
  validation_status ENUM('ok','error') NOT NULL DEFAULT 'ok',
  validation_msg    VARCHAR(512),
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_batch_emp (batch_id, employee_id),
  INDEX idx_il_batch    (batch_id),
  INDEX idx_il_employee (employee_id),
  FOREIGN KEY (batch_id)    REFERENCES incentive_upload_batch(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)              ON DELETE CASCADE
);

-- ── 4. incentive_approval_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_approval_log (
  id            CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id      CHAR(36)  NOT NULL,
  actor_user_id CHAR(36)  NOT NULL,
  action        ENUM('submitted','approved','rejected','applied') NOT NULL,
  remarks       TEXT,
  acted_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ial_batch (batch_id),
  FOREIGN KEY (batch_id) REFERENCES incentive_upload_batch(id) ON DELETE CASCADE
);

-- ── 5. Additive ALTER: incentive_total on salary_prep_line ────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'salary_prep_line'
     AND COLUMN_NAME  = 'incentive_total') = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN incentive_total DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER esic_employer',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 6. Seed standard incentive types ─────────────────────────────────────────
INSERT INTO incentive_master (incentive_code, incentive_name, taxable, pf_applicable, esic_applicable) VALUES
  ('NSA',   'Night Shift Allowance',           1, 0, 0),
  ('PERF',  'Performance Incentive',           1, 0, 0),
  ('REF',   'Referral Incentive',              1, 0, 0),
  ('OT',    'Overtime Allowance',              1, 0, 1),
  ('PLI',   'Performance Linked Incentive',    1, 0, 0),
  ('INDM',  'Performance Incentive Indiamart', 1, 0, 0),
  ('SPEC',  'Special Task Incentive',          1, 0, 0)
ON DUPLICATE KEY UPDATE incentive_name = VALUES(incentive_name);
