-- Branch Health Report: one row per (branch, report date, red signal) so the email can say
-- "red N days since D". A '__run__' row per (branch, date) marks that the report ran, which is what
-- lets a streak tell a clean day from a day with no run. Written only on a real send.
-- Additive and idempotent: one CREATE TABLE IF NOT EXISTS, no FOREIGN KEY, nothing altered or deleted.
-- The report code also creates this table itself on first write, so applying this early is harmless.
CREATE TABLE IF NOT EXISTS branch_health_signal_daily (
  branch_name VARCHAR(120) NOT NULL,
  report_date DATE         NOT NULL,
  signal_key  VARCHAR(80)  NOT NULL,
  label       VARCHAR(300) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_name, report_date, signal_key),
  KEY idx_bhsd_date (report_date)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Branch Health Report red-signal history (streak counting).';

SELECT 'Migration 2084 applied: branch_health_signal_daily' AS migration_status;
