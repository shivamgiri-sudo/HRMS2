-- 1630_grn_funding_cost_centre.sql
--
-- Separates WHO INCURRED a cost from WHAT FUNDED it on a GRN cost allocation.
--
-- Until now `grn_cost_allocation.cost_centre_id` carried whichever of the two the code path
-- happened to produce:
--   * an UNBUDGETED row stored the raiser's own cost centre (correct);
--   * a BUDGETED row stored the BUDGET LINE's cost centre and silently discarded the one the
--     raiser sent (wrong — it attributed the spend to whoever owned the budget).
--
-- Since the branch-wide headroom gate of 2026-08-22 a row is funded from any line in the branch
-- sharing its head+sub-head, so the two are routinely different by design: cost centre A with no
-- line of its own is legitimately funded by cost centre B's line. With one column there was
-- nowhere to record that, and `is_unbudgeted` was pressed into service as a proxy — which is why
-- fully-funded spend was being reported as off-budget.
--
-- After this migration:
--   cost_centre_id          WHO incurred the spend. Always the raiser's cost centre.
--   funding_cost_centre_id  WHOSE BUDGET paid. The funding line's own cost centre; NULL when the
--                           funding line is a branch-common (pooled) line, and NULL when there is
--                           no funding line at all.
--   is_unbudgeted           1 only when NO budget line funded the row (budget_line_id IS NULL).
--
-- Three questions then have exact answers that previously had none:
--   spend with no budget behind it        -> budget_line_id IS NULL
--   spend funded by another cost centre   -> funding_cost_centre_id <> cost_centre_id
--   spend funded from the branch pool     -> budget_line_id IS NOT NULL
--                                            AND funding_cost_centre_id IS NULL
--
-- ADDITIVE AND REVERSIBLE. One nullable column, no DROP, no DELETE, no data rewrite. Guarded on
-- information_schema because `ADD COLUMN IF NOT EXISTS` is not valid MySQL 8 syntax and would
-- record as applied while having failed.
--
-- BACKFILL: deliberately none. Every row written before this deploy stored the funding line's
-- cost centre in `cost_centre_id`, so for those rows the two columns would be identical by
-- construction and a backfill would assert something the old code never actually recorded.
-- NULL on a historic row means "not captured", which is true. New rows populate it from the
-- moment this ships.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND column_name = 'funding_cost_centre_id') = 0,
  'ALTER TABLE grn_cost_allocation
     ADD COLUMN funding_cost_centre_id CHAR(36) NULL
       COMMENT ''Cost centre of the budget line that funded this row. NULL for a pooled line or no line. cost_centre_id remains WHO incurred the spend.''
       AFTER cost_centre_id',
  'SELECT ''grn_cost_allocation.funding_cost_centre_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Reporting reads this as "which cost centres are spending on heads they hold no budget for",
-- which is a scan of every allocation row without it.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND index_name = 'idx_grn_alloc_funding_cc') = 0,
  'ALTER TABLE grn_cost_allocation
     ADD INDEX idx_grn_alloc_funding_cc (funding_cost_centre_id, cost_centre_id)',
  'SELECT ''idx_grn_alloc_funding_cc already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1630_grn_funding_cost_centre.sql applied' AS migration_status;
