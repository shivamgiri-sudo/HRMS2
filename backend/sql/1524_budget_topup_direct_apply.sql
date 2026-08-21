-- 1524_budget_topup_direct_apply.sql
--
-- WHY
-- ---
-- Owner decision, 2026-08-21: Finance Head (and Super Admin) may increase an active budget
-- line's amount directly, without the normal 2-stage branch_head -> finance_head top-up
-- request/review flow. This is implemented as budgetTopupService.directApply() inserting a
-- finance_budget_topup_request row that is ALREADY at status='applied' (both review columns
-- pre-filled to the acting Finance Head, applied_at=NOW()) rather than a bespoke code path — so
-- a direct top-up shows up for free in the existing top-up history/queue UI, list()/get(), and
-- audit plumbing (finance_budget_approval_log + finance_approval_event), with no new UI needed
-- for history.
--
-- WHAT CHANGES
-- ------------
-- Adds finance_budget_topup_request.is_direct TINYINT(1) NOT NULL DEFAULT 0 so a
-- Finance-Head-initiated direct increase is visibly distinct, in the data itself, from a
-- bottom-up branch_head-raised request that happened to be approved quickly — both end at
-- status='applied' and are otherwise indistinguishable without this flag. Every existing row
-- defaults to 0 (not direct), which is correct: no direct-apply path existed before this change.
--
-- Purely additive, single nullable-safe column with a DEFAULT — no existing row's meaning
-- changes. Re-runnable: information_schema-guarded, so a second execution is a no-op. Migrations
-- run at boot here (pm2 restart applies the manifest), so a non-idempotent ADD COLUMN would be a
-- liability (MySQL 8 raises a duplicate-column error on a second run without this guard).

SET @schema := DATABASE();

SET @needs_is_direct := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'finance_budget_topup_request'
     AND COLUMN_NAME = 'is_direct'
);
SET @sql := IF(
  @needs_is_direct = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN is_direct TINYINT(1) NOT NULL DEFAULT 0 AFTER reason',
  'SELECT "finance_budget_topup_request.is_direct already exists" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
