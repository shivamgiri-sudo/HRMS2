/**
 * reconcile-db-bill-snapshot.mjs
 *
 * Compares db_bill (source of truth) against the mas_hrms mirror, row-for-row and
 * rupee-for-rupee. READ-ONLY on both databases — it never writes anywhere.
 *
 * WHY THIS EXISTS
 * ---------------
 * The mirror was reconciled exactly on 2026-08-03 and had already drifted by 2026-08-05:
 * Jul-26 held Rs 76.75 L of a real Rs 172.33 L — 55% of a month's revenue missing — while
 * Apr/May/Jun still matched to the rupee. That is the trap: the old months always match,
 * because nobody edits them. Only the newest one or two drift, and those are exactly the
 * months a P&L is read for.
 *
 * The CEO Overview reads its revenue straight out of billing_invoice_particular_snapshot,
 * so a stale mirror does not fail loudly — it renders a confident, precise, wrong margin.
 * It showed -984.9% on that stale data and -84.2% once the sync was re-run, with no code
 * change in between.
 *
 * Exit code 1 on any mismatch, so this can gate a deploy or run from cron.
 *
 * Usage:
 *   node backend/scripts/reconcile-db-bill-snapshot.mjs
 *   node backend/scripts/reconcile-db-bill-snapshot.mjs --hrms-host=${process.env.DB_HOST} --bill-host=${process.env.BILL_DB_HOST}
 *   node backend/scripts/reconcile-db-bill-snapshot.mjs --months=6
 */

import mysql from 'mysql2/promise';
import fs from 'fs';

const arg = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

