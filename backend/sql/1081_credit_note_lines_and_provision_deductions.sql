-- Two live db_bill tables the completeness check surfaced on 2026-08-06. Both measured against
-- live db_bill before writing this file; neither figure below is inferred from a table name.
--
-- 1. credit_particulars — THE LINE DETAIL OF THE CREDIT NOTES WE ALREADY MIRROR
--    Migration 1080 recorded 'tbl_credit_note_particulars' as "no such table today". That was
--    wrong: the line table exists, it is simply named credit_particulars, and it is live
--    (newest row 2026-07-16). The name was assumed from the header table's name rather than
--    looked up, which is exactly the mistake the completeness check exists to catch.
--
--    It reconciles to the header exactly: 17 rows for fin_year 2026-27 summing Rs 53.91 lakh,
--    against 17 headers summing Rs 53.91 lakh, and all 17 join tbl_credit_note.id through
--    credit_particulars.initial_id. One line per note today, so no fan-out.
--
--    Mirroring it changes NO existing P&L number — the header already carries cost_centre_code
--    and the netting in getInvoicedRevenueActuals is unaffected. What it adds is the same grain
--    the revenue side already has (inv_particulars): per-line particulars, rate, qty and
--    sub_category, so a credit can be attributed and explained the way an invoice line can.
--
-- 2. provision_master_month_deductions — PROVISION DRAWDOWN, LIVE YESTERDAY
--    10,482 rows, newest created_at 2026-08-05. For FY2026-27: 385 rows carrying
--    Rs 1,292.80 lakh of ProvisionBalanceUsed, against the Rs 17,163.40 lakh of provision_master
--    we already mirror. deduction_status is 1 on 10,372 rows and 0 on 110.
--
--    MIRRORED FOR FIDELITY, DELIBERATELY NOT WIRED INTO P&L COST YET. provision_master is the
--    provision raised (the accrued cost, already counted). This table records the provision
--    balance CONSUMED when an invoice lands. Adding it to cost without settling that relationship
--    would very plausibly double-count Rs 1,292.80 lakh — a bigger error than the one it fixes.
--    The snapshot exists so the question can be answered from mas_hrms against real rows; the
--    reader change is a separate, deliberate decision that needs finance sign-off on whether
--    P&L cost is the provision raised, the provision consumed, or the greater of the two.

CREATE TABLE IF NOT EXISTS billing_credit_note_line_snapshot (
  bill_source_id        INT           NOT NULL COMMENT 'credit_particulars.id',
  credit_note_source_id INT           NULL     COMMENT 'credit_particulars.initial_id -> tbl_credit_note.id. Joined 17/17.',
  cost_centre_source_id INT           NULL,
  cost_centre_code      VARCHAR(120)  NULL,
  branch_name           VARCHAR(160)  NULL,
  finance_year          VARCHAR(12)   NULL,
  month_label           VARCHAR(12)   NULL COMMENT "db_bill dialect, e.g. 'Jul'.",
  period_code           CHAR(7)       NULL,
  particulars           TEXT          NULL,
  sub_category          VARCHAR(160)  NULL,
  rate                  DECIMAL(18,2) NULL,
  qty                   DECIMAL(18,2) NULL,
  amount                DECIMAL(18,2) NULL COMMENT 'Net of GST, like the header total_amt.',
  raised_by             VARCHAR(160)  NULL COMMENT 'credit_particulars.username',
  source_created_at     DATETIME      NULL,
  synced_at             DATETIME      NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_bcnl_note (credit_note_source_id),
  KEY idx_bcnl_period (period_code),
  KEY idx_bcnl_cc (cost_centre_code, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_provision_deduction_snapshot (
  bill_source_id        INT           NOT NULL COMMENT 'provision_master_month_deductions.ProvisionMonthId',
  provision_source_id   INT           NULL     COMMENT '-> provision_master.Id, already mirrored',
  finance_year          VARCHAR(12)   NULL,
  finance_month         VARCHAR(12)   NULL,
  used_by_month         VARCHAR(12)   NULL COMMENT 'Provision_UsedBy_Month — the month that consumed the balance.',
  period_code           CHAR(7)       NULL COMMENT 'Derived from finance_year + finance_month, the month the provision belongs to.',
  branch_name           VARCHAR(160)  NULL,
  cost_centre_code      VARCHAR(120)  NULL,
  balance_used          DECIMAL(18,2) NULL COMMENT 'ProvisionBalanceUsed. NOT yet treated as P&L cost — see file header.',
  invoice_source_id     INT           NULL,
  deduction_status      TINYINT(1)    NULL,
  source_created_at     DATETIME      NULL,
  synced_at             DATETIME      NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_bpd_provision (provision_source_id),
  KEY idx_bpd_period (period_code, deduction_status),
  KEY idx_bpd_cc (cost_centre_code, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
