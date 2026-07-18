-- 000_finance_supplemental.sql
-- Manual DBA convenience entrypoint for the complete Finance Budget / GRN / Vendor stack.
-- Production startup remains authoritative through runFinanceSupplementalMigrations().
-- Run from backend/: mysql -u <user> -p <database> < sql/000_finance_supplemental.sql

SOURCE sql/411_branch_budget_grn_approval_flow.sql;
SOURCE sql/412_finance_expense_head_master.sql;
SOURCE sql/413_vendor_payment_transaction_ledger.sql;
SOURCE sql/414_finance_grn_sequence.sql;
SOURCE sql/415_bpo_pnl_revenue_cost_model.sql;
SOURCE sql/416_smart_grn_allocation_document_intelligence.sql;
SOURCE sql/417_budget_subhead_coverage_control.sql;
SOURCE sql/418_grn_allocation_pnl_attribution.sql;