function fromEnvFile(key) {
  try {
    const raw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = raw.split(/\r?\n/).find(l => l.trim().startsWith(`${key}=`));
    // .env values here are wrapped in double quotes; keeping them breaks auth with a
    // message identical to a host-grant failure.
    return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

const USER = process.env.DB_USER ?? fromEnvFile('DB_USER') ?? 'shivam_user';
const PASSWORD = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD') ?? '';
const MONTHS = Number(arg('months', '5'));

const HRMS = { host: arg('hrms-host', fromEnvFile('DB_HOST') ?? '192.168.10.6'), port: 3306,
  user: USER, password: PASSWORD, database: 'mas_hrms', connectTimeout: 20000 };
const BILL = { host: arg('bill-host', '192.168.10.22'), port: 3306,
  user: USER, password: PASSWORD, database: 'db_bill', connectTimeout: 20000 };

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** db_bill labels months 'Jul-26'. Jan-Mar of FY2026-27 are calendar 2027. */
function recentMonthLabels(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.unshift(`${MONTH_NAMES[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const money = (n) => (Number(n ?? 0) / 100000).toFixed(2);
let failures = 0;
let checks = 0;

/**
 * `countOnly` for chains with no money column (clients, expense heads): comparing rupees there
 * would silently pass on 0 === 0 and tell you nothing.
 */
function compare(label, src, mirror, { countOnly = false } = {}) {
  checks++;
  const rowsOk = src.rows === mirror.rows;
  const amountOk = countOnly || money(src.amount) === money(mirror.amount);
  const ok = rowsOk && amountOk;
  if (!ok) failures++;
  const fmt = (x) => countOnly
    ? `${String(x.rows).padStart(6)} rows          `
    : `${String(x.rows).padStart(6)} / ${money(x.amount).padStart(10)} L`;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(38)}source ${fmt(src)}   mirror ${fmt(mirror)}`);
}

const bill = await mysql.createConnection(BILL);
const hrms = await mysql.createConnection(HRMS);

const one = async (conn, sql, params = []) => {
  const [r] = await conn.query(sql, params);
  return { rows: Number(r[0]?.row_n ?? 0), amount: Number(r[0]?.amt ?? 0) };
};

console.log(`\ndb_bill (${BILL.host})  ->  mas_hrms (${HRMS.host})\n`);

console.log('INVOICES — all time');
compare('tbl_invoice / billing_invoice',
  await one(bill, 'SELECT COUNT(*) row_n, SUM(COALESCE(total,0)) amt FROM tbl_invoice'),
  await one(hrms, 'SELECT COUNT(*) row_n, SUM(COALESCE(total_amt,0)) amt FROM billing_invoice_snapshot'));

console.log(`\nINVOICES — last ${MONTHS} billing months (where drift actually happens)`);
for (const m of recentMonthLabels(MONTHS)) {
  compare(m,
    await one(bill, 'SELECT COUNT(*) row_n, SUM(COALESCE(total,0)) amt FROM tbl_invoice WHERE month = ?', [m]),
    await one(hrms, 'SELECT COUNT(*) row_n, SUM(COALESCE(total_amt,0)) amt FROM billing_invoice_snapshot WHERE month_label = ?', [m]));
}

console.log('\nINVOICE LINES — current FY (the table the CEO Overview reads)');
compare('inv_particulars / particular_snapshot',
  await one(bill, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM inv_particulars WHERE fin_year >= '2026-27'"),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM billing_invoice_particular_snapshot WHERE finance_year >= '2026-27'"));

console.log('\nGRN ENTRIES — current FY');
compare('expense_entry_master / grn_entry',
  await one(bill, "SELECT COUNT(*) row_n, SUM(COALESCE(Amount,0)) amt FROM expense_entry_master WHERE FinanceYear >= '2026-27'"),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM grn_entry_snapshot WHERE finance_year >= '2026-27'"));

// ── The chains that had no check at all ──────────────────────────────────────
// Six of the nine tables the sync writes were unverified. That gap is how sync 10 came to fail
// on every run on 2026-08-05 while this script reported OK on everything it did look at.

console.log('\nGRN LINES — current FY (was unchecked; sync 10 failed here silently)');
compare('expense_entry_particular / grn_entry_line',
  await one(bill, `SELECT COUNT(*) row_n, SUM(COALESCE(p.Amount,0)) amt
                     FROM expense_entry_particular p
                     JOIN expense_entry_master m ON m.Id = p.ExpenseEntry
                    WHERE m.FinanceYear >= '2026-27'`),
  await one(hrms, 'SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM grn_entry_line_snapshot'));

console.log('\nBUDGET — current FY');
// No created-before-the-finance-year filter here, deliberately. That used to be applied on both
// sides to keep this check green while the sync dropped 12 fully-approved rows worth Rs 7.27 L.
// A check written to agree with the code it is checking verifies nothing — it just launders the
// bug. Compare against everything db_bill holds for the year.
compare('expense_master / finance_budget',
  await one(bill, "SELECT COUNT(*) row_n, SUM(COALESCE(Amount,0)) amt FROM expense_master WHERE FinanceYear >= '2026-27'"),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM finance_budget_snapshot WHERE finance_year >= '2026-27'"));

compare('expense_particular / finance_budget_line',
  await one(bill, `SELECT COUNT(*) row_n, SUM(COALESCE(p.Amount,0)) amt
                     FROM expense_particular p
                     JOIN expense_master m ON m.Id = p.ExpenseId
                    WHERE m.FinanceYear >= '2026-27'`),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM finance_budget_line_snapshot WHERE finance_year >= '2026-27'"));

// Active on its own, because the totals above match whether or not the flag is right. Of the
// Rs 456.03 L mirrored for FY2026-27 only Rs 130.00 L is active — a reader that ignores this
// overstates the budget by 2.5x, so the flag being faithful matters as much as the amount.
compare('  of which Active=1',
  await one(bill, "SELECT COUNT(*) row_n, SUM(COALESCE(Amount,0)) amt FROM expense_master WHERE FinanceYear >= '2026-27' AND Active = 1"),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM finance_budget_snapshot WHERE finance_year >= '2026-27' AND active_status = 1"));

console.log('\nMASTERS — all time');
compare('provision_master / billing_provision',
  await one(bill, 'SELECT COUNT(*) row_n, SUM(COALESCE(billing_amt,0)) amt FROM provision_master'),
  await one(hrms, 'SELECT COUNT(*) row_n, SUM(COALESCE(billing_amt,0)) amt FROM billing_provision_snapshot'));

compare('client_master / bill_client',
  await one(bill, 'SELECT COUNT(*) row_n, 0 amt FROM client_master'),
  await one(hrms, 'SELECT COUNT(*) row_n, 0 amt FROM bill_client_snapshot'),
  { countOnly: true });

compare('expense heads+subheads / expense_head',
  await one(bill, `SELECT (SELECT COUNT(*) FROM tbl_bgt_expenseheadingmaster)
                        + (SELECT COUNT(*) FROM tbl_bgt_expensesubheadingmaster) AS row_n, 0 amt`),
  await one(hrms, 'SELECT COUNT(*) row_n, 0 amt FROM finance_expense_head_snapshot'),
  { countOnly: true });

console.log('\nCREDIT NOTES — current FY (subtracted from revenue)');
compare('tbl_credit_note / credit_note_snapshot',
  await one(bill, "SELECT COUNT(*) row_n, SUM(COALESCE(total,0)) amt FROM tbl_credit_note WHERE finance_year >= '2026-27'"),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(total_amt,0)) amt FROM billing_credit_note_snapshot WHERE finance_year >= '2026-27'"));
compare('  its lines / credit_note_line_snapshot',
  await one(bill, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM credit_particulars WHERE fin_year >= '2026-27'"),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM billing_credit_note_line_snapshot WHERE finance_year >= '2026-27'"));

console.log('\nPROVISION DRAWDOWN — mirrored for fidelity, deliberately NOT counted as P&L cost');
// This proves the copy is faithful. It does not license using it: provision_master already
// supplies the cost, and adding the drawdown on top would double-count Rs 1,292.80 lakh.
// See the note above syncProvisionDeductions in sync-db-bill-snapshot.mjs.
compare('provision_master_month_deductions',
  await one(bill, "SELECT COUNT(*) row_n, SUM(COALESCE(ProvisionBalanceUsed,0)) amt FROM provision_master_month_deductions WHERE Provision_Finance_Year >= '2026-27'"),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(balance_used,0)) amt FROM billing_provision_deduction_snapshot WHERE finance_year >= '2026-27'"));

console.log('\nBUDGET ADJUSTMENTS — rejects and sanctioned top-ups');
compare('rejected budgets',
  await one(bill, `SELECT COUNT(DISTINCT m.Id) row_n, SUM(m.Amount) amt FROM expense_master m
                     JOIN expense_master_reject r ON r.ExpenseId = m.Id AND r.RejectDate IS NOT NULL
                    WHERE m.FinanceYear >= '2026-27'`),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(amount) amt FROM finance_budget_snapshot WHERE finance_year >= '2026-27' AND is_rejected = 1"));

// Scoped to reopens carrying an amount. 4 of the 86 source budgets have approved reopen rows
// worth 0.00, which the mirror stores as 0 and this check would otherwise read as 4 missing rows
// while the rupees matched exactly — a mismatch that is real in count and meaningless in money.
compare('approved reopen top-ups',
  await one(bill, `SELECT COUNT(DISTINCT r.ExpenseId) row_n, SUM(r.AdditionalAmount) amt
                     FROM expense_reopen_master r JOIN expense_master m ON m.Id = r.ExpenseId
                    WHERE r.Approve = 1 AND m.FinanceYear >= '2026-27'
                      AND COALESCE(r.AdditionalAmount, 0) <> 0`),
  await one(hrms, `SELECT COUNT(*) row_n, SUM(reopen_additional_amount) amt FROM finance_budget_snapshot
                    WHERE finance_year >= '2026-27' AND reopen_additional_amount <> 0`));

/*
 * COMPLETENESS — the check none of the above can make.
 *
 * Everything before this proves the tables we copy are copied faithfully. It says nothing about
 * a table we never copied. That is exactly how Rs 53.91 lakh of credit notes sat unmirrored while
 * this script reported 15/15 green: it was asking the wrong question confidently.
 *
 * So: list every db_bill table written to in the current financial year, and fail on any that is
 * neither mirrored nor explicitly acknowledged as out of scope. A new finance table appearing in
 * db_bill now breaks the build instead of quietly skewing the P&L.
 */
// ── Payroll-adjacent snapshot tables ────────────────────────────────────────
// These are not P&L tables (not revenue/GRN/budget) but are mirrored for
// salary report reconciliation. They are verified here so a single run covers
// the full picture.
console.log('\nPAYROLL-ADJACENT SNAPSHOTS — row count and rupee totals');

// upload_deduction — last 5 salary months (YYYY-MM format)
const [dedMonthsRaw] = await hrms.query(
  `SELECT DISTINCT salary_month FROM upload_deduction_snapshot
    WHERE salary_month IS NOT NULL
    ORDER BY salary_month DESC LIMIT 5`
);
for (const { salary_month } of dedMonthsRaw) {
  compare(`upload_deduction  ${salary_month}`,
    await one(bill,
      `SELECT COUNT(*) row_n,
              SUM(COALESCE(MobileDeduction,0)+COALESCE(ShortCollection,0)+COALESCE(AssetRecovery,0)+
                  COALESCE(Insurance,0)+COALESCE(ProfessionalTax,0)+COALESCE(LeaveDeduction,0)+
                  COALESCE(OthersDeduction,0)) amt
         FROM upload_deduction
        WHERE DATE_FORMAT(SalaryMonth,'%Y-%m') = ?`, [salary_month]),
    await one(hrms,
      `SELECT COUNT(*) row_n,
              SUM(COALESCE(mobile_deduction,0)+COALESCE(short_collection,0)+COALESCE(asset_recovery,0)+
                  COALESCE(insurance,0)+COALESCE(professional_tax,0)+COALESCE(leave_deduction,0)+
                  COALESCE(others_deduction,0)) amt
         FROM upload_deduction_snapshot
        WHERE salary_month = ?`, [salary_month]));
}

// qual_incentive — last 5 year/month combos
const [qiMonthsRaw] = await hrms.query(
  `SELECT DISTINCT sal_year, sal_month FROM qual_incentive_snapshot
    WHERE sal_year IS NOT NULL AND sal_month IS NOT NULL
    ORDER BY sal_year DESC, FIELD(sal_month,'Jan','Feb','Mar','Apr','May','Jun',
      'Jul','Aug','Sep','Oct','Nov','Dec') DESC
    LIMIT 5`
);
for (const { sal_year, sal_month } of qiMonthsRaw) {
  compare(`qual_incentive   ${sal_year}-${sal_month}`,
    await one(bill,
      `SELECT COUNT(*) row_n, SUM(COALESCE(incamt,0)) amt
         FROM qual_incentive WHERE Salyear = ? AND salmonth = ?`,
      [sal_year, sal_month]),
    await one(hrms,
      `SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt
         FROM qual_incentive_snapshot WHERE sal_year = ? AND sal_month = ?`,
      [sal_year, sal_month]));
}

console.log('\nCOMPLETENESS — is anything financial in db_bill still unmirrored?');
const MIRRORED_SOURCES = new Set(['tbl_invoice','inv_particulars','expense_master','expense_particular',
  'expense_entry_master','expense_entry_particular','client_master','provision_master','cost_master',
  'tbl_bgt_expenseheadingmaster','tbl_bgt_expensesubheadingmaster','tbl_credit_note',
  'expense_master_reject','expense_reopen_master',
  'credit_particulars','provision_master_month_deductions',
  // payroll-adjacent — mirrored via sync-incentive-deduction-from-dbbill.mjs
  'upload_deduction','qual_incentive']);
// Reviewed 2026-08-06 and deliberately out of scope for the P&L. Each is a real live table;
// leaving them here is a decision on record, not an oversight.
const OUT_OF_SCOPE = new Map([
  ['tbl_payment', 'collections/AR, not P&L — revenue is recognised on invoice, not receipt'],
  ['tbl_payment_processing', 'collections/AR'],
  ['bill_pay_particulars', 'collections/AR line detail'],
  ['expense_entry_master_delete', 'source hard-deletes: 8 FY rows, 0 still present in expense_entry_master'],
  ['expense_delete_request', 'workflow request, not a posted amount'],
  ['provision_master_edit_request', 'workflow request, not a posted amount'],
  ['expense_entry_master_approve', 'approval audit trail; the state it sets is already on expense_entry_master'],
  ['cost_master_history', 'slowly-changing history of cost_master, which is mirrored'],
  ['tbl_vendormaster', 'vendor master — GRN carries the vendor name it needs'],
  ['po_number', 'PO references, no amount'],
  ['expense_master2', 'legacy duplicate of expense_master'],

  // --- Triaged 2026-08-06, second pass. Each reason below is a measurement, not a guess. ---

  // Shadow copy, not extra budget. For FY2026-27 it holds 236 rows / Rs 114.52 L, every one of
  // its 86 ExpenseIds already exists in expense_master, and 280 (ExpenseId, HeadId, SubHeadId,
  // Amount) tuples match expense_particular exactly. Mirroring it would double-count Rs 114.52 L
  // of budget. Same call as expense_master2 above, for the same reason.
  ['expense_particular2', 'shadow copy of expense_particular; mirroring double-counts Rs 114.52 L'],

  // Dead. Last write 2021-05-26, newest FinanceYear 2021-22. Cost transfers between cost centres
  // WOULD move P&L cost if the feature were live — it is not, and has not been for five years.
  // If rows ever appear with a current FinanceYear, this decision must be revisited.
  ['cost_center_cost_transfer_master', 'cost transfers dead since 2021-05; newest FinanceYear 2021-22'],
  ['cost_center_cost_transfer_particular', 'line detail of the above; same dead-since-2021 evidence'],

  // Collections/AR, not P&L — same reasoning as tbl_payment. Columns are pay_amount, bank_name,
  // deposit_bank, RTGS pay_no: money received, not cost incurred.
  ['other_deductions_bill', 'collections/AR — payment receipts, not P&L cost'],

  // Vendor -> head/sub-head mapping. Four columns, all ids, no amount of any kind.
  ['vendor_expense_relation', 'vendor-to-head mapping, carries no amount'],

  ['expense_entry_particular_approve', 'approval audit trail; the state it sets is on expense_entry_particular'],
  ['expense_entry_particular_delete', 'delete log, mirrors the header-level table already triaged'],

  // Employee income tax, not branch P&L. Live (imported 2026-07-06) but the grain is
  // EmpCode + TaxMonth + IncomTax — payroll data, and PII at that. It belongs to the payroll
  // module if anywhere, and must not be pulled into a finance page.
  ['IncomtaxMaster', 'per-employee income tax — payroll/PII, not branch P&L'],
  ['IncomtaxMasterHistory', 'history of the above'],

  // PO references with no money on them. poAmount and poAmountBalance sum to zero across all
  // 1,112 rows, exactly like po_number above. (Noted in passing: periodFrom/periodTo are
  // inverted on current rows — a source data-quality issue, not a P&L one.)
  ['po_number_particulars', 'PO line references; poAmount/poAmountBalance are empty on every row'],

  // Not a shadow of expense_particular — 0 identical tuples — but effectively dead: 10 rows
  // against a single budget worth Rs 0.86 L in FY2026-27, the rest 2018-21. Too small to move
  // any figure on the page. REVISIT if the row count for a current FinanceYear ever grows.
  ['expense_particular3', 'near-dead: 1 budget / Rs 0.86 L in FY2026-27; no overlap with expense_particular'],

  // --- Dead. Last write shown against each; none has a current FinanceYear. ---
  ['billing_consume_daily', 'telecom consumption, dead since 2022-05'],
  ['billing_consume_daily_history', 'dead since 2022-02'],
  ['billing_ledger', 'client ledger, newest fin_year 2022'],
  ['billing_opening_balance', 'dead since 2022-05'],
  ['billing_opening_balance_history', 'dead since 2022-04'],
  ['provision_particulars', 'superseded provision lines, dead since 2020-03'],
  ['expense_entry_master2', 'dead 2017 duplicate of expense_entry_master'],
  ['expense_entry_particular2', 'dead 2017 duplicate of expense_entry_particular'],
  ['expense_entry_branch_particular', 'dead, newest FinanceYear 2017-18'],
  ['expense_years', 'FY list, dead since 2021-22'],
  ['expense_years2', 'FY list, dead since 2021-22'],
  ['tbl_expensemaster', 'pre-2017 budget system, replaced by expense_master'],
  ['tbl_tempexpensemaster', 'staging table for the pre-2017 budget system'],
  ['tbl_expensedetails', 'pre-2017 budget lines, dead 2017-03'],
  ['tbl_expensedetailsnewentry', 'pre-2017 budget lines, dead 2017-03'],
  ['tbl_expenseunitmaster', 'unit master, dead since 2017-08'],
  ['tbl_bgt_expenseunittypemaster', 'unit-type master, dead since 2017-01'],
  ['tbl_bgt_expensesubheadingtypemaster', '6-row type master, no amounts'],
  ['tbl_tally_row_invoice_data', 'Tally export staging, dead since 2022-04'],
  ['tbl_service_tax', 'pre-GST service tax rates'],
  ['tm_tbl_invoice', '2-row remnant'],
  ['cost_master_1', 'superseded cost_master copy, dead 2019-03'],
  ['cost_master2', 'superseded cost_master copy, dead 2016-11'],
  ['cost_master3', 'superseded cost_master copy, dead 2017-04'],
  ['cost_master_disable', 'disabled-cost-centre log, dead 2017-08'],
  ['bill_no_master', 'bill-number sequence, no amount'],

  // --- Configuration and routing, no money of any kind. ---
  ['AddCostcenter', 'cost-centre creation requests, no amount'],
  ['cost_center_email', 'notification recipients'],
  ['add_cost_center_email', 'notification recipients'],
  ['Automail_Grnpayment_Master', 'automated-mail configuration'],
  ['dashboard_cost_parts', '11-row dashboard display config'],
  ['vendor_master', 'vendor master; GRN carries the vendor name it needs'],
]);
const FINANCE_HINT = /invoice|bill|expense|credit|payment|provision|cost|budget|vendor|po_|tax|debit/i;

const [active] = await bill.query(`
  SELECT TABLE_NAME t FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = 'db_bill' AND TABLE_TYPE = 'BASE TABLE'`);
const suspects = [];
for (const row of active) {
  const t = row.t ?? row.TABLE_NAME;
  if (!FINANCE_HINT.test(t)) continue;
  if (/_old|_bkp|_backup|^tmp_|_tmp$|_copy|_test|_bak|_[0-9]{2}_|before_|[0-9]{4,}$/i.test(t)) continue;
  if (MIRRORED_SOURCES.has(t) || OUT_OF_SCOPE.has(t)) continue;
  try {
    const [[c]] = await bill.query(`SELECT COUNT(*) n FROM \`${t}\``);
    if (Number(c.n) > 0) suspects.push({ t, n: Number(c.n) });
  } catch { /* unreadable table is not a finance risk */ }
}
checks++;
if (suspects.length) {
  // A HARD FAILURE, and it should stay one. The 45-table backlog this check found on 2026-08-06
  // was triaged the same day, so a healthy run reaches this branch with nothing in it. Anything
  // listed here now is genuinely NEW upstream — precisely the event that put Rs 53.91 lakh of
  // credit notes outside the mirror with nothing on the page to suggest a gap.
  //
  // If it fires, do NOT silence it by adding the table to OUT_OF_SCOPE unread. Measure it the way
  // the other 45 were measured: row count, newest FinanceYear or date, whether its amount columns
  // are non-zero, whether its ids already exist in a table we mirror. Two of those 45 turned out
  // to matter and one of them (credit_particulars) had been dismissed on a guessed name — a
  // name-based judgement would have missed it a second time.
  failures++;
  console.log(`  FAIL  ${suspects.length} finance-shaped db_bill table(s) neither mirrored nor triaged:`);
  for (const s of suspects.sort((a, b) => b.n - a.n).slice(0, 12)) {
    console.log(`          ${String(s.n).padStart(8)} rows  ${s.t}`);
  }
  if (suspects.length > 12) console.log(`          ... and ${suspects.length - 12} more`);
  console.log('        Measure each, then mirror it or add it to OUT_OF_SCOPE with the evidence.');
} else {
  console.log(`  OK    every populated finance-shaped table is mirrored or triaged`
    + ` (${MIRRORED_SOURCES.size} mirrored, ${OUT_OF_SCOPE.size} out of scope)`);
}

await bill.end();
await hrms.end();

if (failures) {
  console.log(`\n${failures} of ${checks} checks FAILED. Re-run backend/scripts/sync-db-bill-snapshot.mjs, then this again.`);
  console.log('Until it passes, every revenue figure on Process P&L is suspect.\n');
  process.exit(1);
}
console.log(`\nMirror matches source on all ${checks} checks.\n`);
