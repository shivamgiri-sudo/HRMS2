/**
 * Where the P&L Statement spends its time: every dependency in defaultDependencies, timed one at a time
 * (cold = first call in this process, warm = second), plus the whole getStatement for a branch and a
 * process view. READ-ONLY.
 *
 *   npx tsx scripts/pnl-statement-timing.ts YYYY-MM [YYYY-MM ...]
 */
import "dotenv/config";
import { defaultDependencies, getStatement, getOpenBudgetReserveActuals, getUnproratedPayrollByBranch, getReconciledBranchRevenue } from "../src/modules/process-pnl/pnl-statement.service.js";

const sec = (ms: number) => +(ms / 1000).toFixed(2);
async function timed<T>(label: string, fn: () => Promise<T>): Promise<void> {
  for (const round of ["cold", "warm"]) {
    const t0 = Date.now();
    let note = "ok";
    try { await fn(); } catch (e) { note = "ERROR " + (e instanceof Error ? e.message.slice(0, 80) : String(e)); }
    console.log("STT " + JSON.stringify({ label, round, s: sec(Date.now() - t0), note }));
  }
}

(async () => {
  const periods = process.argv.slice(2);
  if (!periods.length) throw new Error("pass periods");
  for (const period of periods) {
    const d = defaultDependencies as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    console.log("STT_PERIOD " + period);
    for (const key of Object.keys(d)) {
      if (key === "getComponents") { await timed(`${period} getComponents`, () => d[key]()); continue; }
      if (key === "getSummary") { await timed(`${period} getSummary`, () => d[key]({ period })); continue; }
      if (key === "getProcessSummary") continue;
      await timed(`${period} ${key}`, () => d[key](period));
    }
    await timed(`${period} getOpenBudgetReserveActuals (alone)`, () => getOpenBudgetReserveActuals(period));
    await timed(`${period} getUnproratedPayrollByBranch (alone)`, () => getUnproratedPayrollByBranch(period));
    await timed(`${period} getReconciledBranchRevenue (alone)`, () => getReconciledBranchRevenue(period));
    await timed(`${period} getStatement branch`, () => getStatement({ period } as never, "branch"));
    await timed(`${period} getStatement process`, () => getStatement({ period } as never, "process"));
  }
  await new Promise((resolve) => process.stdout.write("STT_DONE\n", resolve));
  process.exit(0);
})();
