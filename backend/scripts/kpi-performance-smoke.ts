/**
 * Read-only smoke test of the KPI live performance engine against real data, as a super_admin (org-wide scope).
 * Prints per-process coverage and a few headline numbers - never employee names. Run on the production host via
 * .github/workflows/ops-kpi-catalogue-sync.yml.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { listProcesses } from "../src/modules/kpi-catalogue/kpi-catalogue.service.js";
import { getProcessPerformance } from "../src/modules/kpi-catalogue/kpi-performance.service.js";

try {
  const [u] = await db.execute(`SELECT user_id FROM user_roles WHERE role_key = 'super_admin' AND active_status = 1 LIMIT 1`);
  const userId = String((u as Array<{ user_id: string }>)[0]?.user_id ?? "");
  if (!userId) throw new Error("no super_admin user found for the smoke test");
  for (const period of ["mtd", "last30"] as const) {
    console.log(`\n=== period ${period} ===`);
    for (const p of await listProcesses()) {
      try {
        const r = await getProcessPerformance(p.process_key, { userId, period, groupBy: "employee" });
        if (!r) { console.log(`${p.process_key}: not in catalogue`); continue; }
        const live = r.kpis.filter((k) => k.availability === "ok");
        const top = live.slice(0, 3).map((k) => `${k.metric_key}=${k.value}${k.target != null ? `/t${k.target}` : ""}${k.rating ? `(${k.rating})` : ""}`).join(", ");
        console.log(`perf | ${p.process_key} | headcount ${r.headcount} | ok ${r.summary.ok} no_data ${r.summary.no_data} not_tracked ${r.summary.not_tracked} | overall ${r.summary.overall_attainment ?? "-"} | ${top}`);
      } catch (err) {
        console.log(`perf | ${p.process_key} | ERROR ${(err as Error).message}`);
      }
    }
  }
} finally {
  await (db as unknown as { end?: () => Promise<void> }).end?.();
  process.exit(0);
}
