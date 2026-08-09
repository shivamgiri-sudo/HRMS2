#!/bin/bash
# Apply leave balance fixes via SQL
# Run: bash apply-leave-fixes.sh

set -e

echo "Applying leave balance fixes..."
echo ""

# Extract DB config
DB_HOST=$(grep "^DB_HOST=" backend/.env | cut -d= -f2)
DB_PORT=$(grep "^DB_PORT=" backend/.env | cut -d= -f2)
DB_USER=$(grep "^DB_USER=" backend/.env | cut -d= -f2)
DB_PASSWORD=$(grep "^DB_PASSWORD=" backend/.env | cut -d= -f2)
DB_NAME=$(grep "^DB_NAME=" backend/.env | cut -d= -f2)

echo "Connecting to $DB_NAME at $DB_HOST:$DB_PORT as $DB_USER..."
echo ""

mysql -h "$DB_HOST" -P "${DB_PORT}" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'SQL'
-- Step 1: Recalculate used_days for current year
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

SELECT CONCAT('✓ Updated leave balances for ', YEAR(CURDATE())) as status;

-- Step 2: Recalculate for 2020-2025
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

SELECT '✓ Recalculated all years from 2020 onwards' as status;

-- Step 3: Show sample results
SELECT
  e.employee_code,
  e.full_name,
  lt.leave_name,
  lbl.allocated_days,
  lbl.used_days,
  (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) as remaining
FROM leave_balance_ledger lbl
JOIN employees e ON e.id = lbl.employee_id
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lbl.balance_year = YEAR(CURDATE())
AND e.active_status = 1
ORDER BY e.employee_code, lt.leave_name
LIMIT 10;

SELECT '✅ Leave balance fix completed!' as final_status;
SQL

echo ""
echo "✅ Leave balances have been recalculated from actual approved requests"
echo ""
echo "The fixes include:"
echo "  1. ✓ Recalculated used_days from actual approved leave_requests"
echo "  2. ✓ Backend service now auto-recalculates on every fetch"
echo "  3. ✓ Total days/year now shows accurate allocated_days"
echo ""
echo "Test at: http://localhost:8081/profile?tab=leaves"
echo ""
