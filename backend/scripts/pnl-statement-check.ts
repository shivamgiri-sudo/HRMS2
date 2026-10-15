/**
 * What the P&L Statement itself shows, branch view, for one or more months. READ-ONLY.
 * Prints the cost waterfall per branch column so it can be put next to Live P&L (reconciliation):
 * revenue, agent / DSC / BMC salary, Indirect = consumed + reserved + open-budget headroom, OP.
 *
 *   npx tsx scripts/pnl-statement-check.ts YYYY-MM [YYYY-MM ...]
 */
import "dotenv/config";
import { getStatement } from "../src/modules/process-pnl/pnl-statement.service.js";
import { getPnlReconciliation } from "../src/modules/process-pnl/pnl-reconciliation.service.js";

const KEYS = [
  "recognized_revenue", "agent_salary", "dsc_salary", "bmc_salary", "total_dsc", "total_bmc", "dc_total",
  "total_idc", "grn_consumed", "grn_committed", "grn_open_budget", "total_cost", "operating_profit",
];
const r0 = (v: unknown) => Math.round(Number(v ?? 0));

(async () => {
  const periods = process.argv.slice(2);
  if (!periods.length) throw new Error("pass periods");
  for (const period of periods) {
    try {
      const s: any = await getStatement({ period } as never, "branch");
      const present = new Set<string>(s.rows.map((r: any) => r.componentKey));
      console.log("STM_META " + JSON.stringify({ period, columns: s.columns.length, hasOpenBudgetLine: present.has("grn_open_budget"), keysFound: KEYS.filter((k) => present.has(k)) }));
      for (const col of s.columns as any[]) {
        const vals: Record<string, number> = {};
        for (const k of KEYS) {
          const row = s.rows.find((r: any) => r.componentKey === k);
          if (row && row.values && row.values[col.id] !== undefined) vals[k] = r0(row.values[col.id]);
        }
        console.log("STM_COL " + JSON.stringify({ period, branch: col.name ?? col.label ?? col.id, ...vals }));
      }
    } catch (e) { console.log("STM_ERROR " + JSON.stringify({ period, error: e instanceof Error ? e.message : String(e) })); }
    try {
      const rec: any = await getPnlReconciliation(period, {});
      for (const b of rec.branches as any[]) {
        console.log("STM_LIVE " + JSON.stringify({
          period, branch: b.branchName, revenue: r0(b.revenue), payroll: r0(b.payrollCost), grnConsumed: r0(b.grnActual),
          grnReserved: r0(b.grnEstimated), openBudget: r0(b.openBudgetReserve), op: r0(b.operatingProfit),
        }));
      }
    } catch (e) { console.log("STM_ERROR " + JSON.stringify({ period, basis: "live", error: e instanceof Error ? e.message : String(e) })); }
  }
  await new Promise((resolve) => process.stdout.write("STM_DONE\n", resolve));
  process.exit(0);
})();
