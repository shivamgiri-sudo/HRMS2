-- Manual supplemental finance bootstrap.
-- Run after backend/sql/000_run_all.sql.

SOURCE sql/412_finance_expense_head_master.sql;
SOURCE sql/413_vendor_payment_transaction_ledger.sql;
SOURCE sql/414_finance_grn_sequence.sql;
SOURCE sql/415_bpo_pnl_revenue_cost_model.sql;
SOURCE sql/416_smart_grn_allocation_document_intelligence.sql;
SOURCE sql/417_budget_subhead_coverage_control.sql;
SOURCE sql/418_grn_allocation_pnl_attribution.sql;
SOURCE sql/419_grn_validation_override_control.sql;
