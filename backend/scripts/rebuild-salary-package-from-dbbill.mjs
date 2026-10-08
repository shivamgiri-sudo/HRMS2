/**
 * rebuild-salary-package-from-dbbill.mjs
 *
 * Makes mas_hrms.salary_component_assignments hold EXACTLY what db_bill holds.
 *
 * WHY
 * ---
 * `salary_component_assignments` is the payroll calculator's PREFERRED salary source
 * (payrollCalculate.service.ts:1143 "prefer salary_component_assignments"), so it
 * decides what every future run pays. Measured against db_bill it is wrong on
 * 2,619 of 4,291 rows:
 *
 *   group  rows   symptom
 *   B        789  `bonus` is 0 while `gross` still includes it. Band G in
 *                 salary_package_master is basic 8000 + hra 4793 + conv 1600 +
 *                 bonus 666 = gross 15059; the stored row has bonus 0 and a
 *                 666 hole. 789 of these are confirmed against a real band.
 *   D      1,379  positive hole, no band row to confirm it against
 *   A        451  the parts EXCEED gross - by up to Rs 19,542. 318 of them have
 *                 `portfolio` and `special_allowance` holding the SAME value,
 *                 i.e. one figure written into two columns. Dropping either one
 *                 fixes at most 333, so there is no single arithmetic rule and
 *                 nothing here may be derived.
 *
 * THE CONTRACT, taken from db_bill and verified on it
 * --------------------------------------------------
 *   Gross = Basic + HRA + Bonus + Conv + Portfolio + MedicalAllowance
 *         + LTA + SpecialAllowance + OtherAllowance          exact, 9,813/9,813
 *
 * db_bill stores SpecialAllowance as a REAL component. mas_hrms's calculator
 * instead treats it as a residual (gross - basic - hra - conv...) and explicitly
 * ignores the stored value. That divergence is why the two systems disagree on
 * itemisation even when gross and net agree, and it is why a row whose parts
 * exceed gross would compute a NEGATIVE special allowance.
 *
 * So nothing is derived here. Every component is copied from the employee's most
 * recent `salary_data` entitlement row - the same row db_bill itself prices the
 * month from - and `gross` is copied, not recomputed, so the sum identity holds
 * by construction rather than by arithmetic luck.
 *
 * SCOPE
 * -----
 * 1,054 of 1,123 active employees have db_bill salary history. The other 69 are
 * new joiners with no db_bill row at all: they are REPORTED AND LEFT UNTOUCHED,
 * because inventing a package for a real employee is worse than leaving a known
 * gap visible. IDC is excluded throughout (separate entity, deliberately not
 * migrated).
 *
 * Superseded rows are marked status='superseded' rather than deleted, so history
 * survives and "which row is current" stops depending on query ordering - today
 * 838 employees carry 4 rows all marked 'active'.
 *
 * READ-ONLY on db_bill. Touches only salary_component_assignments.
 *
 * Usage:
 *   node backend/scripts/rebuild-salary-package-from-dbbill.mjs --dry-run
 *   node backend/scripts/rebuild-salary-package-from-dbbill.mjs
 */
import { connect } from './lib/db-connect.mjs';
import { num, PAID_ROW_FILTER } from './lib/dbbill-salary-mapping.mjs';
import crypto from 'crypto';

