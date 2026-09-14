-- Worker Distributed Safety Schema
-- Adds tracking tables for worker job runs and distributed coordination

-- Worker job run tracking table
CREATE TABLE IF NOT EXISTS worker_job_run (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  worker_name     VARCHAR(100)  NOT NULL COMMENT 'Unique worker identifier',
  status          ENUM('started', 'completed', 'failed') NOT NULL DEFAULT 'started',
  started_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME      NULL,
  duration_ms     INT           NULL COMMENT 'Execution time in milliseconds',
  lock_acquired   TINYINT(1)    NOT NULL DEFAULT 1 COMMENT 'Whether advisory lock was acquired',
  input_hash      VARCHAR(64)   NULL COMMENT 'Hash of input data for idempotency',
  output_summary  TEXT          NULL COMMENT 'Summary of output/results',
  error_message   TEXT          NULL COMMENT 'Error message if failed',
  metadata        JSON          NULL COMMENT 'Additional run metadata',
  hostname        VARCHAR(255)  NULL COMMENT 'Server hostname that ran the worker',
  INDEX idx_worker_job_run_name (worker_name),
  INDEX idx_worker_job_run_status (status),
  INDEX idx_worker_job_run_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Worker configuration table for dynamic enable/disable
CREATE TABLE IF NOT EXISTS worker_config (
  worker_name     VARCHAR(100)  NOT NULL PRIMARY KEY,
  enabled         TINYINT(1)    NOT NULL DEFAULT 1,
  description     VARCHAR(500)  NULL,
  schedule_cron   VARCHAR(100)  NULL COMMENT 'Cron expression if applicable',
  last_run_at     DATETIME      NULL,
  next_run_at     DATETIME      NULL,
  max_retries     INT           NOT NULL DEFAULT 3,
  timeout_seconds INT           NOT NULL DEFAULT 300,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default worker configurations
INSERT IGNORE INTO worker_config (worker_name, enabled, description) VALUES
  ('payroll-nightly-recalc', 1, 'Nightly payroll recalculation for draft/processing runs'),
  ('leave-monthly-credit', 1, 'Monthly leave credit allocation'),
  ('leave-annual-el-credit', 1, 'Annual earned leave credit'),
  ('attendance-engine', 1, 'Attendance processing and reconciliation'),
  ('integration-scheduler', 1, 'Integration hub scheduled jobs'),
  ('lms-sync', 1, 'LMS data synchronization'),
  ('privacy-retention', 1, 'DPDP privacy data retention enforcement'),
  ('sla-breach', 1, 'SLA breach detection and alerting'),
  ('kpi-daily-sync', 1, 'Daily KPI metrics synchronization'),
  ('apr-vicidial-sync', 1, 'APR Vicidial call data sync'),
  ('cosec-sync', 1, 'COSEC biometric attendance sync');
