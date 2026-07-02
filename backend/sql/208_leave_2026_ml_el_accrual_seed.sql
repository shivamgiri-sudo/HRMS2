-- 208_leave_2026_ml_el_accrual_seed.sql
-- Insert ML (Medical Leave) 2026 balance rows for all active employees.
-- Also seed leave_el_accrual_ledger for 2026 (Jan-Jun = 6 months accumulated).

-- Part A: Insert ML 2026 balance rows (6 months * 0.417 = 2.502 days for full-year employees)
INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
SELECT
  UUID(),
  e.id,
  lt.id,
  2026,
  CASE
    WHEN e.date_of_joining < '2026-01-01' THEN 2.50
    WHEN YEAR(e.date_of_joining) = 2026 AND MONTH(e.date_of_joining) <= 6
      THEN ROUND((6 - MONTH(e.date_of_joining) + 1) * 0.417, 2)
    ELSE 0.00
  END,
  0,
  0
FROM employees e
CROSS JOIN leave_type_master lt
WHERE e.active_status = 1
AND e.employment_status = 'active'
AND lt.leave_code = 'ML'
AND NOT EXISTS (
  SELECT 1 FROM leave_balance_ledger lbl2
  WHERE lbl2.employee_id = e.id AND lbl2.leave_type_id = lt.id AND lbl2.balance_year = 2026
);

-- Part B: Seed leave_el_accrual_ledger for 2026 (Jan-Jun = 6 months * 1.5 = 9.0 days for full-year employees)
-- NOTE: COLLATE utf8mb4_0900_ai_ci needed because employees.id is utf8mb4_unicode_ci
--       while leave_el_accrual_ledger.employee_id is utf8mb4_0900_ai_ci
INSERT INTO leave_el_accrual_ledger (id, employee_id, accrual_year, accrued_days, last_credited_month)
SELECT
  UUID(),
  e.id COLLATE utf8mb4_0900_ai_ci,
  2026,
  CASE
    WHEN e.date_of_joining < '2026-01-01' THEN 9.00
    WHEN YEAR(e.date_of_joining) = 2026 AND MONTH(e.date_of_joining) <= 6
      THEN ROUND((6 - MONTH(e.date_of_joining) + 1) * 1.5, 2)
    ELSE 0.00
  END,
  6
FROM employees e
WHERE e.active_status = 1
AND e.employment_status = 'active'
AND NOT EXISTS (
  SELECT 1 FROM leave_el_accrual_ledger eal2
  WHERE eal2.employee_id = e.id COLLATE utf8mb4_0900_ai_ci AND eal2.accrual_year = 2026
);
