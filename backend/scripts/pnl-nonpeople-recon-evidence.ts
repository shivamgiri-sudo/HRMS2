/**
 * Non-people cost (GRN / vendor / imprest) reconciliation evidence, per branch and month. READ-ONLY.
 *
 * HRMS  = Live P&L's GRN spend per cost centre (grnActual consumed + grnEstimated approved-not-billed), rolled up to the
 *         cost centre's branch, exactly what the Branch Review shows.
 * db_bill = expense_entry_particular.Amount (taxable value, ex-GST) of expense_entry_master rows of type Vendor / Imprest
 *         (Salary is people cost) that were not rejected (RejectDate null), by FinanceMonth in FinanceYear 2026-27, mapped
 *         cost_master.id -> cost_centre_master.bill_source_id -> branch. Cost centres of IDC entities and unmapped lines
 *         are listed, never dropped silently.
 * Verdict: MATCH when within 2% or Rs 50,000.
 *
 *   npx tsx scripts/pnl-nonpeople-recon-evidence.ts [YYYY-MM ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { OWN_COMPANY_SQL } from "../src/modules/process-pnl/pnl-actuals.service.js";
import { getPnlReconciliation } from "../src/modules/process-pnl/pnl-reconciliation.service.js";

const MON = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
const periods = process.argv.slice(2).length ? process.argv.slice(2) : MON.map((m, i) => `2026-${String(i + 4).padStart(2, "0")}`);
const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const verdict = (h: number, s: number) => { const d = h - s; const pct = s ? (d / s) * 100 : h ? 100 : 0; return { diff: r0(d), pct: Math.round(pct * 10) / 10, verdict: Math.abs(d) <= 50_000 || Math.abs(pct) <= 2 ? "MATCH" : "REVIEW" }; };

async function main() {
  const [ccs] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.bill_source_id AS src, ccm.cost_centre_code AS code, COALESCE(bm.branch_name,'Unassigned') AS branch FROM cost_centre_master ccm LEFT JOIN branch_master bm ON bm.id = ccm.branch_id WHERE ccm.bill_source_id IS NOT NULL AND ${OWN_COMPANY_SQL}`); // IDC-company cost centres are not MAS (owner ruling)
  const bySrc = new Map<number, { code: string; branch: string }>(ccs.map((r) => [Number(r.src), { code: String(r.code), branch: String(r.branch) }]));

  const rows = await billQuery<any>(
    `SELECT m.FinanceMonth fm, CAST(p.CostCenterId AS UNSIGNED) cc, m.ExpenseEntryType typ, COUNT(*) n, SUM(CAST(p.Amount AS DECIMAL(16,2))) amt
       FROM expense_entry_particular p JOIN expense_entry_master m ON m.Id = CAST(p.ExpenseEntry AS UNSIGNED)
      WHERE m.FinanceYear = '2026-27' AND m.FinanceMonth IN (${MON.map((x) => `'${x}'`).join(",")})
        AND m.ExpenseEntryType IN ('Vendor','Imprest') AND m.RejectDate IS NULL
      GROUP BY m.FinanceMonth, CAST(p.CostCenterId AS UNSIGNED), m.ExpenseEntryType`);
  const bill = new Map<string, number>(), billCc = new Map<string, number>(), unmapped = new Map<string, number>();
  for (const r of rows) {
    const period = `2026-${String(MON.indexOf(String(r.fm).trim()) + 4).padStart(2, "0")}`;
    const hit = bySrc.get(Number(r.cc));
    const amt = Number(r.amt ?? 0);
    if (!hit) { unmapped.set(`${period}|cost_master ${r.cc}`, (unmapped.get(`${period}|cost_master ${r.cc}`) ?? 0) + amt); continue; }
    bill.set(`${hit.branch}|${period}`, (bill.get(`${hit.branch}|${period}`) ?? 0) + amt);
    billCc.set(`${hit.code.toLowerCase()}|${period}`, (billCc.get(`${hit.code.toLowerCase()}|${period}`) ?? 0) + amt);
  }
  console.log("NP_SOURCE " + JSON.stringify({ groupsRead: rows.length, unmappedGroups: unmapped.size }));

  let match = 0, review = 0;
  for (const period of periods) {
    let rec: any;
    try { rec = await getPnlReconciliation(period, {}); } catch (e) { console.log("NP_ERROR " + JSON.stringify({ period, error: e instanceof Error ? e.message : String(e) })); continue; }
    const hr = new Map<string, { actual: number; est: number }>();
    const ccDiff: any[] = [];
    for (const row of rec.rows as any[]) {
      const b = String(row.branchName ?? "Unassigned");
      const cur = hr.get(b) ?? { actual: 0, est: 0 };
      cur.actual += Number(row.grnActual ?? 0); cur.est += Number(row.grnEstimated ?? 0); hr.set(b, cur);
      const total = Number(row.grnActual ?? 0) + Number(row.grnEstimated ?? 0);
      const src = billCc.get(`${String(row.costCentreCode).toLowerCase()}|${period}`) ?? 0;
      if (Math.abs(total - src) >= 30_000) ccDiff.push({ period, branch: b, cc: String(row.costCentreCode), name: String(row.costCentreName ?? ""), hrms: r0(total), dbbill: r0(src), diff: r0(total - src) });
    }
    ccDiff.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    for (const d of ccDiff.slice(0, 20)) console.log("NP_CC " + JSON.stringify(d));
    const branches = new Set<string>([...hr.keys(), ...[...bill.keys()].filter((k) => k.endsWith("|" + period)).map((k) => k.split("|")[0])]);
    for (const b of [...branches].sort()) {
      const h = hr.get(b) ?? { actual: 0, est: 0 };
      const total = h.actual + h.est, src = bill.get(`${b}|${period}`) ?? 0;
      const v = verdict(total, src);
      v.verdict === "MATCH" ? match++ : review++;
      console.log("NP_ROW " + JSON.stringify({ period, branch: b, hrms: r0(total), hrmsConsumed: r0(h.actual), hrmsEstimatedFromApproved: r0(h.est), dbbill: r0(src), ...v }));
    }
  }
  for (const [k, v] of [...unmapped.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 25)) console.log("NP_UNMAPPED " + JSON.stringify({ key: k, amount: r0(v) }));
  console.log("NP_SUMMARY " + JSON.stringify({ match, review }));
  await closeBillPool().catch(() => undefined);
  await new Promise((resolve) => process.stdout.write("NP_DONE\n", resolve));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
