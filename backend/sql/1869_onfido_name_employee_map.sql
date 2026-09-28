-- Migration 1869: Onfido AM/TL name-to-employee reconciliation table
--
-- onfido_doc_external_audit_raw and onfido_agent_daily_raw live in a separate physical
-- database (onfido_db, accessed via getOnfidoPool()) from employees (mas_hrms). There is
-- no FK and no cross-database JOIN possible between them. Both raw tables identify TL/AM
-- only via free-text VARCHAR columns (tl_name, am_name) with no employee_id linkage —
-- onfido_agent_daily_raw.emp_id loosely carries a MAS employee_code-shaped string, but
-- onfido_doc_external_audit_raw has no equivalent column at all, so it cannot be relied on
-- as a general join key.
--
-- This table is populated entirely by application code (see
-- backend/scripts/seed-onfido-name-mapping.ts): raw names are read from onfido_db, employee
-- candidates are read from mas_hrms.employees, matched in TypeScript, and the result is
-- written here. No SQL JOIN across the two databases is ever performed.
--
-- HR reviews and confirms/corrects low-confidence or ambiguous matches via the admin screen
-- backed by onfido-name-mapping.routes.ts. Once verified_by_hr = 1, upsertMapping() in
-- onfido-name-mapping.service.ts must never overwrite that row's employee_id, even if a
-- later automated re-match run would suggest a different employee.
--
-- Lives in mas_hrms (same database as employees), never in onfido_db — onfido_db's schema
-- is owned by an external ETL process this codebase does not control.
--
-- NOTE: this codebase's live migration history shows numeric filename collisions between
-- unrelated concurrent migrations are tolerated safely (schema_migrations tracks by full
-- filename, not by numeric prefix — see e.g. the two independent "1080" files documented in
-- backend/src/db/runPendingMigrations.ts). 1869 was confirmed free against both the on-disk
-- migration files and the live schema_migrations table at the time this file was written,
-- but per that same established convention, a later collision would not be unsafe.
--
-- NOTE: ADD COLUMN IF NOT EXISTS / CREATE TABLE guards must use the INFORMATION_SCHEMA +
-- PREPARE/EXECUTE idiom — MariaDB's ADD COLUMN IF NOT EXISTS is rejected by this project's
-- MySQL 8.0.42 server with ER_PARSE_ERROR (see 1064/1110/1119/1122/1123's documented history
-- of that exact mistake in runPendingMigrations.ts).
--
-- NOTE: deliberately NO foreign key on employee_id -> employees(id). employees is a hot,
-- high-traffic live table (confirmed: 3+ concurrent connections at migration-write time) and
-- adding a table with a FK against it requires a metadata lock this project's own
-- MIGRATION_LOCK_WAIT_SECONDS (15s default) is not long enough to reliably win against live
-- traffic -- this migration's first attempt failed with exactly that
-- "Lock wait timeout exceeded; try restarting transaction" error. This matches the dominant
-- convention already used across dozens of this codebase's own migrations that skip FKs on
-- employees for the same reason (e.g. user_assignment_scope.manager_employee_id has no FK
-- either). The relationship is enforced in application code
-- (onfido-name-mapping.service.ts's getEmployeeCandidates()/upsertMapping()), not the schema.

SET @tbl := 'onfido_name_employee_map';

SET @sql = (SELECT IF(COUNT(*) = 0,
  'CREATE TABLE onfido_name_employee_map (
    id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    raw_name            VARCHAR(255)  NOT NULL,
    raw_role            ENUM(''tl'',''am'') NOT NULL,
    employee_id         CHAR(36)      NULL,
    match_confidence    DECIMAL(4,3)  NOT NULL DEFAULT 0.000,
    match_method        VARCHAR(50)   NOT NULL DEFAULT ''unmatched'',
    verified_by_hr       TINYINT(1)    NOT NULL DEFAULT 0,
    verified_by_user_id CHAR(36)      NULL,
    verified_at         DATETIME      NULL,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_raw_name_role (raw_name, raw_role),
    INDEX idx_onm_employee (employee_id),
    INDEX idx_onm_verified (verified_by_hr)
  ) ENGINE=InnoDB',
  'SELECT 1')
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl);

PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;
