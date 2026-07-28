-- ============================================================
-- Script: Allocate 2026 Leave Balances
-- Description: Copy 2025 leave balance structure to create
--              2026 allocations for all active employees
-- Date: 2026-06-11
-- Run On: mas_hrms database
-- ============================================================

USE mas_hrms;

-- Show current state BEFORE
SELECT '=== BEFORE ===' as status;
SELECT
  balance_year,
  COUNT(*) as total_records,
  COUNT(DISTINCT employee_id) as unique_employees
FROM leave_balance_ledger
GROUP BY balance_year
ORDER BY balance_year DESC;

-- Create 2026 leave balances by copying 2025 structure
-- Reset used_days to 0 for the new year
INSERT INTO leave_balance_ledger (
  id,
  employee_id,
  leave_type_id,
  balance_year,
  allocated_days,
  used_days,
  adjusted_days,
  created_at
)
SELECT
  UUID() as id,
  lbl.employee_id,
  lbl.leave_type_id,
  2026 as balance_year,
  lbl.allocated_days,
  0 as used_days,
  0 as adjusted_days,
  NOW() as created_at
FROM leave_balance_ledger lbl
INNER JOIN employees e ON e.id = lbl.employee_id
WHERE lbl.balance_year = 2025
  AND e.active_status = 1
  AND NOT EXISTS (
    SELECT 1 FROM leave_balance_ledger lbl2
    WHERE lbl2.employee_id = lbl.employee_id
      AND lbl2.leave_type_id = lbl.leave_type_id
      AND lbl2.balance_year = 2026
  );

-- Show results AFTER
SELECT '=== AFTER ===' as status;
SELECT
  balance_year,
  COUNT(*) as total_records,
  COUNT(DISTINCT employee_id) as unique_employees
FROM leave_balance_ledger
GROUP BY balance_year
ORDER BY balance_year DESC;

-- Sample: Show some 2026 balances
SELECT '=== SAMPLE 2026 BALANCES ===' as status;
SELECT
  e.employee_code,
  e.first_name,
  e.last_name,
  ltm.leave_name,
  lbl.allocated_days,
  lbl.used_days,
  lbl.balance_year
FROM leave_balance_ledger lbl
JOIN employees e ON e.id = lbl.employee_id
JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
WHERE lbl.balance_year = 2026
ORDER BY e.employee_code, ltm.leave_name
LIMIT 20;

-- ============================================================
-- Expected Results:
-- - Before: 2025 = 7,655 records, 2026 = 13 records
-- - After:  2025 = 7,655 records, 2026 = ~7,655 records
-- ============================================================
