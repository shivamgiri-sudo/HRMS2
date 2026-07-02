#!/usr/bin/env tsx
/**
 * Sync leave history from db_bill to mas_hrms
 * Run: npx tsx backend/scripts/sync-leave-history-from-db-bill.ts
 */

import { db } from '../src/db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';

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

    // Check for leave-related tables
    console.log('Checking db_bill leave tables...');
    const [tables] = await db.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'db_bill'
       AND (TABLE_NAME LIKE '%leave%' OR TABLE_NAME LIKE '%attendance%')
       ORDER BY TABLE_NAME`
    );

    console.log('Available tables:', tables.map(t => t.TABLE_NAME).join(', '));
    console.log('');

    // Try common table names
    const possibleTables = ['leave_history', 'leave_records', 'leaves', 'employee_leave', 'leave_data'];
    let leaveTable = null;

    for (const tableName of possibleTables) {
      const found = tables.find(t => t.TABLE_NAME.toLowerCase() === tableName.toLowerCase());
      if (found) {
        leaveTable = found.TABLE_NAME;
        break;
      }
    }

    if (!leaveTable) {
      console.log('⚠️  No standard leave table found');
      console.log('Available tables:', tables.map(t => t.TABLE_NAME).join(', '));
      console.log('\nPlease check db_bill manually and update this script with the correct table name');
      process.exit(0);
    }

    console.log(`Using table: ${leaveTable}\n`);

    // Check table structure
    console.log('Table structure:');
    const [columns] = await db.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'db_bill'
       AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [leaveTable]
    );

    console.table(columns.map(c => ({ column: c.COLUMN_NAME, type: c.DATA_TYPE })));

    // Count records
    const [countResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM db_bill.${leaveTable}`
    );
    console.log(`\nFound ${countResult[0].count} historical leave records\n`);

    // Sample the data
    console.log('Sample data (first 5 rows):');
    const [samples] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM db_bill.${leaveTable} LIMIT 5`
    );
    console.table(samples);

    console.log('\n⚠️  Manual mapping required');
    console.log('Next steps:');
    console.log('1. Identify column mapping:');
    console.log('   - employee_code/employee_id → mas_hrms.employees.employee_code');
    console.log('   - start_date/from_date → mas_hrms.leave_requests.start_date');
    console.log('   - end_date/to_date → mas_hrms.leave_requests.end_date');
    console.log('   - days/duration → mas_hrms.leave_requests.leave_days');
    console.log('   - leave_type → mas_hrms.leave_type_master.leave_name');
    console.log('   - status → mas_hrms.leave_requests.status');
    console.log('');
    console.log('2. Update the sync query in backend/sql/208_sync_leave_from_db_bill.sql');
    console.log('3. Run the SQL migration to sync data');

  } catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
