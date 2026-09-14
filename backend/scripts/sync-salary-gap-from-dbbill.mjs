/**
 * sync-salary-gap-from-dbbill.mjs
 *
 * Fills salary_prep_line + salary_prep_line_component gaps from db_bill salary_data.
 * Only inserts; never updates or deletes existing rows.
 *
 * Logic:
 *  For each run in salary_prep_run (103 months), find employees whose EmpCode
 *  exists in both db_bill.salary_data and mas_hrms.employees but does NOT have a
 *  salary_prep_line row for that run. Insert those rows + their components.
 *
 * Safe to re-run: the existingSet check below skips employees who already hold a
 * line for the run. INSERT IGNORE was removed — silently swallowing a failed
 * money INSERT is how bad rows landed here unnoticed in the first place.
 */
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';
import {
  COMPONENT_MAP, EARNED_COLUMN, totalDeductions, earnedGross, num,
} from './lib/dbbill-salary-mapping.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}
function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}

const HRMS_HOST = arg('hrms-host', process.env.DB_HOST ?? fromEnvFile('DB_HOST') ?? '192.168.10.6');
const BILL_HOST = arg('bill-host', '14.97.30.236');
const DB_USER   = process.env.DB_USER     ?? fromEnvFile('DB_USER');
const DB_PASS   = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD');
const DRY_RUN   = process.argv.includes('--dry-run');
const ONLY_MONTH= arg('month', null);  // e.g. --month=2026-07 to run one month
const BATCH     = 300;

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }
function uuid() { return crypto.randomUUID(); }
const n = num; // shared parse, tolerant of the thousands separators salary_data stores

// The column mapping, the earned-vs-entitlement rule and the legacy net identity
// all live in ./lib/dbbill-salary-mapping.mjs. Read the docblock there before
// changing any of it — the entitlement columns look like the obvious choice and
// are the wrong one.

