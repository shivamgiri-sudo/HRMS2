/**
 * P&L by branch, per month. READ-ONLY.
 *
 * Runs the same allocation-overlay summary the P&L pages use and prints, per branch and per
 * process, revenue / agent / DSC / BMC / GRN-vendor / EBITDA / operating profit, so it can be
 * tallied against the MAS projection sheet. Writes nothing.
 *
 *   npx tsx scripts/pnl-branch-op-audit.ts [YYYY-MM ...]   (default 2026-04 .. 2026-09)
 */
import "dotenv/config";
import { bpoPnlAllocationOverlayService } from "../src/modules/process-pnl/bpo-pnl-allocation-overlay.service.js";

const periods = process.argv.slice(2).length ? process.argv.slice(2) : ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const r2 = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const FIELDS = ["recognizedRevenue", "earnedRevenue", "agentSalary", "dsc", "bmc", "grnVendorActual", "grnCommitted", "totalPeopleCost", "contribution", "ebitda", "depreciation", "amortization", "operatingProfit", "financeCost", "pbt"] as const;

(async () => {
  const out: Record<string, unknown> = {};
  for (const period of periods) {
    try {
      const s: any = await bpoPnlAllocationOverlayService.getSummary({ period });
      const branches: Record<string, Record<string, number>> = {};
      const processes: unknown[] = [];
      for (const row of s.rows as any[]) {
        const b = (branches[row.branchName ?? "(none)"] ??= { processes: 0 });
        b.processes += 1;
        for (const f of FIELDS) b[f] = r2((b[f] ?? 0) + Number(row[f] ?? 0));
        processes.push({ branch: row.branchName, process: row.processName, ...Object.fromEntries(FIELDS.map((f) => [f, r2(row[f])])) });
      }
      out[period] = { period: s.period, rowCount: s.rows.length, kpis: s.kpis, branches, processes, warnings: s.warnings ?? null };
    } catch (e) {
      out[period] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  // One console line per period / process: a single huge line gets truncated by the runner's pipe.
  for (const [period, v] of Object.entries(out) as [string, any][]) {
    const { processes, ...rest } = v;
    console.log("PNL_BRANCH " + JSON.stringify({ period, ...rest, processes: undefined }));
    for (const pr of processes ?? []) console.log("PNL_PROC " + JSON.stringify({ period, ...(pr as object) }));
  }
  await new Promise((resolve) => process.stdout.write("PNL_AUDIT_DONE\n", resolve));
  process.exit(0);
})();
