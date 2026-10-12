/**
 * People-cost gap trace for chosen cost centres: HRMS payroll vs db_bill salary_data, per employee, but PRINTS ONLY
 * COUNTS AND TOTALS by category (no codes, names or individual salaries). STRICTLY READ-ONLY.
 *
 * For each cost centre and month, employees fall in one category:
 *   SAME_CC      in both, and db_bill books them to the same cost centre   -> gap split by component
 *   MOVED_IN     HRMS has them here, db_bill books them to another centre
 *   MOVED_OUT    db_bill books them here, HRMS has them in another centre
 *   ONLY_HRMS    HRMS pays them, no db_bill row
 *   ONLY_BILL    db_bill row, no HRMS line (IDC-coded staff are listed separately as IDC_BILL)
 * Components for SAME_CC (HRMS minus db_bill): gross vs Gross1, employer PF, employer ESIC, gratuity (HRMS only),
 * incentive, and the remainder (admin charge and other db_bill-only items).
 *
 *   npx tsx scripts/pnl-people-cost-cc-trace.ts <YYYY-MM> <cost centre code> [<cost centre code> ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { nonVoidRunSql } from "../src/modules/payroll/run-status.js";
import { peopleCostSql } from "../src/modules/process-pnl/pnl-people-cost.js";

const args = process.argv.slice(2);
const MONTH = args.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";
const CODES = args.filter((a) => a !== MONTH).map((c) => c.trim());
const n = (v: unknown) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isNaN(x) ? 0 : x; };
const r0 = (v: number) => Math.round(v);
const key = (v: unknown) => String(v ?? "").trim().toLowerCase();

async function main() {
  if (!CODES.length) { console.log("usage: <YYYY-MM> <cost centre code> ..."); process.exit(1); }
  const [y, m] = MONTH.split("-").map(Number);
  const start = `${MONTH}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const [hrmsRows] = await db.execute<RowDataPacket[]>(
    `SELECT TRIM(e.employee_code) AS code, ccm.cost_centre_code AS cc,
            ${peopleCostSql("l")} AS people, COALESCE(l.gross_salary,0) AS gross, COALESCE(l.pf_employer,0) AS pf,
            COALESCE(l.esic_employer,0) AS esic, COALESCE(l.gratuity,0) AS grat, COALESCE(l.incentive_total,0) AS inc,
            (COALESCE(l.other_deductions,0)+COALESCE(l.loan_emi,0)+COALESCE(l.advance_recovery,0)+COALESCE(l.lwp_deduction,0)) AS ded
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id AND ${nonVoidRunSql("r")}
       JOIN employees e ON e.id = l.employee_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
      WHERE r.run_month = ?`, [MONTH]);
  const hrms = new Map<string, any>();
  for (const r of hrmsRows as any[]) hrms.set(key(r.code), { cc: String(r.cc ?? ""), people: n(r.people), gross: n(r.gross), pf: n(r.pf), esic: n(r.esic), grat: n(r.grat), inc: n(r.inc), ded: n(r.ded) });

  const billRows = await billQuery<any>(
    `SELECT TRIM(EmpCode) code, TRIM(CostCenter) cc, CAST(CTC AS DECIMAL(16,2)) ctc, CAST(Gross1 AS DECIMAL(16,2)) gross1,
            CAST(EPFCompany AS DECIMAL(16,2)) pf, CAST(ESICCompany AS DECIMAL(16,2)) esic, CAST(Incentive AS DECIMAL(16,2)) inc, CAST(AdminChrg AS DECIMAL(16,2)) adm
       FROM salary_data WHERE SalayDate >= ? AND SalayDate < ? AND EmpCode IS NOT NULL AND TRIM(EmpCode) <> ''`, [start, next]);
  const bill = new Map<string, any>();
  for (const r of billRows) bill.set(key(r.code), { code: String(r.code), cc: String(r.cc ?? ""), ctc: n(r.ctc), gross: n(r.gross1), pf: n(r.pf), esic: n(r.esic), inc: n(r.inc), adm: n(r.adm) });

  console.log("TRACE_META " + JSON.stringify({ month: MONTH, codes: CODES, hrmsLines: hrms.size, billRows: bill.size }));
  for (const code of CODES) {
    const k = key(code);
    const cat: Record<string, { n: number; hrms: number; bill: number }> = {};
    const add = (c: string, h: number, b: number) => { const x = (cat[c] ??= { n: 0, hrms: 0, bill: 0 }); x.n++; x.hrms += h; x.bill += b; };
    const comp = { gross: 0, pf: 0, esic: 0, grat: 0, inc: 0, ded: 0, rest: 0 };
    const all = new Set<string>([...hrms.keys(), ...bill.keys()]);
    for (const e of all) {
      const h = hrms.get(e), b = bill.get(e);
      const hHere = h && key(h.cc) === k, bHere = b && key(b.cc) === k;
      if (!hHere && !bHere) continue;
      if (hHere && bHere) {
        add("SAME_CC", h.people, b.ctc);
        comp.gross += h.gross - b.gross; comp.pf += h.pf - b.pf; comp.esic += h.esic - b.esic; comp.grat += h.grat; comp.inc += h.inc - b.inc; comp.ded -= h.ded;
        comp.rest += (h.people - b.ctc) - ((h.gross - b.gross) + (h.pf - b.pf) + (h.esic - b.esic) + h.grat + (h.inc - b.inc) - h.ded);
      } else if (hHere && b) add("MOVED_IN (db_bill books elsewhere)", h.people, b.ctc);
      else if (hHere) add("ONLY_HRMS", h.people, 0);
      else if (bHere && h) add("MOVED_OUT (HRMS has them elsewhere)", h.people, b.ctc);
      else if (bHere && /^idc/i.test(b.code)) add("IDC_BILL", 0, b.ctc);
      else if (bHere) add("ONLY_BILL", 0, b.ctc);
    }
    for (const [c, v] of Object.entries(cat)) console.log("TRACE_CAT " + JSON.stringify({ month: MONTH, cc: code, category: c, employees: v.n, hrms: r0(v.hrms), dbbill: r0(v.bill), diff: r0(v.hrms - v.bill) }));
    if (cat.SAME_CC) console.log("TRACE_COMP " + JSON.stringify({ month: MONTH, cc: code, note: "HRMS minus db_bill for employees in the same cost centre", gross: r0(comp.gross), employerPF: r0(comp.pf), employerESIC: r0(comp.esic), gratuityHrmsOnly: r0(comp.grat), incentive: r0(comp.inc), deductionsHrms: r0(comp.ded), unexplained: r0(comp.rest) }));
  }
  await closeBillPool().catch(() => undefined);
  await new Promise((resolve) => process.stdout.write("TRACE_DONE\n", resolve));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
