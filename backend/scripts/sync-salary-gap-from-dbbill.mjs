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
 * Safe to re-run: INSERT IGNORE on UNIQUE (run_id, employee_id).
 */
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

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
function n(v)   { const x = parseFloat(v); return isNaN(x) ? 0 : x; }

// salary_data column → component mapping
const COMPONENT_MAP = [
  // code,            name,                       type,            billCol
  ['BASIC',           'Basic',                    'earning',       'Basic'],
  ['HRA',             'HRA',                      'earning',       'HRA'],
  ['BONUS',           'Bonus',                    'earning',       'Bonus'],
  ['CONV',            'Conveyance',               'earning',       'Conv'],
  ['PORTFOLIO',       'Portfolio',                'earning',       'Portfolio'],
  ['MA',              'Medical Allowance',        'earning',       'MedicalAllowance'],
  ['LTA',             'LTA',                      'earning',       'LTA'],
  ['SPECIAL',         'Special Allowance',        'earning',       'SpecialAllowance'],
  ['OA',              'Other Allowance',          'earning',       'OtherAllowance'],
  ['INCENTIVE',       'Incentive',                'earning',       'Incentive'],
  ['EXTRA_DAY_INC',   'Extra Day Incentive',      'earning',       'ExtraDayIncentive'],
  ['ARREAR',          'Arrear',                   'earning',       'Arrear'],
  ['PLI',             'PLI',                      'earning',       'PLI'],
  ['PF_EMP',          'PF Employee',              'deduction',     'EPF'],
  ['ESIC_EMP',        'ESIC Employee',            'deduction',     'ESIC'],
  ['PT',              'Professional Tax',         'deduction',     'ProTaxDeduction'],
  ['TDS',             'Income Tax / TDS',         'deduction',     'IncomeTax'],
  ['ADV',             'Advance Recovery',         'deduction',     'AdvPaid'],
  ['LOAN',            'Loan Deduction',           'deduction',     'LoanDed'],
  ['LWP',             'LWP Deduction',            'deduction',     'LeaveDeduction'],
  ['MOBILE_DED',      'Mobile Deduction',         'deduction',     'MobileDedcution'],
  ['ASSET_REC',       'Asset Recovery',           'deduction',     'AssetRecovery'],
  ['INS',             'Insurance',                'deduction',     'Insurance'],
  ['OTHER_DED',       'Other Deduction',          'deduction',     'OtherDeduction'],
  ['PF_EMP_CO',       'PF Employer',              'employer_cost', 'EPFCompany'],
  ['ESIC_EMP_CO',     'ESIC Employer',            'employer_cost', 'ESICCompany'],
  ['ADMIN_CHG',       'Admin Charge',             'employer_cost', 'AdminChrg'],
];

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
        const gross   = n(br.Gross);
        const netSal  = n(br.NetSalary);
        const totalDed= n(br.TotalDeduction);
        const basic   = n(br.Basic);
        const hra     = n(br.HRA);
        const sa      = n(br.SpecialAllowance);
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
          'legacy_migration', 'finalized'
        ]);

        for (const [code, cname, ctype, billCol] of COMPONENT_MAP) {
          const amt = n(br[billCol]);
          if (amt === 0) continue;
          compRows.push([uuid(), runId, lineId, empId, code, cname, ctype, amt, 'legacy_migration']);
        }
      }

      // Insert salary_prep_line rows
      if (lineRows.length) {
        const ph = lineRows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const [res] = await hrms.execute(
          `INSERT IGNORE INTO salary_prep_line
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
          `INSERT IGNORE INTO salary_prep_line_component
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
