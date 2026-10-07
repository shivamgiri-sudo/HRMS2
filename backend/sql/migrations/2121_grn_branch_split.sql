-- 2121_grn_branch_split.sql
--
-- Head Office GRN split across branches (owner requirement 2026-10-07).
--
-- The Finance Head raises a vendor GRN at Head Office and splits its cost across branches. Each
-- branch's share lands on that branch's Back Office cost centre, draws that branch's own budget and
-- shows in that branch's P&L. Head Office keeps the vendor payable: grn_request.branch_id stays Head
-- Office, while each grn_cost_allocation row carries the branch that BEARS its cost in branch_id
-- (today every allocation row equals the GRN's branch, so existing rows need no change).
--
-- This adds only the marker the lists and reports need to find such a GRN. The allocation table
-- already has idx_grn_allocation_attribution (branch_id, cost_centre_id, process_id), which serves
-- the "GRNs with a share in my branch" lookups. DEFAULT 0 keeps every existing GRN as it was.
-- Additive and re-runnable.
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'grn_request' AND COLUMN_NAME = 'is_branch_split') = 0,
  'ALTER TABLE grn_request ADD COLUMN is_branch_split TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
