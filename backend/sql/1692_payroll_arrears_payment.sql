-- Off-cycle / arrears payment ledger.
--
-- WHY THIS EXISTS: no mechanism previously existed in this codebase to pay an employee money owed
-- from a CLOSED payroll run (isRunClosed() refuses recalculation on purpose -- a closed run has
-- already been paid and, for months like July, already filed in a quarterly TDS return).
-- salary_prep_line_adjustment looked like the answer but is confirmed dead: disabled for this
-- release, and even when live, 0 rows ever reached net_salary. The 2026-09-08 fix for 14
-- July-2026 employees underpaid ~Rs 95,110 despite real attendance had to hand-edit
-- salary_prep_line.net_salary directly with two bolted-on columns (arrears_amount, arrears_note)
-- -- a deliberate, logged, one-off exception, not a repeatable mechanism.
--
-- This table is that repeatable mechanism: a first-class, audited, approval-gated ledger for
-- arrears/off-cycle payments, independent of any specific salary_prep_line. It deliberately does
-- NOT write into payrollCalculate.service.ts's own arithmetic or auto-apply to net_salary --
-- wiring an approved row into what an employee is actually paid remains a separate decision,
-- matching every other place in this codebase where "never change salary calculation without
-- approval" is held to (see hrms2-never-change-salary-calculation memory / CLAUDE.md's payroll
-- and statutory safety rules). Today, an approved row is the audited authorization finance acts
-- on (a manual transfer, or a future explicit approval to fold it into a run) -- not a payment
-- that happens by itself.

CREATE TABLE IF NOT EXISTS payroll_arrears_payment (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36)      NOT NULL,
  source_run_id     CHAR(36)      NULL,     -- the run the shortfall originated in (e.g. the locked July run), if any
  target_run_id     CHAR(36)      NULL,     -- the run this is intended to be paid through (e.g. August), if any
  amount            DECIMAL(12,2) NOT NULL,
  reason            TEXT          NOT NULL,
  basis_note        TEXT          NULL,     -- how the amount was derived (per-day rate, source, working-days basis)
  status            ENUM('draft','pending_approval','approved','rejected','paid')
                                  NOT NULL DEFAULT 'draft',
  requested_by      CHAR(36)      NOT NULL,
  requested_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by       CHAR(36)      NULL,
  approved_at       DATETIME      NULL,
  rejected_by       CHAR(36)      NULL,
  rejected_at       DATETIME      NULL,
  rejection_reason  TEXT          NULL,
  paid_by           CHAR(36)      NULL,
  paid_at           DATETIME      NULL,
  payment_reference VARCHAR(191)  NULL,     -- bank ref / cheque no / UTR for the actual manual payment
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHECK (amount > 0),
  INDEX idx_pap_employee (employee_id),
  INDEX idx_pap_status (status),
  INDEX idx_pap_source_run (source_run_id),
  INDEX idx_pap_target_run (target_run_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_run_id) REFERENCES salary_prep_run(id) ON DELETE SET NULL,
  FOREIGN KEY (target_run_id) REFERENCES salary_prep_run(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
