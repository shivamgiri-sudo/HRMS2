-- 1758_grn_accounts_head_approval_stage.sql
-- Inserts a real Accounts Head approval gate into the GRN workflow.
--
-- THE PROBLEM THIS SOLVES
-- grn.routes.ts documented (and finance-workflow-role.ts enforced) a DELIBERATE 2-stage GRN
-- chain: Branch Head -> Finance Head. accounts_head's only authority was downstream, at the
-- PAYMENT step (vendor-payment.routes.ts, once a GRN reaches pending_accounts_payment). That
-- was a correct implementation of the workflow as it was specified at the time.
--
-- Owner ruling (2026-09-12): the real organisational chain is
--   Employee (branch_admin, who raises it) -> Branch/Dept Head -> Accounts Head/Team -> Finance
--   Head/CFO
-- i.e. Accounts Head now owns a genuine mid-chain APPROVAL stage, between Branch Head and
-- Finance Head, not only the post-approval payment run. This migration adds the status value
-- and review-actor columns that stage needs; finance-workflow-role.ts, grn.service.ts and
-- grn-smart.service.ts carry the actual gating logic.
--
-- Additive only: no existing status value is removed or renamed, so every row already sitting
-- in 'branch_head_approved' simply now waits on Accounts Head next instead of Finance Head —
-- which is the intended effect of turning the switch on, not a data migration.

ALTER TABLE grn_request
  MODIFY COLUMN status ENUM(
    'draft','submitted','branch_head_approved','accounts_head_approved','finance_head_approved',
    'pending_accounts_payment','payment_scheduled','partially_paid','paid',
    'approved','rejected','cancelled','consumption_reversed',
    'returned_to_branch_head','returned_to_raiser'
  ) NOT NULL DEFAULT 'draft';

-- Mirrors branch_head_reviewed_by/_at/_note and finance_head_reviewed_by/_at/_note
-- (411_branch_budget_grn_approval_flow.sql), guarded the same way so this migration is safe to
-- rerun and safe against a column already added by a prior partial run.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='accounts_head_reviewed_by')=0,
  'ALTER TABLE grn_request ADD COLUMN accounts_head_reviewed_by CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='accounts_head_reviewed_at')=0,
  'ALTER TABLE grn_request ADD COLUMN accounts_head_reviewed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='accounts_head_review_note')=0,
  'ALTER TABLE grn_request ADD COLUMN accounts_head_review_note TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1758_grn_accounts_head_approval_stage.sql applied' AS migration_status;
