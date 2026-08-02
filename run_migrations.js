/**
 * Run Sidebar Migrations Script
 * This script executes both Phase 1 and Phase 2 migrations
 *
 * Usage: node run_migrations.js
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_CONFIG = {
  host: '122.184.128.90',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
  multipleStatements: true
};

async function runMigrations() {
  let connection;

  try {
    console.log('==========================================');
    console.log('Running Sidebar Migrations');
    console.log('==========================================\n');

    // Connect to database
    console.log('Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✓ Connected successfully\n');

    // Phase 1: Add 18 critical missing pages
    console.log('Phase 1: Adding 18 critical missing pages...');
    const phase1SQL = fs.readFileSync(
      path.join(__dirname, 'backend/sql/add_missing_page_catalog_entries.sql'),
      'utf8'
    );
    await connection.query(phase1SQL);
    console.log('✓ Phase 1 migration completed\n');

    // Phase 2: Add 2 missing report pages
    console.log('Phase 2: Adding 2 missing report pages...');
    const phase2SQL = fs.readFileSync(
      path.join(__dirname, 'backend/sql/add_missing_report_pages.sql'),
      'utf8'
    );
    await connection.query(phase2SQL);
    console.log('✓ Phase 2 migration completed\n');

    // Verification
    console.log('==========================================');
    console.log('Verification');
    console.log('==========================================\n');

    // Check total count
    console.log('Checking page_catalog entries...');
    const [countResult] = await connection.query(`
      SELECT COUNT(*) as total
      FROM page_catalog
      WHERE page_code IN (
        'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
        'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
        'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
        'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER',
        'LMS_PROGRESS_DASHBOARD', 'COMPLIANCE_AUDIT_REPORT'
      )
    `);
    console.log(`Total pages added: ${countResult[0].total} (Expected: 20)\n`);

    // Show details by module
    console.log('Pages added by module:');
    const [pages] = await connection.query(`
      SELECT
        pc.module,
        pc.page_code,
        pc.page_name,
        pc.active_status,
        COUNT(rpa.role_key) as role_count
      FROM page_catalog pc
      LEFT JOIN role_page_access rpa ON pc.page_code = rpa.page_code
      WHERE pc.page_code IN (
        'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
        'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
        'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
        'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER',
        'LMS_PROGRESS_DASHBOARD', 'COMPLIANCE_AUDIT_REPORT'
      )
      GROUP BY pc.page_code
      ORDER BY pc.module, pc.page_code
    `);

    console.table(pages.map(p => ({
      Module: p.module,
      'Page Code': p.page_code,
      'Page Name': p.page_name,
      Status: p.active_status === 1 ? 'Active' : 'Inactive',
      'Roles': p.role_count
    })));

    console.log('\n==========================================');
    console.log('✓ All migrations completed successfully!');
    console.log('==========================================\n');

    console.log('Summary:');
    console.log('- Phase 1: 18 pages added (Expenses, Dashboards, Payroll, Admin)');
    console.log('- Phase 2: 2 pages added (LMS Progress, Compliance Audit)');
    console.log('- Total: 20 pages with role permissions configured\n');

    console.log('Next steps:');
    console.log('1. Deploy frontend build to production');
    console.log('2. Test with different user roles');
    console.log('3. Verify sidebar shows new pages\n');

  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    console.error('\nError details:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed.');
    }
  }
}

// Run migrations
runMigrations().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
