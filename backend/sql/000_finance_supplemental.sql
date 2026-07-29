-- 000_finance_supplemental.sql
-- Manual DBA convenience entrypoint for the complete Finance Budget / GRN / Vendor stack
-- (migrations 411-420). This is the sole such manual entrypoint for this range — it used to
-- be duplicated across three scripts (this one, 000_run_finance_supplemental.sql, and
-- 000_finance_hardening.sql) mirroring two separate, ungoverned startup runners; both the
-- runners and the two duplicate manual scripts were retired once the primary governed manifest
-- was confirmed to fully cover this range (see MIGRATION_MANIFEST in src/db/runPendingMigrations.ts).
-- Production/dev startup is authoritative through runPendingMigrations() (advisory-locked,
-- checksummed) — this script is a convenience for applying the same range by hand.
-- Run from backend/: mysql -u <user> -p <database> < sql/000_finance_supplemental.sql

SOURCE sql/411_branch_budget_grn_approval_flow.sql;
SOURCE sql/412_finance_expense_head_master.sql;
SOURCE sql/413_vendor_payment_transaction_ledger.sql;
SOURCE sql/414_finance_grn_sequence.sql;
SOURCE sql/415_bpo_pnl_revenue_cost_model.sql;
SOURCE sql/416_smart_grn_allocation_document_intelligence.sql;
SOURCE sql/417_budget_subhead_coverage_control.sql;
SOURCE sql/418_grn_allocation_pnl_attribution.sql;
SOURCE sql/419_grn_validation_override_control.sql;
SOURCE sql/420_grn_validation_schema_hardening.sql;
