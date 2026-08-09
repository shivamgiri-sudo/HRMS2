-- Fix leave balance calculation - Recalculate used_days from actual approved leave requests
USE mas_hrms;

-- Step 1: Recalculate used_days for current year from actual approved leave requests
UPDATE leave_balance_ledger lbl
SET used_days = (
  SELECT COALESCE(SUM(lr.leave_days), 0)
  FROM leave_requests lr
  WHERE lr.employee_id = lbl.employee_id
    AND lr.leave_type_id = lbl.leave_type_id
    AND lr.status = 'approved'
    AND YEAR(lr.start_date) = lbl.balance_year
)
WHERE lbl.balance_year = YEAR(CURDATE());

-- Step 2: Recalculate for previous years as well (2020 onwards)
UPDATE leave_balance_ledger lbl
SET used_days = (
  SELECT COALESCE(SUM(lr.leave_days), 0)
  FROM leave_requests lr
  WHERE lr.employee_id = lbl.employee_id
    AND lr.leave_type_id = lbl.leave_type_id
    AND lr.status = 'approved'
    AND YEAR(lr.start_date) = lbl.balance_year
)
WHERE lbl.balance_year >= 2020;

-- Step 3: Verification - Show balances with calculations
SELECT
  e.employee_code,
  e.full_name,
  lt.leave_name,
  lbl.balance_year,
  lbl.allocated_days,
  lbl.used_days,
  lbl.adjusted_days,
  (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) as remaining
FROM leave_balance_ledger lbl
JOIN employees e ON e.id = lbl.employee_id
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lbl.balance_year = YEAR(CURDATE())
  AND e.active_status = 1
ORDER BY e.employee_code, lt.leave_name
LIMIT 20;

SELECT 'Leave balance recalculation completed' as status;
