/**
 * Fix employees with NULL branch_id
 *
 * Run: node scripts/fix-null-branch-ids.mjs
 *
 * This script:
 * 1. Lists all active employees with NULL branch_id
 * 2. Attempts to match them to branches via branch_name or other data
 * 3. Updates branch_id after confirmation
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || '192.168.10.6',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'mas_hrms',
  connectionLimit: 5,
  timezone: '+05:30',
});

async function main() {
  console.log('\n=== Fix NULL branch_id for employees ===\n');

  // 1. Get all branches for reference
  const [branches] = await pool.query(`
    SELECT id, branch_name, branch_code, city
    FROM branch_master
    ORDER BY branch_name
  `);
  console.log('Available branches:');
  branches.forEach(b => console.log(`  - ${b.branch_name} (${b.branch_code}) → ${b.id}`));

  // Find NOIDA branch specifically
  const noidaBranch = branches.find(b =>
    b.branch_name?.toUpperCase().includes('NOIDA') &&
    !b.branch_name?.toUpperCase().includes('NOIDA-')
  );
  console.log(`\nNOIDA branch: ${noidaBranch?.branch_name} → ${noidaBranch?.id}`);

  // 2. Find employees with NULL branch_id
  const [nullBranchEmployees] = await pool.query(`
    SELECT id, employee_code, full_name, branch_id, employment_status,
           date_of_joining, cost_centre_name
    FROM employees
    WHERE branch_id IS NULL
      AND employment_status = 'Active'
    ORDER BY employee_code
  `);

  console.log(`\n=== Employees with NULL branch_id (Active): ${nullBranchEmployees.length} ===\n`);

  if (nullBranchEmployees.length === 0) {
    console.log('No active employees with NULL branch_id found.');
    await pool.end();
    return;
  }

  nullBranchEmployees.forEach(e => {
    console.log(`  ${e.employee_code} | ${e.full_name} | cost_centre: ${e.cost_centre_name || 'N/A'}`);
  });

  // 3. Check db_bill for branch mapping if available
  console.log('\n=== Checking db_bill for branch data ===\n');

  const dbBillPool = mysql.createPool({
    host: process.env.DB_BILL_HOST || '192.168.10.22',
    port: parseInt(process.env.DB_BILL_PORT || '3306'),
    user: process.env.DB_BILL_USER || process.env.DB_USER,
    password: process.env.DB_BILL_PASSWORD || process.env.DB_PASSWORD,
    database: 'db_bill',
    connectionLimit: 2,
    timezone: '+05:30',
  });

  try {
    const empCodes = nullBranchEmployees.map(e => e.employee_code);
    const [billData] = await dbBillPool.query(`
      SELECT EmpCode, BranchName, CostCenter
      FROM masjclrentry
      WHERE EmpCode IN (?)
      GROUP BY EmpCode, BranchName, CostCenter
    `, [empCodes]);

    console.log('Branch data from db_bill:');
    const branchMap = {};
    billData.forEach(row => {
      console.log(`  ${row.EmpCode} → ${row.BranchName} (${row.CostCenter})`);
      branchMap[row.EmpCode] = row.BranchName;
    });

    // 4. Build update statements
    console.log('\n=== Proposed Updates ===\n');

    const updates = [];
    for (const emp of nullBranchEmployees) {
      const billBranch = branchMap[emp.employee_code];
      let targetBranch = null;

      if (billBranch) {
        // Match db_bill branch name to branch_master
        targetBranch = branches.find(b =>
          b.branch_name?.toUpperCase() === billBranch?.toUpperCase() ||
          b.branch_code?.toUpperCase() === billBranch?.toUpperCase()
        );
      }

      // Fallback: check cost_centre_name
      if (!targetBranch && emp.cost_centre_name) {
        targetBranch = branches.find(b =>
          b.branch_name?.toUpperCase() === emp.cost_centre_name?.toUpperCase() ||
          emp.cost_centre_name?.toUpperCase().includes(b.branch_name?.toUpperCase())
        );
      }

      if (targetBranch) {
        updates.push({
          employeeId: emp.id,
          employeeCode: emp.employee_code,
          fullName: emp.full_name,
          branchId: targetBranch.id,
          branchName: targetBranch.branch_name,
          source: billBranch ? 'db_bill' : 'cost_centre',
        });
        console.log(`  ${emp.employee_code} (${emp.full_name}) → ${targetBranch.branch_name} [${billBranch ? 'db_bill' : 'cost_centre'}]`);
      } else {
        console.log(`  ${emp.employee_code} (${emp.full_name}) → ??? (no match found, source: ${billBranch || emp.cost_centre_name || 'none'})`);
      }
    }

    await dbBillPool.end();

    // 5. Execute updates
    if (updates.length > 0) {
      console.log(`\n=== Executing ${updates.length} updates ===\n`);

      for (const u of updates) {
        await pool.execute(
          `UPDATE employees SET branch_id = ? WHERE id = ?`,
          [u.branchId, u.employeeId]
        );
        console.log(`  ✓ Updated ${u.employeeCode} → branch_id = ${u.branchId} (${u.branchName})`);
      }

      console.log(`\n✅ Updated ${updates.length} employees.`);
    } else {
      console.log('\nNo automatic updates possible. Manual review required.');
    }

  } catch (err) {
    console.error('db_bill lookup failed:', err.message);
    console.log('Falling back to manual NOIDA assignment for MAS53006...');

    // Manual fix for MAS53006 → NOIDA
    if (noidaBranch) {
      const mas53006 = nullBranchEmployees.find(e => e.employee_code === 'MAS53006');
      if (mas53006) {
        await pool.execute(
          `UPDATE employees SET branch_id = ? WHERE employee_code = ?`,
          [noidaBranch.id, 'MAS53006']
        );
        console.log(`✓ Updated MAS53006 → NOIDA (${noidaBranch.id})`);
      }
    }
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
