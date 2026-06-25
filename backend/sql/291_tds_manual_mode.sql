-- 291_tds_manual_mode.sql
-- Adds per-run TDS mode control and a manual TDS upload table.
-- New runs default to 'manual' — auto-calculation is disabled by default.
-- Additive migration.

-- ── salary_prep_run: add tds_mode column ─────────────────────────────────────
ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS tds_mode ENUM('auto','manual') NOT NULL DEFAULT 'manual'
  COMMENT 'auto = engine calculates TDS projection; manual = Payroll HO uploads per-employee amounts';

-- ── Manual TDS entries per employee per run ───────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_run_manual_tds (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id       CHAR(36)      NOT NULL,
  employee_id  CHAR(36)      NOT NULL,
  tds_amount   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  remarks      TEXT          NULL,
  uploaded_by  CHAR(36)      NOT NULL,               -- auth_user.id of uploader
  uploaded_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_run_emp_tds (run_id, employee_id),
  INDEX idx_srmt_run      (run_id),
  INDEX idx_srmt_employee (employee_id),
  CONSTRAINT fk_srmt_run FOREIGN KEY (run_id) REFERENCES salary_prep_run(id) ON DELETE CASCADE
);
