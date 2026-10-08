-- 1962_budget_topup_cancel.sql
--
-- WHY
-- ---
-- A top-up request had exactly two ways out once raised: approved-and-applied, or rejected by a
-- reviewer. The person who raised it could neither withdraw it nor correct its amount — and the
-- maker-checker rule in budgetTopupService.review() refuses the raiser's own Reject, so a request
-- raised against the wrong line or for the wrong figure sat in the Branch Head's queue until
-- someone else refused it.
--
-- WHAT CHANGES
-- ------------
--  - status gains 'cancelled': the raiser withdrew the request before it was applied. Distinct
--    from 'rejected', which is a reviewer's decision and carries a reviewer's reason.
--  - cancelled_by / cancelled_at / cancellation_reason record who withdrew it, when and why.
--
-- Editing the amount (allowed only while status = 'submitted') needs no schema: it rewrites
-- requested_amount / requested_quantity in place and leaves its trail in finance_approval_event.
--
-- ADDITIVE. The ENUM is widened, never narrowed, so every existing row keeps its value; three
-- nullable columns, no DROP, no DELETE, no backfill. Guarded on information_schema because
-- `ADD COLUMN IF NOT EXISTS` is not valid MySQL 8 — same pattern as 1631.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'finance_budget_topup_request'
      AND column_name = 'status'
      AND column_type NOT LIKE '%cancelled%') = 1,
  'ALTER TABLE finance_budget_topup_request
     MODIFY COLUMN status ENUM(
       ''submitted'',''branch_head_approved'',''finance_head_approved'',''rejected'',''applied'',''cancelled''
     ) NOT NULL DEFAULT ''submitted''',
  'SELECT ''finance_budget_topup_request.status already allows cancelled'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'finance_budget_topup_request'
      AND column_name = 'cancelled_at') = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN cancelled_by CHAR(36) NULL AFTER rejection_reason,
     ADD COLUMN cancelled_at DATETIME NULL AFTER cancelled_by,
     ADD COLUMN cancellation_reason TEXT NULL AFTER cancelled_at',
  'SELECT ''finance_budget_topup_request.cancelled_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1962_budget_topup_cancel.sql applied' AS migration_status;
