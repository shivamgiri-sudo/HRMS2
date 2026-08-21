-- 1531_capex_pnl_treatment_fix.sql
-- Sets pnl_treatment = 'excluded' on every expense sub-head that is tagged as CAPEX
-- (capex_opex = 'capex') but whose treatment has not yet been corrected.
--
-- CAPEX items are balance-sheet additions (fixed assets, leasehold improvements, major
-- equipment), not period-expense items. Including them as 'operating_expense' or 'direct_cost'
-- would overstate the cost for any P&L period in which they were purchased. Finance Head
-- confirmed all CAPEX lines must be excluded from the P&L revenue-cost model.
--
-- Idempotent — only touches rows where pnl_treatment is not already 'excluded'.
-- Purely a data UPDATE; no schema change.

UPDATE finance_expense_sub_head_master
SET    pnl_treatment = 'excluded',
       updated_at    = NOW()
WHERE  capex_opex    = 'capex'
  AND  pnl_treatment <> 'excluded';

SELECT CONCAT(ROW_COUNT(), ' sub-head(s) corrected to excluded P&L treatment') AS migration_status;

-- Rollback: not recommended — CAPEX items should not be on P&L.
