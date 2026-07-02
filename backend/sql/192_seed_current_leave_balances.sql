-- Seed the current-year leave ledger for every active employee without
-- overwriting balances that have already been used or adjusted.
USE mas_hrms;

SET @balance_year = YEAR(CURDATE());

INSERT INTO leave_balance_ledger
  (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
SELECT
  UUID(),
  e.id,
  lt.id,
  @balance_year,
  lt.max_days_per_year
    + CASE
        WHEN lt.carry_forward = 1 THEN GREATEST(
          COALESCE(previous.allocated_days, 0)
            + COALESCE(previous.adjusted_days, 0)
            - COALESCE(previous.used_days, 0),
          0
        )
        ELSE 0
      END,
  0,
  0
FROM employees e
JOIN leave_type_master lt
  ON lt.active_status = 1
 AND lt.max_days_per_year > 0
 AND LOWER(lt.leave_name) NOT LIKE '%legacy%'
LEFT JOIN leave_balance_ledger previous
  ON previous.employee_id = e.id
 AND previous.leave_type_id = lt.id
 AND previous.balance_year = @balance_year - 1
WHERE e.active_status = 1
  AND (
    lt.leave_code NOT IN ('ML', 'MTRL', 'PL', 'PTRL')
    OR (
      lt.leave_code IN ('ML', 'MTRL')
      AND LOWER(TRIM(COALESCE(e.gender, ''))) IN ('female', 'f')
    )
    OR (
      lt.leave_code IN ('PL', 'PTRL')
      AND LOWER(TRIM(COALESCE(e.gender, ''))) IN ('male', 'm')
    )
  )
ON DUPLICATE KEY UPDATE id = leave_balance_ledger.id;
