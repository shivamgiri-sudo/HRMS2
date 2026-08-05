-- Close three money paths the mirror never carried. Every figure below was measured against
-- live db_bill on 2026-08-06, not assumed.
--
-- 1. CREDIT NOTES — revenue was overstated
--    tbl_credit_note holds 17 approved notes worth Rs 53.91 lakh net for FY2026-27, issued
--    against invoices. Revenue summed tbl_invoice and never subtracted them.
--
--    CORRECTED 2026-08-06 after measuring the mirror end to end. Only Rs 19.19 lakh of that
--    Rs 53.91 lakh lands in FY2026-27: the other 4 notes (Rs 34.72 lakh) name service months
--    Jan/Feb/Mar-26 and so net into the PRIOR year's periods, which is correct — they are filed
--    under finance_year 2026-27 because that is when the credit was raised, not what it covers.
--    Netted by service month against the mirror, gross -> net:
--      Apr-26  355.37 -> 342.62   (credit 12.75)
--      May-26  325.89 -> 320.59   (credit  5.30)
--      Jun-26  372.07 -> 371.43   (credit  0.64)
--      Jul-26  174.07 -> 173.57   (credit  0.50)
--    All 17 notes join cost_centre_master, so none are silently dropped from attribution.
--    Verified: total+igst+sgst+cgst = grnd on 17 of 17, exactly as tbl_invoice behaves, so
--    `total` is net of GST and directly comparable. credit_approve and status agree on all 17,
--    so there is no Reject-style flag trap here.
--    NOT keyed to an invoice: proforma_bill_no matched 0 of 17 against tbl_invoice.bill_no, so
--    netting is done at period + cost centre, never per invoice.
--
-- 2. REJECTED BUDGETS — Active does not capture rejection
--    Of the 18 FY2026-27 budgets carrying a reject with a RejectDate, 7 are still Active = 1,
--    worth Rs 3.97 lakh. Filtering on active_status alone leaves them counted as approved.
--
-- 3. REOPENS — budget was UNDERSTATED
--    expense_reopen_master.AdditionalAmount is a sanctioned top-up. 107 approved reopens add
--    Rs 43.54 lakh across 87 budgets we already mirror, and none of it was carried.
--
--    CORRECTED 2026-08-06, measured against the finished mirror rather than the source estimate
--    above. The chain for FY2026-27, each step verified:
--      544 rows / Rs 456.03 L   all budget rows
--      177 rows / Rs 130.00 L   active_status = 1
--      170 rows / Rs 126.03 L   and is_rejected = 0        (the 7 rejected-but-Active rows drop)
--       77 rows / Rs  42.11 L   approved reopen top-ups on those survivors
--    => TRUE SANCTIONED FY2026-27 BUDGET = 126.03 + 42.11 = Rs 168.14 lakh, not Rs 130.00.
--    (The 169.57 figure first written here mixed source-side totals with mirror-side filters;
--     43.54 counted top-ups on budgets that the is_rejected filter then removed.)
--
-- DELIBERATELY NOT ADDED: deleted GRN entries. expense_entry_master_delete has 8 rows for the FY
-- (Rs 2.26 lakh) but 0 of them still exist in expense_entry_master — the source deletes properly,
-- so an exclusion here would be dead code guarding a case that cannot occur.

CREATE TABLE IF NOT EXISTS billing_credit_note_snapshot (
  bill_source_id        INT           NOT NULL,
  credit_no             VARCHAR(60)   NULL,
  proforma_bill_no      VARCHAR(60)   NULL COMMENT 'Free-text reference; does NOT join to tbl_invoice.bill_no.',
  category              VARCHAR(120)  NULL,
  branch_name           VARCHAR(160)  NULL,
  cost_centre_code      VARCHAR(120)  NULL,
  finance_year          VARCHAR(12)   NULL,
  month_label           VARCHAR(12)   NULL COMMENT "db_bill dialect, e.g. 'Jul-26'.",
  period_code           CHAR(7)       NULL,
  credit_date           DATE          NULL,
  description           TEXT          NULL,
  total_amt             DECIMAL(18,2) NULL COMMENT 'Net of GST. Subtract from invoice total_amt.',
  tax_amt               DECIMAL(18,2) NULL,
  igst                  DECIMAL(18,2) NULL,
  sgst                  DECIMAL(18,2) NULL,
  cgst                  DECIMAL(18,2) NULL,
  grand_total           DECIMAL(18,2) NULL,
  is_approved           TINYINT(1)    NULL COMMENT 'credit_approve. Only approved notes reduce revenue.',
  approved_at           DATETIME      NULL,
  status                VARCHAR(20)   NULL,
  source_created_at     DATETIME      NULL,
  synced_at             DATETIME      NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_bcn_period (period_code, is_approved),
  KEY idx_bcn_cc (cost_centre_code, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE finance_budget_snapshot
  ADD COLUMN is_rejected TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'expense_master_reject carries a RejectDate. Independent of active_status: 7 of the 18 rejected FY2026-27 budgets are still Active=1.'
    AFTER active_status,
  ADD COLUMN reopen_additional_amount DECIMAL(18,2) NOT NULL DEFAULT 0
    COMMENT 'Sum of APPROVED expense_reopen_master.AdditionalAmount — sanctioned budget top-ups. Add to amount for the true sanctioned figure.'
    AFTER amount;

CREATE INDEX idx_fbs_rejected ON finance_budget_snapshot (is_rejected, active_status);
