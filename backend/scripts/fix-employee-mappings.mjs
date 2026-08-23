#!/usr/bin/env node
/**
 * Fix Employee Mappings Script
 *
 * 1. Backfills process_id from cost_centre_master for employees missing it
 * 2. Reports remaining gaps that need manual intervention
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 60000
  });

  try {
    console.log('=== EMPLOYEE MAPPING FIX SCRIPT ===\n');

    // Current state
    const [before] = await conn.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN process_id IS NULL THEN 1 ELSE 0 END) as no_process,
        SUM(CASE WHEN cost_centre_id IS NULL THEN 1 ELSE 0 END) as no_cost_centre,
        SUM(CASE WHEN branch_id IS NULL THEN 1 ELSE 0 END) as no_branch
      FROM employees WHERE active_status=1
    `);
    console.log('BEFORE:');
    console.log('  Total active employees:', before[0].total);
    console.log('  Without process_id:', before[0].no_process);
    console.log('  Without cost_centre_id:', before[0].no_cost_centre);
    console.log('  Without branch_id:', before[0].no_branch);

    // Step 1: Backfill process_id from cost_centre
    console.log('\n--- Step 1: Backfill process_id from cost_centre ---');
    const [backfillResult] = await conn.execute(`
      UPDATE employees e
      JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      SET e.process_id = cc.process_id,
          e.updated_at = NOW()
      WHERE e.active_status=1
        AND e.process_id IS NULL
        AND cc.process_id IS NOT NULL
    `);
    console.log('  Backfilled process_id for', backfillResult.affectedRows, 'employees');

    // Step 2: Backfill branch_id from cost_centre (if any missing)
    console.log('\n--- Step 2: Backfill branch_id from cost_centre ---');
    const [branchResult] = await conn.execute(`
      UPDATE employees e
      JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      SET e.branch_id = cc.branch_id,
          e.updated_at = NOW()
      WHERE e.active_status=1
        AND e.branch_id IS NULL
        AND cc.branch_id IS NOT NULL
    `);
    console.log('  Backfilled branch_id for', branchResult.affectedRows, 'employees');

    // After state
    const [after] = await conn.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN process_id IS NULL THEN 1 ELSE 0 END) as no_process,
        SUM(CASE WHEN cost_centre_id IS NULL THEN 1 ELSE 0 END) as no_cost_centre,
        SUM(CASE WHEN branch_id IS NULL THEN 1 ELSE 0 END) as no_branch
      FROM employees WHERE active_status=1
    `);
    console.log('\nAFTER:');
    console.log('  Total active employees:', after[0].total);
    console.log('  Without process_id:', after[0].no_process);
    console.log('  Without cost_centre_id:', after[0].no_cost_centre);
    console.log('  Without branch_id:', after[0].no_branch);

    // Report remaining gaps
    if (after[0].no_cost_centre > 0) {
      console.log('\n--- Employees still missing cost_centre (need manual assignment) ---');
      const [noCc] = await conn.execute(`
        SELECT employee_code, CONCAT(first_name,' ',COALESCE(last_name,'')) as name,
               branch_id, created_at
        FROM employees
        WHERE active_status=1 AND cost_centre_id IS NULL
        ORDER BY created_at DESC
        LIMIT 20
      `);
      noCc.forEach(r => console.log(' ', r.employee_code, '|', r.name, '| created:', String(r.created_at).substring(0,10)));
    }

    if (after[0].no_process > 0) {
      console.log('\n--- Employees still missing process (CC has no process_id) ---');
      const [noProc] = await conn.execute(`
        SELECT e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) as name,
               cc.cost_centre_code, cc.cost_centre_name
        FROM employees e
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        WHERE e.active_status=1 AND e.process_id IS NULL
        LIMIT 20
      `);
      noProc.forEach(r => console.log(' ', r.employee_code, '|', r.name, '| CC:', r.cost_centre_code || 'NONE'));
    }

    console.log('\n=== DONE ===');

  } finally {
    await conn.end();
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
