/**
 * SAFE LOAN SYNC: Pull loan/advance data from legacy
 *
 * Safety features:
 * - Employee validation (only syncs if employee exists)
 * - Guarantor validation (maps guarantor employee_code to employee_id)
 * - Idempotent (uses legacy_loan_id to prevent duplicates)
 * - No deletions in source or target
 * - Detailed logging
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

async function syncLoans() {
  const legacyConn = await mysql.createConnection(legacyConfig);
  const hrmsConn = await mysql.createConnection(hrmsConfig);

  console.log('='.repeat(80));
  console.log('LOAN SYNC - SAFE MODE');
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
    // Step 1: Fetch all loan records from legacy
    console.log('\n📥 Fetching loan records from legacy...');

    const [legacyLoans] = await legacyConn.execute(`
      SELECT * FROM LoanMaster
      ORDER BY CreateDate DESC
    `);

    stats.fetched = legacyLoans.length;
    console.log(`✅ Fetched ${stats.fetched} loan records`);

    // Step 2: Build employee mapping (employee_code -> employee_id)
    console.log('\n👥 Building employee mapping...');

    const empCodes = [...new Set(legacyLoans.map(l => l.EmpCode).concat(legacyLoans.map(l => l.GuarantorEmpCode)))].filter(Boolean);
    console.log(`   Unique employee codes (employees + guarantors): ${empCodes.length}`);

    const placeholders = empCodes.map(() => '?').join(',');
    const [hrmsEmps] = await hrmsConn.execute(
      `SELECT id, employee_code FROM employees WHERE employee_code IN (${placeholders})`,
      empCodes
    );

    const empMapping = new Map();
    hrmsEmps.forEach(emp => empMapping.set(emp.employee_code, emp.id));

    console.log(`✅ Mapped ${empMapping.size}/${empCodes.length} employees`);

    // Step 3: Process each loan record
    console.log('\n⚙️  Processing loan records...\n');

    for (const loan of legacyLoans) {
      try {
        // Validate employee exists
        const employeeId = empMapping.get(loan.EmpCode);
        if (!employeeId) {
          stats.skipped++;
          console.log(`⚠️  SKIP: Employee ${loan.EmpCode} not found (Loan ID: ${loan.Id})`);
          continue;
        }

        // Map guarantor (optional)
        const guarantorId = loan.GuarantorEmpCode ? empMapping.get(loan.GuarantorEmpCode) : null;

        // Parse amounts (may be strings)
        const amount = parseFloat(loan.Amount) || 0;
        const deductionPerMonth = parseFloat(loan.DeductionPerMonth) || 0;
        const deductedAmount = parseFloat(loan.DeductedAmount) || 0;
        const pendingAmount = parseFloat(loan.PendingAmount) || amount;
        const installments = parseInt(loan.Installments) || 1;

        // Determine status
        let status = 'active';
        if (loan.TransationStatus) {
          const normalized = loan.TransationStatus.toLowerCase().trim();
          if (normalized === 'completed' || normalized === 'closed') {
            status = 'completed';
          } else if (normalized === 'cancelled' || normalized === 'rejected') {
            status = 'cancelled';
          }
        }
        // Also mark as completed if pending is 0
        if (pendingAmount <= 0) {
          status = 'completed';
        }

        // Parse approval
        let approved_by = null;
        let approved_at = null;
        if (loan.ApproveFirst === 'Yes' || loan.ApproveFirst === 'yes') {
          approved_by = 'Approved';
          approved_at = loan.ApproveFirstDate;
        }

        // Check if already synced
        const [existing] = await hrmsConn.execute(
          'SELECT id FROM employee_loans WHERE legacy_loan_id = ? LIMIT 1',
          [loan.Id]
        );

        if (existing.length > 0) {
          // Update existing
          await hrmsConn.execute(`
            UPDATE employee_loans SET
              employee_id = ?,
              employee_code = ?,
              loan_type = ?,
              amount = ?,
              start_date = ?,
              end_date = ?,
              installments = ?,
              deduction_per_month = ?,
              deducted_amount = ?,
              pending_amount = ?,
              status = ?,
              guarantor_name = ?,
              guarantor_emp_code = ?,
              guarantor_emp_id = ?,
              reason = ?,
              approved_by = ?,
              approved_at = ?,
              cheque_number = ?,
              cheque_bank = ?,
              cheque_date = ?,
              rtgs_number = ?,
              rtgs_date = ?,
              branch_name = ?,
              cost_center = ?,
              legacy_updated_at = ?
            WHERE legacy_loan_id = ?
          `, [
            employeeId,
            loan.EmpCode,
            loan.Type || 'Loan',
            amount,
            loan.StartDate,
            loan.EndDate,
            installments,
            deductionPerMonth,
            deductedAmount,
            pendingAmount,
            status,
            loan.GuarantorName,
            loan.GuarantorEmpCode,
            guarantorId,
            loan.Reason,
            approved_by,
            approved_at,
            loan.ChequeNumber,
            loan.ChequeBankName,
            loan.ChequeDate,
            loan.RTGSNumber,
            loan.RTGSDate,
            loan.BranchName,
            loan.CostCenter,
            loan.LastUpdateDate,
            loan.Id,
          ]);
          stats.updated++;
          console.log(`✅ UPDATE: ${loan.EmpCode} - ${loan.Type} - ₹${amount} (${status})`);
        } else {
          // Insert new
          const newId = generateUUID();
          await hrmsConn.execute(`
            INSERT INTO employee_loans (
              id, employee_id, employee_code, loan_type, amount,
              start_date, end_date, installments, deduction_per_month,
              deducted_amount, pending_amount, status,
              guarantor_name, guarantor_emp_code, guarantor_emp_id,
              reason, approved_by, approved_at,
              cheque_number, cheque_bank, cheque_date,
              rtgs_number, rtgs_date,
              branch_name, cost_center,
              legacy_loan_id, legacy_created_at, legacy_updated_at,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            newId,
            employeeId,
            loan.EmpCode,
            loan.Type || 'Loan',
            amount,
            loan.StartDate,
            loan.EndDate,
            installments,
            deductionPerMonth,
            deductedAmount,
            pendingAmount,
            status,
            loan.GuarantorName,
            loan.GuarantorEmpCode,
            guarantorId,
            loan.Reason,
            approved_by,
            approved_at,
            loan.ChequeNumber,
            loan.ChequeBankName,
            loan.ChequeDate,
            loan.RTGSNumber,
            loan.RTGSDate,
            loan.BranchName,
            loan.CostCenter,
            loan.Id,
            loan.CreateDate,
            loan.LastUpdateDate,
            loan.CreateDate,
          ]);
          stats.inserted++;
          console.log(`✅ INSERT: ${loan.EmpCode} - ${loan.Type} - ₹${amount} (${status})`);
        }

        stats.validated++;

      } catch (error) {
        stats.errors.push({ loan_id: loan.Id, emp_code: loan.EmpCode, error: error.message });
        console.error(`❌ ERROR processing loan ${loan.Id}:`, error.message);
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
        console.log(`   Loan ${e.loan_id} (${e.emp_code}): ${e.error}`);
      });
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more`);
      }
    }

    // Summary by status
    const [summary] = await hrmsConn.execute(`
      SELECT
        status,
        COUNT(*) as count,
        SUM(amount) as total_amount,
        SUM(pending_amount) as total_pending
      FROM employee_loans
      GROUP BY status
    `);

    console.log('\n📊 Loan Summary:');
    console.table(summary);

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
syncLoans().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