const arg = (n, fb) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? fb;
const DRY_RUN   = process.argv.includes('--dry-run');
const HRMS_HOST = arg('hrms-host', null);
const BILL_HOST = arg('bill-host', null);
const log = (m) => process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`);

/** db_bill entitlement column -> salary_component_assignments column. */
const PKG = [
  ['Basic',            'basic'],
  ['HRA',              'hra'],
  ['Bonus',            'bonus'],
  ['Conv',             'conveyance'],
  ['Portfolio',        'portfolio'],
  ['MedicalAllowance', 'medical_allowance'],
  ['LTA',              'lta'],
  ['SpecialAllowance', 'special_allowance'],
  ['OtherAllowance',   'other_allowance'],
  ['PLI1',             'pli'],
];

async function main() {
  log(`Rebuild salary package to db_bill parity${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  const hrms = await connect('mas_hrms', { host: HRMS_HOST, log });
  const bill = await connect('db_bill',  { host: BILL_HOST, log });

  // Most recent entitlement row per employee. MySQL 5.5: no window functions.
  const [bRows] = await bill.query(`
    SELECT TRIM(s.EmpCode) AS code, s.SalayDate,
           s.Basic, s.HRA, s.Bonus, s.Conv, s.Portfolio, s.MedicalAllowance,
           s.LTA, s.SpecialAllowance, s.OtherAllowance, s.PLI1, s.Gross,
           s.ESIElig, s.PFELig, s.ESIC, s.EPF, s.ESICCompany, s.EPFCompany, s.CTC
      FROM salary_data s
      JOIN (SELECT TRIM(EmpCode) AS code, MAX(SalayDate) AS mx
              FROM salary_data
             WHERE ${PAID_ROW_FILTER}
             GROUP BY TRIM(EmpCode)) latest
        ON latest.code = TRIM(s.EmpCode) AND latest.mx = s.SalayDate
     WHERE ${PAID_ROW_FILTER}
  `);
  const bMap = new Map();
  for (const r of bRows) if (!bMap.has(r.code)) bMap.set(r.code, r);
  log(`  db_bill packages: ${bMap.size}`);

  // Sanity: the identity must hold on every source row before anything is copied.
  let identityFail = 0;
  for (const r of bMap.values()) {
    const parts = PKG.filter(([, c]) => c !== 'pli').reduce((s, [b]) => s + num(r[b]), 0);
    if (Math.abs(parts - num(r.Gross)) > 1) identityFail++;
  }
  if (identityFail > 0) {
    log(`  ABORT: ${identityFail} db_bill package(s) fail Gross = sum(parts). Not copying an inconsistent source.`);
    await hrms.end(); await bill.end(); return;
  }
  log(`  identity Gross = sum(parts) holds on all ${bMap.size} source packages`);

  const [emps] = await hrms.query(
    `SELECT id, TRIM(employee_code) AS code FROM employees WHERE active_status = 1`);
  log(`  mas_hrms active employees: ${emps.length}`);

  const [existing] = await hrms.query(`
    SELECT s.id, s.employee_id, TRIM(e.employee_code) AS code, s.effective_date, s.status, s.gross
      FROM salary_component_assignments s JOIN employees e ON e.id = s.employee_id`);
  const byEmp = new Map();
  for (const r of existing) {
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id).push(r);
  }

  let inserted = 0, superseded = 0, alreadyExact = 0, noSource = [];

  for (const emp of emps) {
    const b = bMap.get(emp.code);
    if (!b) { noSource.push(emp.code); continue; }

    const vals = {};
    for (const [bc, hc] of PKG) vals[hc] = num(b[bc]);
    const gross = num(b.Gross);
    const effective = String(b.SalayDate).slice(0, 10);

    const rows = byEmp.get(emp.id) ?? [];
    const actives = rows.filter(r => r.status === 'active');

    // Always collapse to exactly ONE active row, whether or not the values already
    // agree. Leaving the extras in place is the defect, not a saving: 837 employees
    // carry four rows all marked 'active', so "the current package" resolves only by
    // query ordering, and the calculator's own ORDER BY effective_date DESC is the
    // only reason it happens to pick a sane one today. Other readers do not order.
    const exact = actives.length === 1 && Math.abs(num(actives[0].gross) - gross) <= 1
      && await (async () => {
        const [chk] = await hrms.query(
          `SELECT basic,hra,bonus,conveyance,portfolio,medical_allowance,lta,special_allowance,other_allowance,pli
             FROM salary_component_assignments WHERE id = ?`, [actives[0].id]);
        const c = chk[0] ?? {};
        return PKG.every(([, hc]) => Math.abs(num(c[hc]) - vals[hc]) <= 1);
      })();

    if (exact) { alreadyExact++; continue; }

    for (const r of actives) {
      if (!DRY_RUN) await hrms.query(
        `UPDATE salary_component_assignments SET status='superseded' WHERE id = ?`, [r.id]);
      superseded++;
    }
    if (!DRY_RUN) {
      await hrms.query(
        `INSERT INTO salary_component_assignments
           (id, employee_id, effective_date, basic, hra, bonus, conveyance, portfolio,
            medical_allowance, lta, special_allowance, other_allowance, pli, gross,
            status, approval_reference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active','db_bill parity rebuild')`,
        [crypto.randomUUID(), emp.id, effective, vals.basic, vals.hra, vals.bonus,
         vals.conveyance, vals.portfolio, vals.medical_allowance, vals.lta,
         vals.special_allowance, vals.other_allowance, vals.pli, gross]);
    }
    inserted++;
  }

  log('');
  log(`${DRY_RUN ? 'WOULD WRITE' : 'WROTE'}:`);
  log(`  packages set to db_bill values .... ${inserted}`);
  log(`  old rows marked superseded ........ ${superseded}`);
  log(`  already exact, untouched .......... ${alreadyExact}`);
  log(`  active emps with NO db_bill row ... ${noSource.length}  (left untouched)`);
  if (noSource.length) log(`    e.g. ${noSource.slice(0, 12).join(', ')}`);
  await hrms.end(); await bill.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
