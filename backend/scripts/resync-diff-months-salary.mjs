/**
 * resync-diff-months-salary.mjs
 * Finds every month where mas_hrms gross differs from db_bill,
 * clears those months, and re-syncs from db_bill.
 * Skips any month already exact (< Rs 100 gross difference).
 * Safe: July 2026 verified-exact run is never touched.
 *
 * Usage:
 *   node backend/scripts/resync-diff-months-salary.mjs
 *   node backend/scripts/resync-diff-months-salary.mjs --dry-run
 *   node backend/scripts/resync-diff-months-salary.mjs --month=2025-04
 *   node backend/scripts/resync-diff-months-salary.mjs --hrms-host=192.168.10.6 --bill-host=14.97.30.236
 */

import mysql from 'mysql2/promise';
import fs    from 'fs';
import path  from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  COMPONENT_MAP, EARNED_COLUMN, totalDeductions, earnedGross, num,
} from './lib/dbbill-salary-mapping.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}
function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}

const DB_USER   = process.env.DB_USER     ?? fromEnvFile('DB_USER');
const DB_PASS   = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD');
const HRMS_HOST = arg('hrms-host', process.env.DB_HOST ?? fromEnvFile('DB_HOST') ?? '192.168.10.6');
const BILL_HOST = arg('bill-host', '14.97.30.236');
const DRY_RUN          = process.argv.includes('--dry-run');
const REPAIR_COMP_ONLY = process.argv.includes('--repair-components');
const SINGLE           = arg('month', null);

const HRMS_CFG = { host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'mas_hrms', connectTimeout: 30000 };
const BILL_CFG = { host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'db_bill',  connectTimeout: 30000, dateStrings: true };

