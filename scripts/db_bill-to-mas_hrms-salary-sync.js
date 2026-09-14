#!/usr/bin/env node

/**
 * db_bill to mas_hrms Salary Data Sync Script
 *
 * Purpose: Live sync salary data from db_bill (source of truth) to mas_hrms
 *
 * Features:
 * - Pull all historical salary records
 * - Map db_bill schema to mas_hrms schema
 * - Create salary_prep_line records
 * - Create salary_prep_line_component records (breakdown)
 * - Handle incremental sync (only new/updated records)
 * - Support full sync and delta sync modes
 *
 * Usage:
 *   node db_bill-to-mas_hrms-salary-sync.js --mode=full
 *   node db_bill-to-mas_hrms-salary-sync.js --mode=delta
 *   node db_bill-to-mas_hrms-salary-sync.js --employee=MAS47814
 */

const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Database configurations
const DB_BILL_CONFIG = {
  host: requiredEnv('BILL_DB_HOST'),
  port: Number(process.env.BILL_DB_PORT || 3306),
  user: requiredEnv('BILL_DB_USER'),
  password: requiredEnv('BILL_DB_PASSWORD'),
  database: requiredEnv('BILL_DB_NAME')
};

const MAS_HRMS_CONFIG = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME')
};

// Component mapping: db_bill -> mas_hrms
const COMPONENT_MAPPING = {
  earnings: [
    { db_bill_field: 'Basic', component_code: 'BASIC', component_name: 'Basic Salary', taxable: true },
    { db_bill_field: 'HRA', component_code: 'HRA', component_name: 'House Rent Allowance', taxable: true },
    { db_bill_field: 'Bonus', component_code: 'BONUS', component_name: 'Performance Bonus', taxable: true },
    { db_bill_field: 'Conv', component_code: 'CONV', component_name: 'Conveyance Allowance', taxable: false },
    { db_bill_field: 'Portfolio', component_code: 'PORTFOLIO', component_name: 'Portfolio Allowance', taxable: true },
    { db_bill_field: 'MedicalAllowance', component_code: 'MA', component_name: 'Medical Allowance', taxable: false },
    { db_bill_field: 'LTA', component_code: 'LTA', component_name: 'Leave Travel Allowance', taxable: false },
    { db_bill_field: 'SpecialAllowance', component_code: 'SPECIAL', component_name: 'Special Allowance', taxable: true },
    { db_bill_field: 'OtherAllowance', component_code: 'OA', component_name: 'Other Allowance', taxable: true },
    { db_bill_field: 'Incentive', component_code: 'INCENTIVE', component_name: 'Incentive', taxable: true },
    { db_bill_field: 'ExtraDayIncentive', component_code: 'EXTRA_DAY_INC', component_name: 'Extra Day Incentive', taxable: true },
    { db_bill_field: 'Arrear', component_code: 'ARREAR', component_name: 'Arrear Payment', taxable: true },
  ],
  deductions: [
    { db_bill_field: 'EPF', component_code: 'PF_EMP', component_name: 'Provident Fund (Employee)', taxable: false },
    { db_bill_field: 'ESIC', component_code: 'ESIC_EMP', component_name: 'ESIC (Employee)', taxable: false },
    { db_bill_field: 'ProTaxDeduction', component_code: 'PT', component_name: 'Professional Tax', taxable: false },
    { db_bill_field: 'IncomeTax', component_code: 'TDS', component_name: 'Tax Deducted at Source', taxable: false },
    { db_bill_field: 'AdvPaid', component_code: 'ADV', component_name: 'Advance Recovery', taxable: false },
    { db_bill_field: 'LoanDed', component_code: 'LOAN', component_name: 'Loan Deduction', taxable: false },
    { db_bill_field: 'LeaveDeduction', component_code: 'LWP', component_name: 'Leave Without Pay', taxable: false },
    { db_bill_field: 'MobileDedcution', component_code: 'MOBILE_DED', component_name: 'Mobile Deduction', taxable: false },
    { db_bill_field: 'AssetRecovery', component_code: 'ASSET_REC', component_name: 'Asset Recovery', taxable: false },
    { db_bill_field: 'Insurance', component_code: 'INS', component_name: 'Insurance Deduction', taxable: false },
    { db_bill_field: 'OtherDeduction', component_code: 'OTHER_DED', component_name: 'Other Deduction', taxable: false },
  ],
  employer_costs: [
    { db_bill_field: 'EPFCompany', component_code: 'PF_EMP_CO', component_name: 'Provident Fund (Employer)', taxable: false },
    { db_bill_field: 'ESICCompany', component_code: 'ESIC_EMP_CO', component_name: 'ESIC (Employer)', taxable: false },
    { db_bill_field: 'AdminChrg', component_code: 'ADMIN_CHG', component_name: 'Admin Charges', taxable: false },
  ]
};

