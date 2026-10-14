/**
 * Times and sanity-checks the Daily Attendance report executor on the live DB. READ-ONLY.
 * Company-wide scope, preview page of 5, three ranges: a past 10 days, a range running into the
 * future (must be capped at today), and one wholly in the future (must be empty).
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { attendanceDaily } from "../src/modules/reporting/executors/attendance.executor.js";
import { businessToday } from "../src/modules/reporting/executors/types.js";

const origExecute = (db as any).execute.bind(db);
const captured: { sql: string; params: unknown[]; ms: number }[] = [];
(db as any).execute = async (sql: any, params: any) => {
  const t0 = Date.now();
  const r = await origExecute(sql, params);
  if (typeof sql === "string" && /FROM attendance_daily_record adr\s+JOIN employees e/.test(sql)) captured.push({ sql, params, ms: Date.now() - t0 });
  return r;
};

const all = { mode: "all", ids: [] } as const;
const scope: any = {
  companyId: "", isSuperAdmin: true, branchScope: all, processScope: all, departmentScope: all, costCentreScope: all,
  canViewAllEmployees: true, canViewSensitiveFields: false, canExportSensitiveReports: false, roles: ["super_admin"],
};
const opts: any = { limit: 5, offset: 0, cursor: null, includeTotal: true, mode: "preview" };

(async () => {
  const today = businessToday();
  console.log("business today:", today);
  const cases = [
    ["past 1 day", { from: "2026-10-10", to: "2026-10-10" }],
    ["past 10 days", { from: "2026-10-01", to: "2026-10-10" }],
    ["wholly future", { from: "2026-10-20", to: "2026-10-31" }],
  ] as const;
  for (const [label, f] of cases) {
    const t0 = Date.now();
    const r: any = await attendanceDaily(f as any, scope, opts);
    const dates = [...new Set(r.rows.map((x: any) => x.record_date))];
    console.log(`${label}: ${Date.now() - t0} ms, total=${r.rowCount}, rows=${r.rows.length}, dates=${JSON.stringify(dates)}, nullDates=${r.rows.filter((x: any) => !x.record_date).length}`);
  }
  const slow = captured.sort((a, b) => b.ms - a.ms)[0];
  if (slow) {
    console.log(`\nslowest statement ${slow.ms} ms; EXPLAIN ANALYZE of it:`);
    const last = slow;
    try {
      const [r] = await origExecute(`EXPLAIN ANALYZE ${last.sql.replace(/\s+LIMIT \d+ OFFSET \d+\s*$/, " LIMIT 5")}`, last.params);
      for (const row of r as any[]) console.log(Object.values(row)[0]);
    } catch (e) { console.log("EXPLAIN ANALYZE failed:", (e as Error).message); }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
