-- Migration 332: Week-off fairness score tracking table
-- Records per-employee per-week fairness metrics for allocation priority.
-- Used by the auto-roster engine to compute priority scores.

CREATE TABLE IF NOT EXISTS weekoff_fairness_score (
  id                               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id                      CHAR(36)     NOT NULL,
  process_id                       CHAR(36)     NOT NULL,
  week_start_date                  DATE         NOT NULL,
  preferred_day                    TINYINT      NULL COMMENT '0=Sun,1=Mon,...,6=Sat; NULL if no preference',
  assigned_day                     TINYINT      NULL COMMENT 'Day actually assigned',
  assigned_day_is_preferred        TINYINT(1)   NOT NULL DEFAULT 0,
  consecutive_no_preferred_weekoff INT          NOT NULL DEFAULT 0
                                   COMMENT 'Weeks in a row employee did not get preferred day',
  consecutive_no_weekend_weekoff   INT          NOT NULL DEFAULT 0
                                   COMMENT 'Weeks in a row employee did not get Sat/Sun off',
  fairness_score                   INT          NOT NULL DEFAULT 100
                                   COMMENT 'Computed allocation priority score (higher = more priority)',
  allocation_exception_reason      VARCHAR(100) NULL
                                   COMMENT 'Reason if preferred day was not allocated',
  created_at                       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY uq_wfs_emp_week (employee_id, week_start_date),
  INDEX idx_wfs_process_week (process_id, week_start_date),
  INDEX idx_wfs_consecutive   (consecutive_no_weekend_weekoff)
);

SELECT '332_weekoff_fairness_score.sql applied' AS migration_status;
