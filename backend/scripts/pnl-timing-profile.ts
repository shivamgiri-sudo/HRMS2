/** Times the P&L / Hiring Engine reads on prod, piece by piece. READ-ONLY. Prints milliseconds only. */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { readGrnSpend } from "../src/modules/process-pnl/pnl-actuals.service.js";
import { getPnlReconciliation } from "../src/modules/process-pnl/pnl-reconciliation.service.js";
import { getCeoOverview } from "../src/modules/process-pnl/ceo-overview.service.js";
import { getDailyTrend } from "../src/modules/process-pnl/pnl-daily-trend.service.js";
import { planBranches } from "../src/modules/hiring-engine/he-branch-plan.service.js";

const t = async (name: string, fn: () => Promise<unknown>) => { const s = Date.now(); let note = ""; try { const r: any = await fn(); if (Array.isArray(r)) note = `${r.length} rows`; } catch (e) { note = "ERROR " + (e instanceof Error ? e.message.slice(0, 80) : String(e)); } console.log(`TIME ${name.padEnd(48)} ${String(Date.now() - s).padStart(7)} ms ${note}`); };
(async () => {
  await t("db ping", async () => db.execute("SELECT 1"));
  for (const p of ["2026-06", "2026-09", "2026-10"]) {
    await t(`${p} readGrnSpend consumed`, () => readGrnSpend(p, "consumed"));
    await t(`${p} readGrnSpend consumed (withDetail)`, () => readGrnSpend(p, "consumed", { withDetail: true }));
    await t(`${p} readGrnSpend reserved`, () => readGrnSpend(p, "reserved"));
    await t(`${p} getPnlReconciliation (cold)`, () => getPnlReconciliation(p, { asOfDate: undefined }));
  }
  for (const p of ["2026-09"]) {
    await t(`${p} getCeoOverview (cold)`, () => getCeoOverview(p, {} as never));
    await t(`${p} getCeoOverview (repeat, cached sources)`, () => getCeoOverview(p, {} as never));
    await t(`${p} getDailyTrend (cold)`, () => getDailyTrend(p));
    await t(`${p} getDailyTrend (repeat)`, () => getDailyTrend(p));
  }
  await t("planBranches (cold inputs)", () => planBranches({}));
  await t("planBranches (cached inputs)", () => planBranches({ walkinToSelected: 0.5 }));
  await new Promise((resolve) => process.stdout.write("TIME_DONE\n", resolve));
  process.exit(0);
})();