async function main() {
  log(`Connecting HRMS=${HRMS_HOST}  db_bill=${BILL_HOST}${DRY_RUN ? ' [DRY-RUN]' : ''}`);

  const hrms = await mysql.createPool({
    host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'mas_hrms',
    connectTimeout: 30000, waitForConnections: true, connectionLimit: 3
  });
  const bill = await mysql.createPool({
    host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'db_bill',
    connectTimeout: 30000, waitForConnections: true, connectionLimit: 3, dateStrings: true
  });

  // Load employee_code → {id} map from mas_hrms
  log('Loading employee map...');
  const [empRows] = await hrms.query('SELECT id, employee_code FROM employees');
  const empMap = new Map(empRows.map(r => [r.employee_code, r.id]));
  log(`  Employee map loaded: ${empMap.size} employees.`);

  // Load all runs from salary_prep_run (run_month is VARCHAR 'YYYY-MM')
  const [runs] = await hrms.query('SELECT id, run_month FROM salary_prep_run ORDER BY run_month');
  log(`  Found ${runs.length} payroll runs.`);

  let totalLineInserted = 0, totalCompInserted = 0, totalSkipped = 0;

  for (const run of runs) {
    const month = run.run_month; // 'YYYY-MM'
    if (ONLY_MONTH && month !== ONLY_MONTH) continue;

    // Get all salary_data rows for this month from db_bill
    const [billRows] = await bill.query(
      `SELECT * FROM salary_data WHERE DATE_FORMAT(SalayDate, '%Y-%m') = ?`,
      [month]
    );
    if (!billRows.length) continue;

    // Get existing employee_ids in salary_prep_line for this run
    const [existingRows] = await hrms.query(
      'SELECT employee_id FROM salary_prep_line WHERE run_id = ?',
      [run.id]
    );
    const existingSet = new Set(existingRows.map(r => r.employee_id));

    // Find gap rows: in db_bill but not in HRMS for this run
    const gapRows = [];
    for (const br of billRows) {
      const empId = empMap.get(br.EmpCode);
      if (!empId) { totalSkipped++; continue; } // employee not in HRMS
      if (existingSet.has(empId)) continue;       // already synced
      gapRows.push({ br, empId, runId: run.id });
    }

    if (!gapRows.length) continue;

    log(`  ${month}: ${billRows.length} in db_bill, ${existingSet.size} in hrms, ${gapRows.length} gap rows to insert`);

    if (DRY_RUN) continue;

    // Insert in batches
    for (let i = 0; i < gapRows.length; i += BATCH) {
      const batch = gapRows.slice(i, i + BATCH);
      const lineRows = [];
      const compRows = [];

      for (const { br, empId, runId } of batch) {
        const lineId = uuid();
        // EARNED, not entitlement. `Gross`/`Basic`/`HRA`/`SpecialAllowance` hold the
        // full-month sticker price; the `1`-suffixed columns hold what the employee
        // actually earned for days worked. Every importer written before 2026-08-29
        // took the wrong set — see lib/dbbill-salary-mapping.mjs.
        const gross   = earnedGross(br);
        const netSal  = n(br.NetSalary);
        // NOT n(br.TotalDeduction): that column rolls up only the non-statutory
        // buckets and excludes EPF / ESIC / TDS / advance / loan.
        const totalDed= totalDeductions(br);
        const basic   = n(br[EARNED_COLUMN.Basic]);
        const hra     = n(br[EARNED_COLUMN.HRA]);
        const sa      = n(br[EARNED_COLUMN.SpecialAllowance]);
        const wdays   = n(br.WorkingDays);
        const edays   = n(br.EarnedDays);
        const ldays   = n(br.Leave);
        const pfEmp   = n(br.EPF);
        const pfEmpr  = n(br.EPFCompany);
        const esicEmp = n(br.ESIC);
        const esicEmpr= n(br.ESICCompany);
        const pt      = n(br.ProTaxDeduction);
        const tds     = n(br.IncomeTax);

        lineRows.push([
          lineId, runId, empId, br.EmpCode,
          wdays, edays, ldays,
          gross, totalDed, netSal,
          pfEmp, pfEmpr, esicEmp, esicEmpr,
          pt, tds, basic, hra, sa,
          // attendance_data_source is enum('ADR','SESSION_FALLBACK','NO_DATA').
          // 'legacy_migration' is not a member, so it was silently coerced to ''
          // on 19,263 rows. NO_DATA is the honest value: these days were never
          // derived from an attendance record, they came from the legacy register.
          'NO_DATA', 'finalized'
        ]);

        for (const [code, cname, ctype, billCol] of COMPONENT_MAP) {
          const amt = n(br[billCol]);
          if (amt === 0) continue;
          // source is enum('snapshot','structure','statutory','manual','system').
          // 'legacy_migration' is not a member — coerced to '' on 118,114 rows.
          compRows.push([uuid(), runId, lineId, empId, code, cname, ctype, amt, 'snapshot']);
        }
      }

      // Insert salary_prep_line rows
      if (lineRows.length) {
        const ph = lineRows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const [res] = await hrms.execute(
          `INSERT INTO salary_prep_line
            (id,run_id,employee_id,employee_code,
             working_days,present_days,leave_days,
             gross_salary,total_deductions,net_salary,
             pf_employee,pf_employer,esic_employee,esic_employer,
             professional_tax,tds_amount,basic,hra,special_allowance,
             attendance_data_source,status)
           VALUES ${ph}`,
          lineRows.flat()
        );
        totalLineInserted += res.affectedRows;
      }

      // Insert salary_prep_line_component rows
      if (compRows.length) {
        const ph = compRows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
        const [res] = await hrms.execute(
          `INSERT INTO salary_prep_line_component
            (id,run_id,line_id,employee_id,component_code,component_name,component_type,amount,source)
           VALUES ${ph}`,
          compRows.flat()
        );
        totalCompInserted += res.affectedRows;
      }
    }
  }

  // Final counts
  const [[lc]] = await hrms.query('SELECT COUNT(*) c FROM salary_prep_line');
  const [[cc]] = await hrms.query('SELECT COUNT(*) c FROM salary_prep_line_component');
  const [[bc]] = await bill.query('SELECT COUNT(*) c FROM salary_data');
  log('');
  log('═══════════════════════════════════════════════');
  log(`salary_prep_line       : hrms=${Number(lc.c)}  bill=${Number(bc.c)}  gap=${Number(bc.c)-Number(lc.c)}`);
  log(`salary_prep_line_component : hrms=${Number(cc.c)}`);
  log(`Lines inserted   : ${totalLineInserted}`);
  log(`Comps inserted   : ${totalCompInserted}`);
  log(`Skipped (no emp) : ${totalSkipped}`);

  await hrms.end();
  await bill.end();
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
