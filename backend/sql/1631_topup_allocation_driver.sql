-- 1631_topup_allocation_driver.sql
--
-- Lets a budget top-up say HOW its money should be shared across cost centres, the same way a
-- budget line does.
--
-- A branch-level budget line carries an `allocation_driver` — headcount, seat count, floor area,
-- revenue share, equal split — and the split it implies is written to
-- finance_budget_line_allocation. A top-up had no equivalent:
--
--   * Topping up an EXISTING line raised its amount and left the split describing the old,
--     smaller amount, unless the requester hand-typed per-cost-centre figures. The same defect
--     already found on four other amount-changing paths and fixed by resyncLineAllocations.
--   * A top-up that creates a NEW head/sub-head inserted a line with planning_level = 'branch'
--     and NO allocation_driver at all — a shared cost that can never be divided by rule, only by
--     hand, forever.
--
-- One nullable column so the request can carry the choice from the form through review to the
-- moment it is applied. NULL keeps today's behaviour exactly: hand-entered splits are honoured as
-- the deliberate manual override they are (`is_manual_override = 1`), and nothing is recomputed.
--
-- ADDITIVE. One nullable column, no DROP, no DELETE, no backfill — the 8 existing top-up requests
-- were all raised without a driver, and NULL is the truthful record of that. Guarded on
-- information_schema because `ADD COLUMN IF NOT EXISTS` is not valid MySQL 8 and would record as
-- applied while having failed.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'finance_budget_topup_request'
      AND column_name = 'allocation_driver') = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN allocation_driver VARCHAR(64) NULL
       COMMENT ''How this top-up should be shared across cost centres, matching finance_budget_line.allocation_driver. NULL means the requester supplied explicit per-cost-centre splits instead.''
       AFTER unit_rate',
  'SELECT ''finance_budget_topup_request.allocation_driver already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1631_topup_allocation_driver.sql applied' AS migration_status;
