-- 209_sync_2026_used_days_from_db_bill.sql
-- Sync 2026 actual leave consumption from db_bill.leave_management into mas_hrms.leave_balance_ledger.
-- Only sets used_days where mas_hrms currently shows 0 (i.e., no native requests submitted yet).
-- Idempotent: employees already showing non-zero used_days are skipped.

-- NOTE: This migration requires a cross-database JOIN between mas_hrms and db_bill.
-- Run via the Node.js script rather than directly (db_bill is a separate server).

-- Verification query (run after the Node script):
-- SELECT lt.leave_code, COUNT(*) as cnt,
--        SUM(lbl.used_days) as total_used, MAX(lbl.used_days) as max_used
-- FROM leave_balance_ledger lbl
-- JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
-- WHERE lbl.balance_year = 2026
-- GROUP BY lt.leave_code ORDER BY lt.leave_code;

-- Expected: CL total_used ~1195, EL total_used ~2033, ML total_used ~589, PTRL ~8
