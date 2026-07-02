-- Sync historical leave data from db_bill to mas_hrms
-- IMPORTANT: Update the column mappings based on actual db_bill schema
USE mas_hrms;

-- Step 1: Check what tables exist in db_bill
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'db_bill'
AND (TABLE_NAME LIKE '%leave%' OR TABLE_NAME LIKE '%attendance%')
ORDER BY TABLE_NAME;

-- Step 2: Template sync query (UPDATE column names based on actual schema)
-- Uncomment and modify after checking db_bill schema:

/*
INSERT INTO leave_requests (
  id,
  employee_id,
  leave_type_id,
  start_date,
  end_date,
  leave_days,
  reason,
  status,
  created_at,
  updated_at
)
SELECT
  UUID() as id,
  e.id as employee_id,
  lt.id as leave_type_id,
  lh.start_date,                    -- UPDATE: actual column name
  lh.end_date,                      -- UPDATE: actual column name
  lh.days as leave_days,            -- UPDATE: actual column name
  COALESCE(lh.reason, 'Migrated from legacy system') as reason,
  'approved' as status,
  COALESCE(lh.applied_date, lh.start_date) as created_at,
  COALESCE(lh.approved_date, lh.start_date) as updated_at
FROM db_bill.leave_history lh      -- UPDATE: actual table name
JOIN employees e ON e.employee_code = lh.employee_code  -- UPDATE: join column
JOIN leave_type_master lt ON lt.leave_name = lh.leave_type  -- UPDATE: leave type mapping
WHERE NOT EXISTS (
  SELECT 1 FROM leave_requests lr
  WHERE lr.employee_id = e.id
    AND lr.start_date = lh.start_date
    AND lr.end_date = lh.end_date
)
AND e.active_status = 1
AND YEAR(lh.start_date) >= 2020    -- Only sync from 2020 onwards
LIMIT 10000;
*/

-- Step 3: After inserting leave requests, recalculate balances
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

-- Step 4: Verification query
SELECT
  e.employee_code,
  e.full_name,
  lt.leave_name,
  YEAR(lr.start_date) as year,
  COUNT(*) as count,
  SUM(lr.leave_days) as total_days
FROM leave_requests lr
JOIN employees e ON e.id = lr.employee_id
JOIN leave_type_master lt ON lt.id = lr.leave_type_id
WHERE lr.status = 'approved'
GROUP BY e.employee_code, e.full_name, lt.leave_name, YEAR(lr.start_date)
ORDER BY e.employee_code, year DESC, lt.leave_name
LIMIT 50;

SELECT 'Leave history sync template ready - update column mappings first' as status;
