-- 430_finance_grade_headcount_driver.sql
-- Branch Budget foundation (PR 12): grade-wise headcount planning per cost centre/period,
-- feeding a new "grade_weighted_headcount" branch-common sharing method. Additive, alongside
-- the existing flat finance_cost_centre_monthly_driver (sql/425) — a cost centre that never
-- opts into grade-level planning is unaffected.

CREATE TABLE IF NOT EXISTS finance_cost_centre_grade_driver (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id         CHAR(36) NOT NULL,
  cost_centre_id    CHAR(36) NOT NULL,
  period_code       CHAR(7) NOT NULL,
  grade_id          CHAR(36) NOT NULL,
  planned_headcount DECIMAL(10,2) NOT NULL DEFAULT 0,
  remarks           VARCHAR(255) NULL,
  status            ENUM('draft','approved') NOT NULL DEFAULT 'draft',
  updated_by        CHAR(36) NULL,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_grade_driver_cc_period_grade (cost_centre_id, period_code, grade_id),
  INDEX idx_grade_driver_branch_period (branch_id, period_code),
  CONSTRAINT fk_grade_driver_grade FOREIGN KEY (grade_id) REFERENCES grade_band_master(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
