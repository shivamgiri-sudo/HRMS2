-- 1062_grn_consumption_reversal.sql
-- Adds a 'consumption_reversed' terminal status for GRNs whose Finance Head approval
-- (and resulting budget consumption) needs correcting after the fact.
--
-- Why this exists: once a GRN reaches a post-finance_head-approval status, budget-consumption
-- .consume() has already moved its amount from reserved into consumed on the budget line, and
-- the GRN state machine has no path back — cancelGrn explicitly refuses once status reaches
-- finance_head_approved or later (grn.service.ts). If that approval turns out to be wrong,
-- today's only fix is a manual DB edit. This migration only widens the status enum; the
-- reversal logic itself lives in budget-consumption.service.ts (reverseConsumption) and
-- grn.service.ts (reverseConsumption), gated to finance_head/super_admin with a required reason.

ALTER TABLE grn_request
  MODIFY COLUMN status ENUM(
    'draft','submitted','branch_head_approved','finance_head_approved',
    'pending_accounts_payment','payment_scheduled','partially_paid','paid',
    'approved','rejected','cancelled','consumption_reversed'
  ) NOT NULL DEFAULT 'draft';

-- Smart (split-allocation) GRNs track consumption per allocation row rather than on the GRN
-- header; widen the same way so reverseConsumedAllocations() has a lifecycle state to land on.
ALTER TABLE grn_cost_allocation
  MODIFY COLUMN lifecycle_status ENUM('draft','reserved','consumed','released','reversed') NOT NULL DEFAULT 'draft';

SELECT '1062_grn_consumption_reversal.sql applied' AS migration_status;
