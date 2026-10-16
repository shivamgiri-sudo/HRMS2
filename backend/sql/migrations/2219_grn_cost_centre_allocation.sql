-- Migration 2219: GRN Cost Centre Allocation
-- Registered 2026-10-16. Additive: new table grn_cost_centre_allocation maps each
-- db_bill expense_entry_particular row (cost-center split of a GRN) to an HRMS
-- cost_centre_master record. One row per (bill_source_id, cost_centre_id) pair.
-- Filled by scripts/sync-grn-cost-centre.mjs.  Revert: DROP TABLE.

CREATE TABLE IF NOT EXISTS grn_cost_centre_allocation (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()),
  bill_source_id  INT            NOT NULL,           -- expense_entry_master.Id in db_bill
  grn_snapshot_id CHAR(36)       NULL,               -- FK to grn_entry_snapshot.id (nullable)
  cost_centre_id  CHAR(36)       NOT NULL,           -- FK to cost_centre_master.id
  dbbill_cc_id    INT            NOT NULL,           -- db_bill cost_master.id
  amount          DECIMAL(12,2)  NOT NULL,           -- allocated amount in rupees
  period_code     VARCHAR(7)     NOT NULL,           -- 'YYYY-MM' e.g. '2026-06'
  branch_name     VARCHAR(100)   NOT NULL,
  finance_year    VARCHAR(10)    NOT NULL,
  finance_month   VARCHAR(10)    NOT NULL,
  synced_at       DATETIME       NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bill_cc (bill_source_id, cost_centre_id),
  KEY idx_period (period_code),
  KEY idx_cost_centre (cost_centre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
