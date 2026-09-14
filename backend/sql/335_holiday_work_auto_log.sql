-- Migration 335: Holiday work auto-generation configuration and audit log
-- Implements system-generated holiday work extra pay (no manual request needed)

-- Add eligibility flag to holidays
ALTER TABLE leave_holiday_master
ADD COLUMN extra_pay_eligible TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '1 = Working this holiday makes employee eligible for auto extra payout';

-- Auto-generated holiday work payout audit log
-- Tracks all system-generated payouts for compliance and transparency
CREATE TABLE IF NOT EXISTS holiday_work_auto_log (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id      CHAR(36)      NOT NULL,
  run_month        DATE          NOT NULL COMMENT 'YYYY-MM-01',
  holiday_id       CHAR(36)      NOT NULL,
  holiday_date     DATE          NOT NULL,
  worked_minutes   SMALLINT      NOT NULL,
  payout_unit      ENUM('half_day','full_day') NOT NULL,
  payout_amount    DECIMAL(10,2) NOT NULL,
  policy_id        CHAR(36)      NOT NULL COMMENT 'Which policy was used',
  policy_snapshot  JSON          NULL COMMENT 'Policy config at calculation time',
  attendance_source VARCHAR(50)  NOT NULL DEFAULT 'ADR',
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (holiday_id) REFERENCES leave_holiday_master(id),
  FOREIGN KEY (policy_id) REFERENCES holiday_work_policy_master(id),
  INDEX idx_hwal_employee (employee_id),
  INDEX idx_hwal_month (run_month),
  INDEX idx_hwal_holiday (holiday_id)
);

SELECT '335_holiday_work_auto_log.sql applied' AS migration_status;
