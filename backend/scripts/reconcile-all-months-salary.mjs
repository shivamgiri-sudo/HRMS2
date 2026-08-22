/**
 * reconcile-all-months-salary.mjs
 *
 * Deep tally: every salary component × every employee × every month
 * comparing db_bill.salary_data against mas_hrms salary_prep_line_component.
 *
 * Outputs:
 *   - Summary table by month (match/diff counts)
 *   - Component-level summary (which components drift most)
 *   - Branch-level summary
 *   - Employee-level diff list (saved to reconcile-diffs.csv)
 *
 * Usage:
 *   node backend/scripts/reconcile-all-months-salary.mjs
 *   node backend/scripts/reconcile-all-months-salary.mjs --month=2025-04
 *   node backend/scripts/reconcile-all-months-salary.mjs --hrms-host=122.184.128.90
 *   node backend/scripts/reconcile-all-months-salary.mjs --tolerance=10
 */

import mysql  from 'mysql2/promise';
import fs     from 'fs';
import path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}
function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}

const HRMS_HOST  = arg('hrms-host', process.env.DB_HOST ?? fromEnvFile('DB_HOST') ?? '192.168.10.6');
const BILL_HOST  = arg('bill-host', process.env.BILL_DB_HOST ?? fromEnvFile('BILL_DB_HOST') ?? '192.168.10.22');
const DB_USER    = process.env.DB_USER     ?? fromEnvFile('DB_USER');
const DB_PASS    = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD');
const SINGLE_MON = arg('month', null);
const TOLERANCE  = Number(arg('tolerance', '1')); // Rs diff to ignore (rounding)

const COMP_MAP = [
  // [hrms_code,  db_bill_field,        label]
  ['BASIC',        'Basic',             'Basic'],
  ['HRA',          'HRA',               'HRA'],
  ['BONUS',        'Bonus',             'Bonus'],
  ['CONV',         'Conv',              'Conveyance'],
  ['PORTFOLIO',    'Portfolio',         'Portfolio'],
  ['MA',           'MedicalAllowance',  'Medical Allowance'],
  ['LTA',          'LTA',               'LTA'],
  ['SPECIAL',      'SpecialAllowance',  'Special Allowance'],
  ['OA',           'OtherAllowance',    'Other Allowance'],
  ['INCENTIVE',    'Incentive',         'Incentive'],
  ['EXTRA_DAY_INC','ExtraDayIncentive', 'Extra Day Incentive'],
  ['ARREAR',       'Arrear',            'Arrear'],
  ['PF_EMP',       'EPF',               'PF Employee'],
  ['ESIC_EMP',     'ESIC',              'ESIC Employee'],
  ['PT',           'ProTaxDeduction',   'Professional Tax'],
  ['TDS',          'IncomeTax',         'TDS / Income Tax'],
  ['ADV',          'AdvPaid',           'Advance Paid'],
  ['LOAN',         'LoanDed',           'Loan Deduction'],
  ['LWP',          'LeaveDeduction',    'LWP Deduction'],
  ['MOBILE_DED',   'MobileDedcution',   'Mobile Deduction'],
  ['ASSET_REC',    'AssetRecovery',     'Asset Recovery'],
  ['INS',          'Insurance',         'Insurance'],
  ['OTHER_DED',    'OtherDeduction',    'Other Deduction'],
  ['PF_EMP_CO',    'EPFCompany',        'PF Employer'],
  ['ESIC_EMP_CO',  'ESICCompany',       'ESIC Employer'],
  ['ADMIN_CHG',    'AdminChrg',         'Admin Charges'],
  // summary fields (from salary_prep_line, not components)
  ['GROSS',        'Gross',             'Gross Salary'],
  ['NET',          'NetSalary',         'Net Salary'],
  ['TOTAL_DED',    'TotalDeduction',    'Total Deduction'],
  ['WORKING_DAYS', 'WorkingDays',       'Working Days'],
  ['PRESENT_DAYS', 'EarnedDays',        'Present/Earned Days'],
];

// Summary fields come from salary_prep_line directly
const LINE_FIELDS = new Set(['GROSS','NET','TOTAL_DED','WORKING_DAYS','PRESENT_DAYS']);

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }
function round2(v) { return Math.round(Number(v) * 100) / 100; }

