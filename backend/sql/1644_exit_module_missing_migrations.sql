-- Migration 1644: reconstructs three exit-module tables' migration history to match
-- what is actually live in production, closing a "fresh environment breaks" gap found
-- during an exit/F&F process audit.
--
-- IMPORTANT — best-effort reconstruction, not a verified copy:
-- Unlike 1506 (exit_clearance_task), which was written by copying `SHOW CREATE TABLE`
-- output directly off production, this migration was written WITHOUT live database
-- access. Column NAMES for exit_retention_action / exit_interview_response /
-- exit_employee_health_snapshot are taken verbatim from backend/sql/schema-snapshot.json
-- (itself generated from live `mas_hrms`, so the names are real), but the TYPES,
-- nullability, defaults, indexes and ENUM value sets below are inferred from how
-- backend/src/modules/exit/exit-intelligence.service.ts reads and writes these columns,
-- not read off the server. Before trusting this on a real disaster-recovery restore, run
-- `SHOW CREATE TABLE <name>` on production and reconcile.
--
-- No `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` anywhere: per 1643_dual_
-- review_queue.sql's and 1643_payroll_readiness_visibility.sql's own notes, that is
-- MariaDB syntax this project's MySQL 8 rejects at parse time while the runner still
-- records the file as applied — a migration that silently did nothing. Every ALTER below
-- is instead guarded the same way migration 305 guards its own idempotent column adds:
-- an INFORMATION_SCHEMA check driving PREPARE/EXECUTE, so a replay is a genuine no-op
-- rather than a parse-time failure the runner can't see.

DELIMITER $$
CREATE PROCEDURE IF NOT EXISTS _m1644_add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN def TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', def);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE IF NOT EXISTS _m1644_add_index(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN def TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD INDEX `', idx, '` ', def);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- ── Fix 1: exit_retention_action — migration 305 created this table with the wrong
-- columns (action_type, action_summary, outcome, performed_by, performed_at only). Live
-- production also has employee_id, action_owner_user_id, outcome_remarks, created_by,
-- created_at, updated_at (confirmed via schema-snapshot.json) — addRetentionAction() in
-- exit-intelligence.service.ts inserts all of these. A fresh environment built from 305
-- alone would throw ER_BAD_FIELD_ERROR on the first retention action logged.
CALL _m1644_add_col('exit_retention_action', 'employee_id', 'CHAR(36) DEFAULT NULL AFTER exit_request_id');
CALL _m1644_add_col('exit_retention_action', 'action_owner_user_id', 'CHAR(36) DEFAULT NULL AFTER action_type');
CALL _m1644_add_col('exit_retention_action', 'outcome_remarks', 'TEXT DEFAULT NULL AFTER outcome');
CALL _m1644_add_col('exit_retention_action', 'created_by', 'CHAR(36) DEFAULT NULL');
CALL _m1644_add_col('exit_retention_action', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL _m1644_add_col('exit_retention_action', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

-- Back-fill created_at/created_by from the old performed_at/performed_by on any row that
-- already exists with only the 305 columns populated (harmless no-op once already backfilled
-- or on a table with 0 rows, which is the confirmed state of this table in production today).
UPDATE exit_retention_action
   SET created_at = COALESCE(created_at, performed_at, CURRENT_TIMESTAMP),
       created_by = COALESCE(created_by, performed_by)
 WHERE created_by IS NULL;

CALL _m1644_add_index('exit_retention_action', 'idx_exit_retention_employee', '(employee_id)');

-- ── Fix 2: exit_interview_response — actively written by saveExitInterview()
-- (POST /api/exit/:id/interview) with no CREATE TABLE anywhere in backend/sql/. A fresh
-- environment would throw ER_NO_SUCH_TABLE on the first exit interview captured.
CREATE TABLE IF NOT EXISTS exit_interview_response (
  id                       CHAR(36)      NOT NULL,
  exit_request_id          CHAR(36)      NOT NULL,
  employee_id              CHAR(36)      NOT NULL,
  primary_reason           VARCHAR(120)  DEFAULT NULL,
  secondary_reason         VARCHAR(120)  DEFAULT NULL,
  manager_feedback_score   TINYINT UNSIGNED DEFAULT NULL,
  process_feedback_score   TINYINT UNSIGNED DEFAULT NULL,
  salary_feedback_score    TINYINT UNSIGNED DEFAULT NULL,
  work_life_score          TINYINT UNSIGNED DEFAULT NULL,
  would_rejoin             TINYINT(1)    DEFAULT NULL,
  rehire_eligible          TINYINT(1)    DEFAULT NULL,
  comments                 TEXT          DEFAULT NULL,
  captured_by              CHAR(36)      NOT NULL,
  captured_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exit_interview_request (exit_request_id),
  KEY idx_exit_interview_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Fix 3: exit_employee_health_snapshot — actively written by createExitHealthSnapshot()
-- (called on every createExitRequest) with no CREATE TABLE anywhere in backend/sql/. A
-- fresh environment would throw ER_NO_SUCH_TABLE on the first resignation submitted.
CREATE TABLE IF NOT EXISTS exit_employee_health_snapshot (
  id                    CHAR(36)      NOT NULL,
  exit_request_id       CHAR(36)      NOT NULL,
  employee_id           CHAR(36)      NOT NULL,
  snapshot_date         DATE          NOT NULL,
  engagement_score      DECIMAL(5,2)  DEFAULT NULL,
  performance_score     DECIMAL(5,2)  DEFAULT NULL,
  attendance_score      DECIMAL(5,2)  DEFAULT NULL,
  kudos_received_90d    INT UNSIGNED  DEFAULT NULL,
  pulse_avg_90d         DECIMAL(5,2)  DEFAULT NULL,
  regrettable_exit      TINYINT(1)    DEFAULT NULL,
  risk_label            ENUM('low','medium','high','critical') DEFAULT NULL,
  insight_json          JSON          DEFAULT NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exit_health_snapshot_request (exit_request_id),
  KEY idx_exit_health_snapshot_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS _m1644_add_col;
DROP PROCEDURE IF EXISTS _m1644_add_index;
