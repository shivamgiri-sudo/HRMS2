// backend/scripts/deactivate-orphan-accounts.ts
// Soft-deactivates mas_hrms employees that have no EmpCode in db_bill.
// Never hard-deletes. Skips anyone with leave/attendance/payroll/ATS data or a login.
//
// Dry-run (default):  cd backend && npx tsx scripts/deactivate-orphan-accounts.ts
// Apply:              cd backend && npx tsx scripts/deactivate-orphan-accounts.ts --apply
// Include login accts: add --include-active-users  (requires --apply too)

import { createConnection, type Connection } from 'mysql2/promise';
import { resolve } from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const INCLUDE_USERS = process.argv.includes('--include-active-users');

function env(key: string, fallback?: string): string {
  const v = process.env[key]?.trim();
  if (!v && fallback === undefined) throw new Error(`${key} is required`);
  return v ?? (fallback as string);
}

interface HrmsEmployee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  active_status: number;
  user_id: string | null;
  date_of_joining: string | null;
  created_at: string;
  branch: string | null;
}

async function hasAssociatedData(hrms: Connection, employeeId: string): Promise<{ has: boolean; reason: string }> {
  const checks: Array<[string, string]> = [
    ['leave_requests',       `SELECT 1 FROM leave_requests WHERE employee_id = ? LIMIT 1`],
    ['attendance_records',   `SELECT 1 FROM attendance_records WHERE employee_id = ? LIMIT 1`],
    ['payroll_records',      `SELECT 1 FROM payroll_records WHERE employee_id = ? LIMIT 1`],
    ['ats_candidate',        `SELECT 1 FROM ats_candidate WHERE converted_employee_id = ? LIMIT 1`],
    ['employee_bank_detail', `SELECT 1 FROM employee_bank_detail WHERE employee_id = ? LIMIT 1`],
  ];

  for (const [table, sql] of checks) {
    try {
      const [rows] = await hrms.execute<any[]>(sql, [employeeId]);
      if ((rows as any[]).length > 0) return { has: true, reason: table };
    } catch {
      // table may not exist in all environments — skip
    }
  }
  return { has: false, reason: '' };
}

