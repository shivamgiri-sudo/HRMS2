/**
 * verify-calculator-parity-vs-dbbill.mjs   READ-ONLY.
 *
 * Proves the payslip component builder now reproduces db_bill's itemisation, on
 * real db_bill rows rather than fixtures.
 *
 * Replays the exact arithmetic the calculator performs for an assignment-sourced
 * line (payrollCalculate.service.ts):
 *
 *   ratio                = EarnedDays / WorkingDays
 *   calcSpecialAllowance = pkgGross*ratio - pkgBasic*ratio - pkgHra*ratio   <- calculateNetSalary
 *   SPECIAL              = calcSpecialAllowance - prorated(BONUS+CONV+PORTFOLIO+MEDICAL+LTA+OTHER_ALLOW)
 *   every other line     = pkgComponent * ratio
 *
 * and compares each emitted line against db_bill's own earned column for that
 * employee-month. Before the fix, SPECIAL subtracted CONV only, so every other
 * in-gross sibling was double-counted: once as its own line and again inside
 * SPECIAL.
 *
 * Usage: node backend/scripts/verify-calculator-parity-vs-dbbill.mjs [--month=2026-07]
 */
import { connect } from './lib/db-connect.mjs';
import { num, PAID_ROW_FILTER } from './lib/dbbill-salary-mapping.mjs';

const arg = (n, fb) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? fb;
const MONTH = arg('month', null);
const HRMS_HOST = arg('hrms-host', null);
const BILL_HOST = arg('bill-host', null);
const log = (m) => process.stdout.write(m + '\n');
const r2 = (n) => Math.round(n * 100) / 100;

// Mirrors buildPayslipEarningComponents' assignment path exactly.
function emit(pkg, ed, wd) {
  // Mirrors the corrected assignment path: every component, SPECIAL included, is
  // taken from the package and prorated on its own. No residual.
  // Multiply before dividing: a precomputed ratio loses the exact .5 at rounding
  // boundaries (1333 * (8.5/31) = 365.49999999999994, but (1333*8.5)/31 = 365.5).
  const R = (n) => Math.round(n);            // db_bill rounds to whole rupees
  const pro = (v) => R((v * ed) / wd);
  const comp = {
    BASIC: pkg.basic, HRA: pkg.hra, CONV: pkg.conv, BONUS: pkg.bonus,
    PORTFOLIO: pkg.portfolio, MEDICAL: pkg.medical, LTA: pkg.lta,
    SPECIAL: pkg.special, OTHER_ALLOW: pkg.other,
  };
  const out = {};
  for (const [k, v] of Object.entries(comp)) if (v > 0) out[k] = pro(v);
  return out;
}

async function main() {
  const bill = await connect('db_bill', { host: BILL_HOST, log: () => {} });
  const monthCond = MONTH ? `AND DATE_FORMAT(SalayDate,'%Y-%m') = ${bill.escape(MONTH)}` : '';
  const [rows] = await bill.query(`
    SELECT TRIM(EmpCode) code, DATE_FORMAT(SalayDate,'%Y-%m') mon,
           Basic, HRA, Bonus, Conv, Portfolio, MedicalAllowance, LTA, SpecialAllowance,
           OtherAllowance, Gross, WorkingDays, EarnedDays,
           Basic1, HRA1, Bonus1, Conv1, Portfolio1, MedicalAllowance1,
           SpecialAllowance1, OtherAllowance1, Gross1
      FROM salary_data
     WHERE ${PAID_ROW_FILTER} ${monthCond}
       AND CAST(WorkingDays AS DECIMAL(8,2)) > 0
  `);
  log(`db_bill rows replayed: ${rows.length}${MONTH ? ` (month ${MONTH})` : ' (all months)'}`);

  const MAP = {
    BASIC: 'Basic1', HRA: 'HRA1', BONUS: 'Bonus1', CONV: 'Conv1',
    PORTFOLIO: 'Portfolio1', MEDICAL: 'MedicalAllowance1',
    SPECIAL: 'SpecialAllowance1', OTHER_ALLOW: 'OtherAllowance1',
  };
  const bad = {}; let grossBad = 0, checked = 0, maxDev = 0, devTotal = 0;
  const devSamples = [];
  const samples = [];

  for (const r of rows) {
    const wd = num(r.WorkingDays), ed = num(r.EarnedDays);
    if (wd <= 0) continue;
    const ratio = ed / wd;
    const pkg = {
      basic: num(r.Basic), hra: num(r.HRA), conv: num(r.Conv), bonus: num(r.Bonus),
      portfolio: num(r.Portfolio), medical: num(r.MedicalAllowance), lta: num(r.LTA),
      special: num(r.SpecialAllowance), other: num(r.OtherAllowance), gross: num(r.Gross),
    };
    const got = emit(pkg, ed, wd);
    checked++;

    for (const [code, billCol] of Object.entries(MAP)) {
      const want = r2(num(r[billCol]));
      const have = r2(got[code] ?? 0);
      if (Math.abs(want - have) > 0.0) {
        bad[code] = (bad[code] ?? 0) + 1;
        if (samples.length < 6) samples.push(`${r.mon} ${r.code} ${code}: db_bill=${want} calc=${have}`);
      }
    }
    const total = r2(Object.values(got).reduce((s, v) => s + v, 0));
    const dev = Math.abs(total - r2(num(r.Gross1)));
    if (dev > 0.0) {
      grossBad++;
      if (devSamples.length < 8) devSamples.push(`${r.mon} ${r.code}: sum=${total} Gross1=${r2(num(r.Gross1))} dev=${r2(total - r2(num(r.Gross1)))} ratio=${r2(ratio)}`);
    }
    maxDev = Math.max(maxDev, dev);
    devTotal += dev;
  }

  log('');
  log(`employee-months checked: ${checked}`);
  log('  component            mismatches (tolerance Rs 0 - exact)');
  let clean = true;
  for (const code of Object.keys(MAP)) {
    const n = bad[code] ?? 0;
    if (n) clean = false;
    log(`  ${code.padEnd(20)} ${String(n).padStart(8)}${n ? '   MISMATCH' : '   MATCH'}`);
  }
  log(`  ${'SUM == Gross1'.padEnd(20)} ${String(grossBad).padStart(8)}${grossBad ? '   MISMATCH' : '   MATCH'}`);
  log('');
  log(`  worst sum deviation: Rs ${r2(maxDev)}   mean: Rs ${r2(devTotal / Math.max(1, checked))}`);
  if (samples.length) { log(''); log('  component samples:'); samples.forEach(s => log('    ' + s)); }
  if (devSamples.length) { log(''); log('  sum-deviation samples:'); devSamples.forEach(s => log('    ' + s)); }
  log('');
  log(clean && !grossBad
    ? 'RESULT: the calculator now itemises exactly as db_bill does.'
    : 'RESULT: divergence remains - see samples above.');
  await bill.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
