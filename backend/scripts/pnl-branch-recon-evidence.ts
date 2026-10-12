/**
 * Branch P&L reconciliation evidence, per branch and month. READ-ONLY (HRMS reads + billQuery SELECT only).
 *
 * "Reconciled before branches review" needs proof, not a claim. For each month this prints, per HRMS branch:
 *   HRMS    recognised revenue and payroll cost per branch as the Branch Review tab shows them (reconciliation, cost-centre branch);
 *           the process-based allocation overlay is printed beside it as overlayBasis
 *   db_bill invoice revenue (tbl_invoice.total, ex-GST; status 0; service month; IDC company and Non Revenue
 *           excluded; a re-issued invoice counted once) and salary cost (salary_data), mapped to the branch of the
 *           HRMS cost centre with the same code
 *   diff    absolute and %, and a verdict: MATCH (<= 2% or <= Rs 50,000) / REVIEW
 * Lines that cannot be mapped to an HRMS cost centre are printed as UNMAPPED so nothing is silently dropped.
 *
 *   npx tsx scripts/pnl-branch-recon-evidence.ts [YYYY-MM ...]   (default: April 2026 up to last month)
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import { bpoPnlAllocationOverlayService } from "../src/modules/process-pnl/bpo-pnl-allocation-overlay.service.js";
import { getPnlReconciliation } from "../src/modules/process-pnl/pnl-reconciliation.service.js";

const TOL_PCT = 2, TOL_ABS = 50_000;
const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function defaultPeriods(): string[] {
  const out: string[] = [];
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  for (let d = new Date(Date.UTC(2026, 3, 1)); d <= last; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(d.toISOString().slice(0, 7));
  return out;
}
/** 'Apr-26' / 'April 2026' / '2026-04' -> '2026-04' (null when unreadable). */
function serviceMonth(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const m = s.match(/^([a-z]{3})[a-z]*[-\s']*(\d{2}|\d{4})$/);
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[2].length === 2 ? "20" + m[2] : m[2]}-${MONTHS[m[1]]}`;
}
const verdict = (hrms: number, src: number) => {
  const diff = hrms - src;
  const pct = src ? (diff / src) * 100 : hrms ? 100 : 0;
  return { diff: r0(diff), pct: Math.round(pct * 10) / 10, verdict: Math.abs(diff) <= TOL_ABS || Math.abs(pct) <= TOL_PCT ? "MATCH" : "REVIEW" };
};

(async () => {
  const periods = process.argv.slice(2).length ? process.argv.slice(2) : defaultPeriods();
  const [cc] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.cost_centre_code AS code, COALESCE(bm.branch_name, 'Unassigned') AS branch FROM cost_centre_master ccm LEFT JOIN branch_master bm ON bm.id = ccm.branch_id`);
  const branchOf = new Map(cc.map((r) => [String(r.code).trim().toLowerCase(), String(r.branch)]));

  // Which tbl_invoice column carries the invoice description (used to spot re-issued invoices).
  const cols = (await billQuery<any>("SHOW COLUMNS FROM tbl_invoice")).map((c: any) => String(c.Field));
  const descCol = ["description", "particulars", "invoice_description", "narration", "remarks"].find((c) => cols.includes(c)) ?? null;
  console.log("EVID_META " + JSON.stringify({ tolerancePct: TOL_PCT, toleranceAbs: TOL_ABS, invoiceDescriptionColumn: descCol, periods }));

  const inv = await billQuery<any>(
    `SELECT id, TRIM(month) svc, TRIM(cost_company_name) company, TRIM(cost_center) cc, invoiceType itype,
            CAST(total AS DECIMAL(16,2)) total${descCol ? `, TRIM(${descCol}) descr` : ""}, invoiceDate
       FROM tbl_invoice WHERE status = 0 AND invoiceDate >= '2026-03-01' ORDER BY invoiceDate, id`);
  const keep = new Map<string, any>();
  let excludedIdc = 0, excludedNonRev = 0, unmappedRev = 0;
  for (const r of inv) {
    if (/^idc$/i.test(String(r.company ?? ""))) { excludedIdc += 1; continue; }
    if (/non\s*revenue/i.test(String(r.itype ?? ""))) { excludedNonRev += 1; continue; }
    const sm = serviceMonth(r.svc);
    if (!sm) continue;
    keep.set(`${String(r.cc).toLowerCase()}|${sm}|${descCol ? String(r.descr ?? "").toLowerCase() : r.id}`, { ...r, sm });
  }
  const revByBranchMonth = new Map<string, number>();
  const unmapped = new Map<string, number>();
  for (const r of keep.values()) {
    const b = branchOf.get(String(r.cc).trim().toLowerCase());
    const amt = Number(r.total ?? 0);
    if (!b) { unmappedRev += 1; unmapped.set(`REV|${r.sm}|${r.cc}`, (unmapped.get(`REV|${r.sm}|${r.cc}`) ?? 0) + amt); continue; }
    revByBranchMonth.set(`${b}|${r.sm}`, (revByBranchMonth.get(`${b}|${r.sm}`) ?? 0) + amt);
  }

  const sal = await billQuery<any>(
    `SELECT DATE_FORMAT(SalayDate,'%Y-%m') p, TRIM(CostCenter) cc, SUM(CAST(CTC AS DECIMAL(16,2))) ctc, SUM(CAST(Incentive AS DECIMAL(16,2))) inc
       FROM salary_data WHERE SalayDate >= '2026-04-01' GROUP BY p, cc`);
  const salByBranchMonth = new Map<string, number>();
  for (const r of sal) {
    const b = branchOf.get(String(r.cc).trim().toLowerCase());
    const amt = Number(r.ctc ?? 0);
    if (!b) { unmapped.set(`SAL|${r.p}|${r.cc}`, (unmapped.get(`SAL|${r.p}|${r.cc}`) ?? 0) + amt); continue; }
    salByBranchMonth.set(`${b}|${r.p}`, (salByBranchMonth.get(`${b}|${r.p}`) ?? 0) + amt);
  }
  console.log("EVID_SOURCE " + JSON.stringify({ invoicesRead: inv.length, kept: keep.size, excludedIdc, excludedNonRevenue: excludedNonRev, unmappedInvoiceLines: unmappedRev }));

  let match = 0, review = 0;
  for (const period of periods) {
    let s: any;
    try { s = await bpoPnlAllocationOverlayService.getSummary({ period }); } catch (e) { console.log("EVID_ERROR " + JSON.stringify({ period, error: e instanceof Error ? e.message : String(e) })); continue; }
    const hr = new Map<string, { rev: number; people: number }>();
    for (const row of s.rows as any[]) {
      const b = String(row.branchName ?? "Unassigned");
      const cur = hr.get(b) ?? { rev: 0, people: 0 };
      cur.rev += Number(row.recognizedRevenue ?? 0); cur.people += Number(row.totalPeopleCost ?? 0);
      hr.set(b, cur);
    }
    // The basis the Branch Review tab shows: cost-centre branch for revenue and payroll (pnl-reconciliation).
    const rc = new Map<string, { rev: number; people: number; unalloc: number }>();
    try {
      const rec: any = await getPnlReconciliation(period, {});
      for (const b of rec.branches as any[]) rc.set(String(b.branchName ?? "Unassigned"), { rev: Number(b.revenue ?? 0), people: Number(b.payrollCost ?? 0), unalloc: Number(b.unallocatedPayroll ?? 0) });
    } catch (e) { console.log("EVID_ERROR " + JSON.stringify({ period, basis: "reconciliation", error: e instanceof Error ? e.message : String(e) })); }
    const branches = new Set<string>([...hr.keys(), ...rc.keys(), ...[...revByBranchMonth.keys(), ...salByBranchMonth.keys()].filter((k) => k.endsWith("|" + period)).map((k) => k.split("|")[0])]);
    for (const b of [...branches].sort()) {
      const h = hr.get(b) ?? { rev: 0, people: 0 };
      const c = rc.get(b) ?? { rev: 0, people: 0, unalloc: 0 };
      const srcRev = revByBranchMonth.get(`${b}|${period}`) ?? 0, srcPeo = salByBranchMonth.get(`${b}|${period}`) ?? 0;
      const rev = verdict(h.rev, srcRev), peo = verdict(h.people, srcPeo);
      const rrev = verdict(c.rev, srcRev), rpeo = verdict(c.people, srcPeo);
      for (const v of [rrev.verdict, rpeo.verdict]) v === "MATCH" ? match++ : review++;
      console.log("EVID_ROW " + JSON.stringify({
        period, branch: b,
        revenue: { hrms: r0(c.rev), dbbill: r0(srcRev), ...rrev },
        peopleCost: { hrms: r0(c.people), dbbill: r0(srcPeo), ...rpeo, unallocatedInHrms: r0(c.unalloc) },
        overlayBasis: { revenue: { hrms: r0(h.rev), ...rev }, peopleCost: { hrms: r0(h.people), ...peo } },
      }));
    }
  }
  for (const [k, v] of [...unmapped.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 40)) console.log("EVID_UNMAPPED " + JSON.stringify({ key: k, amount: r0(v) }));
  console.log("EVID_SUMMARY " + JSON.stringify({ match, review, note: "People cost compares HRMS people cost with db_bill salary_data CTC; incentives are in HRMS people cost by owner decision, so a REVIEW on people may be an incentive-definition gap, not an error." }));
  await new Promise((resolve) => process.stdout.write("EVID_DONE\n", resolve));
  process.exit(0);
})();
