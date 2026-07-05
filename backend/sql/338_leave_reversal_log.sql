-- Migration 338: Leave reversal log
-- Records every automatic leave reversal where approved paid leave caused
-- final payable days to exceed total calendar days in the payroll month.
-- Leave days are credited back to employee's leave balance.
-- This is visible in HR/payroll reports.

CREATE TABLE IF NOT EXISTS leave_reversal_log (
  id                    CHAR(36)      NOT NULL,
  employee_id           CHAR(36)      NOT NULL,
  run_month             CHAR(7)       NOT NULL,             -- YYYY-MM
  leave_request_id      CHAR(36)      NOT NULL,
  leave_type_id         CHAR(36)      NOT NULL,
  leave_date            DATE          NOT NULL,             -- from_date of the reversed leave
  original_leave_days   DECIMAL(4,2)  NOT NULL,
  reversed_days         DECIMAL(4,2)  NOT NULL,
  reason                VARCHAR(500)  NOT NULL DEFAULT 'Payable days exceeded month days due to leave addition',
  balance_before        DECIMAL(6,2)  NOT NULL,
  balance_after         DECIMAL(6,2)  NOT NULL,
  payroll_run_id        CHAR(36)      NOT NULL,
  calculated_payable    DECIMAL(6,2)  NOT NULL,             -- before cap
  month_days_cap        SMALLINT      NOT NULL,             -- total calendar days in month
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            VARCHAR(50)   NOT NULL DEFAULT 'system',
  PRIMARY KEY (id),
  UNIQUE KEY uq_lrl (leave_request_id, run_month),          -- idempotent per leave × month
  INDEX idx_lrl_emp_month    (employee_id, run_month),
  INDEX idx_lrl_run          (payroll_run_id)
);
