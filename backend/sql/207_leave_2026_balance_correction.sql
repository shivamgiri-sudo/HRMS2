-- 207_leave_2026_balance_correction.sql
-- Correct all leave_balance_ledger rows for 2026 to match actual policy.
-- Today is June 2026: months Jan(1)..Jun(6) = 6 months elapsed.

-- Step A: Fix EL 2026 -- strip carry-forward, set to 18 days flat (prior year's full accrual for employees who served all of 2025)
-- Employees who joined during 2025 get prorated: (months served in 2025 / 12) * 18
-- We approximate: anyone with DOJ before 2025 gets 18, those who joined in 2025 get prorated
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = CASE
  WHEN e.date_of_joining < '2025-01-01' THEN 18.00
  WHEN YEAR(e.date_of_joining) = 2025 THEN ROUND((18.00 * (12 - MONTH(e.date_of_joining) + 1)) / 12, 2)
  ELSE 0.00
END
WHERE lt.leave_code = 'EL'
AND lbl.balance_year = 2026;

-- Step B: Fix CL 2026 -- set to earned-to-date (6 months * 0.583 = 3.498 days for full-year employees)
-- New joiners in 2026: prorated from join month
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = CASE
  WHEN e.date_of_joining < '2026-01-01' THEN 3.498
  WHEN YEAR(e.date_of_joining) = 2026 AND MONTH(e.date_of_joining) <= 6
    THEN ROUND((6 - MONTH(e.date_of_joining) + 1) * 0.583, 3)
  ELSE 0.000
END
WHERE lt.leave_code = 'CL'
AND lbl.balance_year = 2026;

-- Step C: Delete existing SL/PL/DL/CO rows for 2026 (deactivated types)
DELETE lbl FROM leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lt.leave_code IN ('SL', 'PL', 'DL', 'CO', 'PML')
AND lbl.balance_year = 2026;

-- Step D: Delete old ML (Maternity) 2026 rows -- ML now means Medical Leave
-- The old ML = Maternity rows (182 days allocated) were wrong; Medical Leave rows will be inserted by migration 208
DELETE lbl FROM leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lt.leave_code = 'ML'
AND lbl.balance_year = 2026;

-- Step E: Fix PTRL 2026 -- should be 4 days (annual), keep used_days as-is
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
SET lbl.allocated_days = 4.00
WHERE lt.leave_code = 'PTRL'
AND lbl.balance_year = 2026;

-- Step F: Fix MTRL 2026 -- should be 180 days (annual), keep used_days as-is
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
SET lbl.allocated_days = 180.00
WHERE lt.leave_code = 'MTRL'
AND lbl.balance_year = 2026;