async function main() {
  console.log(`=== Deactivate Orphan Accounts (${APPLY ? 'APPLY MODE' : 'DRY-RUN'}) ===\n`);

  // ── Connect db_bill ─────────────────────────────────────────────────────────
  const bill = await createConnection({
    host:        env('BILL_DB_HOST'),
    port:        Number(env('BILL_DB_PORT', '3306')),
    user:        env('BILL_DB_USER'),
    password:    env('BILL_DB_PASSWORD'),
    database:    env('BILL_DB_NAME'),
    dateStrings: true,
    timezone:    'local',
  });

  // ── Connect mas_hrms ────────────────────────────────────────────────────────
  const hrms = await createConnection({
    host:        env('DB_HOST'),
    port:        Number(env('DB_PORT', '3306')),
    user:        env('DB_USER'),
    password:    env('DB_PASSWORD'),
    database:    env('DB_NAME'),
    dateStrings: true,
  });

  console.log('  ✓ Connected to both databases\n');

  // ── Fetch all EmpCodes from db_bill ─────────────────────────────────────────
  const [billRows] = await bill.execute<any[]>(
    `SELECT TRIM(EmpCode) AS EmpCode FROM employee_master WHERE EmpCode IS NOT NULL AND TRIM(EmpCode) != ''`,
  );
  const billCodes = new Set<string>(billRows.map((r: any) => String(r.EmpCode).trim().toUpperCase()));
  await bill.end();
  console.log(`  db_bill: ${billCodes.size} distinct employee codes loaded`);

  // ── Fetch mas_hrms employees not in db_bill ─────────────────────────────────
  const [hrmsRows] = await hrms.execute<any[]>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.active_status, e.user_id,
            e.date_of_joining, e.created_at,
            bm.branch_name AS branch
     FROM employees e
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     ORDER BY e.created_at DESC`,
  );
  const allHrms: HrmsEmployee[] = hrmsRows as HrmsEmployee[];

  const orphans = allHrms.filter(e => !billCodes.has(e.employee_code.trim().toUpperCase()));
  console.log(`  mas_hrms: ${allHrms.length} total, ${orphans.length} not in db_bill\n`);

  // ── Categorise orphans ──────────────────────────────────────────────────────
  const toDeactivate: HrmsEmployee[] = [];
  const skippedHasData: Array<{ emp: HrmsEmployee; reason: string }> = [];
  const skippedHasLogin: HrmsEmployee[] = [];
  const alreadyInactive: HrmsEmployee[] = [];

  for (const emp of orphans) {
    if (emp.active_status === 0) {
      alreadyInactive.push(emp);
      continue;
    }
    if (emp.user_id && !INCLUDE_USERS) {
      skippedHasLogin.push(emp);
      continue;
    }
    const { has, reason } = await hasAssociatedData(hrms, emp.id);
    if (has) {
      skippedHasData.push({ emp, reason });
      continue;
    }
    toDeactivate.push(emp);
  }

  // ── Print plan ──────────────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════');
  console.log(`  Would DEACTIVATE (no data, no login): ${toDeactivate.length}`);
  console.log('════════════════════════════════════════════════');
  toDeactivate.forEach(e => {
    console.log(`  ${e.employee_code.padEnd(12)} ${(e.first_name + ' ' + (e.last_name ?? '')).substring(0, 30).padEnd(32)} joined:${e.date_of_joining ?? 'N/A'}  branch:${e.branch ?? '-'}`);
  });

  console.log(`\n  SKIP — already inactive: ${alreadyInactive.length}`);

  console.log(`\n  SKIP — has login (use --include-active-users to override): ${skippedHasLogin.length}`);
  skippedHasLogin.forEach(e => {
    console.log(`    ${e.employee_code.padEnd(12)} ${(e.first_name + ' ' + (e.last_name ?? '')).substring(0, 28)}`);
  });

  console.log(`\n  SKIP — has associated data (manual review required): ${skippedHasData.length}`);
  skippedHasData.forEach(({ emp: e, reason }) => {
    console.log(`    ${e.employee_code.padEnd(12)} ${(e.first_name + ' ' + (e.last_name ?? '')).substring(0, 28).padEnd(30)} [${reason}]`);
  });

  // ── Apply ───────────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\n[DRY-RUN] No changes made. Add --apply to execute.\n`);
    await hrms.end();
    return;
  }

  let deactivated = 0;
  let errors = 0;
  for (const emp of toDeactivate) {
    try {
      await hrms.execute(
        `UPDATE employees
         SET active_status = 0,
             employment_status = 'Deactivated',
             updated_at = NOW()
         WHERE id = ?`,
        [emp.id],
      );

      // Audit log
      try {
        await hrms.execute(
          `INSERT INTO audit_log (id, table_name, record_id, action, changed_by, change_summary, created_at)
           VALUES (UUID(), 'employees', ?, 'DEACTIVATE_ORPHAN', 'system:deactivate-orphan-script',
                   'Employee not found in db_bill.employee_master; deactivated via audit script', NOW())`,
          [emp.id],
        );
      } catch {
        // audit_log may have different schema — non-fatal
      }

      console.log(`  ✓ Deactivated ${emp.employee_code}  ${emp.first_name} ${emp.last_name ?? ''}`);
      deactivated++;
    } catch (err) {
      console.error(`  ✗ Error deactivating ${emp.employee_code}:`, err);
      errors++;
    }
  }

  await hrms.end();

  console.log(`\n=== Done ===`);
  console.log(`  Deactivated : ${deactivated}`);
  console.log(`  Errors      : ${errors}`);
  console.log(`  Skipped (data): ${skippedHasData.length}`);
  console.log(`  Skipped (login): ${skippedHasLogin.length}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