function log(msg) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${msg}\n`); }
function uuid() { return crypto.randomUUID(); }

// ─── Load employee map ────────────────────────────────────────────────────────
async function loadEmpMap(hrms) {
  const [rows] = await hrms.execute('SELECT id, employee_code FROM employees');
  return new Map(rows.map(r => [r.employee_code, r.id]));
}

// ─── Find diff months ─────────────────────────────────────────────────────────
async function findDiffMonths(hrms, bill) {
  // db_bill: all non-IDC active months
  const [bd] = await bill.execute(`
    SELECT DATE_FORMAT(SalayDate,'%Y-%m') AS mon,
           -- Gross1 (EARNED), to match what salary_prep_line.gross_salary now holds.
           -- Comparing against the entitlement Gross column would report every
           -- month as divergent and trigger a full destructive re-sync.
           SUM(Gross1) AS gross
    FROM salary_data
    WHERE EmpCode NOT LIKE 'IDC%'
      AND (Status = '1' OR Status IS NULL OR Status = '')
    GROUP BY DATE_FORMAT(SalayDate,'%Y-%m')
    ORDER BY mon
  `);

  // mas_hrms: all months via run join
  const [hd] = await hrms.execute(`
    SELECT spr.run_month AS mon, spr.id AS run_id,
           SUM(spl.gross_salary) AS gross
    FROM salary_prep_run spr
    LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
    GROUP BY spr.run_month, spr.id
    ORDER BY spr.run_month
  `);

  const hMap = new Map(hd.map(r => [r.mon.substring(0, 7), r]));
  const diffs = [];

  for (const b of bd) {
    if (SINGLE && b.mon !== SINGLE) continue;
    const h = hMap.get(b.mon);
    if (!h) {
      // Month missing entirely — just sync fresh
      diffs.push({ mon: b.mon, run_id: null, bill_gross: Number(b.gross), hrms_gross: 0, gap: Number(b.gross) });
      continue;
    }
    const gap = Math.abs(Number(b.gross) - Number(h.gross));
    if (gap >= 100) {
      diffs.push({ mon: b.mon, run_id: h.run_id, bill_gross: Number(b.gross), hrms_gross: Number(h.gross), gap });
    }
  }
  return diffs;
}

// ─── Clear one month ──────────────────────────────────────────────────────────
// Returns { keptRunId } when FK prevents run deletion (payroll_disbursement etc.)
async function clearMonth(hrms, runId, mon) {
  if (DRY_RUN) { log(`  [DRY] would clear run ${runId} for ${mon}`); return {}; }
  // Delete components first (FK)
  const [cr] = await hrms.execute('DELETE FROM salary_prep_line_component WHERE run_id = ?', [runId]);
  // Delete lines
  const [lr] = await hrms.execute('DELETE FROM salary_prep_line WHERE run_id = ?', [runId]);
  // Try to delete run — FK from payroll_disbursement may block it
  try {
    await hrms.execute('DELETE FROM salary_prep_run WHERE id = ?', [runId]);
    log(`  Cleared: ${cr.affectedRows} components, ${lr.affectedRows} lines, run deleted.`);
    return {};
  } catch(e) {
    if (e.message.includes('foreign key constraint') || e.message.includes('a parent row')) {
      log(`  Cleared: ${cr.affectedRows} components, ${lr.affectedRows} lines, run KEPT (FK ref — disbursement rows exist).`);
      return { keptRunId: runId };
    }
    throw e;
  }
}

// ─── Sync one month from db_bill ──────────────────────────────────────────────
// existingRunId: when clearMonth couldn't delete the run (FK), reuse its ID
async function syncMonth(hrms, bill, empMap, mon, existingRunId = null) {
  // Fetch all salary rows for this month from db_bill
  const [rows] = await bill.execute(`
    SELECT EmpCode, Branch, Basic, HRA, Bonus, Conv, Portfolio, MedicalAllowance, LTA,
           SpecialAllowance, OtherAllowance, Incentive, ExtraDayIncentive, Arrear, PLI,
           EPF, ESIC, ProTaxDeduction, IncomeTax, AdvPaid, LoanDed,
           LeaveDeduction, MobileDedcution, ShortCollection, AssetRecovery, Insurance,
           OtherDeduction, SHSH,
           EPFCompany, ESICCompany, AdminChrg,
           Gross, NetSalary, WorkingDays, EarnedDays, \`Leave\`, TotalDeduction,
           -- the EARNED (pro-rated) set: what the employee actually earned for days
           -- worked. The unsuffixed columns above are the full-month entitlement.
           Basic1, HRA1, Bonus1, Conv1, Portfolio1, MedicalAllowance1,
           SpecialAllowance1, OtherAllowance1, Gross1
    FROM salary_data
    WHERE DATE_FORMAT(SalayDate,'%Y-%m') = ?
      AND (Status = '1' OR Status IS NULL OR Status = '')
      AND EmpCode NOT LIKE 'IDC%'
      AND EmpCode IS NOT NULL AND TRIM(EmpCode) != ''
    ORDER BY EmpCode
  `, [mon]);

  if (rows.length === 0) { log(`  No rows in db_bill for ${mon} — skipping.`); return { inserted: 0, noEmp: 0 }; }

  if (DRY_RUN) { log(`  [DRY] would insert ${rows.length} rows for ${mon}`); return { inserted: rows.length, noEmp: 0 }; }

  // Create or reuse salary_prep_run
  const runId = existingRunId || uuid();
  const [y, m] = mon.split('-').map(Number);
  const fy = m >= 4 ? `${y}-${String(y+1).slice(2)}` : `${y-1}-${String(y).slice(2)}`;
  // Run header totals must be the EARNED gross, so the header agrees with the sum
  // of its own lines. Using entitlement here is what made 102 of 103 run headers
  // disagree with their lines.
  const totalGross = rows.reduce((s,r) => s + earnedGross(r), 0);
  const totalNet   = rows.reduce((s,r) => s + num(r.NetSalary), 0);
  if (existingRunId) {
    // Update totals on the kept run
    await hrms.execute(`
      UPDATE salary_prep_run SET total_employees=?, total_gross=?, total_net=?, updated_at=NOW() WHERE id=?
    `, [rows.length, totalGross, totalNet, runId]);
  } else {
    await hrms.execute(`
      INSERT INTO salary_prep_run
        (id, run_month, run_kind, status, financial_year, total_employees, total_gross, total_net, created_by, created_at, updated_at)
      VALUES (?, ?, 'regular', 'finalized', ?, ?, ?, ?, 'db_bill_resync', NOW(), NOW())
    `, [runId, mon, fy, rows.length, totalGross, totalNet]);
  }

  let inserted = 0, noEmp = 0, errors = 0;
  // Was a second, independently maintained copy of the component map that took the
  // ENTITLEMENT columns (Basic/HRA/Conv/...) rather than the EARNED ones
  // (Basic1/HRA1/Conv1/...). Now shares the one source of truth.
  const COMP_FIELDS = COMPONENT_MAP.map(([code, , ctype, billCol]) => [code, billCol, ctype]);

  for (const r of rows) {
    const empId = empMap.get(r.EmpCode);
    if (!empId) { noEmp++; continue; }

    const lineId = uuid();
    try {
      await hrms.execute(`
        INSERT INTO salary_prep_line
          (id, run_id, employee_id, employee_code, gross_salary, net_salary,
           basic, hra, special_allowance, pf_employee, pf_employer,
           esic_employee, esic_employer, professional_tax, tds_amount,
           total_deductions, working_days, present_days, leave_days,
           attendance_data_source, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ADR','included')
      `, [lineId, runId, empId, r.EmpCode,
          // EARNED gross and earned component values, not the full-month entitlement.
          // TotalDeduction alone is not the total withheld — it excludes EPF/ESIC/TDS/
          // advance/loan. See lib/dbbill-salary-mapping.mjs.
          earnedGross(r), num(r.NetSalary),
          num(r[EARNED_COLUMN.Basic]), num(r[EARNED_COLUMN.HRA]),
          num(r[EARNED_COLUMN.SpecialAllowance]),
          num(r.EPF)||0, num(r.EPFCompany)||0,
          num(r.ESIC)||0, num(r.ESICCompany)||0,
          num(r.ProTaxDeduction), num(r.IncomeTax),
          totalDeductions(r),
          parseInt(r.WorkingDays)||0, parseInt(r.EarnedDays)||0,
          parseInt(r.Leave)||0]);

      // Insert components (skip zeros)
      const compVals = [];
      for (const [code, field, ctype] of COMP_FIELDS) {
        const amt = num(r[field]);
        if (amt === 0) continue;
        compVals.push([uuid(), runId, lineId, empId, code, code, ctype, amt, 'snapshot']);
      }
      if (compVals.length > 0) {
        const ph = compVals.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
        await hrms.execute(
          `INSERT INTO salary_prep_line_component
             (id,run_id,line_id,employee_id,component_code,component_name,component_type,amount,source)
           VALUES ${ph}`,
          compVals.flat()
        );
      }
      inserted++;
    } catch(e) {
      errors++;
      if (errors <= 2) log(`  ERR ${r.EmpCode}: ${e.message}`);
    }
  }
  return { inserted, noEmp, errors };
}

