/**
 * Bridge: payroll people cost -> bucketed people cost -> P&L rows, per month. READ-ONLY.
 *   BR_ACT   getActualPeopleCost(period): payroll classified into agent / DSC / BMC, per branch
 *   BR_BASE  base process records: sum of directPeopleCost (the fallback source) and rows with fallbacks
 *   BR_ROWS  P&L summary rows totals: agent, dscPeople, bmcPeople, dscNonPeople, bmcNonPeople
 *   npx tsx scripts/hrms-people-bridge.ts
 */
import "dotenv/config";
import { getActualPeopleCost } from "../src/modules/process-pnl/bpo-pnl.service.js";
import { bpoPnlAllocationOverlayService } from "../src/modules/process-pnl/bpo-pnl-allocation-overlay.service.js";
import { processPnlService } from "../src/modules/process-pnl/process-pnl.service.js";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const r0 = (v: number) => Math.round(v);
(async () => {
  const [br] = await db.execute<RowDataPacket[]>(`SELECT id, branch_name FROM branch_master`);
  const bname = new Map((br as any[]).map((b) => [String(b.id), b.branch_name]));
  for (const period of ["2026-04", "2026-05", "2026-06", "2026-07"]) {
    try {
      const act = await getActualPeopleCost(period);
      const tot = { agent: 0, dsc: 0, bmc: 0 };
      const byBranch: Record<string, unknown> = {};
      for (const [id, b] of act.byBranch) { tot.agent += b.agent_salary; tot.dsc += b.dsc_people; tot.bmc += b.bmc_people; byBranch[bname.get(id) ?? id] = { agent: r0(b.agent_salary), dsc: r0(b.dsc_people), bmc: r0(b.bmc_people) }; }
      console.log("BR_ACT " + JSON.stringify({ period, total: { agent: r0(tot.agent), dsc: r0(tot.dsc), bmc: r0(tot.bmc), all: r0(tot.agent + tot.dsc + tot.bmc) }, byBranch }));
      const base: any[] = await processPnlService.listProcesses({ period } as any);
      const dp = base.reduce((s, r) => s + Number(r.directPeopleCost ?? 0), 0);
      const withDp = base.filter((r) => Number(r.directPeopleCost ?? 0) > 0).map((r) => ({ p: r.processName, b: r.branchName, directPeopleCost: r0(Number(r.directPeopleCost)) }));
      console.log("BR_BASE " + JSON.stringify({ period, base_rows: base.length, sum_directPeopleCost: r0(dp), rows_with_directPeopleCost: withDp }));
      const s: any = await bpoPnlAllocationOverlayService.getSummary({ period });
      const sum = (f: string) => r0((s.rows as any[]).reduce((a, r) => a + Number(r[f] ?? 0), 0));
      console.log("BR_ROWS " + JSON.stringify({ period, rows: s.rows.length, agent: sum("agentSalary"), dscPeople: sum("dscPeople"), bmcPeople: sum("bmcPeople"), dscNonPeople: sum("dscNonPeople"), bmcNonPeople: sum("bmcNonPeople"), totalPeopleCost: sum("totalPeopleCost") }));
    } catch (e) { console.log("BR_ERR " + period + " " + (e instanceof Error ? e.message : String(e))); }
  }
  await new Promise((resolve) => process.stdout.write("BR_DONE\n", resolve));
  process.exit(0);
})();
