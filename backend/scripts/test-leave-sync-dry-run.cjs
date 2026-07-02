/**
 * DRY RUN: Test leave sync WITHOUT modifying any data
 *
 * Purpose:
 * - Validate employee_code mappings
 * - Check data quality
 * - Identify potential issues
 * - Show what WOULD be synced
 *
 * SAFE: READ-ONLY, NO WRITES
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// Legacy MySQL (db_bill - READ ONLY)
const legacyConfig = {
  host: '14.97.30.236',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'db_bill',
};

// HRMS MySQL (mas_hrms - READ ONLY for this test)
const hrmsConfig = {
  host: '122.184.128.90',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
};

async function dryRunLeaveSyn() {
  const legacyConn = await mysql.createConnection(legacyConfig);
  const hrmsConn = await mysql.createConnection(hrmsConfig);

  console.log('='.repeat(80));
  console.log('LEAVE SYNC DRY RUN - READ ONLY TEST');
  console.log('='.repeat(80));

  try {
    // Step 1: Count total leave records in legacy
    const [legacyCount] = await legacyConn.execute(
      'SELECT COUNT(*) as total FROM leave_management'
    );
    console.log(`\n📊 Total legacy leave records: ${legacyCount[0].total}`);

    // Step 2: Get sample leave records from legacy
    const [legacyLeaves] = await legacyConn.execute(`
      SELECT
        Id, EmpCode, EmpName, LeaveFrom, LeaveTo,
        LeaveType, Status, TotalLeave, CreateDate
      FROM leave_management
      ORDER BY CreateDate DESC
      LIMIT 10
    `);

    console.log(`\n📋 Sample legacy leave records (10 latest):`);
    console.table(legacyLeaves);

    // Step 3: Get unique employee codes from leave records
    const [uniqueEmps] = await legacyConn.execute(`
      SELECT DISTINCT EmpCode, EmpName
      FROM leave_management
      WHERE EmpCode IS NOT NULL AND EmpCode != ''
      ORDER BY EmpCode
      LIMIT 20
    `);

    console.log(`\n👥 Sample employee codes in leave data (20):`);
    console.table(uniqueEmps);

    // Step 4: Check which employees exist in HRMS
    const empCodes = uniqueEmps.map(e => e.EmpCode);
    const placeholders = empCodes.map(() => '?').join(',');

    const [hrmsEmps] = await hrmsConn.execute(
      `SELECT id, employee_code, first_name, last_name, active_status
       FROM employees
       WHERE employee_code IN (${placeholders})`,
      empCodes
    );

    console.log(`\n✅ Employees found in HRMS: ${hrmsEmps.length}/${empCodes.length}`);
    console.table(hrmsEmps);

    // Step 5: Check missing employees
    const hrmsEmpCodes = new Set(hrmsEmps.map(e => e.employee_code));
    const missingEmps = empCodes.filter(code => !hrmsEmpCodes.has(code));

    if (missingEmps.length > 0) {
      console.log(`\n⚠️  Employees NOT found in HRMS (${missingEmps.length}):`);
      console.log(missingEmps.slice(0, 10).join(', '));
      if (missingEmps.length > 10) {
        console.log(`... and ${missingEmps.length - 10} more`);
      }
    }

    // Step 6: Check leave type distribution
    const [leaveTypes] = await legacyConn.execute(`
      SELECT
        COALESCE(LeaveType, 'NULL') as LeaveType,
        COUNT(*) as count,
        ROUND(AVG(TotalLeave), 2) as avg_days
      FROM leave_management
      GROUP BY LeaveType
      ORDER BY count DESC
    `);

    console.log(`\n📊 Leave type distribution:`);
    console.table(leaveTypes);

    // Step 7: Check status distribution
    const [statuses] = await legacyConn.execute(`
      SELECT
        COALESCE(Status, 'NULL') as Status,
        COUNT(*) as count
      FROM leave_management
      GROUP BY Status
      ORDER BY count DESC
    `);

    console.log(`\n📊 Leave status distribution:`);
    console.table(statuses);

    // Step 8: Check date range
    const [dateRange] = await legacyConn.execute(`
      SELECT
        MIN(CreateDate) as earliest_leave,
        MAX(CreateDate) as latest_leave,
        COUNT(*) as total_leaves
      FROM leave_management
      WHERE CreateDate IS NOT NULL
    `);

    console.log(`\n📅 Leave date range:`);
    console.table(dateRange);

    // Step 9: Check for data quality issues
    const [dataQuality] = await legacyConn.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN EmpCode IS NULL OR EmpCode = '' THEN 1 ELSE 0 END) as missing_empcode,
        SUM(CASE WHEN LeaveFrom IS NULL THEN 1 ELSE 0 END) as missing_from_date,
        SUM(CASE WHEN LeaveTo IS NULL THEN 1 ELSE 0 END) as missing_to_date,
        SUM(CASE WHEN LeaveType IS NULL OR LeaveType = '' THEN 1 ELSE 0 END) as missing_leave_type,
        SUM(CASE WHEN Status IS NULL OR Status = '' THEN 1 ELSE 0 END) as missing_status
      FROM leave_management
    `);

    console.log(`\n⚠️  Data quality check:`);
    console.table(dataQuality);

    // Step 10: Calculate sync statistics
    const totalLeaves = legacyCount[0].total;
    const validEmps = hrmsEmps.length;
    const missingEmpCount = missingEmps.length;
    const dataIssues = dataQuality[0].missing_from_date + dataQuality[0].missing_to_date;

    console.log(`\n${'='.repeat(80)}`);
    console.log('SYNC READINESS REPORT');
    console.log('='.repeat(80));
    console.log(`Total legacy leave records: ${totalLeaves}`);
    console.log(`Employees validated in HRMS: ${validEmps}/${empCodes.length} (${Math.round((validEmps / empCodes.length) * 100)}%)`);
    console.log(`Missing employees: ${missingEmpCount}`);
    console.log(`Records with date issues: ${dataIssues}`);
    console.log(`\n✅ Estimated syncable records: ~${Math.round((validEmps / empCodes.length) * totalLeaves)}`);
    console.log(`⚠️  Estimated skipped records: ~${Math.round((missingEmpCount / empCodes.length) * totalLeaves)}`);

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ DRY RUN COMPLETE - NO DATA WAS MODIFIED');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error during dry run:', error.message);
    throw error;
  } finally {
    await legacyConn.end();
    await hrmsConn.end();
  }
}

// Run dry run
dryRunLeaveSyn().catch(console.error);