// ─── Repair missing components for runs that have lines but 0 components ─────
// Third copy of the same map, also on the entitlement columns. Now one source.
const COMP_FIELDS_GLOBAL = COMPONENT_MAP.map(([code, , ctype, billCol]) => [code, billCol, ctype]);

async function repairComponents(hrms, bill) {
  const [runsNeedRepair] = await hrms.execute(`
    SELECT spr.id AS run_id, spr.run_month AS mon,
           (SELECT COUNT(*) FROM salary_prep_line WHERE run_id = spr.id) AS line_cnt
    FROM salary_prep_run spr
    WHERE EXISTS     (SELECT 1 FROM salary_prep_line          WHERE run_id = spr.id)
      AND NOT EXISTS (SELECT 1 FROM salary_prep_line_component WHERE run_id = spr.id)
    ORDER BY spr.run_month
  `);

  log(`Runs with lines but 0 components: ${runsNeedRepair.length}`);
  if (runsNeedRepair.length === 0) return;

  for (const run of runsNeedRepair) {
    const { run_id: runId, mon, line_cnt: lineCnt } = run;
    log(`\n[REPAIR] ${mon}  runId=${runId}  lines=${lineCnt}`);

    const [billRows] = await bill.execute(`
      SELECT EmpCode, LTA, Incentive, ExtraDayIncentive, Arrear, PLI,
             EPF, ESIC, ProTaxDeduction, IncomeTax, AdvPaid, LoanDed,
             LeaveDeduction, MobileDedcution, AssetRecovery, Insurance, OtherDeduction,
             EPFCompany, ESICCompany, AdminChrg,
             -- EARNED component values, not the full-month entitlement.
             Basic1, HRA1, Bonus1, Conv1, Portfolio1, MedicalAllowance1,
             SpecialAllowance1, OtherAllowance1
      FROM salary_data
      WHERE DATE_FORMAT(SalayDate,'%Y-%m') = ?
        AND (Status = '1' OR Status IS NULL OR Status = '')
        AND EmpCode NOT LIKE 'IDC%'
        AND EmpCode IS NOT NULL AND TRIM(EmpCode) != ''
    `, [mon]);

    const [existingLines] = await hrms.execute(
      `SELECT id AS line_id, employee_id, employee_code FROM salary_prep_line WHERE run_id = ?`,
      [runId]
    );
    const lineByCode = new Map(existingLines.map(l => [l.employee_code, { line_id: l.line_id, employee_id: l.employee_id }]));

    const allCompVals = [];
    let skipped = 0;
    for (const r of billRows) {
      const lineInfo = lineByCode.get(r.EmpCode);
      if (!lineInfo) { skipped++; continue; }
      const { line_id: lineId, employee_id: empId } = lineInfo;
      for (const [code, field, ctype] of COMP_FIELDS_GLOBAL) {
        const amt = num(r[field]);
        if (amt === 0) continue;
        allCompVals.push([uuid(), runId, lineId, empId, code, code, ctype, amt, 'snapshot']);
      }
    }

    const BATCH = 500;
    let totalInserted = 0;
    for (let i = 0; i < allCompVals.length; i += BATCH) {
      const batch = allCompVals.slice(i, i + BATCH);
      const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      await hrms.execute(
        `INSERT INTO salary_prep_line_component
           (id,run_id,line_id,employee_id,component_code,component_name,component_type,amount,source)
         VALUES ${ph}`,
        batch.flat()
      );
      totalInserted += batch.length;
    }
    log(`  Inserted ${totalInserted} components, skipped ${skipped} employees (no line found).`);
  }
  log('\nComponent repair complete.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`Connecting HRMS=${HRMS_HOST}  db_bill=${BILL_HOST}${DRY_RUN?' [DRY-RUN]':''}`);
  const hrms = await mysql.createPool({ ...HRMS_CFG, waitForConnections: true, connectionLimit: 5 });
  const bill = await mysql.createPool({ ...BILL_CFG, waitForConnections: true, connectionLimit: 3 });
  log('Connected.\n');

  try {
    // Step 1: Always repair runs that have lines but zero components first
    log('Step 1: Checking for runs with missing components...');
    await repairComponents(hrms, bill);

    if (REPAIR_COMP_ONLY) {
      log('--repair-components flag set; skipping diff-month re-sync.');
      return;
    }

    log('\nStep 2: Loading employee map...');
    const empMap = await loadEmpMap(hrms);
    log(`  ${empMap.size} employees loaded.\n`);

    log('Scanning for diff months...');
    const diffs = await findDiffMonths(hrms, bill);
    log(`  ${diffs.length} months need re-sync.\n`);

    if (diffs.length === 0) { log('All months already exact. Nothing to do.'); return; }

    let done = 0, totalInserted = 0, totalNoEmp = 0;
    for (const d of diffs) {
      log(`[${done+1}/${diffs.length}] ${d.mon}  bill=${Math.round(d.bill_gross/1000)}K  hrms=${Math.round(d.hrms_gross/1000)}K  gap=${Math.round(d.gap/1000)}K`);

      let keptRunId = null;
      if (d.run_id) {
        const cleared = await clearMonth(hrms, d.run_id, d.mon);
        keptRunId = cleared.keptRunId || null;
      }

      const result = await syncMonth(hrms, bill, empMap, d.mon, keptRunId);
      totalInserted += result.inserted;
      totalNoEmp   += result.noEmp;
      log(`  Synced: inserted=${result.inserted}  noEmp=${result.noEmp}  errors=${result.errors||0}\n`);
      done++;
    }

    log('══════════════════════════════════════════════');
    log('RE-SYNC COMPLETE');
    log(`  Months fixed    : ${done}`);
    log(`  Lines inserted  : ${totalInserted}`);
    log(`  Skipped (noEmp) : ${totalNoEmp}`);

    // Final verification
    log('\nFINAL VERIFICATION:');
    const [bd] = await bill.execute(`
      SELECT COUNT(*) as mon_cnt, COUNT(DISTINCT EmpCode) as emp_cnt,
             SUM(Gross) as gross, SUM(EPF) as pf
      FROM salary_data
      WHERE EmpCode NOT LIKE 'IDC%'
        AND (Status = '1' OR Status IS NULL OR Status = '')
    `);
    const [hd] = await hrms.execute(`
      SELECT COUNT(*) as run_cnt,
             SUM(spl.gross_salary) as gross, SUM(spl.pf_employee) as pf
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
    `);
    log(`  db_bill : ${bd[0].emp_cnt} unique emp, gross=Rs ${Math.round(bd[0].gross/100000)/10}L, pf=Rs ${Math.round(bd[0].pf/100000)/10}L`);
    log(`  mas_hrms: runs=${hd[0].run_cnt}, gross=Rs ${Math.round(hd[0].gross/100000)/10}L, pf=Rs ${Math.round(hd[0].pf/100000)/10}L`);

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });