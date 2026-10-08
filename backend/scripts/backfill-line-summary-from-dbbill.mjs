/**
 * backfill-line-summary-from-dbbill.mjs
 *
 * WHAT THIS FIXES
 * ---------------
 * `salary_prep_line_component` is exact against db_bill on all 29 heads (verified
 * 129,696/129,696, zero variance). But `salary_prep_line` carries a SECOND copy of
 * the same figures in its own summary columns, and six of them were never populated
 * by any importer. Every screen, report and payslip that reads the line row rather
 * than the component table therefore shows zero:
 *
 *   column              db_bill column     rows wrong   understated by
 *   incentive_total      Incentive             54,193    Rs 11,82,75,183
 *   other_deductions     OtherDeduction         6,659    Rs    70,44,051
 *   tds                  IncomeTax              1,673    Rs    66,16,985
 *   loan_emi             LoanDed                  477    Rs    29,20,605
 *   advance_recovery     AdvPaid                  181    Rs    14,63,866
 *   lwp_deduction        LeaveDeduction           128    Rs      28,976
 *                                                        ────────────────
 *                                                        Rs 13,63,49,666
 *
 * Every drift is one-directional: mas_hrms is LOW, never high. `gross_salary` and
 * `net_salary` are already exact, so no payment amount changes - this restores the
 * itemisation behind an already-correct net.
 *
 * Day columns, same problem:
 *   final_payable_days   EarnedDays           115,569 rows sat at 0
 *   lwp_days             WorkingDays-EarnedDays  all rows sat at 0
 *
 * `Leave` in db_bill is PAID leave, not LWP - MAS62735 for 2026-07 has
 * WorkingDays=31, EarnedDays=31, Leave=1, i.e. a leave day that did not reduce
 * earned days. So LWP is the shortfall `WorkingDays - EarnedDays`, never `Leave`.
 * `leave_days` already matches `Leave` and is left alone.
 *
 * `paid_working_days` is deliberately NOT touched. db_bill's nearest column is
 * ActualDays (physically present, excludes week-offs/holidays/paid leave) which is
 * a different quantity from EarnedDays, and guessing a payroll day-count is worse
 * than leaving it as it is. Flagged rather than assumed.
 *
 * READ-ONLY on db_bill. Writes only the eight columns listed above, only where the
 * value actually differs, and never touches gross_salary, net_salary,
 * total_deductions or any component row.
 *
 * Usage:
 *   node backend/scripts/backfill-line-summary-from-dbbill.mjs --dry-run
 *   node backend/scripts/backfill-line-summary-from-dbbill.mjs --month=2026-07
 *   node backend/scripts/backfill-line-summary-from-dbbill.mjs
 */
import { connect } from './lib/db-connect.mjs';
import { num, PAID_ROW_FILTER } from './lib/dbbill-salary-mapping.mjs';

