-- Remove duplicate rows in pnl_running_salary_snapshot caused by the
-- old flushRows logic that only deleted NULL-CC rows before upsert.
-- An employee who moved between cost centres kept one row per CC per
-- period, inflating salary totals.  Keep the most-recently-computed row
-- per (period_code, employee_id); discard all others.

DELETE s
FROM pnl_running_salary_snapshot s
JOIN (
  SELECT period_code, employee_id, MAX(computed_at) AS keep_at
  FROM pnl_running_salary_snapshot
  GROUP BY period_code, employee_id
  HAVING COUNT(*) > 1
) keep ON keep.period_code = s.period_code AND keep.employee_id = s.employee_id
WHERE s.computed_at < keep.keep_at;