class SalarySync {
  constructor() {
    this.dbBillConnection = null;
    this.masHrmsConnection = null;
    this.stats = {
      totalProcessed: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      skippedSyncs: 0,
      componentsCreated: 0,
      errors: []
    };
  }

  async connect() {
    console.log('🔌 Connecting to databases...');
    this.dbBillConnection = await mysql.createConnection(DB_BILL_CONFIG);
    this.masHrmsConnection = await mysql.createConnection(MAS_HRMS_CONFIG);
    console.log('✅ Connected to both databases');
  }

  async disconnect() {
    if (this.dbBillConnection) await this.dbBillConnection.end();
    if (this.masHrmsConnection) await this.masHrmsConnection.end();
    console.log('🔌 Disconnected from databases');
  }

  /**
   * Get employee_id from mas_hrms by employee_code
   */
  async getEmployeeId(employeeCode) {
    const [rows] = await this.masHrmsConnection.execute(
      'SELECT id FROM employees WHERE employee_code = ?',
      [employeeCode]
    );
    return rows.length > 0 ? rows[0].id : null;
  }

  /**
   * Get or create salary_prep_run for a given month
   */
  async getOrCreateRun(salaryMonth) {
    // Check if run exists
    const [runs] = await this.masHrmsConnection.execute(
      'SELECT id FROM salary_prep_run WHERE run_month = ? LIMIT 1',
      [salaryMonth]
    );

    if (runs.length > 0) {
      return runs[0].id;
    }

    // Create new run
    const runId = this.generateUUID();
    await this.masHrmsConnection.execute(
      `INSERT INTO salary_prep_run (id, run_month, status) VALUES (?, ?, 'FINALIZED')`,
      [runId, salaryMonth]
    );
    console.log(`  ✅ Created salary_prep_run for ${salaryMonth}`);
    return runId;
  }

  /**
   * Check if salary record already exists
   */
  async salaryRecordExists(employeeId, runId) {
    const [rows] = await this.masHrmsConnection.execute(
      'SELECT id FROM salary_prep_line WHERE employee_id = ? AND run_id = ? LIMIT 1',
      [employeeId, runId]
    );
    return rows.length > 0 ? rows[0].id : null;
  }

