-- ---------------------------------------------------------------------------
-- 1657 — Two-stage approval for incentive and deduction bulk uploads
-- ---------------------------------------------------------------------------
--
-- WHY
--
-- `upload_batch` today carries ONE approval decision: `approval_status` moves
-- 'pending_branch_head' → 'approved' | 'rejected' | 'partially_applied', and the
-- moment the Branch Head approves, `performDecision()` runs the domain engine.
-- For incentives that engine sets `incentive_upload_batch.status = 'approved'`,
-- and payrollCalculate.service.ts §5f pays exactly that status — so today the
-- Branch Head's click IS the payment.
--
-- The approved design puts a second, HO-level approver in front of the money:
--
--   Branch WFM / Payroll HR upload
--        → Branch Head approves        (nothing applies; batch waits)
--             → Payroll Head approves  (the existing engine runs, money moves)
--
-- Only INCENTIVE_BULK and DEDUCTION_BULK get the second stage. Attendance
-- regularization and leave keep their single Branch Head stage — they do not move
-- money and adding an HO step to them would stall branch operations.
--
-- WHAT THIS MIGRATION DOES NOT NEED TO DO
--
-- `upload_batch.approval_status` is already VARCHAR(30), not an ENUM, so the new
-- values 'pending_payroll_head' and 'discarded' need no DDL. Likewise
-- `employee_deduction_entries.status` already has 'inactive', which payroll's
-- `status = 'active'` filter ignores — a discarded deduction line needs no new state.
--
-- SAFETY
--
-- Every ALTER is guarded on information_schema so a re-run is a no-op, and every
-- guard tests the same column it is about to add — an UPDATE that read an unguarded
-- column took production down on 2026-09-02.
-- Nothing here backfills or rewrites an existing row. Batches currently sitting at
-- 'pending_branch_head' keep working: they are simply routed to the new stage-1
-- handler, which moves them to 'pending_payroll_head' instead of applying them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. upload_batch — per-stage decision columns
-- ---------------------------------------------------------------------------
-- The existing `approved_by` / `approved_at` / `approval_remarks` are kept and keep
-- their meaning: the FINAL decision on the batch, whichever stage made it. These new
-- columns record each stage separately, so "who released this at branch level" is
-- still answerable after the Payroll Head has stamped the batch.

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN branch_head_approved_by VARCHAR(36) NULL AFTER approval_remarks',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'branch_head_approved_by');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN branch_head_approved_at DATETIME NULL AFTER branch_head_approved_by',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'branch_head_approved_at');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN branch_head_remarks TEXT NULL AFTER branch_head_approved_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'branch_head_remarks');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN payroll_head_approved_by VARCHAR(36) NULL AFTER branch_head_remarks',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'payroll_head_approved_by');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN payroll_head_approved_at DATETIME NULL AFTER payroll_head_approved_by',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'payroll_head_approved_at');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN payroll_head_remarks TEXT NULL AFTER payroll_head_approved_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'payroll_head_remarks');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

-- Rejection is not a terminal status the UI has to special-case per stage: the stage
-- that refused, and why, live here. Mirrors payroll_cc_attendance_finalization's
-- last_rejected_* quartet, which the cost-centre sign-off chain already proved out.
SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN last_rejected_by VARCHAR(36) NULL AFTER payroll_head_remarks',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'last_rejected_by');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN last_rejected_at DATETIME NULL AFTER last_rejected_by',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'last_rejected_at');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN last_rejected_stage VARCHAR(30) NULL AFTER last_rejected_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'last_rejected_stage');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN last_rejected_reason TEXT NULL AFTER last_rejected_stage',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'last_rejected_reason');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------------------------------------------------------------------------
-- 2. upload_batch_row — single-line discard
-- ---------------------------------------------------------------------------
-- Either approver may drop ONE employee out of a batch without bouncing the whole
-- file. `row_status` becomes 'discarded'; these columns hold who, when, at which
-- stage and — mandatory — why.
--
-- The row itself is never deleted. `raw_data` already holds the uploaded line, so
-- the discarded row remains a complete record of what was proposed and refused, which
-- is what makes the creator's notification reconstructable months later.

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discarded_by VARCHAR(36) NULL AFTER error_messages',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND COLUMN_NAME = 'discarded_by');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discarded_at DATETIME NULL AFTER discarded_by',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND COLUMN_NAME = 'discarded_at');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discard_stage VARCHAR(30) NULL AFTER discarded_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND COLUMN_NAME = 'discard_stage');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discard_reason TEXT NULL AFTER discard_stage',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND COLUMN_NAME = 'discard_reason');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

-- The cost-centre and employee-wise views read rows for one batch and skip discarded
-- ones. Without this they are a full scan of upload_batch_row (6,632 rows today, but
-- it grows one row per uploaded spreadsheet line forever).
SET @c = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_ubr_batch_status ON upload_batch_row (upload_batch_id, row_status)',
  'SELECT 1') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND INDEX_NAME = 'idx_ubr_batch_status');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------------------------------------------------------------------------
-- 3. Access — the Payroll Head needs the approvals page
-- ---------------------------------------------------------------------------
-- BULK_UPLOAD_APPROVALS already exists (migration 1522) and already grants
-- branch_head, branch_admin, payroll_head and super_admin. What it lacks is the
-- creator side: a Branch WFM or Payroll HR who uploaded a batch currently has no way
-- to watch it move through the chain. Both get can_view only — no can_edit, because
-- the maker must never be able to press the approve button on their own upload.
--
-- These are added to rbacPageMatrix.ts in the same change; apply-rbac-page-matrix
-- deactivates any live grant missing from that matrix, so a row added only here would
-- be revoked on the next run of that script.

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'wfm', 'BULK_UPLOAD_APPROVALS', 1, 0, 0, 0, 1, 1
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access WHERE role_key = 'wfm' AND page_code = 'BULK_UPLOAD_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'payroll_hr', 'BULK_UPLOAD_APPROVALS', 1, 0, 0, 0, 1, 1
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access WHERE role_key = 'payroll_hr' AND page_code = 'BULK_UPLOAD_APPROVALS');

-- Payroll HR is named in the approved design as an uploader alongside Branch WFM.
-- They already hold BULK_UPLOAD with can_create = 1 (verified live 2026-09-03), so
-- nothing is inserted for that page here; the backend UPLOADER_ROLES list is what
-- actually gated them out, and that is fixed in bulk-approval.service.ts.

-- The page_catalog row from 1522 records page_path '/bulk-upload-approvals' while the
-- React route is '/bulk-upload/approvals'. Nothing reads page_path for routing — the
-- gate is by page_code — but the mismatch makes the catalogue misleading, so correct it.
UPDATE page_catalog
   SET page_path = '/bulk-upload/approvals'
 WHERE page_code = 'BULK_UPLOAD_APPROVALS'
   AND page_path = '/bulk-upload-approvals';
