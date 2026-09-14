// backend/scripts/audit-employee-sync.ts
// Read-only audit: compares db_bill.employee_master with mas_hrms.employees
// Run: cd backend && npx tsx scripts/audit-employee-sync.ts
// Output: console report + audit-employee-sync-YYYYMMDD.json

import { createConnection } from 'mysql2/promise';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

function env(key: string, fallback?: string): string {
  const v = process.env[key]?.trim();
  if (!v && fallback === undefined) throw new Error(`${key} is required in .env`);
  return v ?? (fallback as string);
}

interface BillEmployee {
  EmpCode: string;
  EmpName: string;
  Status: string | null;
  LeftDate: string | null;
  Location: string | null;
  Depart: string | null;
  Process: string | null;
  Desig: string | null;
  DOJ: string | null;
  DOB: string | null;
  Gender: string | null;
  EmailId: string | null;
  PMobNo: string | null;
}

interface HrmsEmployee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  active_status: number;
  employment_status: string | null;
  date_of_joining: string | null;
  date_of_exit: string | null;
  created_at: string;
  user_id: string | null;
  branch: string | null;
  department: string | null;
  designation: string | null;
  branch_id: string | null;
}

async function main() {
  console.log('=== Employee Sync Audit: db_bill vs mas_hrms ===\n');

  // ── Connect db_bill ─────────────────────────────────────────────────────────
  console.log('Connecting to db_bill …');
  const bill = await createConnection({
    host:        env('BILL_DB_HOST'),
    port:        Number(env('BILL_DB_PORT', '3306')),
    user:        env('BILL_DB_USER'),
    password:    env('BILL_DB_PASSWORD'),
    database:    env('BILL_DB_NAME'),
    dateStrings: true,
    timezone:    'local',
  });
  console.log(`  ✓ Connected to ${env('BILL_DB_HOST')}/${env('BILL_DB_NAME')}`);

  // ── Connect mas_hrms ────────────────────────────────────────────────────────
  console.log('Connecting to mas_hrms …');
  const hrms = await createConnection({
    host:        env('DB_HOST'),
    port:        Number(env('DB_PORT', '3306')),
    user:        env('DB_USER'),
    password:    env('DB_PASSWORD'),
    database:    env('DB_NAME'),
    dateStrings: true,
  });
  console.log(`  ✓ Connected to ${env('DB_HOST')}/${env('DB_NAME')}\n`);

  // ── A. Fetch all data ───────────────────────────────────────────────────────
  console.log('Fetching employees from db_bill …');
  const [billRows] = await bill.execute<any[]>(
    `SELECT EmpCode, EmpName, Status, LeftDate, Location, Depart, Process, Desig, DOJ, DOB, Gender, EmailId, PMobNo
     FROM employee_master
     WHERE EmpCode IS NOT NULL AND TRIM(EmpCode) != ''`,
  );
  const billEmps: BillEmployee[] = billRows as BillEmployee[];

  console.log('Fetching employees from mas_hrms …');
  const [hrmsRows] = await hrms.execute<any[]>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.active_status, e.employment_status,
            e.date_of_joining, e.date_of_exit, e.created_at, e.user_id, e.branch_id,
            bm.branch_name AS branch,
            dm.dept_name AS department,
            de.designation_name AS designation
     FROM employees e
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN department_master dm ON dm.id = e.department_id
     LEFT JOIN designation_master de ON de.id = e.designation_id`,
  );
  const hrmsEmps: HrmsEmployee[] = hrmsRows as HrmsEmployee[];

  await bill.end();
  await hrms.end();

  // ── B. Build lookup maps ────────────────────────────────────────────────────
  const billMap = new Map<string, BillEmployee>();
  for (const e of billEmps) {
    billMap.set(e.EmpCode.trim().toUpperCase(), e);
  }

  const hrmsMap = new Map<string, HrmsEmployee>();
  for (const e of hrmsEmps) {
    hrmsMap.set(e.employee_code.trim().toUpperCase(), e);
  }

  // ── Gap 1: In db_bill, NOT in mas_hrms ──────────────────────────────────────
  const missingInHrms: BillEmployee[] = [];
  const missingActive: BillEmployee[] = [];
  const missingLeft: BillEmployee[] = [];
  for (const [code, be] of billMap) {
    if (!hrmsMap.has(code)) {
      missingInHrms.push(be);
      if (be.Status === 'L') missingLeft.push(be);
      else missingActive.push(be);
    }
  }

  // ── Gap 2: Status mismatch (active in hrms, Left in db_bill) ───────────────
  const staleActive: Array<{ hrms: HrmsEmployee; bill: BillEmployee }> = [];
  for (const [code, he] of hrmsMap) {
    const be = billMap.get(code);
    if (be && he.active_status === 1 && be.Status === 'L') {
      staleActive.push({ hrms: he, bill: be });
    }
  }

  // ── Gap 3: In mas_hrms, NOT in db_bill (orphans/test accounts) ─────────────
  const notInBill: HrmsEmployee[] = [];
  for (const [code, he] of hrmsMap) {
    if (!billMap.has(code)) {
      notInBill.push(he);
    }
  }
  const orphansActive = notInBill.filter(e => e.active_status === 1);
  const orphansInactive = notInBill.filter(e => e.active_status === 0);
  const orphansWithLogin = notInBill.filter(e => e.user_id != null);

  // ── Print summary ───────────────────────────────────────────────────────────
  const billActive = billEmps.filter(e => e.Status !== 'L').length;
  const billLeft = billEmps.filter(e => e.Status === 'L').length;
  const hrmsActive = hrmsEmps.filter(e => e.active_status === 1).length;
  const hrmsInactive = hrmsEmps.filter(e => e.active_status === 0).length;

  console.log('\n══════════════════════════════════════════════════');
  console.log('  TOTALS');
  console.log('══════════════════════════════════════════════════');
  console.log(`  db_bill total  : ${billEmps.length.toString().padStart(5)}  (active: ${billActive}, left: ${billLeft})`);
  console.log(`  mas_hrms total : ${hrmsEmps.length.toString().padStart(5)}  (active: ${hrmsActive}, inactive: ${hrmsInactive})`);

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  GAP 1 — In db_bill, MISSING from mas_hrms: ${missingInHrms.length}`);
  console.log(`          Active (not Left): ${missingActive.length}`);
  console.log(`          Left   (Status=L): ${missingLeft.length}`);
  console.log('══════════════════════════════════════════════════');
  if (missingInHrms.length > 0) {
    console.log('  First 50:');
    missingInHrms.slice(0, 50).forEach(e => {
      const status = e.Status === 'L' ? 'LEFT' : 'ACTIVE';
      console.log(`  [${status}] ${e.EmpCode.padEnd(12)} ${(e.EmpName ?? '').substring(0, 30).padEnd(32)} DOJ:${e.DOJ ?? 'N/A'}  Branch:${e.Location ?? '-'}`);
    });
    if (missingInHrms.length > 50) console.log(`  … and ${missingInHrms.length - 50} more (see JSON output)`);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  GAP 2 — Active in mas_hrms but LEFT in db_bill: ${staleActive.length}`);
  console.log('══════════════════════════════════════════════════');
  if (staleActive.length > 0) {
    staleActive.slice(0, 50).forEach(({ hrms: he, bill: be }) => {
      console.log(`  ${he.employee_code.padEnd(12)} ${(he.first_name + ' ' + (he.last_name ?? '')).substring(0, 30).padEnd(32)} LeftDate:${be.LeftDate ?? 'N/A'}`);
    });
    if (staleActive.length > 50) console.log(`  … and ${staleActive.length - 50} more (see JSON output)`);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  GAP 3 — In mas_hrms, NOT in db_bill (orphans): ${notInBill.length}`);
  console.log(`          Active: ${orphansActive.length}  |  Inactive: ${orphansInactive.length}  |  Has login: ${orphansWithLogin.length}`);
  console.log('══════════════════════════════════════════════════');
  if (notInBill.length > 0) {
    notInBill.slice(0, 50).forEach(he => {
      const flags = [
        he.active_status ? 'ACTIVE' : 'inactive',
        he.user_id ? 'HAS-LOGIN' : 'no-login',
      ].join(' ');
      console.log(`  ${he.employee_code.padEnd(12)} ${(he.first_name + ' ' + (he.last_name ?? '')).substring(0, 30).padEnd(32)} [${flags}]  joined:${he.date_of_joining ?? 'N/A'}  created:${he.created_at}`);
    });
    if (notInBill.length > 50) console.log(`  … and ${notInBill.length - 50} more (see JSON output)`);
  }

  // ── Save JSON ───────────────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outPath = resolve(process.cwd(), `scripts/audit-employee-sync-${dateStr}.json`);
  const report = {
    generated_at: new Date().toISOString(),
    totals: {
      db_bill: { total: billEmps.length, active: billActive, left: billLeft },
      mas_hrms: { total: hrmsEmps.length, active: hrmsActive, inactive: hrmsInactive },
    },
    gap1_missing_from_hrms: {
      count: missingInHrms.length,
      active_count: missingActive.length,
      left_count: missingLeft.length,
      rows: missingInHrms.map(e => ({
        EmpCode: e.EmpCode,
        EmpName: e.EmpName,
        Status: e.Status,
        DOJ: e.DOJ,
        LeftDate: e.LeftDate,
        Location: e.Location,
        Depart: e.Depart,
        Process: e.Process,
        Desig: e.Desig,
        EmailId: e.EmailId,
        PMobNo: e.PMobNo,
      })),
    },
    gap2_stale_active_in_hrms: {
      count: staleActive.length,
      rows: staleActive.map(({ hrms: he, bill: be }) => ({
        employee_code: he.employee_code,
        name: `${he.first_name} ${he.last_name ?? ''}`.trim(),
        hrms_active_status: he.active_status,
        bill_status: be.Status,
        bill_left_date: be.LeftDate,
        hrms_date_of_joining: he.date_of_joining,
      })),
    },
    gap3_not_in_db_bill: {
      count: notInBill.length,
      active_count: orphansActive.length,
      inactive_count: orphansInactive.length,
      has_login_count: orphansWithLogin.length,
      rows: notInBill.map(he => ({
        employee_code: he.employee_code,
        name: `${he.first_name} ${he.last_name ?? ''}`.trim(),
        active_status: he.active_status,
        has_login: !!he.user_id,
        date_of_joining: he.date_of_joining,
        created_at: he.created_at,
        branch: he.branch,
        department: he.department,
        designation: he.designation,
      })),
    },
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n✓ Full JSON report saved: ${outPath}`);
  console.log('\n=== Next Steps ===');
  console.log('1. Review the report above and the JSON file.');
  console.log('2. To import missing + fix stale-active:  npx tsx scripts/migrate-legacy.ts');
  console.log('3. To deactivate orphans (dry-run):       npx tsx scripts/deactivate-orphan-accounts.ts');
  console.log('4. To apply deactivations:                npx tsx scripts/deactivate-orphan-accounts.ts --apply\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
