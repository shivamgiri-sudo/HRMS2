/**
 * Fix June 2026 joiners who are inactive with NULL branch in mas_hrms
 * but were paid in db_bill July salary.
 *
 * Run: node backend/scripts/fix-june-joiners.mjs
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

const config = {
  host: '122.184.128.90',
  port: 3306,
  user: 'shivam_user',
  password: process.env.DB_PASSWORD,
  database: 'mas_hrms',
  connectTimeout: 30000,
};

const NOIDA2_BRANCH_ID = 'febd8777-6583-11f1-adb1-00155d0ab410';
const NOIDA_BRANCH_ID = '77769026-5e88-11f1-adb1-00155d0ab410';

const NOIDA2_EMPLOYEES = [
  'MAS62926','MAS62940','MAS62942','MAS62943','MAS62944','MAS62945',
  'MAS62948','MAS62953','MAS62955','MAS62961','MAS62966','MAS62967',
  'MAS62979','MAS62990','MAS62991','MAS63011','MAS63013','MAS63016',
  'MAS63017','MAS63020','MAS63022','MAS63024','MAS63026','MAS63030',
  'MAS63031','MAS63032'
];

const NOIDA_EMPLOYEES = ['MAS62923','MAS62929','MAS62982','MAS63035'];

async function main() {
  console.log('Connecting to mas_hrms...');
  const conn = await mysql.createConnection(config);

  try {
    // Fix NOIDA-2 employees
    console.log(`\nUpdating ${NOIDA2_EMPLOYEES.length} NOIDA-2 employees...`);
    const [r1] = await conn.execute(
      `UPDATE employees
       SET active_status = 1, branch_id = ?, updated_at = NOW()
       WHERE employee_code IN (${NOIDA2_EMPLOYEES.map(() => '?').join(',')})
         AND (active_status = 0 OR branch_id IS NULL)`,
      [NOIDA2_BRANCH_ID, ...NOIDA2_EMPLOYEES]
    );
    console.log(`NOIDA-2: ${r1.affectedRows} rows updated`);

    // Fix NOIDA employees
    console.log(`\nUpdating ${NOIDA_EMPLOYEES.length} NOIDA employees...`);
    const [r2] = await conn.execute(
      `UPDATE employees
       SET active_status = 1, branch_id = ?, updated_at = NOW()
       WHERE employee_code IN (${NOIDA_EMPLOYEES.map(() => '?').join(',')})
         AND (active_status = 0 OR branch_id IS NULL)`,
      [NOIDA_BRANCH_ID, ...NOIDA_EMPLOYEES]
    );
    console.log(`NOIDA: ${r2.affectedRows} rows updated`);

    // Verify
    console.log('\n--- Verification ---');
    const [verify] = await conn.execute(
      `SELECT e.employee_code, e.full_name, b.branch_name, e.active_status
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       WHERE e.employee_code IN (${[...NOIDA2_EMPLOYEES, ...NOIDA_EMPLOYEES].map(() => '?').join(',')})`,
      [...NOIDA2_EMPLOYEES, ...NOIDA_EMPLOYEES]
    );

    console.log('\nUpdated employees:');
    console.log('EmpCode      | Branch   | Active');
    console.log('-------------|----------|-------');
    for (const row of verify) {
      console.log(`${row.employee_code} | ${(row.branch_name || 'NULL').padEnd(8)} | ${row.active_status}`);
    }

    console.log(`\nTotal: ${r1.affectedRows + r2.affectedRows} employees fixed`);

  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
