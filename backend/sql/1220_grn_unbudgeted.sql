-- Migration 1220: Unbudgeted GRN flag
-- Allows raiser to select any expense head (not just budgeted ones)
-- Finance Head can later link the allocation to a budget line

ALTER TABLE grn_request
  ADD COLUMN is_unbudgeted TINYINT(1) NOT NULL DEFAULT 0 AFTER is_late_invoice;

ALTER TABLE grn_cost_allocation
  ADD COLUMN is_unbudgeted TINYINT(1) NOT NULL DEFAULT 0 AFTER sequence_no;

CREATE INDEX idx_grn_request_unbudgeted     ON grn_request(is_unbudgeted);
CREATE INDEX idx_grn_cost_alloc_unbudgeted  ON grn_cost_allocation(is_unbudgeted);
