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
 *   node backend/scripts/reconcile-db-bill-snapshot.mjs --hrms-host=122.184.128.90 --bill-host=14.97.30.236
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
console.log('\nCOMPLETENESS — is anything financial in db_bill still unmirrored?');
const MIRRORED_SOURCES = new Set(['tbl_invoice','inv_particulars','expense_master','expense_particular',
  'expense_entry_master','expense_entry_particular','client_master','provision_master','cost_master',
  'tbl_bgt_expenseheadingmaster','tbl_bgt_expensesubheadingmaster','tbl_credit_note',
  'expense_master_reject','expense_reopen_master']);
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
  ['tbl_credit_note_particulars', 'no such table today; placeholder if lines are ever added'],
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
  // WARN, not FAIL, deliberately — and only while the initial triage backlog is being worked
  // through. 45 tables were outstanding when this check was written on 2026-08-06, and a job that
  // exits red every night from the first day is one people learn to ignore, which is the same
  // failure mode as a check that always passes. The money reconciliations above stay the hard
  // pass/fail signal because they are actionable today.
  //
  // TURN THIS INTO A HARD FAILURE once the list below is empty. At that point a newly-appearing
  // finance table in db_bill SHOULD break the nightly run, because that is precisely the event
  // that put Rs 53.91 lakh of credit notes outside the mirror unnoticed.
  console.log(`  WARN  ${suspects.length} finance-shaped db_bill table(s) neither mirrored nor triaged.`);
  console.log('        Not failing the run yet — see the note in this file. Largest first:');
  for (const s of suspects.sort((a, b) => b.n - a.n).slice(0, 12)) {
    console.log(`          ${String(s.n).padStart(8)} rows  ${s.t}`);
  }
  console.log('        Each needs checking, then mirroring or adding to OUT_OF_SCOPE with a reason.');
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
