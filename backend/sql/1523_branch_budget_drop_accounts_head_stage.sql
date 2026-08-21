-- 1523_branch_budget_drop_accounts_head_stage.sql
--
-- WHY
-- ---
-- Owner decision, 2026-08-21: Account Head approval is not required to create/activate a branch
-- budget. branch-budget.service.ts's REVIEW_STAGES was changed in the same release to a 2-stage
-- chain (Branch Head, then Finance Head as the terminal approver straight to 'active') — the
-- 'accounts_head_approved' status is no longer ever written by the application. This migration
-- only advances data that is already stuck under the old 3-stage rule; it does not touch
-- application logic (that lives in branch-budget.service.ts / budget-coverage.routes.ts).
--
-- accounts_head remains a valid ROLE everywhere else in the app (GRN reversal, budget
-- transfer/virement, P&L signoff chain, expense-master access) — only this one header approval
-- stage was removed. finance_budget_header.status keeps 'accounts_head_approved' in its ENUM
-- definition for historical rows/log text; no ALTER is needed since nothing writes it again.
--
-- WHAT CHANGES
-- ------------
-- Exactly one live row is affected (verified 2026-08-21): budget id
-- 404c4f60-eecf-458f-8797-6df75eff3560 (branch fea9fdc3-6583-11f1-adb1-00155d0ab410, period
-- 2026-08), sitting at status='finance_head_approved' with finance_head_approved_by/at already
-- set and accounts_head_approved_by/at NULL.
--
-- 1. Advance any such row straight to 'active', crediting the Finance Head's own actor/timestamp
--    into accounts_head_approved_by/at (the least-fabricated choice — no synthetic "system" user
--    id is invented, and no approval is back-dated to before it actually happened).
-- 2. Write one matching finance_budget_approval_log row per advanced budget, so the jump from
--    finance_head_approved to active is visible in the same audit trail as every other budget
--    action, using the existing terse action-name convention (SUBMIT, APPROVE, TRANSFER_APPROVE).
--    Guarded so re-running this file is a no-op even if it is executed more than once.
--
-- Deliberately skipped: no finance_approval_event row. branch-budget.service.ts's own review()
-- has never written to finance_approval_event (only budget-topup.service.ts does, for top-ups) —
-- matching that existing pattern keeps this migration's blast radius minimal.

UPDATE finance_budget_header
   SET status = 'active',
       accounts_head_approved_by = finance_head_approved_by,
       accounts_head_approved_at = finance_head_approved_at
 WHERE status = 'finance_head_approved';

INSERT INTO finance_budget_approval_log
  (id, budget_id, action, from_status, to_status, actor_user_id, actor_role, remarks)
SELECT
  UUID(),
  h.id,
  'SYSTEM_ADVANCE',
  'finance_head_approved',
  'active',
  h.finance_head_approved_by,
  'system_migration',
  'Accounts Head approval stage removed from the branch-budget workflow (owner decision, 2026-08-21) — auto-advanced by migration 1523.'
FROM finance_budget_header h
WHERE h.accounts_head_approved_by = h.finance_head_approved_by
  AND h.accounts_head_approved_at = h.finance_head_approved_at
  AND h.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM finance_budget_approval_log l
     WHERE l.budget_id = h.id AND l.action = 'SYSTEM_ADVANCE'
  );
