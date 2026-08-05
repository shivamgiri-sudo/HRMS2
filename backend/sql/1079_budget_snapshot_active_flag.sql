-- Mirror db_bill's `Active` flag onto the budget snapshot.
--
-- WHY
-- ---
-- finance_budget_snapshot already carries entry_status and approve_1..5_at, so a reader can tell
-- how far a budget got through approval. It carries no equivalent of expense_master.Active, and
-- that turns out to matter a great deal: of the 544 FY2026-27 budget rows mirrored on 2026-08-06,
-- only 177 are Active. The other 367 are inactive at source and utterly indistinguishable here.
--
-- Anything summing this table — Branch Budget, the P&L's budget-vs-actual, coverage — has been
-- counting all 544 as if they were live. The exclusion is not something a caller can currently
-- opt into, because the column simply is not present.
--
-- Discovered while investigating 12 rows the sync was dropping as "mis-filed". They were in fact
-- the most complete records in the table (all Active, all fully approved), which is what prompted
-- looking at Active across the whole set. See 1069 and 1070 for the rest of this mirror.
--
-- DELIBERATELY NOT CHANGING ANY READER
-- ------------------------------------
-- This only exposes the flag. Whether Branch Budget or the P&L should filter to Active rows is a
-- finance decision that changes reported numbers, and it is not one a migration should make
-- silently. Default NULL, so rows written before the next sync are honestly "unknown" rather than
-- being assumed active — assuming would recreate the exact problem this fixes.

ALTER TABLE finance_budget_snapshot
  ADD COLUMN active_status TINYINT(1) NULL DEFAULT NULL
    COMMENT 'db_bill expense_master.Active. NULL = not yet resynced, not "assumed active".'
    AFTER entry_status;

CREATE INDEX idx_fbs_active_period
  ON finance_budget_snapshot (active_status, period_code);
