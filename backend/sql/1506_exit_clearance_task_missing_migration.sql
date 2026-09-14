-- Migration 1506: reconstructs exit_clearance_task's missing CREATE TABLE.
--
-- This table has been live in production and read/written by 20+ files (exit-intelligence.
-- service.ts's createDefaultClearanceTasks, exit.routes.ts's clearance generate/PATCH routes,
-- ff-approval-guard.compat.routes.ts's approval gate, reporting adapters, work-inbox) with no
-- CREATE TABLE anywhere in sql/ or sql/migrations/ — its only trace in the repo was the column
-- list in schema-snapshot.json. A fresh environment (new dev machine, staging, disaster
-- recovery restore from migrations alone) would never get this table at all.
--
-- CREATE TABLE IF NOT EXISTS is a no-op everywhere this table already exists (every real
-- environment today) and only creates it where it's genuinely missing. Structure copied
-- verbatim from `SHOW CREATE TABLE exit_clearance_task` against production 2026-08-20 —
-- same columns, same enum values, same indexes, same absence of foreign keys (the live table
-- has none on exit_request_id/employee_id either; not adding any here that don't already
-- exist, to avoid the collation-mismatch trap this project has hit before on FK-to-employees).
CREATE TABLE IF NOT EXISTS exit_clearance_task (
  id                CHAR(36)     NOT NULL,
  exit_request_id   CHAR(36)     NOT NULL,
  employee_id       CHAR(36)     NOT NULL,
  clearance_area    ENUM('manager','hr','it','admin','assets','payroll','finance','wfm','lms','compliance') NOT NULL,
  task_title        VARCHAR(180) NOT NULL,
  task_description  VARCHAR(700) DEFAULT NULL,
  owner_role        VARCHAR(80)  NOT NULL,
  owner_user_id     CHAR(36)     DEFAULT NULL,
  due_date          DATE         DEFAULT NULL,
  status            ENUM('pending','in_progress','cleared','blocked','waived') NOT NULL DEFAULT 'pending',
  remarks           VARCHAR(700) DEFAULT NULL,
  cleared_by        CHAR(36)     DEFAULT NULL,
  cleared_at        DATETIME     DEFAULT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_exit_clearance_request  (exit_request_id, status),
  KEY idx_exit_clearance_employee (employee_id, status),
  KEY idx_exit_clearance_owner    (owner_role, owner_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
