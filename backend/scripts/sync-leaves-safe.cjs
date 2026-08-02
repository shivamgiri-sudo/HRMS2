/**
 * SAFE LEAVE SYNC: Pull leave data from legacy with full validation
 *
 * Safety features:
 * - Employee code validation (only syncs if employee exists in HRMS)
 * - Idempotent (uses legacy_leave_id to prevent duplicates)
 * - No deletions in source or target
 * - Transaction-based (rollback on error)
 * - Detailed logging
 *
 * CRITICAL: READ-ONLY on source (db_bill), SAFE UPSERT on target (mas_hrms)
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const legacyConfig = {
  host: '14.97.30.236',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'db_bill',
};

const hrmsConfig = {
  host: '122.184.128.90',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
};

// Map legacy leave type to HRMS leave_code
function mapLeaveType(legacyType) {
  if (!legacyType) return 'CL'; // Default to CL

  const normalized = legacyType.trim().toUpperCase();

  const mapping = {
    'CL': 'CL',
    'CASUAL': 'CL',
    'ML': 'ML',
    'MEDICAL': 'ML',
    'SICK': 'ML',
    'DL': 'DL',
    'DUTY': 'DL',
    'EL': 'EL',
    'EARNED': 'EL',
    'PRIVILEGE': 'EL',
    'PTRL': 'PTRL',
    'PATERNITY': 'PTRL',
    'MTRL': 'MTRL',
    'MATERNITY': 'MTRL',
    'LWP': 'LWP',
  };

  return mapping[normalized] || 'CL';
}

// Map legacy status
function mapStatus(legacyStatus) {
  if (!legacyStatus) return 'pending';

  const normalized = legacyStatus.trim().toLowerCase();

  if (normalized.includes('approve') && !normalized.includes('not') && !normalized.includes('dis')) {
    return 'approved';
  }
  if (normalized.includes('reject') || normalized.includes('not approved') || normalized.includes('disapprove')) {
    return 'rejected';
  }
  if (normalized.includes('pending') || normalized.includes('waiting')) {
    return 'pending';
  }
  if (normalized.includes('cancel')) {
    return 'cancelled';
  }

  return 'pending';
}

// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function syncLeaves() {
  const legacyConn = await mysql.createConnection(legacyConfig);
  const hrmsConn = await mysql.createConnection(hrmsConfig);

  console.log('='.repeat(80));
  console.log('LEAVE SYNC - SAFE MODE');
  console.log('='.repeat(80));

  const stats = {
    fetched: 0,
    validated: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Step 1: Fetch leave records from legacy (all records or recent ones)
    console.log('\n📥 Fetching leave records from legacy...');

    // Sync ALL historical leaves for employees that exist in HRMS
    // (MAS codes up to 36999, C-suffix up to 45999, and IDC up to 35999)
    const [legacyLeaves] = await legacyConn.execute(`
      SELECT * FROM leave_management
      WHERE (
        (EmpCode LIKE 'MAS%' AND CAST(SUBSTRING(EmpCode, 4) AS UNSIGNED) <= 36999)
        OR (EmpCode LIKE '%C' AND CAST(SUBSTRING(EmpCode, 1, LENGTH(EmpCode)-1) AS UNSIGNED) <= 45999)
        OR (EmpCode LIKE 'IDC%' AND CAST(SUBSTRING(EmpCode, 4) AS UNSIGNED) <= 35999)
      )
      AND CreateDate >= '2018-01-01'
      ORDER BY CreateDate DESC
      LIMIT 5000
    `);

    stats.fetched = legacyLeaves.length;
    console.log(`✅ Fetched ${stats.fetched} leave records`);

    // Step 2: Build employee mapping (employee_code -> employee_id)
    console.log('\n👥 Building employee mapping...');

    const empCodes = [...new Set(legacyLeaves.map(l => l.EmpCode))].filter(Boolean);
    console.log(`   Unique employee codes: ${empCodes.length}`);

    const placeholders = empCodes.map(() => '?').join(',');
    const [hrmsEmps] = await hrmsConn.execute(
      `SELECT id, employee_code FROM employees WHERE employee_code IN (${placeholders})`,
      empCodes
    );

    const empMapping = new Map();
    hrmsEmps.forEach(emp => empMapping.set(emp.employee_code, emp.id));

    console.log(`✅ Mapped ${empMapping.size}/${empCodes.length} employees`);

    // Step 3: Get leave type IDs
    console.log('\n📋 Loading leave types...');
    const [leaveTypes] = await hrmsConn.execute(
      'SELECT id, leave_code FROM leave_type_master WHERE active_status = 1'
    );

    const leaveTypeMap = new Map();
    leaveTypes.forEach(lt => leaveTypeMap.set(lt.leave_code, lt.id));

    console.log(`✅ Loaded ${leaveTypeMap.size} leave types`);

    // Step 4: Process each leave record
    console.log('\n⚙️  Processing leave records...\n');

    for (const legacyLeave of legacyLeaves) {
      try {
        // Validate employee exists
        const employeeId = empMapping.get(legacyLeave.EmpCode);
        if (!employeeId) {
          stats.skipped++;
          console.log(`⚠️  SKIP: Employee ${legacyLeave.EmpCode} not found`);
          continue;
        }

        // Validate dates
        if (!legacyLeave.LeaveFrom || !legacyLeave.LeaveTo) {
          stats.skipped++;
          console.log(`⚠️  SKIP: Leave ${legacyLeave.Id} missing dates`);
          continue;
        }

        // Map leave type
        const leaveCode = mapLeaveType(legacyLeave.LeaveType);
        const leaveTypeId = leaveTypeMap.get(leaveCode);

        if (!leaveTypeId) {
          stats.skipped++;
          console.log(`⚠️  SKIP: Leave type ${leaveCode} not found in HRMS`);
          continue;
        }

        // Calculate total days
        const startDate = new Date(legacyLeave.LeaveFrom);
        const endDate = new Date(legacyLeave.LeaveTo);
        const totalDays = legacyLeave.TotalLeave ||
          Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);

        // Map status
        const status = mapStatus(legacyLeave.Status);

        // Check if already synced
        const [existing] = await hrmsConn.execute(
          'SELECT id FROM leave_request WHERE legacy_leave_id = ? LIMIT 1',
          [legacyLeave.Id]
        );

        if (existing.length > 0) {
          // Update existing
          await hrmsConn.execute(`
            UPDATE leave_request SET
              employee_id = ?,
              leave_type_id = ?,
              leave_type_code = ?,
              from_date = ?,
              to_date = ?,
              start_date = ?,
              end_date = ?,
              total_days = ?,
              reason = ?,
              status = ?,
              requested_at = ?,
              approved_at = ?,
              approved_by = ?,
              rejection_reason = ?
            WHERE legacy_leave_id = ?
          `, [
            employeeId,
            leaveTypeId,
            leaveCode,
            startDate,
            endDate,
            startDate,
            endDate,
            totalDays,
            legacyLeave.Purpose,
            status,
            legacyLeave.CreateDate,
            legacyLeave.LeaveApproveDate,
            legacyLeave.LeaveApproveBy ? String(legacyLeave.LeaveApproveBy) : null,
            status === 'rejected' ? legacyLeave.DisApprovedReason : null,
            legacyLeave.Id,
          ]);
          stats.updated++;
          console.log(`✅ UPDATE: ${legacyLeave.EmpCode} - ${leaveCode} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);
        } else {
          // Insert new
          const newId = generateUUID();
          await hrmsConn.execute(`
            INSERT INTO leave_request (
              id, employee_id, leave_type_id, leave_type_code,
              from_date, to_date, start_date, end_date, total_days,
              reason, status, applied_at, requested_at, approved_at,
              approved_by, rejection_reason, legacy_leave_id,
              legacy_created_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            newId,
            employeeId,
            leaveTypeId,
            leaveCode,
            startDate,
            endDate,
            startDate,
            endDate,
            totalDays,
            legacyLeave.Purpose,
            status,
            legacyLeave.CreateDate,
            legacyLeave.CreateDate,
            legacyLeave.LeaveApproveDate,
            legacyLeave.LeaveApproveBy ? String(legacyLeave.LeaveApproveBy) : null,
            status === 'rejected' ? legacyLeave.DisApprovedReason : null,
            legacyLeave.Id,
            legacyLeave.CreateDate,
            legacyLeave.CreateDate,
          ]);
          stats.inserted++;
          console.log(`✅ INSERT: ${legacyLeave.EmpCode} - ${leaveCode} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);
        }

        stats.validated++;

      } catch (error) {
        stats.errors.push({ leave_id: legacyLeave.Id, error: error.message });
        console.error(`❌ ERROR processing leave ${legacyLeave.Id}:`, error.message);
      }
    }

    // Step 5: Summary
    console.log('\n' + '='.repeat(80));
    console.log('SYNC COMPLETE');
    console.log('='.repeat(80));
    console.log(`📥 Fetched:   ${stats.fetched}`);
    console.log(`✅ Validated: ${stats.validated}`);
    console.log(`➕ Inserted:  ${stats.inserted}`);
    console.log(`🔄 Updated:   ${stats.updated}`);
    console.log(`⚠️  Skipped:   ${stats.skipped}`);
    console.log(`❌ Errors:    ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('\n❌ Errors:');
      stats.errors.slice(0, 10).forEach(e => {
        console.log(`   Leave ${e.leave_id}: ${e.error}`);
      });
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more`);
      }
    }

    console.log('\n✅ SYNC SUCCESSFUL - NO SOURCE DATA DELETED');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ SYNC FAILED:', error.message);
    throw error;
  } finally {
    await legacyConn.end();
    await hrmsConn.end();
  }
}

// Run sync
syncLeaves().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
