-- Mirror db_bill's budget, GRN, invoice line items and expense masters into mas_hrms.
--
-- WHY
-- ---
-- The live finance system is db_bill. mas_hrms already mirrors invoices, clients,
-- provisions and salary from it, but three things that the P&L needs are not mirrored at
-- all, so nobody working in mas_hrms can see them:
--
--   budget          db_bill.expense_master        18,433 rows   mas_hrms had 97 own rows
--   GRN / expense   db_bill.expense_entry_master  85,463 rows   mas_hrms had 3, 0 allocations
--   invoice lines   db_bill.inv_particulars       21,055 rows   not mirrored at all
--
-- The invoice line items matter most: they carry the COST-CENTRE-WISE SEAT RATE
-- (rate x qty per cost centre per month) that the P&L needs and that nothing in mas_hrms
-- could previously answer.
--
-- EVERY COLUMN WAS VALIDATED AT SOURCE BEFORE THIS WAS WRITTEN. What that found:
--
-- 1. AMOUNTS ARE NOT INTEGERS. expense_entry_master.Amount has decimals on 6,500 rows,
--    from Rs 2.15 to Rs 33,17,122.54, and inv_particulars.qty has decimals on 91 of 540
--    recent rows (part-month seats). The existing invoice sync uses safeInt() because
--    tbl_invoice genuinely holds whole rupees; reusing it here would silently truncate
--    paise. Every amount below is DECIMAL(18,2).
--
-- 2. `Reject` IS NOT A REJECTION FLAG. expense_entry_master.Reject = 1 on 85,255 of
--    85,463 rows, but only 1,894 of those carry a RejectDate and 80,074 carry an
--    ApprovalDate. Copying it as a boolean would mark 99.8% of GRNs rejected and make
--    every cost figure downstream wrong. The honest signal is RejectDate IS NOT NULL
--    (2,099 rows across both Reject=1 and Reject=4). Both the raw flag and the derived
--    truth are stored, and the derived one is what code should read.
--
-- 3. MONTH LABELS DISAGREE BETWEEN SOURCE TABLES. tbl_invoice.month is 'Jun-26';
--    inv_particulars.month_for is 'Jun'; expense_master/expense_entry_master use a
--    separate FinanceYear + FinanceMonth ('2026-27', 'Jun'). period_code is derived once,
--    on the way in, so consumers never have to guess which dialect a row speaks.
--
-- 4. `rate` IS NOT ALWAYS A PER-SEAT RATE. BSS/OB/NOIDA-DD/993 billed Rs 38,000 x 2 seats
--    in June and Rs 76,000 x 1 in July — same invoice value, different split. So a seat
--    rate may only be inferred where qty is a real seat count. is_seat_line marks the
--    lines whose service says so; everything else must not be read as a seat rate.
--
-- 5. Vendor is blank on roughly half of recent GRN rows, and service is blank on 183 of
--    356 recent invoice lines carrying Rs 611 lakh — so the biggest contracts do NOT
--    carry a service label and their billing model cannot be derived from it.
--
-- 6. EXPENSE HEAD IDS ARE STRINGS AND MUST NOT BE NUMBERS. tbl_bgt_expenseheadingmaster
--    holds 52 ids that are unique as text but collapse to only 31 as integers, because
--    zero-padded and unpadded forms coexist and mean DIFFERENT heads:
--
--      '000001' = Communication & Connectivity      '1' = Security Service Charges
--      '000006' = Contract Fees-Others              '6' = Staff Welfare
--
--    GRN entries write the unpadded form, so HeadId='1' is Security Service Charges.
--    Joining on CAST(... AS UNSIGNED) matches BOTH rows — it appears to resolve 100% while
--    silently doubling every row and mislabelling every cost. An exact string join resolves
--    1,008 of 1,008 recent GRN entries and 325 of 325 budget rows with no fan-out. Hence
--    head_id and sub_head_id are VARCHAR here, never INT.
--
-- SAFE TO APPLY
-- -------------
-- Additive only: four new snapshot tables, no existing table touched, no existing row
-- changed. Nothing reads them until the sync runs and code is pointed at them.

