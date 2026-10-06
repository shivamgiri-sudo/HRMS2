-- 2115_grn_allocation_budget_draw.sql
--
-- Where a Smart GRN allocation's reservation actually landed, when it landed on more than one line.
--
-- THE PROBLEM. At Branch Head approval, reserveAllocations() spreads an allocation whose saved line
-- is short across several lines of the same head/sub-head (allocateAcrossLines), then re-points the
-- allocation row at the largest draw only. consume / release / reverse / link-budget then moved the
-- row's FULL amount on that one line: a 100 reserved 60 on L1 + 40 on L2 consumed 100 from L1
-- (taking 40 of another GRN's reservation) and left 40 reserved on L2 for ever.
--
-- One row per draw; absent rows mean the allocation sits wholly on its own budget_line_id, which is
-- every allocation that never spread. No foreign keys: the referenced tables carry drifted
-- collations on some environments, and these rows are written and deleted only alongside the
-- allocation's own budget movement, inside the same transaction. CREATE TABLE IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS grn_allocation_budget_draw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  allocation_id CHAR(36) NOT NULL,
  grn_request_id CHAR(36) NOT NULL,
  budget_line_id CHAR(36) NOT NULL,
  amount_with_tax DECIMAL(18,2) NOT NULL,
  amount_without_tax DECIMAL(18,2) NULL,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_grn_draw_allocation (allocation_id),
  INDEX idx_grn_draw_grn (grn_request_id),
  INDEX idx_grn_draw_line (budget_line_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
