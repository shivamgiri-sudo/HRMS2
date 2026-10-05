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
  const PERIODS = process.argv.slice(2).length ? process.argv.slice(2) : ["2026-04", "2026-05", "2026-06", "2026-07"];
  for (const period of PERIODS) {
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
      const s0 = s;
      const sum = (f: string) => r0((s.rows as any[]).reduce((a, r) => a + Number(r[f] ?? 0), 0));
      // per-process: payroll bucketed by the employee's own process vs the base fallback vs what ended up in the rows
      const [pm] = await db.execute<RowDataPacket[]>(`SELECT p.id, p.process_name, p.active_status, bm.branch_name FROM process_master p LEFT JOIN branch_master bm ON bm.id = p.branch_id`);
      const pinfo = new Map((pm as any[]).map((x) => [String(x.id), x]));
      const baseById = new Map(base.map((r) => [String(r.processId), r]));
      const rowById = new Map((s0 as any).rows.map((r: any) => [String(r.processId), r]));
      const ids = new Set<string>([...act.byProcess.keys(), ...baseById.keys(), ...rowById.keys()]);
      for (const id of ids) {
        const a = act.byProcess.get(id); const b = baseById.get(id); const r = rowById.get(id) as any;
        const vals = { actAgent: r0(a?.agent_salary ?? 0), actDsc: r0(a?.dsc_people ?? 0), actBmc: r0(a?.bmc_people ?? 0), directPeopleCost: r0(Number(b?.directPeopleCost ?? 0)), rowAgent: r0(Number(r?.agentSalary ?? 0)), rowDscPeople: r0(Number(r?.dscPeople ?? 0)), rowBmcPeople: r0(Number(r?.bmcPeople ?? 0)) };
        if (Object.values(vals).every((v) => v === 0)) continue;
        const i = pinfo.get(id);
        console.log("BR_PROC " + JSON.stringify({ period, process: i?.process_name ?? id, p_active: i?.active_status, branch: i?.branch_name ?? null, in_base: baseById.has(id), in_rows: rowById.has(id), ...vals }));
      }
      console.log("BR_ROWS " + JSON.stringify({ period, rows: s.rows.length, agent: sum("agentSalary"), dscPeople: sum("dscPeople"), bmcPeople: sum("bmcPeople"), dscNonPeople: sum("dscNonPeople"), bmcNonPeople: sum("bmcNonPeople"), totalPeopleCost: sum("totalPeopleCost") }));
    } catch (e) { console.log("BR_ERR " + period + " " + (e instanceof Error ? e.message : String(e))); }
  }
  await new Promise((resolve) => process.stdout.write("BR_DONE\n", resolve));
  process.exit(0);
})();
