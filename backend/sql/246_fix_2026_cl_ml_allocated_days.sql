-- 246_fix_2026_cl_ml_allocated_days.sql
-- Correct CL/ML 2026 allocated_days to match the leave_credit_schedule.
-- Through July 2026: CL months = Jan,Mar,May,Jul = 4 credits; ML months = Feb,Apr,Jun = 3 credits.
-- Employees who joined after a credit month receive prorated or zero for that month.
-- This migration is SAFE (UPDATE only, no deletes). Run once after deploying 245.

-- Fix CL: employees who joined before 2026 should have exactly 4 days (Jan+Mar+May+Jul)
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = 4.0
WHERE lt.leave_code = 'CL'
  AND lbl.balance_year = 2026
  AND e.date_of_joining < '2026-01-01'
  AND lbl.allocated_days != 4.0;

-- Fix CL: employees who joined in 2026 — credit only months they were present for (whole-number per schedule)
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = (
  -- Count CL months in schedule (1,3,5,7) that are >= join month
  (CASE WHEN MONTH(e.date_of_joining) <= 1 THEN 1 ELSE 0 END) +
  (CASE WHEN MONTH(e.date_of_joining) <= 3 THEN 1 ELSE 0 END) +
  (CASE WHEN MONTH(e.date_of_joining) <= 5 THEN 1 ELSE 0 END) +
  (CASE WHEN MONTH(e.date_of_joining) <= 7 THEN 1 ELSE 0 END)
)
WHERE lt.leave_code = 'CL'
  AND lbl.balance_year = 2026
  AND YEAR(e.date_of_joining) = 2026;

-- Fix ML: employees who joined before 2026 should have exactly 3 days (Feb+Apr+Jun)
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = 3.0
WHERE lt.leave_code = 'ML'
  AND lbl.balance_year = 2026
  AND e.date_of_joining < '2026-01-01'
  AND lbl.allocated_days != 3.0;

-- Fix ML: employees who joined in 2026 — credit only months they were present for
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = (
  -- Count ML months in schedule (2,4,6) that are >= join month
  (CASE WHEN MONTH(e.date_of_joining) <= 2 THEN 1 ELSE 0 END) +
  (CASE WHEN MONTH(e.date_of_joining) <= 4 THEN 1 ELSE 0 END) +
  (CASE WHEN MONTH(e.date_of_joining) <= 6 THEN 1 ELSE 0 END)
)
WHERE lt.leave_code = 'ML'
  AND lbl.balance_year = 2026
  AND YEAR(e.date_of_joining) = 2026;

-- Repair idempotency log: ensure leave_el_credit_log has correct entries for all
-- CL/ML schedule months processed so far in 2026, so the worker won't re-credit them.
-- Only insert missing entries (ON DUPLICATE KEY UPDATE is a no-op).
INSERT IGNORE INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
SELECT
  UUID(),
  e.id,
  lt.id,
  2026,
  sched.month,
  LAST_DAY(CONCAT('2026-', LPAD(sched.month, 2, '0'), '-01')),
  1.0,
  0,
  'monthly'
FROM employees e
JOIN leave_credit_schedule sched ON sched.month <= 7  -- months processed through July
JOIN leave_type_master lt ON lt.leave_code = sched.leave_code AND lt.active_status = 1
WHERE e.active_status = 1
  AND e.employment_status = 'active'
  AND MONTH(e.date_of_joining) <= sched.month  -- only months employee was present
  -- Skip rows already logged
  AND NOT EXISTS (
    SELECT 1 FROM leave_el_credit_log log2
    WHERE log2.employee_id = e.id
      AND log2.leave_type_id = lt.id
      AND log2.credit_year = 2026
      AND log2.credit_month = sched.month
      AND log2.credit_type = 'monthly'
  );
