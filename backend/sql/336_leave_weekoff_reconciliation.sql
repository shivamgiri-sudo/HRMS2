-- Migration 336: Leave / week-off overlap reconciliation log
-- Tracks every case where a leave credit was restored because the day was
-- also a rostered week-off (and the process has weekoff_earning_required = true).

CREATE TABLE IF NOT EXISTS leave_weekoff_reconciliation_log (
  id               CHAR(36)      NOT NULL,
  employee_id      CHAR(36)      NOT NULL,
  run_month        CHAR(7)       NOT NULL,          -- YYYY-MM
  leave_request_id CHAR(36)      NOT NULL,
  leave_type_id    CHAR(36)      NOT NULL,
  overlap_date     DATE          NOT NULL,
  days_restored    DECIMAL(4,2)  NOT NULL DEFAULT 1.00,
  restored_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  restored_by      VARCHAR(50)   NOT NULL DEFAULT 'system',
  notes            TEXT          NULL,
  PRIMARY KEY (id),
  INDEX idx_lwor_emp_month   (employee_id, run_month),
  INDEX idx_lwor_leave_req   (leave_request_id),
  -- Idempotency: one row per employee × leave request × overlap date
  UNIQUE KEY uq_lwor_overlap (leave_request_id, overlap_date)
);
