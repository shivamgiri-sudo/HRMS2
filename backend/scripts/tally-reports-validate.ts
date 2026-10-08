/**
 * Validates the finance reports and every Tally-bound export against the raw tables.
 * STRICTLY READ-ONLY: SELECT only, and the lock table is only read. Nothing is exported or locked.
 *
 * Each check recomputes a figure with plain SQL and compares it with what the report/export code
 * produces from the same database, printing PASS / FAIL.
 *
 *   npx tsx scripts/tally-reports-validate.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { ledgerReportsService } from "../src/modules/finance/ledger-reports.service.js";
import { salaryVoucherService } from "../src/modules/finance/salary-voucher.service.js";
import { buildCsv, buildTallyXml, buildXlsx, voucherTable } from "../src/modules/finance/salary-voucher-formats.js";
import { tallyExportService } from "../src/modules/finance/tally-export.service.js";
import ExcelJS from "exceljs";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;
const q = async <T = RowDataPacket>(sql: string, params: unknown[] = []) => ((await db.execute<RowDataPacket[]>(sql, params))[0] as unknown as T[]);

async function vendorLedgers() {
  console.log("\n=== 1. Vendor ledger vs raw bill/payment tables ===");
  // Raw expectation per normalised vendor name: sum(due - paid) over non-rejected-unpaid bills.
  const raw = await q<any>(
    `SELECT UPPER(TRIM(vm.vendor_name)) nm, MIN(vm.id) any_id, ROUND(SUM(vpt.due_amount),2) bills, ROUND(SUM(vpt.paid_amount),2) paid,
            ROUND(SUM(vpt.due_amount - vpt.paid_amount),2) bal
       FROM vendor_payment_tracking vpt JOIN vendor_master vm ON vm.id = vpt.vendor_id
      WHERE NOT (vpt.payment_status = 'Rejected' AND COALESCE(vpt.paid_amount,0) = 0)
      GROUP BY UPPER(TRIM(vm.vendor_name))`);
  console.log(`vendor groups with tracked bills: ${raw.length}`);
  let bad = 0; const badRows: string[] = []; let compared = 0;
  const sample = [...raw].sort((a, b) => Math.abs(Number(b.bills)) - Math.abs(Number(a.bills))).slice(0, 60)
    .concat(raw.filter((_, i) => i % 15 === 0).slice(0, 60));
  const seen = new Set<string>();
  for (const r of sample) {
    if (seen.has(r.nm)) continue; seen.add(r.nm);
    const st = await ledgerReportsService.vendorStatement(String(r.any_id));
    compared++;
    // Legacy settled GRNs add a bill and an equal payment, so the closing balance is unchanged.
    const closing = (st!.closing.side === "Cr" ? -1 : 1) * st!.closing.amount;
    const expected = -Number(r.bal);
    if (!near(closing, expected)) { bad++; badRows.push(`${r.nm}: ledger ${closing} vs tracking ${expected}`); }
  }
  check(`closing balance equals sum(due - paid) for ${compared} vendors (top 60 by value + a spread)`, bad === 0, bad ? badRows.slice(0, 5).join(" | ") : "");
  const sri = raw.find((r) => r.nm === "SRI SANCHIA COMPUTRONICS");
  if (sri) {
    const st = await ledgerReportsService.vendorStatement(String(sri.any_id));
    check("SRI SANCHIA COMPUTRONICS (3 vendor ids) is one ledger", st !== null && near(st.closing.amount, Math.abs(Number(sri.bal))), `closing ${st?.closing.amount} ${st?.closing.side}, tracking balance ${sri.bal}`);
  }
  // Running balance must walk from opening to closing.
  const one = await ledgerReportsService.vendorStatement(String(raw[0].any_id));
  const last = one!.rows.at(-1);
  check("running balance of the last row equals the closing balance", !last || (last.balance === one!.closing.amount && last.balanceSide === one!.closing.side));
  check("totals: opening + credits - debits = closing",
    near((one!.opening.side === "Cr" ? -1 : 1) * one!.opening.amount + one!.totals.debit - one!.totals.credit, (one!.closing.side === "Cr" ? -1 : 1) * one!.closing.amount));
}

async function trialBalance() {
  console.log("\n=== 2. Trial Balance ===");
  const tb = await ledgerReportsService.computeTrialBalance();
  check("debits equal credits", tb.balanced, `Dr ${tb.totalDebit} / Cr ${tb.totalCredit}`);
  const sumVendorNet = tb.rows.filter((r) => r.accountType === "vendor").reduce((s, r) => s + r.netBalance, 0);
  const [raw] = await q<any>(`SELECT ROUND(SUM(due_amount - paid_amount),2) bal FROM vendor_payment_tracking WHERE NOT (payment_status = 'Rejected' AND COALESCE(paid_amount,0) = 0)`);
  check("vendor balances in the Trial Balance equal what is still owed (tracking)", near(sumVendorNet, -Number(raw.bal), 1), `TB ${sumVendorNet.toFixed(2)} vs tracking ${-Number(raw.bal)}`);
  const [jr] = await q<any>(`SELECT ROUND(SUM(debit_amount),2) d, ROUND(SUM(credit_amount),2) c FROM journal_entry_line jel JOIN journal_entry je ON je.id = jel.journal_entry_id WHERE je.reversed_by_entry_id IS NULL AND jel.account_type <> 'vendor'`);
  const nonVendor = tb.rows.filter((r) => r.accountType !== "vendor" && !r.accountId.startsWith("synthetic:"));
  check("non-vendor journal rows equal the raw journal", near(nonVendor.reduce((s, r) => s + r.totalDebit, 0), Number(jr.d), 1) && near(nonVendor.reduce((s, r) => s + r.totalCredit, 0), Number(jr.c), 1));
  // Fast (unfiltered) path must equal the join path for the same data.
  const joined = await ledgerReportsService.computeTrialBalance("9999-12-31");
  check("single-pass journal read equals the filtered join path", near(joined.totalDebit, tb.totalDebit, 1) && near(joined.totalCredit, tb.totalCredit, 1));
}

async function headSubHead() {
  console.log("\n=== 3. Head / Sub-head spend ===");
  const rows = await ledgerReportsService.headSubHeadLedger();
  const total = rows.reduce((s, r) => s + r.totalSpent, 0);
  const [j] = await q<any>(`SELECT ROUND(SUM(jel.debit_amount),2) d FROM journal_entry_line jel JOIN journal_entry je ON je.id = jel.journal_entry_id WHERE jel.account_type = 'expense_sub_head' AND je.reversed_by_entry_id IS NULL`);
  const [u] = await q<any>(
    `SELECT ROUND(SUM(COALESCE(NULLIF(g.amount_with_tax,0), g.amount)),2) a, COUNT(*) n FROM grn_request g
      WHERE g.grn_type='vendor' AND g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
        AND NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = g.id AND je.reversed_by_entry_id IS NULL)`);
  check("total spend = journal expense debits + unposted vendor GRNs", near(total, Number(j.d) + Number(u.a ?? 0), 1), `report ${total.toFixed(2)} = journal ${j.d} + unposted ${u.a ?? 0} (${u.n} GRNs)`);
}

async function salaryVoucher() {
  console.log("\n=== 4. Salary voucher and its exports (Aug-2026 run) ===");
  const runs = await q<any>(`SELECT id, run_month FROM salary_prep_run WHERE run_month = '2026-08' AND (created_by IS NULL OR created_by <> 'test-auto-gen') LIMIT 1`);
  if (!runs.length) { console.log("no 2026-08 run"); return; }
  const gen = await salaryVoucherService.generate(String(runs[0].id), { serialFrom: 900001 });
  const vs = gen.vouchers;
  check("every voucher balances (debit = credit)", vs.every((v) => v.totals.balanced), `${vs.length} vouchers`);
  // Raw: net payable per company/branch from the lines.
  const [net] = await q<any>(`SELECT ROUND(SUM(net_salary),2) n, ROUND(SUM(pf_employee + pf_employer),2) pf, ROUND(SUM(esic_employee + esic_employer),2) esic FROM salary_prep_line WHERE run_id = ?`, [runs[0].id]);
  const sumLine = (name: string) => vs.reduce((s, v) => s + v.lines.filter((l) => l.ledger_name === name).reduce((a, l) => a + l.amount, 0), 0);
  // Employees without an entity/branch or unpaid are excluded by design; report the gap rather than hide it.
  const salaryPayable = sumLine("Salary Payable A/C");
  console.log(`   raw net ${net.n} vs voucher Salary Payable ${salaryPayable.toFixed(2)} (difference = ${gen.unassigned.length} unassigned + ${gen.unpaid.length} unpaid employees)`);
  const [excl] = gen.unassigned.length || gen.unpaid.length
    ? await q<any>(`SELECT ROUND(SUM(net_salary),2) n FROM salary_prep_line WHERE run_id = ? AND employee_code IN (${[...gen.unassigned, ...gen.unpaid].map(() => "?").join(",")})`, [runs[0].id, ...gen.unassigned, ...gen.unpaid])
    : [{ n: 0 }];
  check("Salary Payable = raw net of the run minus the employees left off", near(salaryPayable, Number(net.n) - Number(excl.n ?? 0), 1));

  // Employees the voucher cannot place. Reported with their money so the gap is visible, not hidden.
  const left = [...gen.unassigned, ...gen.unpaid];
  if (left.length) {
    const info = await q<any>(
      `SELECT l.employee_code, ROUND(l.net_salary,2) net, e.branch_id IS NULL no_branch, bm.branch_name
         FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE l.run_id = ? AND l.employee_code IN (${left.map(() => "?").join(",")})`, [runs[0].id, ...left]);
    const byPrefix = new Map<string, { n: number; net: number; noBranch: number }>();
    for (const r of info) {
      const k = String(r.employee_code).replace(/[0-9].*$/, "") || "(none)";
      const cur = byPrefix.get(k) ?? { n: 0, net: 0, noBranch: 0 };
      cur.n++; cur.net += Number(r.net); cur.noBranch += r.no_branch ? 1 : 0; byPrefix.set(k, cur);
    }
    console.log(`   left off the voucher: ${info.length} employees, net ${info.reduce((s, r) => s + Number(r.net), 0).toFixed(2)} — by code prefix:`);
    console.table([...byPrefix.entries()].map(([prefix, v]) => ({ prefix, employees: v.n, net: Math.round(v.net), without_branch: v.noBranch })));
    const rules = await q<any>(`SELECT * FROM finance_payroll_entity_rule WHERE active_status = 1`).catch(() => []);
    console.log(`   entity rules in force: ${JSON.stringify(rules.map((r: any) => ({ prefix: r.code_prefix ?? r.employee_code_prefix, company: r.company_code })))}`);
  }

  const { header, rows } = voucherTable(vs);
  const amountIdx = header.indexOf("Amount"), dcIdx = header.indexOf("DebitCredit");
  const d = rows.filter((r) => r[dcIdx] === "D").reduce((s, r) => s + Number(r[amountIdx]), 0);
  const c = rows.filter((r) => r[dcIdx] === "C").reduce((s, r) => s + Number(r[amountIdx]), 0);
  check("CSV/Excel table: total debits = total credits", near(d, c, 0.5), `Dr ${d.toFixed(2)} / Cr ${c.toFixed(2)} over ${rows.length} rows`);
  check("CSV has one line per ledger row plus the header", buildCsv(vs).split("\n").length === rows.length + 1);

  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildXlsx(vs));
  check("Excel has the same number of rows as the table", wb.worksheets[0].rowCount === rows.length + 1);
  let xd = 0, xc = 0;
  wb.worksheets[0].eachRow((row, i) => { if (i === 1) return; const v = Number(row.getCell(amountIdx + 1).value); (String(row.getCell(dcIdx + 1).value) === "D" ? (xd += v) : (xc += v)); });
  check("Excel totals equal the CSV totals", near(xd, d, 0.5) && near(xc, c, 0.5));

  const xml = buildTallyXml(vs);
  const amounts = [...xml.matchAll(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
  check("Tally XML amounts sum to zero (Tally rejects a voucher that does not)", near(amounts.reduce((s, a) => s + a, 0), 0, 0.5), `${amounts.length} ledger entries`);
  const perVoucher = xml.split("<VOUCHER ").slice(1).map((blk) => [...blk.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, m, i) => (i % 2 === 0 ? s + Number(m[1]) : s), 0));
  check("every voucher in the XML nets to zero on its own", perVoucher.every((x) => near(x, 0, 0.05)), `${perVoucher.length} vouchers`);
  check("XML has one VOUCHER per voucher", xml.split("<VOUCHER ").length - 1 === vs.length);
  check("voucher numbers are unique", new Set(vs.map((v) => v.voucher_no)).size === vs.length);
  check("dates are all the month end", vs.every((v) => v.date === `${runs[0].run_month}-${String(new Date(Number(String(runs[0].run_month).slice(0, 4)), Number(String(runs[0].run_month).slice(5)), 0).getDate()).padStart(2, "0")}`));
}

async function bankVouchers() {
  console.log("\n=== 5. Bank voucher Tally XML ===");
  const accounts = await q<any>(`SELECT id FROM company_bank_account LIMIT 50`);
  let ok = 0, vouchers = 0, balancedAll = true;
  for (const a of accounts) {
    try {
      const r = await tallyExportService.buildEnvelopeVerified(String(a.id));
      ok++; vouchers += r.entryCount;
      for (const blk of r.xml.split("<VOUCHER ").slice(1)) {
        const sum = [...blk.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, m) => s + Number(m[1]), 0);
        if (!near(sum, 0, 0.02)) balancedAll = false;
      }
    } catch (e: any) { console.log(`   account ${a.id}: ${e.message}`); }
  }
  check(`bank-account export builds and passes the journal/ledger parity check (${ok}/${accounts.length} accounts, ${vouchers} vouchers)`, ok === accounts.length);
  check("every bank voucher in the XML nets to zero", balancedAll);
}

async function gst() {
  console.log("\n=== 6. GST / Tally sales batches ===");
  const batches = await q<any>(`SELECT id, export_type, company_gstin, period_month, status, exception_rows FROM gst_export_batch WHERE status <> 'superseded' ORDER BY period_month DESC LIMIT 12`);
  console.log(`   live batches: ${batches.length}`);
  let bad = 0;
  for (const b of batches) {
    const [r] = await q<any>(
      `SELECT COUNT(*) n, SUM(ABS(invoice_value - (taxable_value + igst_amount + cgst_amount + sgst_amount + COALESCE(other_charges,0) + COALESCE(round_off_amount,0))) > 1.01) off,
              SUM(validation_status = 'exception') exc FROM gst_export_row WHERE batch_id = ?`, [b.id]);
    // A row that does not add up is expected to be flagged as an exception (and held back from the
    // export); only an unflagged one is a defect.
    const [unflagged] = await q<any>(
      `SELECT COUNT(*) n FROM gst_export_row WHERE batch_id = ? AND validation_status <> 'exception'
          AND ABS(invoice_value - (taxable_value + igst_amount + cgst_amount + sgst_amount + COALESCE(other_charges,0) + COALESCE(round_off_amount,0))) > 1.01`, [b.id]);
    if (Number(r.off) > 0) console.log(`   ${b.export_type} ${b.period_month}: ${r.off}/${r.n} rows do not add up, ${Number(r.off) - Number(unflagged.n)} of them already flagged as exceptions`);
    if (Number(unflagged.n) > 0) bad++;
    if (Number(r.exc) !== Number(b.exception_rows)) { bad++; console.log(`   ${b.export_type} ${b.period_month}: exception count differs (${r.exc} vs ${b.exception_rows})`); }
  }
  check("every live GST batch: invoice value = taxable + taxes (+ other charges, round-off) and exception counts agree", bad === 0);
}

async function locks() {
  console.log("\n=== 7. Lock table ===");
  try {
    const dup = await q<any>(`SELECT export_type, scope_key, item_key, COUNT(*) c FROM tally_export_lock WHERE active = 1 GROUP BY export_type, scope_key, item_key HAVING c > 1`);
    check("no item has two active locks", dup.length === 0);
    const [n] = await q<any>(`SELECT COUNT(*) n, SUM(active = 1) active_locks FROM tally_export_lock`);
    console.log(`   locks recorded: ${n.n} (active ${n.active_locks ?? 0})`);
  } catch (e: any) { check("lock table exists", false, e.message); }
}

async function main() {
  await vendorLedgers();
  await trialBalance();
  await headSubHead();
  await salaryVoucher();
  await bankVouchers();
  await gst();
  await locks();
  console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
