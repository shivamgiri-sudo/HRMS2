# Leave System Fixes - Profile Page

## Issues Identified:

1. **Incorrect leave count showing** - Right side total leave count incorrect
2. **"Total: X days/year" statement incorrect** - Wrong data source
3. **Leave history not reflecting db_bill data** - Past trends should come from db_bill

---

## Fix 1: Verify Leave Balance Calculation

### Backend API Check:
**File:** `backend/src/modules/leave/leave.service.ts`

Check the `getLeaveBalances` function to ensure it:
- Calculates `used_days` correctly from approved leave requests
- Returns accurate `total_days` from employee_leave_balance
- Includes pending/approved leaves in the calculation

### SQL Query to Verify Data:

```sql
-- Check employee leave balances
SELECT 
  elb.employee_id,
  elb.leave_type_id,
  lt.name as leave_type,
  elb.year,
  elb.total_days,
  elb.used_days,
  elb.carry_forward_days,
  (elb.total_days + elb.carry_forward_days - elb.used_days) as remaining
FROM employee_leave_balance elb
JOIN leave_types lt ON lt.id = elb.leave_type_id
WHERE elb.employee_id = 'EMPLOYEE_ID_HERE'
  AND elb.year = YEAR(CURDATE())
ORDER BY lt.sort_order;

-- Verify used_days matches actual leave requests
SELECT 
  lr.leave_type_id,
  lt.name,
  SUM(lr.leave_days) as actual_used_days
FROM leave_requests lr
JOIN leave_types lt ON lt.id = lr.leave_type_id
WHERE lr.employee_id = 'EMPLOYEE_ID_HERE'
  AND lr.status = 'approved'
  AND YEAR(lr.start_date) = YEAR(CURDATE())
GROUP BY lr.leave_type_id, lt.name;
```

---

## Fix 2: Sync Leave History from db_bill

### Step 1: Create Migration to Sync Historical Data

**File:** `backend/sql/207_sync_leave_history_from_db_bill.sql`

```sql
-- Sync historical leave data from db_bill to mas_hrms
USE mas_hrms;

-- Create temporary mapping if employee codes match
CREATE TEMPORARY TABLE IF NOT EXISTS employee_code_map AS
SELECT 
  e.id as mas_employee_id,
  e.employee_code
FROM employees e
WHERE e.active_status = 1;

-- Insert historical leave requests from db_bill
-- Adjust table/column names based on actual db_bill schema
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
  ecm.mas_employee_id,
  (SELECT id FROM leave_types WHERE name = 'Casual Leave' LIMIT 1) as leave_type_id,
  db_bill.leave_history.start_date,
  db_bill.leave_history.end_date,
  db_bill.leave_history.days as leave_days,
  db_bill.leave_history.reason,
  'approved' as status,
  db_bill.leave_history.applied_date as created_at,
  db_bill.leave_history.approved_date as updated_at
FROM db_bill.leave_history lh
JOIN employee_code_map ecm ON ecm.employee_code = lh.employee_code
WHERE NOT EXISTS (
  SELECT 1 FROM leave_requests lr
  WHERE lr.employee_id = ecm.mas_employee_id
    AND lr.start_date = lh.start_date
    AND lr.end_date = lh.end_date
)
LIMIT 10000; -- Safety limit

-- Update used_days in employee_leave_balance based on actual history
UPDATE employee_leave_balance elb
SET used_days = (
  SELECT COALESCE(SUM(lr.leave_days), 0)
  FROM leave_requests lr
  WHERE lr.employee_id = elb.employee_id
    AND lr.leave_type_id = elb.leave_type_id
    AND lr.status = 'approved'
    AND YEAR(lr.start_date) = elb.year
)
WHERE elb.year >= 2020;

SELECT 'Leave history sync completed' as status;
```

### Step 2: Create Script to Sync Regularly

**File:** `backend/scripts/sync-leave-history.ts`

