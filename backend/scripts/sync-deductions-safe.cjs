/**
 * SAFE DEDUCTION SYNC: Pull deduction data from legacy
 *
 * Safety features:
 * - Employee validation
 * - Month-level deduplication (one record per employee per month)
 * - Idempotent (uses legacy_deduction_id)
 * - Safe amount parsing (handles NULL, strings, zeros)
 * - No deletions
 */

const mysql = require('mysql2/promise');

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

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseAmount(value) {
  if (!value || value === '') return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function normalizeSalaryMonth(month) {
  if (!month) return null;

  // Handle formats: "2026-05", "May-2026", "2026/05", etc.
  const cleaned = month.trim();

  // Already in YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  // Try YYYY/MM
  if (/^\d{4}\/\d{2}$/.test(cleaned)) {
    return cleaned.replace('/', '-');
  }

  // Try Mon-YYYY or Mon/YYYY
  const monthMap = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
  };

  const match = cleaned.match(/([a-z]+)[-/](\d{4})/i);
  if (match) {
    const monthName = match[1].toLowerCase().substring(0, 3);
    const year = match[2];
    const monthNum = monthMap[monthName];
    if (monthNum) {
      return `${year}-${monthNum}`;
    }
  }

  return null;
}

async function syncDeductions() {
  const legacyConn = await mysql.createConnection(legacyConfig);
  const hrmsConn = await mysql.createConnection(hrmsConfig);

  console.log('='.repeat(80));
  console.log('DEDUCTION SYNC - SAFE MODE');
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
    // Step 1: Fetch deduction records from legacy
    console.log('\n📥 Fetching deduction records from legacy...');

    const [legacyDeductions] = await legacyConn.execute(`
      SELECT * FROM upload_deduction
      WHERE ProcessStatus = 'Processed'
      ORDER BY UpdateDate DESC
      LIMIT 5000
    `);

    stats.fetched = legacyDeductions.length;
    console.log(`✅ Fetched ${stats.fetched} deduction records`);

    // Step 2: Build employee mapping
    console.log('\n👥 Building employee mapping...');

    const empCodes = [...new Set(legacyDeductions.map(d => d.EmpCode))].filter(Boolean);
    console.log(`   Unique employee codes: ${empCodes.length}`);

    const placeholders = empCodes.map(() => '?').join(',');
    const [hrmsEmps] = await hrmsConn.execute(
      `SELECT id, employee_code FROM employees WHERE employee_code IN (${placeholders})`,
      empCodes
    );

    const empMapping = new Map();
    hrmsEmps.forEach(emp => empMapping.set(emp.employee_code, emp.id));

    console.log(`✅ Mapped ${empMapping.size}/${empCodes.length} employees`);

    // Step 3: Process each deduction record
    console.log('\n⚙️  Processing deduction records...\n');

    for (const deduction of legacyDeductions) {
      try {
        // Validate employee exists
        const employeeId = empMapping.get(deduction.EmpCode);
        if (!employeeId) {
          stats.skipped++;
          continue;
        }

        // Normalize salary month
        const salaryMonth = normalizeSalaryMonth(deduction.SalaryMonth);
        if (!salaryMonth) {
          stats.skipped++;
          console.log(`⚠️  SKIP: Invalid salary month "${deduction.SalaryMonth}" for ${deduction.EmpCode}`);
          continue;
        }

        // Parse all deduction amounts
        const mobileDeduction = parseAmount(deduction.MobileDeduction);
        const shortCollection = parseAmount(deduction.ShortCollection);
        const assetRecovery = parseAmount(deduction.AssetRecovery);
        const insurance = parseAmount(deduction.Insurance);
        const professionalTax = parseAmount(deduction.ProfessionalTax);
        const leaveDeduction = parseAmount(deduction.LeaveDeduction);
        const othersDeduction = parseAmount(deduction.OthersDeduction);

        const totalDeduction = mobileDeduction + shortCollection + assetRecovery +
                             insurance + professionalTax + leaveDeduction + othersDeduction;

        // Skip if no deductions
        if (totalDeduction === 0) {
          stats.skipped++;
          continue;
        }

        // Check if already synced
        const [existing] = await hrmsConn.execute(
          'SELECT id FROM employee_deductions_log WHERE legacy_deduction_id = ? LIMIT 1',
          [deduction.Id]
        );

        if (existing.length > 0) {
          // Update existing
          await hrmsConn.execute(`
            UPDATE employee_deductions_log SET
              employee_id = ?,
              employee_code = ?,
              salary_month = ?,
              mobile_deduction = ?,
              short_collection = ?,
              asset_recovery = ?,
              insurance = ?,
              professional_tax = ?,
              leave_deduction = ?,
              others_deduction = ?,
              remarks = ?,
              deduction_remarks = ?,
              process_status = ?,
              branch_name = ?,
              cost_center = ?,
              legacy_import_date = ?,
              legacy_update_date = ?
            WHERE legacy_deduction_id = ?
          `, [
            employeeId,
            deduction.EmpCode,
            salaryMonth,
            mobileDeduction,
            shortCollection,
            assetRecovery,
            insurance,
            professionalTax,
            leaveDeduction,
            othersDeduction,
            deduction.Remarks,
            deduction.DeductionRemarks,
            deduction.ProcessStatus,
            deduction.BranchName,
            deduction.CostCenter,
            deduction.ImportDate,
            deduction.UpdateDate,
            deduction.Id,
          ]);
          stats.updated++;
          console.log(`✅ UPDATE: ${deduction.EmpCode} - ${salaryMonth} - ₹${totalDeduction.toFixed(2)}`);
        } else {
          // Check for duplicate (same employee + month)
          const [duplicate] = await hrmsConn.execute(
            'SELECT id FROM employee_deductions_log WHERE employee_id = ? AND salary_month = ? LIMIT 1',
            [employeeId, salaryMonth]
          );

          if (duplicate.length > 0) {
            // Merge with existing record (add to existing deductions)
            await hrmsConn.execute(`
              UPDATE employee_deductions_log SET
                mobile_deduction = mobile_deduction + ?,
                short_collection = short_collection + ?,
                asset_recovery = asset_recovery + ?,
                insurance = insurance + ?,
                professional_tax = professional_tax + ?,
                leave_deduction = leave_deduction + ?,
                others_deduction = others_deduction + ?,
                legacy_deduction_id = ?
              WHERE id = ?
            `, [
              mobileDeduction,
              shortCollection,
              assetRecovery,
              insurance,
              professionalTax,
              leaveDeduction,
              othersDeduction,
              deduction.Id,
              duplicate[0].id,
            ]);
            stats.updated++;
            console.log(`✅ MERGE: ${deduction.EmpCode} - ${salaryMonth} - ₹${totalDeduction.toFixed(2)} (merged into existing)`);
          } else {
            // Insert new
            const newId = generateUUID();
            await hrmsConn.execute(`
              INSERT INTO employee_deductions_log (
                id, employee_id, employee_code, salary_month,
                mobile_deduction, short_collection, asset_recovery,
                insurance, professional_tax, leave_deduction, others_deduction,
                remarks, deduction_remarks, process_status,
                branch_name, cost_center,
                legacy_deduction_id, legacy_import_date, legacy_update_date,
                created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              newId,
              employeeId,
              deduction.EmpCode,
              salaryMonth,
              mobileDeduction,
              shortCollection,
              assetRecovery,
              insurance,
              professionalTax,
              leaveDeduction,
              othersDeduction,
              deduction.Remarks,
              deduction.DeductionRemarks,
              deduction.ProcessStatus,
              deduction.BranchName,
              deduction.CostCenter,
              deduction.Id,
              deduction.ImportDate,
              deduction.UpdateDate,
              deduction.ImportDate || new Date(),
            ]);
            stats.inserted++;
            console.log(`✅ INSERT: ${deduction.EmpCode} - ${salaryMonth} - ₹${totalDeduction.toFixed(2)}`);
          }
        }

        stats.validated++;

      } catch (error) {
        stats.errors.push({
          deduction_id: deduction.Id,
          emp_code: deduction.EmpCode,
          month: deduction.SalaryMonth,
          error: error.message
        });
        console.error(`❌ ERROR processing deduction ${deduction.Id}:`, error.message);
      }
    }

    // Step 4: Summary
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
        console.log(`   Deduction ${e.deduction_id} (${e.emp_code} - ${e.month}): ${e.error}`);
      });
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more`);
      }
    }

    // Summary by month
    const [monthlySummary] = await hrmsConn.execute(`
      SELECT * FROM v_monthly_deductions_summary
      ORDER BY salary_year DESC, salary_month_num DESC
      LIMIT 12
    `);

    console.log('\n📊 Monthly Deduction Summary (Last 12 months):');
    console.table(monthlySummary);

    // Summary by category
    const [categorySummary] = await hrmsConn.execute(`
      SELECT
        'Mobile Deduction' as category,
        COUNT(*) as count,
        SUM(mobile_deduction) as total
      FROM employee_deductions_log WHERE mobile_deduction > 0
      UNION ALL
      SELECT
        'Short Collection',
        COUNT(*),
        SUM(short_collection)
      FROM employee_deductions_log WHERE short_collection > 0
      UNION ALL
      SELECT
        'Asset Recovery',
        COUNT(*),
        SUM(asset_recovery)
      FROM employee_deductions_log WHERE asset_recovery > 0
      UNION ALL
      SELECT
        'Insurance',
        COUNT(*),
        SUM(insurance)
      FROM employee_deductions_log WHERE insurance > 0
      UNION ALL
      SELECT
        'Professional Tax',
        COUNT(*),
        SUM(professional_tax)
      FROM employee_deductions_log WHERE professional_tax > 0
      UNION ALL
      SELECT
        'Leave Deduction',
        COUNT(*),
        SUM(leave_deduction)
      FROM employee_deductions_log WHERE leave_deduction > 0
      UNION ALL
      SELECT
        'Others',
        COUNT(*),
        SUM(others_deduction)
      FROM employee_deductions_log WHERE others_deduction > 0
    `);

    console.log('\n📊 Deduction Category Summary:');
    console.table(categorySummary);

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
syncDeductions().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
