#!/usr/bin/env tsx
/**
 * Check leave data integrity and show actual values
 * Run: npx tsx backend/scripts/check-leave-data.ts
 */

import { db } from '../src/db/mysql.js';
import type { RowDataPacket } from 'mysql2';

async function main() {
  console.log('Checking leave data integrity...\n');

  try {
    // Check leave_balance_ledger structure
    console.log('1. Leave Balance Ledger Structure:');
    const [columns] = await db.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'leave_balance_ledger'
       ORDER BY ORDINAL_POSITION`
    );
    console.table(columns.map(c => ({ column: c.COLUMN_NAME, type: c.DATA_TYPE })));

    // Check sample leave balances
    console.log('\n2. Sample Leave Balances (Current Year):');
    const currentYear = new Date().getFullYear();
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
       WHERE lbl.balance_year = ?
       AND e.active_status = 1
       LIMIT 10`,
      [currentYear]
    );
    console.table(balances);

    // Check leave_requests aggregation
    console.log('\n3. Actual Leave Requests (Current Year):');
    const [requests] = await db.execute<RowDataPacket[]>(
      `SELECT
        e.employee_code,
        e.full_name,
        lt.leave_name,
        lr.status,
        COUNT(*) as count,
        SUM(lr.leave_days) as total_days
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN leave_type_master lt ON lt.id = lr.leave_type_id
       WHERE YEAR(lr.start_date) = ?
       GROUP BY e.employee_code, e.full_name, lt.leave_name, lr.status
       ORDER BY e.employee_code, lt.leave_name
       LIMIT 20`,
      [currentYear]
    );
    console.table(requests);

    // Check for mismatch between used_days and actual approved requests
    console.log('\n4. Mismatches (Balance vs Actual):');
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
       WHERE lbl.balance_year = ?
       AND e.active_status = 1
       GROUP BY e.employee_code, e.full_name, lt.leave_name, lbl.used_days
       HAVING ABS(difference) > 0.01
       LIMIT 10`,
      [currentYear]
    );

    if (mismatches.length > 0) {
      console.table(mismatches);
      console.log(`\n⚠️  Found ${mismatches.length} mismatches`);
    } else {
      console.log('✓ No mismatches found\n');
    }

    // Check db_bill database
    console.log('\n5. Checking db_bill database:');
    const [dbCheck] = await db.execute<RowDataPacket[]>(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA
       WHERE SCHEMA_NAME = 'db_bill'`
    );

    if (!dbCheck.length) {
      console.log('❌ db_bill database not accessible\n');
    } else {
      console.log('✓ db_bill database accessible\n');

      // Check for leave-related tables in db_bill
      const [tables] = await db.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = 'db_bill'
         AND (TABLE_NAME LIKE '%leave%' OR TABLE_NAME LIKE '%attendance%')
         ORDER BY TABLE_NAME`
      );

      if (tables.length > 0) {
        console.log('Leave-related tables in db_bill:');
        tables.forEach(t => console.log(`  - ${t.TABLE_NAME}`));
        console.log('');
      } else {
        console.log('No leave-related tables found in db_bill\n');
      }
    }

    console.log('✅ Check completed');

  } catch (error) {
    console.error('❌ Check failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
