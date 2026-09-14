-- Migration 1242: approval-gate columns for employee_loans.
--
-- WHY THIS IS NEEDED
--   employee_loans.status is a plain VARCHAR(20) NOT NULL DEFAULT 'active' (065_employee_loans.sql)
--   with no ENUM/CHECK constraint, so the new 'pending_approval' and 'rejected' status VALUES
--   need no DDL at all — they are just new strings the application now writes and reads.
--   What DOES need DDL is provenance: POST /api/payroll/loans/:id/approve
--   (backend/src/modules/payroll/loans.routes.ts) must refuse self-approval by comparing the
--   original creator against the approver, and the table has never recorded who created a loan
--   — only approved_by/approved_at exist, and until this change POST / self-stamped THOSE at
--   creation time with the creator's own id (fake provenance: it recorded who created the row,
--   not who approved it). Symmetrically, POST /:id/reject needs somewhere to record who
--   rejected, when, and why; the existing `reason` column already holds the loan's own
--   requested-for purpose (written by POST / from the request body) and reusing it for a
--   rejection note would silently overwrite that value, so a dedicated rejection column set is
--   the correct additive choice, not a DDL-avoidance workaround.
--
-- COLUMNS ADDED
--   created_by         VARCHAR(100) NULL — the auth user id who created the loan record; POST /
--                       now writes this and no longer stamps approved_by/approved_at at create
--                       time. NULL on the 67 pre-existing rows (see grandfathering note below);
--                       the self-approval check treats a NULL created_by as "unknown creator",
--                       never as a match, so it cannot false-positive-block a legacy row.
--   rejected_by         VARCHAR(100) NULL — mirrors approved_by, set only by POST /:id/reject.
--   rejected_at          DATETIME NULL — mirrors approved_at.
--   rejection_reason    VARCHAR(500) NULL — mirrors the length class of other free-text reason
--                       fields in this schema (e.g. cost_centre_master.rejection_reason); kept
--                       distinct from the pre-existing `reason` column, which is the loan's own
--                       stated purpose, not the approver's decision note.
--
-- GRANDFATHERING — CRITICAL, PER OWNER RULING
--   This migration touches NO existing row. It only ADDs nullable columns with no DEFAULT
--   requiring a rewrite of current data, and issues no UPDATE/DELETE against employee_loans.
--   The 67 live rows (all status IN ('active','completed') from a one-time legacy backfill,
--   actively deducting real payroll) keep their current status, approved_by and approved_at
--   values exactly as they are. created_by/rejected_by/rejected_at/rejection_reason simply read
--   NULL on all of them, which is correct: none of them went through the new gate.
--
-- PATTERN REUSED, NOT INVENTED
--   information_schema-guarded PREPARE/EXECUTE, not `ADD COLUMN IF NOT EXISTS` — this MySQL 8
--   server rejects that clause with ER_PARSE_ERROR while still recording the migration as
--   applied (the 2026-08-13 outage pattern; see 1211/1212/1224/1225/1227/1228/1232/1241).
--   No DROP, no DELETE, no existing column touched, no payroll/salary calculation logic
--   changed — payrollCalculate.service.ts and running-salary.service.ts's loan-EMI reads
--   already filter WHERE status='active' and are not touched by this migration or the
--   approval-gate feature it backs.
--
-- ROLLBACK:
--   ALTER TABLE employee_loans
--     DROP COLUMN created_by, DROP COLUMN rejected_by,
--     DROP COLUMN rejected_at, DROP COLUMN rejection_reason;

SET @c_created_by = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_loans'
     AND COLUMN_NAME = 'created_by'
);
SET @sql = IF(@c_created_by = 0,
  'ALTER TABLE employee_loans ADD COLUMN created_by VARCHAR(100) NULL COMMENT ''Auth user id who created this loan record (POST /). NULL on rows created before this column existed. Used by POST /:id/approve to block self-approval.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_rejected_by = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_loans'
     AND COLUMN_NAME = 'rejected_by'
);
SET @sql = IF(@c_rejected_by = 0,
  'ALTER TABLE employee_loans ADD COLUMN rejected_by VARCHAR(100) NULL COMMENT ''Auth user id who rejected this loan via POST /:id/reject. Mirrors approved_by.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_rejected_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_loans'
     AND COLUMN_NAME = 'rejected_at'
);
SET @sql = IF(@c_rejected_at = 0,
  'ALTER TABLE employee_loans ADD COLUMN rejected_at DATETIME NULL COMMENT ''Timestamp of POST /:id/reject. Mirrors approved_at.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_rejection_reason = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_loans'
     AND COLUMN_NAME = 'rejection_reason'
);
SET @sql = IF(@c_rejection_reason = 0,
  'ALTER TABLE employee_loans ADD COLUMN rejection_reason VARCHAR(500) NULL COMMENT ''Why POST /:id/reject refused this loan. Distinct from the pre-existing `reason` column, which is the loan''''s own stated purpose written at creation.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
