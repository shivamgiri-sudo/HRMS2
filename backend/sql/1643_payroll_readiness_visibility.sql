-- 1643: Make payroll branch/process readiness answerable — four outstanding-work counters
-- on payroll_branch_readiness, plus the payroll_hr grant on the readiness page.
--
-- WHY THE COUNTERS
-- payroll_branch_readiness holds five MANUALLY TICKED items (attendance_data_ready,
-- leave_finalized, regularization_complete, custom_deductions_uploaded, overtime_entered).
-- The checklist POST writes the column and verifies nothing: there is no query against
-- attendance_daily_record, leave_request or attendance_regularization behind any of them. So a
-- branch WFM user attests "Attendance Data Ready" from memory, and the Payroll Head sees a
-- score with no way to tell WHY a branch is short — only that it is.
--
-- These four columns carry the outstanding work behind those attestations, refreshed live by
-- payrollBranchReadinessService.refreshLiveMetrics(). They are reporting columns, not new
-- gates: nothing in computeScore() or computeStatus() reads them, so adding them cannot move
-- any branch's score or status. What they change is that a tick is now made against a visible
-- number, and follow-up has something to chase.
--
--   pending_leave_count           leave_request rows still 'pending' for the branch/process
--   pending_regularization_count  attendance_regularization still 'pending'/'escalated'
--   employees_without_attendance  active employees with ZERO attendance rows in the month
--   incentive_batch_status        incentive_upload_batch status, or NULL when none uploaded
--
-- incentive_batch_status is here because incentives_status='approved' is worth 20 of the 100
-- readiness points and branch staff CANNOT set it: POST /api/incentives/batches/:id/approve is
-- requireRole('admin','finance'). A branch below 100% on bank details or UAN therefore cannot
-- reach the 80-point threshold without an action by a team that does not appear on the
-- readiness page at all. Surfacing the batch's real state is what makes that dependency
-- chaseable instead of invisible.
--
-- WHY THE payroll_hr GRANT
-- role_page_access holds PAYROLL_BRANCH_READINESS grants for admin, branch_head,
-- branch_payroll, branch_wfm, finance, hr, payroll, payroll_branch, payroll_head, super_admin
-- and wfm — but not payroll_hr. That is the wrong role to omit: user_roles has 4 active
-- payroll_hr users (3 branch-scoped, 1 all-scoped) and ZERO users holding payroll_branch, so
-- payroll_hr is the branch-payroll role in practice, not a synonym nobody uses. The backend
-- routes were already opened to it (payroll-branch-readiness.routes.ts grants payroll_hr on
-- seven routes), leaving the API permitting a role the access gate denied — and
-- custom_deductions_uploaded, worth 10 points, is precisely the item payroll_hr owns.
--
-- No page_catalog row is created: PAYROLL_BRANCH_READINESS is already catalogued (ten other
-- roles hold grants against it), and access.service.ts builds its permission map from active
-- page_catalog rows, so the code already resolves.
--
-- Purely additive and idempotent. Four guarded ALTERs, one guarded INSERT, one re-asserting
-- UPDATE. No DROP, no DELETE, no existing column altered, no FOREIGN KEY (no-FK convention).
-- Column additions are guarded individually via information_schema + PREPARE/EXECUTE because
-- the deployed MySQL rejects ADD COLUMN IF NOT EXISTS with ER_PARSE_ERROR while still
-- recording the migration as applied.
--
-- ROLLBACK
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'PAYROLL_BRANCH_READINESS' AND role_key = 'payroll_hr';
--   -- the four columns are inert reporting fields; dropping them is optional.

-- ── A. outstanding-work counters ────────────────────────────────────────────────

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness'
  AND COLUMN_NAME = 'pending_leave_count'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN pending_leave_count INT NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness'
  AND COLUMN_NAME = 'pending_regularization_count'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN pending_regularization_count INT NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness'
  AND COLUMN_NAME = 'employees_without_attendance'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN employees_without_attendance INT NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_branch_readiness'
  AND COLUMN_NAME = 'incentive_batch_status'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE payroll_branch_readiness ADD COLUMN incentive_batch_status VARCHAR(40) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── B. payroll_hr reaches the readiness page ────────────────────────────────────

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), 'payroll_hr', 'PAYROLL_BRANCH_READINESS', 1, 0, 1, 0, 0, 1, NOW()
  FROM (SELECT 1) AS seed
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access existing
    WHERE existing.role_key  = 'payroll_hr'
      AND existing.page_code = 'PAYROLL_BRANCH_READINESS'
 );

UPDATE role_page_access
   SET can_view = 1, can_edit = 1, active_status = 1
 WHERE page_code = 'PAYROLL_BRANCH_READINESS'
   AND role_key  = 'payroll_hr';

SELECT '1643 applied: readiness outstanding-work counters + payroll_hr page grant' AS migration_status;
