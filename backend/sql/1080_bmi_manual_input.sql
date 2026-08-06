-- Migration 1080: BMI hiring benchmark manual input store
-- Stores the 3 time-spent metrics (HR/ops/TL hours per week) and SLA penalty
-- that have no HRMS data source and must be entered by branch managers.

CREATE TABLE IF NOT EXISTS bmi_manual_input (
  id           CHAR(36)       NOT NULL PRIMARY KEY DEFAULT (UUID()),
  branch_id    CHAR(36)       NOT NULL,
  period_month CHAR(7)        NOT NULL COMMENT 'YYYY-MM e.g. 2026-07',
  metric_key   VARCHAR(100)   NOT NULL COMMENT 'hr_hours_week | ops_hours_week | tl_hours_week | sla_penalty',
  value        DECIMAL(14,2)  NULL,
  updated_by   CHAR(36)       NULL,
  updated_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bmi_input (branch_id, period_month, metric_key),
  KEY idx_bmi_branch_month (branch_id, period_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 1080: bmi_manual_input created' AS status;
