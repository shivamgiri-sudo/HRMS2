-- Add the missing "Computers 26-27 Cost" sub-head under Repairs & Maintenance.
-- Date: 2026-08-19
--
-- WHAT IS WRONG
--   db_bill.tbl_bgt_expensesubheadingmaster holds SubHeadingId=119 "Computers 26-27 COST"
--   under HeadingId=9 ("Repairs & Maintenance" -- the same head mas_hrms mirrors as head_code
--   REPAIRS_MAINTENANCE), Status1=1, sub_close_status=1: live and active in db_bill today.
--
--   db_bill re-creates a fresh sub-head for this line every fiscal year (COMPUTERS-2020-21
--   COST, ... Computers 24-25 COST, Computers 25-26 COST, Computers 26-27 COST, all still under
--   HeadingId=9). mas_hrms's catalogue never adopted that yearly-vintage pattern -- it has no
--   sub-head with any year suffix at all -- so this FY's row was simply never carried across,
--   and it could not appear anywhere a branch budget is raised against Repairs & Maintenance.
--
--   This is a different item from CAPEX_COMPUTERS ("Computers - Cost", added by
--   sql/1060_sync_expense_heads_from_db_bill.sql): that one consolidates the equivalent yearly
--   rows from db_bill's SEPARATE HeadingId=27 ("Repairs & Maintenance Capex") into one evergreen
--   capex sub-head. SubHeadingId=119 lives under db_bill's plain HeadingId=9, so it belongs on
--   mas_hrms's plain REPAIRS_MAINTENANCE head, not the Capex one -- confirmed with the user
--   rather than assumed, since the two heads' yearly sub-head sets look identical at a glance
--   but are tracked separately in db_bill.
--
-- WHAT THIS CHANGES
--   Adds one sub-head, "Computers 26-27 Cost", under REPAIRS_MAINTENANCE. Defaults mirror its
--   nearest sibling on that head (COMPUTER_PERIPHERALS -- device-based, 18% GST exclusive,
--   fully recoverable, opex). INSERT IGNORE against the existing UNIQUE (head_id, sub_head_code)
--   and (head_id, sub_head_name) constraints, so a re-run is a no-op.
--
-- ROLLBACK
--   DELETE FROM finance_expense_sub_head_master WHERE sub_head_code = 'COMPUTERS_26_27_COST';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, default_unit, default_tax_treatment,
   default_gst_rate, default_gst_type, default_recoverable_tax_pct, default_allocation_driver,
   pnl_treatment, pnl_bucket, capex_opex, display_order, active_status)
SELECT UUID(), h.id, 'COMPUTERS_26_27_COST', 'Computers 26-27 Cost', 'Device', 'exclusive',
       18.0000, 'cgst_sgst', 100.0000, 'device_count',
       'operating_expense', 'bmc_non_people', 'opex', 60, 1
FROM finance_expense_head_master h
WHERE h.head_code = 'REPAIRS_MAINTENANCE';

-- Verification (expects one row):
--   SELECT sh.sub_head_code, sh.sub_head_name, h.head_name, sh.active_status
--     FROM finance_expense_sub_head_master sh
--     JOIN finance_expense_head_master h ON h.id = sh.head_id
--    WHERE sh.sub_head_code = 'COMPUTERS_26_27_COST';