```typescript
#!/usr/bin/env tsx
/**
 * Sync leave history from db_bill to mas_hrms
 * Run: npx tsx backend/scripts/sync-leave-history.ts
 */

import { db } from '../src/db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

async function main() {
  console.log('Starting leave history sync from db_bill...\n');

  try {
    // Check db_bill access
    const [dbCheck] = await db.execute<RowDataPacket[]>(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA 
       WHERE SCHEMA_NAME = 'db_bill'`
    );
    
    if (!dbCheck.length) {
      console.error('❌ db_bill database not accessible');
      process.exit(1);
    }

    console.log('✓ db_bill database accessible\n');

    // Check leave_history table structure
    console.log('Checking db_bill.leave_history structure...');
    const [columns] = await db.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = 'db_bill' 
       AND TABLE_NAME = 'leave_history'`
    );
    
    console.log('Available columns:', columns.map(c => c.COLUMN_NAME).join(', '));
    console.log('');

    // Count records to sync
    const [countResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM db_bill.leave_history`
    );
    console.log(`Found ${countResult[0].count} historical leave records\n`);

    // Run sync (customize based on actual schema)
    console.log('Running sync...');
    const [syncResult] = await db.execute<ResultSetHeader>(
      `INSERT INTO leave_requests (
        id, employee_id, leave_type_id, start_date, end_date, 
        leave_days, reason, status, created_at, updated_at
      )
      SELECT 
        UUID(),
        e.id,
        lt.id,
        lh.start_date,
        lh.end_date,
        lh.days,
        COALESCE(lh.reason, 'Migrated from legacy system'),
        'approved',
        COALESCE(lh.created_at, lh.start_date),
        COALESCE(lh.updated_at, lh.start_date)
      FROM db_bill.leave_history lh
      JOIN employees e ON e.employee_code = lh.employee_code
      JOIN leave_types lt ON lt.name = lh.leave_type
      WHERE NOT EXISTS (
        SELECT 1 FROM leave_requests lr
        WHERE lr.employee_id = e.id
          AND lr.start_date = lh.start_date
          AND lr.end_date = lh.end_date
      )
      LIMIT 10000`
    );

    console.log(`✓ Synced ${syncResult.affectedRows} leave records\n`);

    // Update balances
    console.log('Updating leave balances...');
    await db.execute(
      `UPDATE employee_leave_balance elb
       SET used_days = (
         SELECT COALESCE(SUM(lr.leave_days), 0)
         FROM leave_requests lr
         WHERE lr.employee_id = elb.employee_id
           AND lr.leave_type_id = elb.leave_type_id
           AND lr.status = 'approved'
           AND YEAR(lr.start_date) = elb.year
       )
       WHERE elb.year >= 2020`
    );

    console.log('✓ Leave balances updated\n');
    console.log('✅ Sync completed successfully!');

  } catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
```

---

## Fix 3: Update LeaveRequestHistory Component

**File:** `src/components/profile/LeaveRequestHistory.tsx`

Ensure it queries all historical data:

```typescript
// In the useQuery hook
const { data: leaveHistory } = useQuery({
  queryKey: ['leave-history', employeeId],
  queryFn: async () => {
    const response = await hrmsApi.get(`/api/leave/requests/history/${employeeId}`);
    return response.data;
  }
});
```

### Backend API Endpoint

**File:** `backend/src/modules/leave/leave.routes.ts`

Add historical endpoint:

```typescript
// Get employee leave history (all years)
leaveRouter.get("/requests/history/:employeeId", requireAuth, async (req: any, res: any) => {
  const { employeeId } = req.params;
  
  const [requests] = await db.execute<RowDataPacket[]>(
    `SELECT 
      lr.*,
      lt.name as leave_type_name,
      lt.is_paid,
      approver.full_name as approver_name
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    LEFT JOIN employees approver ON approver.id = lr.approved_by
    WHERE lr.employee_id = ?
    ORDER BY lr.start_date DESC
    LIMIT 1000`,
    [employeeId]
  );
  
  res.json({ success: true, data: requests });
});
```

---

## Testing Commands

```bash
# 1. Check current leave balances
mysql -h HOST -u USER -p mas_hrms -e "
SELECT e.employee_code, e.full_name, lt.name, elb.total_days, elb.used_days
FROM employee_leave_balance elb
JOIN employees e ON e.id = elb.employee_id  
JOIN leave_types lt ON lt.id = elb.leave_type_id
WHERE e.email = 'your.email@teammas.in'
  AND elb.year = YEAR(CURDATE());
"

# 2. Check leave history
mysql -h HOST -u USER -p mas_hrms -e "
SELECT DATE(start_date) as start, DATE(end_date) as end, leave_days, status
FROM leave_requests lr
JOIN employees e ON e.id = lr.employee_id
WHERE e.email = 'your.email@teammas.in'
ORDER BY start_date DESC
LIMIT 20;
"

# 3. Sync from db_bill
cd backend
npx tsx scripts/sync-leave-history.ts
```

---

##  Quick Fixes

### If Total Days are Wrong:

```sql
-- Update specific employee leave balance
UPDATE employee_leave_balance
SET total_days = 12  -- Correct value
WHERE employee_id = (SELECT id FROM employees WHERE email = 'user@teammas.in')
  AND leave_type_id = (SELECT id FROM leave_types WHERE name = 'Casual Leave')
  AND year = YEAR(CURDATE());
```

### If Used Days are Wrong:

```sql
-- Recalculate used days for current year
UPDATE employee_leave_balance elb
SET used_days = (
  SELECT COALESCE(SUM(lr.leave_days), 0)
  FROM leave_requests lr
  WHERE lr.employee_id = elb.employee_id
    AND lr.leave_type_id = elb.leave_type_id
    AND lr.status = 'approved'
    AND YEAR(lr.start_date) = elb.year
)
WHERE elb.year = YEAR(CURDATE());
```

---

## Implementation Priority

1. **High:** Fix incorrect leave counts (SQL updates)
2. **High:** Verify total_days in employee_leave_balance table
3. **Medium:** Sync historical data from db_bill
4. **Medium:** Add history endpoint to API
5. **Low:** Create automated sync script

---

## Next Steps

1. Verify db_bill schema and table names
2. Run SQL fixes for immediate correction
3. Implement sync script for historical data
4. Test on profile page
5. Schedule regular syncs if needed
