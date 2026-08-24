-- 1558_helpdesk_ticket_raised_by.sql
--
-- Adds helpdesk_ticket.raised_by_user_id — the maker half of a maker-checker rule
-- the helpdesk module has never had.
--
-- WHY THIS COLUMN DID NOT EXIST
-- helpdesk_ticket (016_employee_lifecycle.sql) records employee_id (whose problem the
-- ticket is about) and assigned_to (who is working it), but nothing about who actually
-- raised it. That is fine while an employee raises their own ticket — employee_id and
-- the raiser are the same person. It stops being fine on the admin path: POST /tickets
-- lets any HELPDESK_ADMIN_ROLES holder create a ticket on behalf of any employee, and
-- the acting user survives only inside sensitive_action_log's change_summary JSON
-- ({on_behalf_of: ...}), which is telemetry, not a workflow record, and which
-- writeSensitiveActionLog is explicitly allowed to drop on failure.
--
-- The consequence, confirmed by reading the routes: one person holding one helpdesk role
-- can POST /tickets, POST /tickets/:id/take and POST /tickets/:id/resolve end to end, and
-- nothing on the row can afterwards show that the same pair of eyes did all three. Every
-- other governed module here (GRN, imprest, budget review, cost centre, payroll sign-off)
-- enforces maker != checker and has a contract test for it. Helpdesk had no occurrence of
-- "maker" or "checker" anywhere in the module.
--
-- WHY IT IS SAFE TO ADD NOW, AND WHY THERE IS NO BACKFILL
-- helpdesk_ticket holds 4 rows in production, all four INSERTed in the same second on
-- 2026-06-01 08:24:19 — seed data. In sensitive_action_log, module_key='HELPDESK' has only
-- TICKET_ASSIGNED (3) and TICKET_ESCALATED (1); TICKET_CREATED, TICKET_RESOLVED and
-- TICKET_TAKEN have never been written once. No ticket has ever been raised or resolved
-- through this API, so there is no history to reconstruct and no in-flight workflow to
-- disturb. The 4 seed rows keep raised_by_user_id NULL, and the guard in helpdesk.routes.ts
-- treats NULL as "raiser unknown, cannot prove separation" — it does not block on them,
-- because refusing to resolve a row that predates the column would be inventing a failure.
--
-- NULLABLE, and no foreign key, deliberately: this matches assigned_to on the same table,
-- which is also CHAR(36) NULL with no FK to auth_user. Adding an FK here and not there
-- would be a new inconsistency, and a NOT NULL column would fail against the 4 existing rows.
-- COLLATE is stated explicitly — helpdesk_ticket and auth_user are both utf8mb4_unicode_ci
-- (verified live 2026-08-24), and stating it keeps a future join off the errno 3780 path
-- this repo has hit before on employees(id).
--
-- information_schema-guarded PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS: MySQL 8
-- does not support that clause, and this repo has already recorded migrations as applied
-- while their DDL silently did nothing (see 1304/1305). Idempotent — re-running is a no-op.

-- ── 1. raised_by_user_id ─────────────────────────────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'helpdesk_ticket'
       AND COLUMN_NAME  = 'raised_by_user_id') = 0,
  'ALTER TABLE helpdesk_ticket ADD COLUMN raised_by_user_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL COMMENT ''auth_user.id of whoever called POST /tickets — the maker. NULL on rows predating migration 1558.''',
  'SELECT ''helpdesk_ticket.raised_by_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. resolved_by_user_id ───────────────────────────────────────────────────
-- The checker half. /resolve previously recorded the acting user only in the audit log,
-- so even after the guard below refuses a self-resolve, nothing on the row would say who
-- the second pair of eyes actually was. Same nullability and collation reasoning as above.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'helpdesk_ticket'
       AND COLUMN_NAME  = 'resolved_by_user_id') = 0,
  'ALTER TABLE helpdesk_ticket ADD COLUMN resolved_by_user_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL COMMENT ''auth_user.id of whoever called POST /tickets/:id/resolve — the checker.''',
  'SELECT ''helpdesk_ticket.resolved_by_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. Index on raised_by_user_id ────────────────────────────────────────────
-- Supports "what did this person raise" lookups from the queue and the eventual
-- separation-of-duties report. Not unique: one user raises many tickets.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'helpdesk_ticket'
       AND INDEX_NAME   = 'idx_helpdesk_ticket_raised_by') = 0,
  'ALTER TABLE helpdesk_ticket ADD INDEX idx_helpdesk_ticket_raised_by (raised_by_user_id)',
  'SELECT ''idx_helpdesk_ticket_raised_by already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1558_helpdesk_ticket_raised_by.sql applied — helpdesk_ticket.raised_by_user_id + resolved_by_user_id + idx_helpdesk_ticket_raised_by' AS migration_status;
