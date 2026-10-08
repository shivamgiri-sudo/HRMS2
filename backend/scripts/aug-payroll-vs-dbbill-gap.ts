/**
 * Aug-2026 (or YYYY-MM) HRMS payroll vs db_bill salary_data, per employee. STRICTLY READ-ONLY.
 *
 * Compares the exact figures the salary voucher is built from (net, gross, PF, ESIC, PT, TDS) so
 * the voucher gap can be read straight off the employee gap. Prints counts by amount of
 * difference, voucher-level totals both ways, and the largest per-employee differences.
 * Output is employee_code and amounts only. Takes no write flags.
 *
 *   npx tsx scripts/aug-payroll-vs-dbbill-gap.ts [YYYY-MM]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";
const n = (v: unknown) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isNaN(x) ? 0 : x; };
const r2 = (v: number) => Math.round(v * 100) / 100;

type Fig = { net: number; gross: number; pf: number; esic: number; pt: number; tds: number };
const FIELDS: (keyof Fig)[] = ["net", "gross", "pf", "esic", "pt", "tds"];

async function main() {
  const [y, m] = MONTH.split("-").map(Number);
  const start = `${MONTH}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const [hrmsRows] = await db.execute<RowDataPacket[]>(
    `SELECT l.employee_code, l.status, l.net_salary, l.gross_salary, l.pf_employee, l.esic_employee,
            l.professional_tax, COALESCE(l.tds_amount, l.tds) AS tds
       FROM salary_prep_line l JOIN salary_prep_run r ON r.id = l.run_id
      WHERE r.run_month = ?`, [MONTH]);
  const hrms = new Map<string, Fig>();
  for (const r of hrmsRows as any[]) {
    hrms.set(String(r.employee_code).trim(), { net: n(r.net_salary), gross: n(r.gross_salary), pf: n(r.pf_employee), esic: n(r.esic_employee), pt: n(r.professional_tax), tds: n(r.tds) });
  }

  // Gross1 is the EARNED gross (Gross is the full entitlement); the voucher's Gross Salary is earned.
  const billRows = await billQuery<any>(
    `SELECT EmpCode, NetSalary, Gross1, EPF, ESIC, ProTaxDeduction, IncomeTax
       FROM salary_data
      WHERE SalDate >= ? AND SalDate < ? AND EmpCode IS NOT NULL AND TRIM(EmpCode) <> '' AND EmpCode NOT LIKE 'IDC%'`,
    [start, next]);
  const bill = new Map<string, Fig>();
  for (const r of billRows) {
    bill.set(String(r.EmpCode).trim(), { net: n(r.NetSalary), gross: n(r.Gross1), pf: n(r.EPF), esic: n(r.ESIC), pt: n(r.ProTaxDeduction), tds: n(r.IncomeTax) });
  }

  const both = [...hrms.keys()].filter((k) => bill.has(k));
  const onlyHrms = [...hrms.keys()].filter((k) => !bill.has(k));
  const onlyBill = [...bill.keys()].filter((k) => !hrms.has(k));
  console.log(`month ${MONTH}: HRMS lines ${hrms.size}, db_bill rows ${bill.size}, both ${both.length}, only-HRMS ${onlyHrms.length}, only-db_bill ${onlyBill.length}`);

  const tot = (m: Map<string, Fig>, keys: string[]) => Object.fromEntries(FIELDS.map((f) => [f, r2(keys.reduce((s, k) => s + m.get(k)![f], 0))]));
  console.log("totals over the employees in BOTH:");
  console.table({ HRMS: tot(hrms, both), db_bill: tot(bill, both) });
  console.log("totals, everyone on each side:");
  console.table({ HRMS: tot(hrms, [...hrms.keys()]), db_bill: tot(bill, [...bill.keys()]) });

  const buckets = { exact: 0, within1: 0, within10: 0, over10: 0 };
  const diffs: { code: string; net_hrms: number; net_bill: number; net_diff: number; fields: string }[] = [];
  const byField: Record<string, number> = {};
  for (const k of both) {
    const a = hrms.get(k)!, b = bill.get(k)!;
    const d = Math.abs(a.net - b.net);
    if (d === 0) buckets.exact++; else if (d <= 1) buckets.within1++; else if (d <= 10) buckets.within10++; else buckets.over10++;
    const diffFields = FIELDS.filter((f) => Math.abs(a[f] - b[f]) > 1);
    for (const f of diffFields) byField[f] = (byField[f] ?? 0) + 1;
    if (d > 1 || diffFields.length) diffs.push({ code: k, net_hrms: a.net, net_bill: b.net, net_diff: r2(a.net - b.net), fields: diffFields.join(",") });
  }
  console.log("net salary difference per employee (both sides):"); console.table(buckets);
  console.log("employees whose field differs by more than Rs 1:"); console.table(byField);
  diffs.sort((a, b) => Math.abs(b.net_diff) - Math.abs(a.net_diff));
  console.log(`employees with any difference > Rs 1: ${diffs.length}; net difference sum ${r2(diffs.reduce((s, d) => s + d.net_diff, 0))}`);
  console.table(diffs.slice(0, 60));
  console.log("only in HRMS (first 40):", onlyHrms.slice(0, 40).join(" "));
  console.log("only in db_bill (first 40):", onlyBill.slice(0, 40).join(" "));
}

main().then(async () => { await closeBillPool(); await db.end?.(); }).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await db.end?.(); } catch { } process.exit(1); });
