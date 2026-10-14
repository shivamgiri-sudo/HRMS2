/**
 * Branch P&L by component, per month, plus a non-MAS leak check. READ-ONLY (HRMS SELECTs only).
 *
 * Component order follows the finance sheet (MAS-Projection branch tabs):
 *   Revenue, Agent, DSC, BMC, Non-people (GRN), Total DC/IDC, OP = Revenue - cost.
 * Two bases are printed per branch and month so they can be put next to the sheet:
 *   OVERLAY  process-based allocation overlay (bpoPnlAllocationOverlayService): agent / DSC / BMC / EBITDA
 *   RECON    cost-centre basis the Statement branch column and Branch Review use (getPnlReconciliation)
 * Leak check: every reconciliation row whose branch, cost centre, process or company says
 * DialDesk / I-Spark / IDC / Dataconnect, or whose company is not MAS Callnet, with its money.
 *
 *   npx tsx scripts/pnl-branch-component-op.ts [YYYY-MM ...]   (default: April 2026 up to this month)
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { bpoPnlAllocationOverlayService } from "../src/modules/process-pnl/bpo-pnl-allocation-overlay.service.js";
import { getPnlReconciliation } from "../src/modules/process-pnl/pnl-reconciliation.service.js";

const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const NON_MAS = /dial\s*desk|dialdesk|i-?\s*spark|ispark|dataconnect|\bidc\b|pikquick/i;
const OWN = (s: string | null | undefined) => {
  const n = String(s ?? "").toLowerCase().replace(/[.\s,]/g, "");
  return n.includes("mascallnet");
};

function defaultPeriods(): string[] {
  const out: string[] = [];
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let d = new Date(Date.UTC(2026, 3, 1)); d <= last; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(d.toISOString().slice(0, 7));
  return out;
}

(async () => {
  const periods = process.argv.slice(2).length ? process.argv.slice(2) : defaultPeriods();
  console.log("COMP_META " + JSON.stringify({ periods }));
  for (const period of periods) {
    try {
      const s: any = await bpoPnlAllocationOverlayService.getSummary({ period });
      const ov = new Map<string, { rev: number; agent: number; dscPeople: number; dscNon: number; bmcPeople: number; bmcNon: number; grn: number; ebitda: number; processes: number }>();
      for (const row of s.rows as any[]) {
        const b = String(row.branchName ?? "Unassigned");
        const c = ov.get(b) ?? { rev: 0, agent: 0, dscPeople: 0, dscNon: 0, bmcPeople: 0, bmcNon: 0, grn: 0, ebitda: 0, processes: 0 };
        c.rev += Number(row.recognizedRevenue ?? 0);
        c.agent += Number(row.agentSalary ?? 0);
        c.dscPeople += Number(row.dscPeople ?? 0);
        c.dscNon += Number(row.dscNonPeople ?? 0);
        c.bmcPeople += Number(row.bmcPeople ?? 0);
        c.bmcNon += Number(row.bmcNonPeople ?? 0);
        c.grn += Number(row.grnVendorActual ?? 0);
        c.ebitda += Number(row.ebitda ?? 0);
        c.processes += 1;
        ov.set(b, c);
        if (NON_MAS.test(`${row.branchName} ${row.processName} ${row.clientName} ${row.costCentreCode}`)) {
          console.log("COMP_LEAK_OVERLAY " + JSON.stringify({ period, branch: b, process: row.processName, client: row.clientName, cc: row.costCentreCode, revenue: r0(row.recognizedRevenue), people: r0(row.totalPeopleCost), ebitda: r0(row.ebitda) }));
        }
      }
      for (const [b, c] of [...ov.entries()].sort()) {
        const dsc = c.dscPeople + c.dscNon, bmc = c.bmcPeople + c.bmcNon;
        console.log("COMP_OVERLAY " + JSON.stringify({
          period, branch: b, processes: c.processes,
          revenue: r0(c.rev), agent: r0(c.agent), dsc: r0(dsc), bmc: r0(bmc),
          dscNonPeople: r0(c.dscNon), bmcNonPeople: r0(c.bmcNon), grnVendor: r0(c.grn),
          totalDc: r0(c.agent + dsc + bmc), ebitda: r0(c.ebitda),
        }));
      }
    } catch (e) { console.log("COMP_ERROR " + JSON.stringify({ period, basis: "overlay", error: e instanceof Error ? e.message : String(e) })); }

    try {
      const rec: any = await getPnlReconciliation(period, {});
      for (const b of rec.branches as any[]) {
        console.log("COMP_RECON " + JSON.stringify({
          period, branch: String(b.branchName ?? "Unassigned"), costCentres: b.costCentres,
          revenue: r0(b.revenue), payroll: r0(b.payrollCost), unallocatedPayroll: r0(b.unallocatedPayroll),
          grnActual: r0(b.grnActual), grnCommitted: r0(b.grnEstimated), openBudgetReserve: r0(b.openBudgetReserve),
          op: r0(b.operatingProfit), staffPaid: b.staffPaid,
        }));
      }
      for (const row of rec.rows as any[]) {
        const flagged = NON_MAS.test(`${row.branchName} ${row.costCentreName} ${row.costCentreCode} ${row.costCentreProcess}`) || (row.companyName && !OWN(row.companyName));
        const money = Number(row.recognisedRevenue ?? 0) + Number(row.payrollCost ?? 0) + Number(row.grnActual ?? 0) + Number(row.grnEstimated ?? 0);
        if (flagged && money !== 0) {
          console.log("COMP_LEAK_RECON " + JSON.stringify({
            period, branch: row.branchName, cc: row.costCentreCode, name: row.costCentreName, process: row.costCentreProcess, company: row.companyName,
            revenue: r0(row.recognisedRevenue), payroll: r0(row.payrollCost), grn: r0(row.grnActual), grnCommitted: r0(row.grnEstimated),
          }));
        }
      }
      console.log("COMP_TOTALS " + JSON.stringify({
        period, mode: rec.mode, company: rec.company, revenue: r0(rec.totals.revenue), payroll: r0(rec.totals.payrollCost), unallocatedPayroll: r0(rec.totals.unallocatedPayroll),
        grnActual: r0(rec.totals.grnActual), grnCommitted: r0(rec.totals.grnEstimated), op: r0(rec.totals.operatingProfit),
        depreciation: r0(rec.totals.depreciation), financeCost: r0(rec.totals.financeCost), idcMissing: rec.idcMissing, blockers: rec.blockers,
      }));
    } catch (e) { console.log("COMP_ERROR " + JSON.stringify({ period, basis: "reconciliation", error: e instanceof Error ? e.message : String(e) })); }
  }
  // People-bucket diagnostic (aggregates only): why a month can put agent pay into DSC.
  const q = async (label: string, sql: string) => {
    try { const [r] = await db.query<RowDataPacket[]>(sql); for (const row of r) console.log(`COMP_DIAG ${label} ${JSON.stringify(row)}`); }
    catch (e) { console.log("COMP_ERROR " + JSON.stringify({ diag: label, error: e instanceof Error ? e.message : String(e) })); }
  };
  await q("rules", "SELECT scope_type, scope_key, process_id, branch_id, pnl_bucket, priority, effective_from, effective_to, created_at FROM pnl_cost_classification_rule WHERE active_status = 1 ORDER BY created_at DESC LIMIT 80");
  await q("snapshot_bucket", "SELECT period_code, pnl_bucket, COUNT(*) AS n, ROUND(SUM(earned_salary_till_date)) AS cost, MAX(as_of_date) AS as_of FROM pnl_running_salary_snapshot WHERE period_code >= '2026-04' GROUP BY period_code, pnl_bucket ORDER BY period_code, pnl_bucket");
  await q("runs", "SELECT run_month, status, COUNT(*) AS runs FROM salary_prep_run WHERE run_month >= '2026-04' GROUP BY run_month, status ORDER BY run_month, status");
  await q("sep_dsc_mix", "SELECT department_name, designation_name, COUNT(*) AS n, ROUND(SUM(earned_salary_till_date)) AS cost FROM pnl_running_salary_snapshot WHERE period_code = '2026-09' AND pnl_bucket = 'dsc_people' GROUP BY department_name, designation_name ORDER BY cost DESC LIMIT 15");
  await q("aug_dsc_mix", "SELECT department_name, designation_name, COUNT(*) AS n, ROUND(SUM(earned_salary_till_date)) AS cost FROM pnl_running_salary_snapshot WHERE period_code = '2026-08' AND pnl_bucket = 'dsc_people' GROUP BY department_name, designation_name ORDER BY cost DESC LIMIT 15");
  await new Promise((resolve) => process.stdout.write("COMP_DONE\n", resolve));
  process.exit(0);
})();
