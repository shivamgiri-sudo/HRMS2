#!/usr/bin/env tsx
/**
 * Apply leave balance fixes
 * Run: npx tsx backend/scripts/apply-leave-fix.ts
 */

import { db } from '../src/db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

async function main() {
  console.log('Applying leave balance fixes...\n');

  try {
    // Step 1: Recalculate used_days for current year
    console.log('1. Recalculating used_days for current year...');
    const [result1] = await db.execute<ResultSetHeader>(
      `UPDATE leave_balance_ledger lbl
       SET used_days = (
         SELECT COALESCE(SUM(lr.leave_days), 0)
         FROM leave_requests lr
         WHERE lr.employee_id = lbl.employee_id
           AND lr.leave_type_id = lbl.leave_type_id
           AND lr.status = 'approved'
           AND YEAR(lr.start_date) = lbl.balance_year
       )
       WHERE lbl.balance_year = YEAR(CURDATE())`
    );
    console.log(`✓ Updated ${result1.affectedRows} balance records for current year\n`);

    // Step 2: Recalculate for previous years (2020 onwards)
    console.log('2. Recalculating used_days for 2020-2025...');
    const [result2] = await db.execute<ResultSetHeader>(
      `UPDATE leave_balance_ledger lbl
       SET used_days = (
         SELECT COALESCE(SUM(lr.leave_days), 0)
         FROM leave_requests lr
         WHERE lr.employee_id = lbl.employee_id
           AND lr.leave_type_id = lbl.leave_type_id
           AND lr.status = 'approved'
           AND YEAR(lr.start_date) = lbl.balance_year
       )
       WHERE lbl.balance_year >= 2020`
    );
    console.log(`✓ Updated ${result2.affectedRows} balance records total\n`);

    // Step 3: Show sample results
    console.log('3. Sample balances after fix:');
    const [balances] = await db.execute<RowDataPacket[]>(
      `SELECT
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
       LIMIT 10`
    );
    console.table(balances);

    // Step 4: Check for any mismatches
    console.log('\n4. Checking for remaining mismatches...');
    const [mismatches] = await db.execute<RowDataPacket[]>(
      `SELECT
        e.employee_code,
        e.full_name,
        lt.leave_name,
        lbl.used_days as ledger_used,
        COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN lr.leave_days ELSE 0 END), 0) as actual_approved,
        (lbl.used_days - COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN lr.leave_days ELSE 0 END), 0)) as difference
       FROM leave_balance_ledger lbl
       JOIN employees e ON e.id = lbl.employee_id
       JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
       LEFT JOIN leave_requests lr ON lr.employee_id = lbl.employee_id
         AND lr.leave_type_id = lbl.leave_type_id
         AND YEAR(lr.start_date) = lbl.balance_year
       WHERE lbl.balance_year = YEAR(CURDATE())
       AND e.active_status = 1
       GROUP BY e.employee_code, e.full_name, lt.leave_name, lbl.used_days
       HAVING ABS(difference) > 0.01
       LIMIT 10`
    );

    if (mismatches.length > 0) {
      console.table(mismatches);
      console.log(`\n⚠️  Still found ${mismatches.length} mismatches - may need manual review`);
    } else {
      console.log('✓ No mismatches found - all balances are accurate\n');
    }

    console.log('✅ Leave balance fix completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Test the leave balance page: http://localhost:8081/profile?tab=leaves');
    console.log('2. Run db_bill sync script: npx tsx backend/scripts/sync-leave-history-from-db-bill.ts');

  } catch (error) {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