-- ---------------------------------------------------------------------------
-- 1. Budget  <- db_bill.expense_master
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_budget_snapshot (
  bill_source_id   INT           NOT NULL,          -- db_bill.expense_master.Id
  branch_source_id INT           NULL,              -- db_bill.branch_master.id
  branch_name      VARCHAR(200)  NULL,
  entry_no         VARCHAR(100)  NULL,
  finance_year     VARCHAR(20)   NULL,              -- '2026-27'
  finance_month    VARCHAR(20)   NULL,              -- 'Jun'
  period_code      CHAR(7)       NULL,              -- '2026-06', derived on the way in
  head_id          VARCHAR(50)   NULL,             -- exact source string; NEVER cast to INT
  sub_head_id      VARCHAR(50)   NULL,
  amount           DECIMAL(18,2) NOT NULL DEFAULT 0,
  expense_status   VARCHAR(50)   NULL,
  entry_status     VARCHAR(50)   NULL,
  -- The five-level approval chain, kept as dates rather than a collapsed boolean so a
  -- half-approved budget is distinguishable from an unapproved one.
  approve_1_at     DATETIME      NULL,
  approve_2_at     DATETIME      NULL,
  approve_3_at     DATETIME      NULL,
  approve_4_at     DATETIME      NULL,
  approve_5_at     DATETIME      NULL,
  objective        TEXT          NULL,
  description_det  TEXT          NULL,
  source_created_at DATETIME     NULL,
  synced_at        DATETIME      NOT NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_fbs_period (period_code),
  KEY idx_fbs_branch (branch_source_id, period_code),
  KEY idx_fbs_head   (head_id, sub_head_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. GRN / expense entries  <- db_bill.expense_entry_master
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grn_entry_snapshot (
  bill_source_id   INT           NOT NULL,          -- db_bill.expense_entry_master.Id
  grn_no           VARCHAR(50)   NULL,
  branch_source_id INT           NULL,
  branch_name      VARCHAR(200)  NULL,
  vendor           VARCHAR(255)  NULL,              -- blank on ~half the recent rows
  finance_year     VARCHAR(20)   NULL,
  finance_month    VARCHAR(20)   NULL,
  period_code      CHAR(7)       NULL,
  head_id          VARCHAR(50)   NULL,             -- exact source string; NEVER cast to INT
  sub_head_id      VARCHAR(50)   NULL,
  amount           DECIMAL(18,2) NOT NULL DEFAULT 0, -- decimals on 6,500 rows; never an INT
  cgst             DECIMAL(18,2) NOT NULL DEFAULT 0,
  sgst             DECIMAL(18,2) NOT NULL DEFAULT 0,
  igst             DECIMAL(18,2) NOT NULL DEFAULT 0,
  expense_date     VARCHAR(20)   NULL,              -- varchar at source; kept verbatim
  bill_no          VARCHAR(100)  NULL,
  bill_date        VARCHAR(20)   NULL,
  entry_status     VARCHAR(50)   NULL,              -- Open / Booked / Close
  grn_status       VARCHAR(50)   NULL,
  -- The raw flag, preserved for traceability, and the truth derived from it.
  reject_flag_raw  INT           NULL,
  is_rejected      TINYINT(1)    NOT NULL DEFAULT 0, -- RejectDate IS NOT NULL, NOT Reject=1
  rejected_at      DATETIME      NULL,
  approved_at      DATETIME      NULL,
  approved_by_ph_at DATETIME     NULL,
  approved_by_fh_at DATETIME     NULL,
  description      TEXT          NULL,
  source_created_at DATETIME     NULL,
  synced_at        DATETIME      NOT NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_ges_period (period_code),
  KEY idx_ges_branch (branch_source_id, period_code),
  KEY idx_ges_grn    (grn_no),
  KEY idx_ges_status (is_rejected, entry_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Invoice line items  <- db_bill.inv_particulars   ** THE SEAT RATE **
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_invoice_particular_snapshot (
  bill_source_id    INT           NOT NULL,         -- db_bill.inv_particulars.id
  cost_centre_source_id INT       NULL,
  cost_centre_code  VARCHAR(100)  NULL,
  branch_name       VARCHAR(200)  NULL,
  finance_year      VARCHAR(20)   NULL,
  month_for         VARCHAR(20)   NULL,             -- 'Jun', NOT 'Jun-26' like tbl_invoice
  period_code       CHAR(7)       NULL,
  service           VARCHAR(255)  NULL,
  sub_category      VARCHAR(255)  NULL,
  particulars       TEXT          NULL,
  rate              DECIMAL(18,2) NOT NULL DEFAULT 0,
  qty               DECIMAL(18,4) NOT NULL DEFAULT 0, -- fractional: part-month seats
  amount            DECIMAL(18,2) NOT NULL DEFAULT 0,
  -- How this line is billed, derived from the line itself because the declared fields
  -- cannot answer it (revenueType blank on 595 of 970 cost centres; service blank on the
  -- 183 recent lines carrying Rs 611 lakh). By value across FY2026-27:
  --   unit_recurring  Rs 935 lakh -- a fixed monthly rate per unit against a varying,
  --                   usually fractional, unit count (Onfido 49,910 x 195 then x 175;
  --                   BirlaNu 29,702 x 0.21 / 1.04 / 0.04). The fractions are part-month
  --                   FTEs prorated by deployed days.
  --   usage / one_time / revenue_share / fixed -- the rest
  billing_pattern   VARCHAR(30)   NOT NULL DEFAULT 'fixed',
  -- True only for unit_recurring lines, and a candidate rather than a guarantee: the
  -- rate/qty split is not always the per-person one (BSS/OB/NOIDA-DD/993 billed
  -- 38,000 x 2 in June and 76,000 x 1 in July for the same value).
  is_seat_line      TINYINT(1)    NOT NULL DEFAULT 0,
  source_created_at DATETIME      NULL,
  synced_at         DATETIME      NOT NULL,
  PRIMARY KEY (bill_source_id),
  KEY idx_bips_cc     (cost_centre_code, period_code),
  KEY idx_bips_period (period_code),
  KEY idx_bips_seat   (is_seat_line, period_code),
  KEY idx_bips_pattern (billing_pattern, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Expense head / sub-head masters  <- db_bill.tbl_bgt_expense*master
-- ---------------------------------------------------------------------------
-- Without these, head_id and sub_head_id on the two tables above are opaque integers and
-- the budget-vs-GRN comparison cannot be labelled.
CREATE TABLE IF NOT EXISTS finance_expense_head_snapshot (
  bill_source_id VARCHAR(50)  NOT NULL,   -- HeadingId / SubHeadingId, verbatim
  head_type      VARCHAR(20)  NOT NULL,   -- 'head' or 'subhead'
  parent_head_id VARCHAR(50)  NULL,       -- set for subheads
  head_name      VARCHAR(255) NULL,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  synced_at      DATETIME     NOT NULL,
  PRIMARY KEY (head_type, bill_source_id),
  KEY idx_fehs_parent (parent_head_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
