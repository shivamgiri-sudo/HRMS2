/**
 * Is the live (running-month) salary reaching Live P&L? READ-ONLY. Prints, for the periods given (default: this IST month and last):
 *   SAL_SNAPSHOT  rows / employees / sum earned_salary_till_date / newest refresh / rows with no cost centre
 *   SAL_RUN       payroll runs for the period (status, lines)
 *   SAL_LIVE      what getPnlReconciliation returns: people cost total, payroll freshness row, blockers, mode
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { getPnlReconciliation } from "../src/modules/process-pnl/pnl-reconciliation.service.js";

const show = async (tag: string, sql: string, args: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, args as never); for (const r of rows) console.log(`${tag} ${JSON.stringify(r)}`); if (!rows.length) console.log(`${tag} (no rows)`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const cur = now.toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const periods = process.argv.slice(2).length ? process.argv.slice(2) : [prev, cur];
  console.log("SAL_META " + JSON.stringify({ nowIst: now.toISOString(), periods }));
  for (const p of periods) {
    await show("SAL_SNAPSHOT", `SELECT period_code, COUNT(*) AS rows_n, COUNT(DISTINCT employee_id) AS employees, ROUND(SUM(earned_salary_till_date)) AS earned, MAX(updated_at) AS newest, MIN(updated_at) AS oldest, SUM(cost_centre_id IS NULL) AS no_cc FROM pnl_running_salary_snapshot WHERE period_code = ? GROUP BY period_code`, [p]);
    await show("SAL_SNAPSHOT_COLS", `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_running_salary_snapshot' AND column_name IN ('as_of_date','updated_at','created_at','refreshed_at')`);
    await show("SAL_RUN", `SELECT r.status, COUNT(DISTINCT r.id) AS runs, COUNT(l.id) AS lines_n FROM salary_prep_run r LEFT JOIN salary_prep_line l ON l.run_id = r.id WHERE r.run_month = ? GROUP BY r.status`, [p]);
    try {
      const rec = await getPnlReconciliation(p, {});
      const t: any = rec.totals;
      console.log("SAL_LIVE " + JSON.stringify({ period: p, mode: rec.mode, payrollCost: Math.round(t.payrollCost ?? 0), unallocatedPayroll: Math.round(t.unallocatedPayroll ?? 0), revenue: Math.round(t.recognisedRevenue ?? t.revenue ?? 0), operatingProfit: Math.round(t.operatingProfit ?? 0), marginPct: t.marginPct ?? null,
        payrollFreshness: rec.freshness.filter((f: any) => /payroll|salary/i.test(f.source)), blockers: rec.blockers.map((b: string) => b.slice(0, 160)) }));
    } catch (e) { console.log("SAL_LIVE ERROR " + (e instanceof Error ? e.message : String(e))); }
  }
  await new Promise((resolve) => process.stdout.write("SAL_DONE\n", resolve));
  process.exit(0);
})();
