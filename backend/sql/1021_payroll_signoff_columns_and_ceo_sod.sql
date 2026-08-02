-- 1021_payroll_signoff_columns_and_ceo_sod.sql
--
-- Two related fixes from the CEO UAT of 31-Jul-2026.
--
-- 1. PAYROLL SIGN-OFF IS NON-FUNCTIONAL — the endpoint 500s, it does not merely
--    show an empty queue.
--    backend/src/modules/payroll/payroll-signoff.routes.ts selects and updates six
--    columns on salary_prep_run that have never existed in any applied migration:
--      finance_approved_by / finance_approved_at / finance_remarks
--      ceo_acknowledged_by / ceo_acknowledged_at / ceo_remarks
--    Verified against the live schema on 31-Jul-2026: none are present, and running
--    the route's own query returns
--      ERROR 1054: Unknown column 'finance_approved_by' in 'field list'
--    The UAT saw "Choose a pending run" with nothing selectable because the frontend
--    swallowed that 500. Every route in the module is affected: GET /runs,
--    GET /runs/:id/status, POST /runs/:id/finance-approve, POST /runs/:id/ceo-acknowledge
--    and POST /runs/:id/revoke-finance-approval.
--
--    All six are added, not three. The two-stage flow is fully implemented in both
--    backend and UI, and POST /finance-approve already restricts to
--    finance / super_admin / payroll_head — the CEO cannot finance-approve. CEO
--    acknowledgement is a separate threshold-gated governance step, so removing it
--    would delete a working control rather than fix the segregation-of-duties issue
--    (which is fix 2 below).
--
-- 2. SEGREGATION OF DUTIES on the ceo role.
--    The UAT flagged PAYROLL_SIGN_OFF as the only CEO page carrying Create and
--    Export. Live check confirmed it, and found a second, wider grant the UAT did
--    not see: AGENT_PERFORMANCE with can_view/create/edit/delete/export all = 1,
--    the ceo role's only full-CRUD grant.
--
-- Additive and idempotent. Adds columns and narrows two grants. Creates no table,
-- drops no column, deletes no row, and changes no payroll figure.
--
-- NOT EXECUTED AUTOMATICALLY. Review, then run against the target schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. salary_prep_run sign-off columns
-- ─────────────────────────────────────────────────────────────────────────────
-- MySQL has no ADD COLUMN before 8.0.29 and this must stay re-runnable,
-- so each column is guarded through information_schema.

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'finance_approved_by') = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN finance_approved_by CHAR(36) NULL COMMENT ''auth_user.id of the finance/payroll_head approver''',
  'SELECT ''finance_approved_by already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'finance_approved_at') = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN finance_approved_at DATETIME NULL COMMENT ''NULL = pending finance sign-off''',
  'SELECT ''finance_approved_at already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'finance_remarks') = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN finance_remarks TEXT NULL',
  'SELECT ''finance_remarks already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'ceo_acknowledged_by') = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN ceo_acknowledged_by CHAR(36) NULL COMMENT ''auth_user.id of the acknowledging CEO''',
  'SELECT ''ceo_acknowledged_by already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'ceo_acknowledged_at') = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN ceo_acknowledged_at DATETIME NULL',
  'SELECT ''ceo_acknowledged_at already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'ceo_remarks') = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN ceo_remarks TEXT NULL',
  'SELECT ''ceo_remarks already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Sign-off queue predicate is `status = 'processing' AND finance_approved_at IS NULL`.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND INDEX_NAME = 'idx_spr_signoff_queue') = 0,
  'CREATE INDEX idx_spr_signoff_queue ON salary_prep_run (status, finance_approved_at)',
  'SELECT ''idx_spr_signoff_queue already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Narrow the two over-broad ceo grants
-- ─────────────────────────────────────────────────────────────────────────────
-- Sign-off authority stays with finance / payroll_head, which POST /finance-approve
-- already enforces. The CEO keeps view (and the separate ceo-acknowledge endpoint);
-- Create and Export are removed.
UPDATE role_page_access
   SET can_create = 0,
       can_export = 0
 WHERE role_key  = 'ceo'
   AND page_code = 'PAYROLL_SIGN_OFF';

-- Reduce the ceo role's only full-CRUD grant to read + export.
UPDATE role_page_access
   SET can_create = 0,
       can_edit   = 0,
       can_delete = 0
 WHERE role_key  = 'ceo'
   AND page_code = 'AGENT_PERFORMANCE';

-- Verification after running:
--   SELECT page_code, can_view, can_create, can_edit, can_delete, can_export
--     FROM role_page_access
--    WHERE role_key = 'ceo' AND (can_create=1 OR can_edit=1 OR can_delete=1);
--   -- expected: empty set
--
--   SELECT COUNT(*) FROM salary_prep_run
--    WHERE status = 'processing' AND finance_approved_at IS NULL;
--   -- expected on 31-Jul-2026: 3 (2026-06, and two 2026-07 runs)
