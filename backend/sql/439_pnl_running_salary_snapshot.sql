-- 439_pnl_running_salary_snapshot.sql
--
-- Per-employee running-month salary, snapshotted so the P&L can show a live Operating Profit %
-- part-way through a month.
--
-- Why a snapshot rather than a query:
--
--   The figure has to be earned-till-date, not full-month gross. Full-month would book a whole
--   month's cost on the 3rd and make OP% meaningless until month-end, which defeats the point of
--   watching it during the month.
--
--   computeRunningSalary() (payroll/running-salary.service.ts) already produces exactly that, and
--   it is not simple: fixed salary components versus ctc_annual/12, payable days, eligible
--   week-offs, LWP, statutory overrides. Reimplementing it as aggregate SQL for the P&L would
--   create a second copy of payroll maths that drifts from the first, and then a payslip and the
--   P&L would disagree while both looked authoritative. That is worse than an empty P&L.
--
--   It is also per employee and there are ~1,200 of them, so calling it inline on every statement
--   load is not viable. Snapshotting pays that cost once per refresh.
--
-- So: one source of truth (computeRunningSalary), called per employee by a refresh job, with the
-- result stored here alongside the attribution the P&L needs. as_of_date travels with the row so
-- the statement can say how fresh the number is instead of implying it is current.
--
-- Rollback:
--   DROP TABLE IF EXISTS pnl_running_salary_snapshot;

CREATE TABLE IF NOT EXISTS pnl_running_salary_snapshot (
  id                      CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  period_code             CHAR(7) NOT NULL,
  employee_id             CHAR(36) NOT NULL,
  employee_code           VARCHAR(60) NULL,
  branch_id               CHAR(36) NULL,
  process_id              CHAR(36) NULL,
  cost_centre_id          CHAR(36) NULL,
  department_name         VARCHAR(255) NULL,
  designation_name        VARCHAR(255) NULL,
  -- Which line of the P&L this person's cost belongs to. Resolved once, at snapshot time, from
  -- pnl_cost_classification_rule plus the process-mapping fallback, so the statement never has to
  -- re-derive it.
  pnl_bucket              ENUM('agent_salary','dsc_people','bmc_people') NOT NULL,
  -- The running figure and its inputs, kept so a number can be explained without recomputing it.
  earned_salary_till_date DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_monthly           DECIMAL(18,2) NOT NULL DEFAULT 0,
  earned_payable_days     DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_payable_days      DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- The date the running figure was earned up to. Mid-month this is deliberately not month-end.
  as_of_date              DATE NOT NULL,
  computed_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pnl_running_salary (period_code, employee_id),
  KEY idx_pnl_running_salary_period_branch (period_code, branch_id),
  KEY idx_pnl_running_salary_period_process (period_code, process_id),
  KEY idx_pnl_running_salary_bucket (period_code, pnl_bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
