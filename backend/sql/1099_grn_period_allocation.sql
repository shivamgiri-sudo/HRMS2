-- 1099_grn_period_allocation.sql
-- Multi-month expense recognition (Requirement 5).
--
-- An annual policy of Rs 12,00,000 covering Apr-2026 to Mar-2027 must not land entirely in
-- April. The cost belongs to all twelve months, because that is when the cover is consumed.
--
-- WHY A CHILD OF grn_cost_allocation, NOT OF grn_request
-- Hanging the period split off the GRN header would lose which cost centre owns each month:
-- a 3-cost-centre invoice split across 12 months is 36 facts, not 12. As a child of the
-- allocation, cost-centre, process and LOB attribution survive the split for free.
--
-- WHY NOT JUST WRITE 12 grn_cost_allocation ROWS WITH DIFFERENT recognition_period
-- Those rows ARE the budget-consumption rows: reserveAllocations and consumeAllocations
-- iterate every one and call budgetConsumptionService. Twelve monthly rows would be twelve
-- consumption events. Under the agreed rule — consume the invoice month only — eleven would
-- have to be skipped, which means teaching the consume loop not to consume. That is the exact
-- overload that produced the legacy/smart split. allocation_percentage is also force-normalised
-- to 100.000000, which 3 cost centres x 12 months quietly breaks.
--
-- WHAT IS SPLIT: pnl_cost_amount, NOT amount_with_tax.
-- Recoverable GST is not an expense and must not be spread across months. amount_with_tax
-- stays whole on the header and is what createFromGrn reads for due_amount — which is
-- precisely why one invoice still produces exactly one vendor_payment_tracking row. The
-- UNIQUE (grn_request_id) on that table already guarantees it; nothing here can reach it.
--
-- THE FINANCIAL-YEAR RULE (user ruling, 2026-08-07)
-- The whole recognition amount is spread across the months of the GRN's OWN financial year
-- only. A policy running Jul-26 to Jun-27 has nine eligible months (Jul..Mar), and the full
-- amount is divided by nine. Nothing is carried into the next FY and nothing is left
-- unallocated, so sum(period allocations) == pnl_cost_amount exactly. The accepted consequence
-- is that cost is recognised faster than the service is consumed for any policy not starting
-- in April: conservative, never later.
--
-- Additive only, safe to rerun.

CREATE TABLE IF NOT EXISTS grn_period_allocation (
  id CHAR(36) NOT NULL,
  cost_allocation_id CHAR(36) NOT NULL,
  -- Denormalised so the P&L view can join without going through the allocation table.
  grn_request_id CHAR(36) NOT NULL,
  sequence_no INT NOT NULL,
  period_code CHAR(7) NOT NULL COMMENT 'YYYY-MM the expense is recognised in',
  recognition_amount DECIMAL(18,2) NOT NULL,
  pnl_bucket VARCHAR(60) NULL,
  split_method ENUM('equal','by_days','manual') NOT NULL DEFAULT 'equal',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grn_period_sequence (cost_allocation_id, sequence_no),
  -- One row per period per allocation. Two rows for the same month would double-count in the
  -- P&L while still summing to the invoice total, which is the hardest kind of error to see.
  UNIQUE KEY uq_grn_period_month (cost_allocation_id, period_code),
  INDEX idx_grn_period_lookup (period_code, grn_request_id),
  INDEX idx_grn_period_request (grn_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FK only when the collations match, for the reason set out in 1088: a mismatch throws errno
-- 3780, and with MIGRATION_STOP_ON_FAILURE true and migrations running at boot that would
-- block every later migration and leave /api/health at 503.
SET @child = (SELECT COLLATION_NAME FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'grn_period_allocation' AND column_name = 'cost_allocation_id');
SET @parent = (SELECT COLLATION_NAME FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'grn_cost_allocation' AND column_name = 'id');
SET @sql = IF(
  @child IS NOT NULL AND @parent IS NOT NULL AND @child = @parent
    AND (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE table_schema = DATABASE() AND table_name = 'grn_period_allocation'
            AND constraint_name = 'fk_grn_period_allocation') = 0,
  'ALTER TABLE grn_period_allocation
     ADD CONSTRAINT fk_grn_period_allocation
     FOREIGN KEY (cost_allocation_id) REFERENCES grn_cost_allocation(id)
     ON DELETE CASCADE ON UPDATE RESTRICT',
  'SELECT ''fk_grn_period_allocation skipped or already present'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The recognition window on the header. recognition_start_period is what widens the
-- bill_date-vs-period_code equality check in grn-smart.service.ts: an annual policy dated
-- 25-Mar-2026 that recognises from Apr-2026 is rejected outright today, and that check is the
-- real blocker for multi-month, more than any table.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'grn_request'
      AND column_name = 'recognition_start_period') = 0,
  'ALTER TABLE grn_request
     ADD COLUMN recognition_start_period CHAR(7) NULL
       COMMENT ''First month the expense is recognised in; NULL means use bill_date'',
     ADD COLUMN recognition_end_period CHAR(7) NULL
       COMMENT ''Last month, before FY clamping'',
     ADD COLUMN period_allocation_mode ENUM(''single'',''deferred'') NOT NULL DEFAULT ''single''',
  'SELECT ''grn_request recognition columns already exist'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1099_grn_period_allocation.sql applied' AS migration_status;