async function getMonths(bill) {
  const [rows] = await bill.execute(`
    SELECT DISTINCT DATE_FORMAT(SalayDate,'%Y-%m') AS mon
    FROM salary_data
    WHERE EmpCode NOT LIKE 'IDC%'
      AND (Status='1' OR Status IS NULL OR Status='')
    ORDER BY mon
  `);
  return rows.map(r => r.mon);
}

async function getBillRows(bill, mon) {
  const [rows] = await bill.execute(`
    SELECT EmpCode, Branch, CostCenter,
           Basic, HRA, Bonus, Conv, Portfolio, MedicalAllowance, LTA,
           SpecialAllowance, OtherAllowance, Incentive, ExtraDayIncentive, Arrear,
           EPF, ESIC, ProTaxDeduction, IncomeTax, AdvPaid, LoanDed,
           LeaveDeduction, MobileDedcution, AssetRecovery, Insurance, OtherDeduction,
           EPFCompany, ESICCompany, AdminChrg,
           Gross, NetSalary, TotalDeduction, WorkingDays, EarnedDays
    FROM salary_data
    WHERE DATE_FORMAT(SalayDate,'%Y-%m') = ?
      AND EmpCode NOT LIKE 'IDC%'
      AND (Status='1' OR Status IS NULL OR Status='')
      AND EmpCode IS NOT NULL AND TRIM(EmpCode) != ''
  `, [mon]);
  // Key by EmpCode
  const map = new Map();
  for (const r of rows) map.set(r.EmpCode, r);
  return map;
}

