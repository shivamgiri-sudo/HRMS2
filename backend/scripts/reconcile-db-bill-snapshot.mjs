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
// The sync deliberately drops rows whose finance year begins after their created date — 12 of
// them, Rs 7.27 L, mis-filed at source. The same predicate has to be applied here or this check
// would fail forever and be ignored, which is worse than not having it.
compare('expense_master / finance_budget',
  await one(bill, `SELECT COUNT(*) row_n, SUM(COALESCE(Amount,0)) amt FROM expense_master
                    WHERE FinanceYear >= '2026-27' AND createdate >= '2026-04-01'`),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM finance_budget_snapshot WHERE finance_year >= '2026-27'"));

compare('expense_particular / finance_budget_line',
  await one(bill, `SELECT COUNT(*) row_n, SUM(COALESCE(p.Amount,0)) amt
                     FROM expense_particular p
                     JOIN expense_master m ON m.Id = p.ExpenseId
                    WHERE m.FinanceYear >= '2026-27' AND m.createdate >= '2026-04-01'`),
  await one(hrms, "SELECT COUNT(*) row_n, SUM(COALESCE(amount,0)) amt FROM finance_budget_line_snapshot WHERE finance_year >= '2026-27'"));

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

await bill.end();
await hrms.end();

if (failures) {
  console.log(`\n${failures} of ${checks} checks FAILED. Re-run backend/scripts/sync-db-bill-snapshot.mjs, then this again.`);
  console.log('Until it passes, every revenue figure on Process P&L is suspect.\n');
  process.exit(1);
}
console.log(`\nMirror matches source on all ${checks} checks.\n`);
