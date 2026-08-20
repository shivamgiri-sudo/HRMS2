-- 1512_grn_unbudgeted_allocation_nullable.sql
--
-- Makes grn_cost_allocation.budget_id / budget_line_id NULLABLE so an UNBUDGETED vendor GRN can
-- actually be saved.
--
-- Why this was needed: the unbudgeted path was half-built and had never once executed.
-- grn-smart.service.ts saveInvoiceComponents() already builds synthetic line objects with
-- `id: null, budget_id: null` when input.isUnbudgeted is true, and then INSERTs them straight
-- into grn_cost_allocation(budget_id, budget_line_id, ...). Both columns are NOT NULL on
-- production, so that INSERT could only ever have died with ER_BAD_NULL_ERROR (1048). Verified
-- live 2026-08-20: 0 of 84,782 grn_request rows carry is_unbudgeted = 1 and 0 of 38
-- grn_cost_allocation rows carry a NULL budget line -- the feature has produced no data at all,
-- so there is nothing to backfill and no historical row whose meaning changes.
--
-- Relaxing NOT NULL is additive: every existing row already holds a real value, and the two
-- foreign keys (fk_grn_allocation_budget -> finance_budget_header, fk_grn_allocation_budget_line
-- -> finance_budget_line) keep enforcing referential integrity for every non-NULL value, which is
-- exactly the InnoDB semantic we want -- an unbudgeted split points at no budget line until
-- Finance Head links one during approval, and any value it does hold must still be a real line.
-- The FKs do NOT need dropping and recreating: MODIFY COLUMN of the nullability alone leaves them
-- intact.
--
-- Column type, collation and default are restated byte-identically to the live definition
-- (char(36), utf8mb4_unicode_ci, no default) so the only declared change is NULL-ability.
--
-- Re-runnable: guarded on information_schema, so a second execution is a no-op rather than a
-- redundant table rebuild. Migrations run at boot here (pm2 restart applies the manifest), so a
-- non-idempotent form would be a liability.

SET @schema := DATABASE();

SET @needs_budget_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'grn_cost_allocation'
     AND COLUMN_NAME = 'budget_id'
     AND IS_NULLABLE = 'NO'
);
SET @sql := IF(
  @needs_budget_id > 0,
  'ALTER TABLE grn_cost_allocation
     MODIFY COLUMN budget_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
  'SELECT "grn_cost_allocation.budget_id already nullable" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @needs_budget_line_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'grn_cost_allocation'
     AND COLUMN_NAME = 'budget_line_id'
     AND IS_NULLABLE = 'NO'
);
SET @sql := IF(
  @needs_budget_line_id > 0,
  'ALTER TABLE grn_cost_allocation
     MODIFY COLUMN budget_line_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
  'SELECT "grn_cost_allocation.budget_line_id already nullable" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
