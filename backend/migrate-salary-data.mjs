#!/usr/bin/env node
/**
 * db_bill.salary_data → mas_hrms historical salary migration
 *
 * Usage (from repo root):
 *   node backend/migrate-salary-data.mjs --dry-run
 *   node backend/migrate-salary-data.mjs --from=2024-01 --to=2025-11
 *   node backend/migrate-salary-data.mjs --month=2025-06 --dry-run --verbose
 *   node backend/migrate-salary-data.mjs --from=2021-03 --to=2026-06
 *
 * Source:  db_bill.salary_data  (PascalCase columns, 135 k rows, 2018-2026)
 * Target:  mas_hrms.salary_prep_run + salary_prep_line
 *
 * Safety:
 *   - Never writes to db_bill
 *   - All mas_hrms writes use ON DUPLICATE KEY UPDATE (idempotent)
 *   - --dry-run logs what would be written without touching anything
 *   - Existing runs with real data are NOT overwritten (existing lines kept)
 */

import { config }     from 'dotenv';
import mysql          from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath }    from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dir, '.env') });

// ─── CLI ─────────────────────────────────────────────────────────────────────
const argv   = process.argv.slice(2);
const flag   = n => argv.includes(`--${n}`);
const opt    = n => { const a = argv.find(a => a.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : null; };

const DRY_RUN    = flag('dry-run');
const VERBOSE    = flag('verbose');
const FROM_MONTH = opt('from')  ?? opt('month') ?? null;
const TO_MONTH   = opt('to')    ?? opt('month') ?? null;

console.log('\n══════════════════════════════════════════════════════');
console.log('  db_bill.salary_data → mas_hrms  Migration');
console.log('══════════════════════════════════════════════════════');
if (DRY_RUN)    console.log('  ⚠  DRY-RUN — no writes will happen');
if (FROM_MONTH) console.log(`  From : ${FROM_MONTH}`);
if (TO_MONTH)   console.log(`  To   : ${TO_MONTH}`);
console.log('');

// ─── Connections ─────────────────────────────────────────────────────────────
let hrms, bill;
try {
  hrms = await mysql.createConnection({
    host:     process.env.DB_HOST     || '122.184.128.90',
    port:    +process.env.DB_PORT     || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME     || 'mas_hrms',
    connectTimeout: 15000,
  });
  console.log(`✓ mas_hrms  @ ${process.env.DB_HOST}/${process.env.DB_NAME}`);
} catch (e) {
  console.error('✗ mas_hrms connect failed:', e.message); process.exit(1);
}

try {
  bill = await mysql.createConnection({
    host:     process.env.BILL_DB_HOST     || '14.97.30.236',
    port:    +process.env.BILL_DB_PORT     || 3306,
    user:     process.env.BILL_DB_USER     || process.env.DB_USER,
    password: process.env.BILL_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.BILL_DB_NAME     || 'db_bill',
    connectTimeout: 15000,
  });
  console.log(`✓ db_bill   @ ${process.env.BILL_DB_HOST || '14.97.30.236'}/db_bill`);
} catch (e) {
  console.error('✗ db_bill connect failed:', e.message); process.exit(1);
}

// ─── Employee code → ID map ───────────────────────────────────────────────────
const [empRows] = await hrms.execute(
  `SELECT id, employee_code FROM employees`
);
// Build map with both trimmed and as-is keys for safety
const empMap = new Map();
for (const r of empRows) {
  empMap.set(String(r.employee_code).trim(), String(r.id));
  empMap.set(String(r.employee_code).trim().toUpperCase(), String(r.id));
}
console.log(`✓ Loaded ${empRows.length} employees from mas_hrms`);

// ─── Existing salary_prep_run map ────────────────────────────────────────────
const [runRows] = await hrms.execute(
  `SELECT id, run_month, status,
          (SELECT COUNT(*) FROM salary_prep_line WHERE run_id = salary_prep_run.id) AS line_count
     FROM salary_prep_run
    ORDER BY run_month`
);
const runMap = new Map(runRows.map(r => [r.run_month, r]));
console.log(`✓ Found ${runRows.length} existing salary_prep_run entries in mas_hrms`);

// ─── Distinct months in db_bill ───────────────────────────────────────────────
let whereClause = `WHERE SalDate IS NOT NULL`;
const whereParams = [];
if (FROM_MONTH) { whereClause += ` AND DATE_FORMAT(SalDate, '%Y-%m') >= ?`; whereParams.push(FROM_MONTH); }
if (TO_MONTH)   { whereClause += ` AND DATE_FORMAT(SalDate, '%Y-%m') <= ?`; whereParams.push(TO_MONTH); }

const [monthRows] = await bill.execute(
  `SELECT DATE_FORMAT(SalDate, '%Y-%m') AS m, COUNT(*) AS emp_count
     FROM salary_data
    ${whereClause}
    GROUP BY m
    ORDER BY m`,
  whereParams
);

console.log(`\n── Months in db_bill salary_data: ${monthRows.length} ──`);

// A run with < 10 lines is treated as a stub — migrate db_bill data into it
const STUB_THRESHOLD = 10;

// ─── Gap analysis ────────────────────────────────────────────────────────────
const toMigrate = [];
for (const { m, emp_count } of monthRows) {
  const existing = runMap.get(m);
  if (existing) {
    const lineCount = existing.line_count;
    if (lineCount >= STUB_THRESHOLD) {
      console.log(`  ${m}  ✓ has ${lineCount} lines already — SKIP`);
    } else if (lineCount > 0) {
      console.log(`  ${m}  ⚠  run has only ${lineCount} line(s) (stub) — will add db_bill data (${emp_count} in db_bill)`);
      toMigrate.push({ m, emp_count, existingRunId: existing.id });
    } else {
      console.log(`  ${m}  ⚠  run exists but 0 lines — will populate (${emp_count} rows in db_bill)`);
      toMigrate.push({ m, emp_count, existingRunId: existing.id });
    }
  } else {
    console.log(`  ${m}  ✗ MISSING → will create run + lines (${emp_count} rows in db_bill)`);
    toMigrate.push({ m, emp_count, existingRunId: null });
  }
}

if (toMigrate.length === 0) {
  console.log('\n✓ Nothing to migrate — all months already have data in mas_hrms.');
  await hrms.end(); await bill.end(); process.exit(0);
}

console.log(`\n✓ Will migrate ${toMigrate.length} month(s) — ${toMigrate.reduce((s,r)=>s+r.emp_count,0)} total rows`);
if (DRY_RUN) {
  console.log('  ⚠  DRY-RUN — stopping here. Re-run without --dry-run to write.');
  await hrms.end(); await bill.end(); process.exit(0);
}

// ─── Migration ───────────────────────────────────────────────────────────────
let totalUpserted = 0, totalSkipped = 0;

for (const { m, emp_count, existingRunId } of toMigrate) {
  process.stdout.write(`  Migrating ${m} (${emp_count} rows) ... `);

  // Fetch rows from db_bill for this month
  const [rows] = await bill.execute(
    `SELECT EmpCode, EmpName, Basic, Basic1, HRA, HRA1, SpecialAllowance, OtherAllowance,
            Gross, Gross1, TotalDeduction, NetSalary,
            ESIC, EPF, IncomeTax, WorkingDays, EarnedDays, \`Leave\`,
            ExtraDay, Incentive, Arrear, LoanDed, AdvPaid, OtherDeduction,
            SalDate
       FROM salary_data
      WHERE DATE_FORMAT(SalDate, '%Y-%m') = ?`,
    [m]
  );

  // Ensure salary_prep_run exists
  let runId = existingRunId;
  if (!runId) {
    runId = randomUUID();
    await hrms.execute(
      `INSERT INTO salary_prep_run
         (id, run_month, status, created_by, created_at, updated_at)
       VALUES (?, ?, 'disbursed', 'db_bill_migration', NOW(), NOW())
       ON DUPLICATE KEY UPDATE id = id`,
      [runId, m]
    );
    // Re-fetch in case ON DUPLICATE triggered
    const [[actualRun]] = await hrms.execute(
      `SELECT id FROM salary_prep_run WHERE run_month = ? ORDER BY created_at LIMIT 1`, [m]
    );
    runId = actualRun?.id ?? runId;
  }

  let upserted = 0, skipped = 0;
  for (const row of rows) {
    const code  = String(row.EmpCode ?? '').trim();
    const empId = empMap.get(code) ?? empMap.get(code.toUpperCase()) ?? null;
    if (!empId) { skipped++; continue; }

    // Use Gross1 (earned gross) when available, else Gross (full month gross)
    const basic      = parseFloat(row.Basic1  ?? row.Basic  ?? 0)  || 0;
    const hra        = parseFloat(row.HRA1    ?? row.HRA    ?? 0)  || 0;
    const special    = parseFloat(row.SpecialAllowance ?? row.OtherAllowance ?? 0) || 0;
    const gross      = parseFloat(row.Gross1  ?? row.Gross  ?? (basic + hra + special)) || 0;
    const esic       = parseFloat(row.ESIC    ?? 0) || 0;
    const epf        = parseFloat(row.EPF     ?? 0) || 0;
    const tds        = parseFloat(row.IncomeTax ?? 0) || 0;
    const loanDed    = parseFloat(row.LoanDed  ?? 0) || 0;
    const advPaid    = parseFloat(row.AdvPaid  ?? 0) || 0;
    const otherDed   = parseFloat(row.OtherDeduction ?? 0) || 0;
    const totalDed   = parseFloat(row.TotalDeduction ?? (esic + epf + tds + loanDed + advPaid + otherDed)) || 0;
    const net        = parseFloat(row.NetSalary ?? (gross - totalDed)) || 0;
    const working    = parseFloat(row.WorkingDays ?? 26) || 26;
    const present    = parseFloat(row.EarnedDays  ?? 0) || 0;
    const leave      = parseFloat(row['Leave']     ?? 0) || 0;
    const lwp        = Math.max(0, working - present - leave);

    if (VERBOSE) {
      console.log(`\n    ${code} basic=${basic} gross=${gross} net=${net} working=${working} present=${present}`);
    }

    await hrms.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
          basic, hra, special_allowance,
          gross_salary, total_deductions, net_salary,
          pf_employee, esic_employee, tds,
          lwp_days, present_days, leave_days, working_days,
          status)
       VALUES
         (UUID(), ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?,
          'calculated')
       ON DUPLICATE KEY UPDATE
         basic             = VALUES(basic),
         hra               = VALUES(hra),
         special_allowance = VALUES(special_allowance),
         gross_salary      = VALUES(gross_salary),
         total_deductions  = VALUES(total_deductions),
         net_salary        = VALUES(net_salary),
         pf_employee       = VALUES(pf_employee),
         esic_employee     = VALUES(esic_employee),
         tds               = VALUES(tds),
         lwp_days          = VALUES(lwp_days),
         present_days      = VALUES(present_days),
         leave_days        = VALUES(leave_days),
         working_days      = VALUES(working_days)`,
      [runId, empId, code,
       basic, hra, special,
       gross, totalDed, net,
       epf, esic, tds,
       lwp, present, leave, working]
    );
    upserted++;
  }

  // Update run-level totals
  await hrms.execute(
    `UPDATE salary_prep_run SET
       total_employees = (SELECT COUNT(DISTINCT employee_id) FROM salary_prep_line WHERE run_id = ?),
       total_gross     = (SELECT COALESCE(SUM(gross_salary), 0)  FROM salary_prep_line WHERE run_id = ?),
       total_net       = (SELECT COALESCE(SUM(net_salary),   0)  FROM salary_prep_line WHERE run_id = ?),
       updated_at      = NOW()
     WHERE id = ?`,
    [runId, runId, runId, runId]
  );

  console.log(`✓  ${upserted} upserted, ${skipped} skipped (code not in mas_hrms)`);
  totalUpserted += upserted;
  totalSkipped  += skipped;
}

// ─── Done ─────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  Migration complete');
console.log(`  Months migrated : ${toMigrate.length}`);
console.log(`  Rows upserted   : ${totalUpserted}`);
console.log(`  Rows skipped    : ${totalSkipped}  (emp code not in mas_hrms)`);
console.log('══════════════════════════════════════════════════════\n');

await hrms.end();
await bill.end();
