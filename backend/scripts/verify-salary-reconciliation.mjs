/**
 * Verify July 2026 salary reconciliation between mas_hrms and db_bill
 * Run: node backend/scripts/verify-salary-reconciliation.mjs
 */
import mysql from 'mysql2/promise';

// The database password is read from the environment, never written here. This file was one
// of 13 that had it as a source literal; the repository is public and the same value
// authenticates mas_hrms, dialer_db, db_bill and mcn_lms. Pasting it back is exactly what
// backend/src/db/__tests__/no-hardcoded-credentials.contract.test.ts exists to catch.
// Run: node --env-file=backend/.env <this script>
if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is not set. Run with: node --env-file=backend/.env <script>');
}

async function main() {
  const masConn = await mysql.createConnection({
    host: '122.184.128.90', port: 3306, user: 'shivam_user',
    password: process.env.DB_PASSWORD, database: 'mas_hrms', connectTimeout: 30000
  });

  const billConn = await mysql.createConnection({
    host: '14.97.30.236', port: 3306, user: 'shivam_user',
    password: process.env.DB_PASSWORD, database: 'db_bill', connectTimeout: 30000
  });

  try {
    // mas_hrms July 2026 salary (excluding IDC/DIALDESK)
    const [[masRow]] = await masConn.execute(`
      SELECT SUM(spl.net_pay) AS total
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      JOIN branch_master b ON b.id = e.branch_id
      WHERE spr.period = '2026-07' AND spr.status = 'LOCKED'
        AND b.branch_name NOT IN ('IDC', 'NOIDA-DIALDESK')
    `);

    // db_bill July 2026 salary (excluding IDC/DIALDESK)
    const [[billRow]] = await billConn.execute(`
      SELECT SUM(NetPay) AS total
      FROM salary_data
      WHERE SalMonth = 7 AND SalYear = 2026
        AND BranchName NOT IN ('IDC', 'NOIDA-DIALDESK')
    `);

    const masTotal = Number(masRow.total || 0);
    const billTotal = Number(billRow.total || 0);
    const diff = masTotal - billTotal;

    console.log('=== July 2026 Salary Reconciliation (Post-Fix) ===');
    console.log('mas_hrms:   ₹' + masTotal.toLocaleString('en-IN'));
    console.log('db_bill:    ₹' + billTotal.toLocaleString('en-IN'));
    console.log('Difference: ₹' + diff.toLocaleString('en-IN') + ' (' + ((diff/billTotal)*100).toFixed(2) + '%)');

    if (Math.abs(diff) < 10000) {
      console.log('\n✓ RECONCILED - Gap is negligible');
    } else {
      console.log('\n⚠ Gap still exists - investigating...');
    }

  } finally {
    await masConn.end();
    await billConn.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