const arg = (n, fb) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? fb;
const DRY_RUN   = process.argv.includes('--dry-run');
const ONLY_MONTH = arg('month', null);
const HRMS_HOST = arg('hrms-host', null);
const BILL_HOST = arg('bill-host', null);
const log = (m) => process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`);

/** hrms line column -> [db_bill column, kind] */
const MONEY_COLS = [
  ['tds',              'IncomeTax'],
  ['lwp_deduction',    'LeaveDeduction'],
  ['advance_recovery', 'AdvPaid'],
  ['loan_emi',         'LoanDed'],
  ['incentive_total',  'Incentive'],
  ['other_deductions', 'OtherDeduction'],
  // Paid-leave day count. Already correct on 129,587 of 129,696 rows; 109 drifted
  // by a combined 54.5 days. Included so the column is exact rather than nearly so.
  ['leave_days',       'Leave'],
];

async function main() {
  log(`Backfill line summary columns${DRY_RUN ? ' [DRY-RUN]' : ''}${ONLY_MONTH ? ` month=${ONLY_MONTH}` : ' all months'}`);
  const hrms = await connect('mas_hrms', { host: HRMS_HOST, log });
  const bill = await connect('db_bill', { host: BILL_HOST, log });

  const monthCond = ONLY_MONTH ? `AND DATE_FORMAT(SalayDate,'%Y-%m') = ${bill.escape(ONLY_MONTH)}` : '';
  const [bRows] = await bill.query(`
    SELECT TRIM(EmpCode) AS code, DATE_FORMAT(SalayDate,'%Y-%m') AS mon,
           IncomeTax, LeaveDeduction, AdvPaid, LoanDed, Incentive, OtherDeduction,
           \`Leave\`, WorkingDays, EarnedDays
      FROM salary_data
     WHERE ${PAID_ROW_FILTER} ${monthCond}
  `);
  log(`  db_bill rows: ${bRows.length}`);
  const bMap = new Map(bRows.map(r => [`${r.code}|${r.mon}`, r]));

  const hrmsMonthCond = ONLY_MONTH ? `WHERE r.run_month = ${hrms.escape(ONLY_MONTH)}` : '';
  const [hRows] = await hrms.query(`
    SELECT l.id, TRIM(l.employee_code) AS code, r.run_month AS mon,
           l.tds, l.lwp_deduction, l.advance_recovery, l.loan_emi,
           l.incentive_total, l.other_deductions, l.leave_days,
           l.final_payable_days, l.lwp_days
      FROM salary_prep_line l JOIN salary_prep_run r ON r.id = l.run_id
      ${hrmsMonthCond}
  `);
  log(`  mas_hrms lines: ${hRows.length}`);

  const changed = Object.fromEntries([...MONEY_COLS.map(([c]) => [c, 0]),
    ['final_payable_days', 0], ['lwp_days', 0]]);
  const drift = Object.fromEntries(Object.keys(changed).map(k => [k, 0]));
  let rowsTouched = 0, unmatched = 0;

  for (const h of hRows) {
    const b = bMap.get(`${h.code}|${h.mon}`);
    if (!b) { unmatched++; continue; }

    const sets = [], vals = [];
    for (const [hc, bc] of MONEY_COLS) {
      const want = num(b[bc]);
      const have = num(h[hc]);
      if (Math.abs(want - have) > 0.011) {
        sets.push(`${hc} = ?`); vals.push(want);
        changed[hc]++; drift[hc] += want - have;
      }
    }
    const wantPayable = num(b.EarnedDays);
    if (Math.abs(wantPayable - num(h.final_payable_days)) > 0.011) {
      sets.push('final_payable_days = ?'); vals.push(wantPayable);
      changed.final_payable_days++; drift.final_payable_days += wantPayable - num(h.final_payable_days);
    }
    const wantLwp = Math.max(0, num(b.WorkingDays) - num(b.EarnedDays));
    if (Math.abs(wantLwp - num(h.lwp_days)) > 0.011) {
      sets.push('lwp_days = ?'); vals.push(wantLwp);
      changed.lwp_days++; drift.lwp_days += wantLwp - num(h.lwp_days);
    }

    if (sets.length === 0) continue;
    rowsTouched++;
    if (!DRY_RUN) {
      await hrms.query(`UPDATE salary_prep_line SET ${sets.join(', ')} WHERE id = ?`, [...vals, h.id]);
    }
  }

  log('');
  log(`${DRY_RUN ? 'WOULD UPDATE' : 'UPDATED'} ${rowsTouched} line(s); unmatched in db_bill: ${unmatched}`);
  log('  column                rows        delta');
  for (const k of Object.keys(changed)) {
    if (changed[k] === 0) continue;
    const isDays = k.endsWith('_days');
    log(`  ${k.padEnd(20)} ${String(changed[k]).padStart(6)}  ${isDays ? drift[k].toFixed(2) + ' days' : 'Rs ' + drift[k].toFixed(2)}`);
  }
  await hrms.end(); await bill.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
