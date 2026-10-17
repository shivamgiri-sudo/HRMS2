-- Migration 2227: db_lock_incident - deadlock / lock-wait telemetry and lock-watchdog actions.
-- Additive: one new table, nothing altered. Collation is stated explicitly (utf8mb4_unicode_ci, the schema standard):
-- 2220/2221 omitted it and came out utf8mb4_0900_ai_ci, which broke joins with auth_user/employees (fixed in 2226).
-- kind='deadlock'|'lock_wait_timeout': aggregated count of a statement shape that lost a conflict (occurrences per minute).
-- kind='blocker': a connection that was holding locks other transactions were waiting on; action says what was done.
-- Rows older than 30 days are deleted by the db-lock-watchdog cron. Revert: DROP TABLE db_lock_incident.
CREATE TABLE IF NOT EXISTS db_lock_incident (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  detected_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind            ENUM('deadlock','lock_wait_timeout','blocker') NOT NULL,
  action          ENUM('observed','killed','alerted','skipped') NOT NULL DEFAULT 'observed',
  statement_shape VARCHAR(300) NULL,
  occurrences     INT NOT NULL DEFAULT 1,
  blocker_thread  BIGINT UNSIGNED NULL,
  blocker_user    VARCHAR(64) NULL,
  blocker_age_s   INT NULL,
  blocker_state   VARCHAR(20) NULL,
  blocker_query   VARCHAR(500) NULL,
  waiters         INT NULL,
  max_wait_s      INT NULL,
  reason          VARCHAR(120) NULL,
  PRIMARY KEY (id),
  KEY idx_dli_detected (detected_at),
  KEY idx_dli_kind (kind, detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