  /**
   * Parse numeric value from db_bill (handles NULL, empty strings)
   */
  parseNumeric(value) {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Convert db_bill salary date to YYYY-MM format
   */
  formatSalaryMonth(salDate) {
    if (!salDate) return null;
    const date = new Date(salDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Generate UUID (v4)
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Sync single salary record from db_bill to mas_hrms
   */
  async syncSalaryRecord(salaryData) {
    const employeeCode = salaryData.EmpCode;
    const salaryMonth = this.formatSalaryMonth(salaryData.SalayDate);

    console.log(`\n📋 Processing ${employeeCode} - ${salaryMonth}`);

    try {
      // Get employee_id
      const employeeId = await this.getEmployeeId(employeeCode);
      if (!employeeId) {
        console.log(`  ⚠️  Employee ${employeeCode} not found in mas_hrms, skipping`);
        this.stats.skippedSyncs++;
        return;
      }

      // Get or create run
      const runId = await this.getOrCreateRun(salaryMonth);

      // Check if already exists
      const existingId = await this.salaryRecordExists(employeeId, runId);
      if (existingId) {
        console.log(`  ⏭️  Record already exists, skipping`);
        this.stats.skippedSyncs++;
        return;
      }

      // Parse all numeric values
      const basic = this.parseNumeric(salaryData.Basic);
      const hra = this.parseNumeric(salaryData.HRA);
      const specialAllowance = this.parseNumeric(salaryData.SpecialAllowance);
      const gross = this.parseNumeric(salaryData.Gross);
      const pfEmployee = this.parseNumeric(salaryData.EPF);
      const pfEmployer = this.parseNumeric(salaryData.EPFCompany);
      const esicEmployee = this.parseNumeric(salaryData.ESIC);
      const esicEmployer = this.parseNumeric(salaryData.ESICCompany);
      const professionalTax = this.parseNumeric(salaryData.ProTaxDeduction);
      const tds = this.parseNumeric(salaryData.IncomeTax);
      const totalDeductions = pfEmployee + esicEmployee + professionalTax + tds;
      const netSalary = this.parseNumeric(salaryData.NetSalary);
      const workingDays = this.parseNumeric(salaryData.WorkingDays);
      const presentDays = this.parseNumeric(salaryData.EarnedDays);
      const leaveDays = this.parseNumeric(salaryData.Leave);

      // Create salary_prep_line
      const lineId = this.generateUUID();
      await this.masHrmsConnection.execute(
        `INSERT INTO salary_prep_line (
          id, run_id, employee_id, employee_code,
          working_days, present_days, leave_days, lwp_days, late_marks,
          gross_salary, total_deductions, net_salary,
          pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, tds, tds_amount, lwp_deduction, advance_recovery,
          basic, hra, special_allowance, employer_statutory_cost,
          status
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, 0, 0,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, 0, 0,
          ?, ?, ?, ?,
          'APPROVED'
        )`,
        [
          lineId, runId, employeeId, employeeCode,
          workingDays, presentDays, leaveDays,
          gross, totalDeductions, netSalary,
          pfEmployee, pfEmployer, esicEmployee, esicEmployer,
          professionalTax, tds, tds,
          basic, hra, specialAllowance, (pfEmployer + esicEmployer)
        ]
      );
      console.log(`  ✅ Created salary_prep_line`);

      // Create component breakdown
      let componentCount = 0;

      // Earnings
      for (const comp of COMPONENT_MAPPING.earnings) {
        const amount = this.parseNumeric(salaryData[comp.db_bill_field]);
        if (amount > 0) {
          const compId = this.generateUUID();
          await this.masHrmsConnection.execute(
            `INSERT INTO salary_prep_line_component (
              id, run_id, line_id, employee_id,
              component_code, component_name, component_type,
              amount, taxable
            ) VALUES (?, ?, ?, ?, ?, ?, 'earning', ?, ?)`,
            [
              compId, runId, lineId, employeeId,
              comp.component_code, comp.component_name,
              amount, comp.taxable ? 1 : 0
            ]
          );
          componentCount++;
        }
      }

      // Deductions
      for (const comp of COMPONENT_MAPPING.deductions) {
        const amount = this.parseNumeric(salaryData[comp.db_bill_field]);
        if (amount > 0) {
          const compId = this.generateUUID();
          await this.masHrmsConnection.execute(
            `INSERT INTO salary_prep_line_component (
              id, run_id, line_id, employee_id,
              component_code, component_name, component_type,
              amount, taxable
            ) VALUES (?, ?, ?, ?, ?, ?, 'deduction', ?, 0)`,
            [
              compId, runId, lineId, employeeId,
              comp.component_code, comp.component_name,
              amount
            ]
          );
          componentCount++;
        }
      }

      // Employer costs (not visible to employee, but part of CTC)
      for (const comp of COMPONENT_MAPPING.employer_costs) {
        const amount = this.parseNumeric(salaryData[comp.db_bill_field]);
        if (amount > 0) {
          const compId = this.generateUUID();
          await this.masHrmsConnection.execute(
            `INSERT INTO salary_prep_line_component (
              id, run_id, line_id, employee_id,
              component_code, component_name, component_type,
              amount, taxable
            ) VALUES (?, ?, ?, ?, ?, ?, 'employer_cost', ?, 0)`,
            [
              compId, runId, lineId, employeeId,
              comp.component_code, comp.component_name,
              amount
            ]
          );
          componentCount++;
        }
      }

      console.log(`  ✅ Created ${componentCount} salary components`);
      this.stats.componentsCreated += componentCount;
      this.stats.successfulSyncs++;

    } catch (error) {
      console.error(`  ❌ Error syncing ${employeeCode}: ${error.message}`);
      this.stats.failedSyncs++;
      this.stats.errors.push({ employeeCode, salaryMonth, error: error.message });
    }

    this.stats.totalProcessed++;
  }

  /**
   * Full sync: Pull all salary records from db_bill
   */
  async fullSync(employeeCode = null) {
    console.log('\n🔄 Starting FULL SYNC from db_bill to mas_hrms\n');

    let query = `
      SELECT * FROM salary_data
      WHERE Status = '1'
      ${employeeCode ? 'AND EmpCode = ?' : ''}
      ORDER BY SalayDate DESC, EmpCode
    `;

    const [salaryRecords] = employeeCode
      ? await this.dbBillConnection.execute(query, [employeeCode])
      : await this.dbBillConnection.execute(query);

    console.log(`📊 Found ${salaryRecords.length} salary records in db_bill`);

    for (const record of salaryRecords) {
      await this.syncSalaryRecord(record);
    }
  }

  /**
   * Delta sync: Only sync records from last N months
   */
  async deltaSync(monthsBack = 6) {
    console.log(`\n🔄 Starting DELTA SYNC (last ${monthsBack} months)\n`);

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const [salaryRecords] = await this.dbBillConnection.execute(
      `SELECT * FROM salary_data
       WHERE Status = '1' AND SalayDate >= ?
       ORDER BY SalayDate DESC, EmpCode`,
      [cutoffStr]
    );

    console.log(`📊 Found ${salaryRecords.length} salary records (since ${cutoffStr})`);

    for (const record of salaryRecords) {
      await this.syncSalaryRecord(record);
    }
  }

  /**
   * Print sync statistics
   */
  printStats() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SYNC STATISTICS');
    console.log('='.repeat(60));
    console.log(`Total Records Processed: ${this.stats.totalProcessed}`);
    console.log(`✅ Successful Syncs: ${this.stats.successfulSyncs}`);
    console.log(`⏭️  Skipped (Already Exist): ${this.stats.skippedSyncs}`);
    console.log(`❌ Failed Syncs: ${this.stats.failedSyncs}`);
    console.log(`🔢 Components Created: ${this.stats.componentsCreated}`);

    if (this.stats.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.stats.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.employeeCode} (${err.salaryMonth}): ${err.error}`);
      });
    }

    console.log('='.repeat(60) + '\n');
  }
}

// Main execution
(async function main() {
  const args = process.argv.slice(2);
  const mode = args.find(a => a.startsWith('--mode='))?.split('=')[1] || 'full';
  const employeeCode = args.find(a => a.startsWith('--employee='))?.split('=')[1];
  const monthsBack = parseInt(args.find(a => a.startsWith('--months='))?.split('=')[1] || '6');

  const sync = new SalarySync();

  try {
    await sync.connect();

    if (mode === 'delta') {
      await sync.deltaSync(monthsBack);
    } else {
      await sync.fullSync(employeeCode);
    }

    sync.printStats();

  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  } finally {
    await sync.disconnect();
  }
})();