async function getHrmsRows(hrms, mon) {
  // Get line-level summary fields
  const [lines] = await hrms.execute(`
    SELECT spl.employee_code,
           spl.gross_salary, spl.net_salary, spl.total_deductions,
           spl.working_days, spl.present_days
    FROM salary_prep_line spl
    JOIN salary_prep_run spr ON spr.id = spl.run_id
    WHERE spr.run_month = ?
  `, [mon]);
  const lineMap = new Map(lines.map(l => [l.employee_code, l]));

  // Get component amounts
  const [comps] = await hrms.execute(`
    SELECT spl.employee_code, splc.component_code, splc.amount
    FROM salary_prep_line_component splc
    JOIN salary_prep_line spl ON spl.id = splc.line_id
    JOIN salary_prep_run spr ON spr.id = spl.run_id
    WHERE spr.run_month = ?
  `, [mon]);

  // Build map: empCode -> { compCode -> amount }
  const compMap = new Map();
  for (const c of comps) {
    if (!compMap.has(c.employee_code)) compMap.set(c.employee_code, new Map());
    compMap.get(c.employee_code).set(c.component_code, round2(c.amount));
  }

  return { lineMap, compMap };
}

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch(e) {
      if ((e.message.includes('Deadlock') || e.message.includes('deadlock') || e.message.includes('Lock wait')) && i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function reconcileMonth(bill, hrms, mon, csvRows, summaryByComp, summaryByBranch) {
  const billMap = await withRetry(() => getBillRows(bill, mon));
  const { lineMap, compMap } = await withRetry(() => getHrmsRows(hrms, mon));

  let totalEmp = 0, diffEmp = 0, missingInHrms = 0;

  for (const [empCode, bRow] of billMap) {
    totalEmp++;
    const hLine = lineMap.get(empCode);
    const hComp = compMap.get(empCode) || new Map();

    if (!hLine) { missingInHrms++; continue; }

    let empHasDiff = false;
    for (const [code, field, label] of COMP_MAP) {
      const billAmt = round2(Number(bRow[field]) || 0);
      let hrmsAmt;
      if (LINE_FIELDS.has(code)) {
        const colMap = { GROSS:'gross_salary', NET:'net_salary', TOTAL_DED:'total_deductions', WORKING_DAYS:'working_days', PRESENT_DAYS:'present_days' };
        hrmsAmt = round2(Number(hLine[colMap[code]]) || 0);
      } else {
        hrmsAmt = round2(hComp.get(code) || 0);
      }
      const diff = Math.abs(billAmt - hrmsAmt);
      if (diff > TOLERANCE) {
        empHasDiff = true;
        csvRows.push({ mon, empCode, branch: bRow.Branch || '', costCenter: bRow.CostCenter || '', comp: code, label, billAmt, hrmsAmt, diff });
        summaryByComp[code] = summaryByComp[code] || { label, count: 0, totalDiff: 0 };
        summaryByComp[code].count++;
        summaryByComp[code].totalDiff += diff;
        const bn = (bRow.Branch || 'Unknown').trim();
        summaryByBranch[bn] = summaryByBranch[bn] || { diffComps: 0, totalDiff: 0 };
        summaryByBranch[bn].diffComps++;
        summaryByBranch[bn].totalDiff += diff;
      }
    }
    if (empHasDiff) diffEmp++;
  }

  return { totalEmp, diffEmp, missingInHrms };
}

async function main() {
  log(`Connecting HRMS=${HRMS_HOST}  db_bill=${BILL_HOST}`);
  const hrms = await mysql.createPool({ host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'mas_hrms', connectTimeout: 30000, waitForConnections: true, connectionLimit: 3 });
  const bill = await mysql.createPool({ host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'db_bill',  connectTimeout: 30000, waitForConnections: true, connectionLimit: 3, dateStrings: true });
  log('Connected.\n');

  const months = SINGLE_MON ? [SINGLE_MON] : await getMonths(bill);
  log(`Months to reconcile: ${months.length}\n`);

  const csvRows = [];
  const summaryByComp = {};
  const summaryByBranch = {};
  const monthSummary = [];

  let grandTotal = 0, grandDiffEmp = 0, grandMissing = 0;

  for (let i = 0; i < months.length; i++) {
    const mon = months[i];
    process.stdout.write(`[${i+1}/${months.length}] ${mon} ... `);
    const { totalEmp, diffEmp, missingInHrms } = await reconcileMonth(bill, hrms, mon, csvRows, summaryByComp, summaryByBranch);
    process.stdout.write(`total=${totalEmp}  diff=${diffEmp}  missing=${missingInHrms}\n`);
    monthSummary.push({ mon, totalEmp, diffEmp, missingInHrms, exact: totalEmp - diffEmp - missingInHrms });
    grandTotal   += totalEmp;
    grandDiffEmp += diffEmp;
    grandMissing += missingInHrms;
  }

  log('\n═══════════════════════════════════════════════════');
  log('RECONCILIATION COMPLETE');
  log(`Total employee-months checked : ${grandTotal}`);
  log(`Exact matches                 : ${grandTotal - grandDiffEmp - grandMissing}`);
  log(`Employees with component diff : ${grandDiffEmp}`);
  log(`Missing in mas_hrms           : ${grandMissing}`);

  // Months with diffs
  const diffMonths = monthSummary.filter(m => m.diffEmp > 0 || m.missingInHrms > 0);
  if (diffMonths.length) {
    log('\nMonths with discrepancies:');
    for (const m of diffMonths) {
      log(`  ${m.mon}  total=${m.totalEmp}  diff=${m.diffEmp}  missing=${m.missingInHrms}`);
    }
  } else {
    log('\nAll months: EXACT — every component matches for every employee.');
  }

  // Top component diffs
  const topComps = Object.entries(summaryByComp).sort((a,b) => b[1].count - a[1].count).slice(0, 10);
  if (topComps.length) {
    log('\nTop components with discrepancies:');
    for (const [code, s] of topComps) {
      log(`  ${code.padEnd(14)} ${s.label.padEnd(22)} diffs=${s.count}  totalDiff=Rs ${Math.round(s.totalDiff)}`);
    }
  }

  // Branch diffs
  const topBranches = Object.entries(summaryByBranch).sort((a,b) => b[1].totalDiff - a[1].totalDiff).slice(0, 15);
  if (topBranches.length) {
    log('\nBranches with most discrepancy:');
    for (const [bn, s] of topBranches) {
      log(`  ${bn.padEnd(30)} diffComps=${s.diffComps}  totalDiff=Rs ${Math.round(s.totalDiff)}`);
    }
  }

  // Write CSV
  if (csvRows.length > 0) {
    const csvPath = path.join(__dirname, 'reconcile-diffs.csv');
    const header = 'month,employee_code,branch,cost_center,component_code,component_label,bill_amount,hrms_amount,diff\n';
    const body = csvRows.map(r =>
      `${r.mon},${r.empCode},${JSON.stringify(r.branch)},${JSON.stringify(r.costCenter)},${r.comp},${JSON.stringify(r.label)},${r.billAmt},${r.hrmsAmt},${r.diff}`
    ).join('\n');
    fs.writeFileSync(csvPath, header + body, 'utf8');
    log(`\nDetailed diff CSV: ${csvRows.length} rows → ${csvPath}`);
  } else {
    log('\nNo component diffs found — CSV not written.');
  }

  await hrms.end();
  await bill.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });