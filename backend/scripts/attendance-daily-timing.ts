/**
 * Times and sanity-checks the Daily Attendance report executor on the live DB. READ-ONLY.
 * Company-wide scope, preview page of 5, three ranges: a past 10 days, a range running into the
 * future (must be capped at today), and one wholly in the future (must be empty).
 */
import "dotenv/config";
import { attendanceDaily } from "../src/modules/reporting/executors/attendance.executor.js";
import { businessToday } from "../src/modules/reporting/executors/types.js";

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
    ["past 10 days", { from: "2026-10-01", to: "2026-10-10" }],
    ["into the future", { from: "2026-10-12", to: "2026-10-31" }],
    ["wholly future", { from: "2026-10-20", to: "2026-10-31" }],
  ] as const;
  for (const [label, f] of cases) {
    const t0 = Date.now();
    const r: any = await attendanceDaily(f as any, scope, opts);
    const dates = [...new Set(r.rows.map((x: any) => x.record_date))];
    console.log(`${label}: ${Date.now() - t0} ms, total=${r.rowCount}, rows=${r.rows.length}, dates=${JSON.stringify(dates)}, nullDates=${r.rows.filter((x: any) => !x.record_date).length}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
