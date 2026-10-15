/**
 * Post-deploy check (2026-10-15 changes). READ-ONLY (SELECTs only):
 *  1. Attendance register shows nobody who left before the month, and the LOB / manager filters narrow.
 *  2. Roster console process options with and without `from`.
 *  3. Shift adherence per-process LOB rows add up to the process.
 *
 *   npx tsx scripts/verify-roster-attendance-changes.ts [YYYY-MM]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceRegisterMonthly } from "../src/modules/reporting/executors/attendance.executor.js";
import { getConsoleOptions } from "../src/modules/wfm/console-scope.js";
import { getShiftAdherence } from "../src/modules/wfm/shift-adherence.service.js";

const month = String(process.argv[2] ?? new Date().toISOString().slice(0, 7));
const first = `${month}-01`;
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as RowDataPacket[];
const all: any = { mode: "all", ids: [] };
const scope: any = { companyId: "ops", isSuperAdmin: true, branchScope: all, processScope: all, departmentScope: all, costCentreScope: all, canViewAllEmployees: true, canViewSensitiveFields: false };
// Small sequential pages: the register runs per-employee queries concurrently, and one 3000-row call
// is enough to trip the pool's circuit breaker on the live DB.
const PAGE = 200;
const run = async (f: Record<string, unknown>, maxPages = 8) => {
  const out: any[] = [];
  for (let i = 0; i < maxPages; i++) {
    const r = (await attendanceRegisterMonthly({ month, employeeStatus: "all", ...f } as any, scope, { limit: PAGE, offset: i * PAGE, includeTotal: true, mode: "preview" } as any)) as any;
    out.push(...r.rows);
    if (r.rows.length < PAGE) break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return out;
};

(async () => {
  let bad = 0;
  const rows = await run({});
  const ids = rows.map((r) => r.employee_id as string);
  console.log(`register ${month}: ${rows.length} rows, inactive=${rows.filter((r) => r.employee_status === "Inactive").length}`);
  if (ids.length) {
    const gone = await q(
      `SELECT employee_code, active_status, COALESCE(date_of_exit, date_of_leaving) AS exit_date FROM employees
        WHERE id IN (${ids.map(() => "?").join(",")})
          AND COALESCE(date_of_exit, date_of_leaving) < ? AND (date_of_joining IS NULL OR COALESCE(date_of_exit, date_of_leaving) >= DATE(date_of_joining))`,
      [...ids, first],
    );
    console.log(`  left before ${first} but listed: ${gone.length}`);
    if (gone.length) { bad++; console.table(gone.slice(0, 10)); }
    const [{ n }] = await q(`SELECT COUNT(*) n FROM employees WHERE active_status = 0 AND COALESCE(date_of_exit, date_of_leaving) < ?`, [first]);
    console.log(`  (inactive employees who left before month overall: ${n}, none should be listed)`);
  }

  const [lob] = await q(`SELECT lob_id, COUNT(*) n FROM employees WHERE active_status = 1 AND lob_id IS NOT NULL GROUP BY lob_id ORDER BY n DESC LIMIT 1`);
  if (lob) {
    const r = await run({ lobId: lob.lob_id }, 2);
    const wrong = r.length ? await q(`SELECT COUNT(*) n FROM employees WHERE id IN (${r.map(() => "?").join(",")}) AND (lob_id <> ? OR lob_id IS NULL)`, [...r.map((x) => x.employee_id), lob.lob_id]) : [{ n: 0 }];
    console.log(`LOB ${lob.lob_id}: ${r.length} rows (of ${rows.length}), off-LOB rows: ${wrong[0].n}`);
    if (wrong[0].n > 0 || r.length > rows.length && rows.length < PAGE * 8) bad++;
  }
  const [mgr] = await q(`SELECT reporting_manager_id, COUNT(*) n FROM employees WHERE active_status = 1 AND reporting_manager_id IS NOT NULL GROUP BY reporting_manager_id ORDER BY n DESC LIMIT 1`);
  if (mgr) {
    const r = await run({ managerId: mgr.reporting_manager_id }, 2);
    const wrong = r.length ? await q(`SELECT COUNT(*) n FROM employees WHERE id IN (${r.map(() => "?").join(",")}) AND reporting_manager_id <> ? AND (manager_id IS NULL OR manager_id <> ?)`, [...r.map((x) => x.employee_id), mgr.reporting_manager_id, mgr.reporting_manager_id]) : [{ n: 0 }];
    console.log(`manager ${mgr.reporting_manager_id}: ${r.length} rows, off-manager rows: ${wrong[0].n}`);
    if (wrong[0].n > 0 || r.length > rows.length && rows.length < PAGE * 8) bad++;
  }

  const sa: any = { roles: ["super_admin"], assignments: [] };
  const base = await getConsoleOptions(sa);
  const wide = await getConsoleOptions(sa, { from: first });
  const baseIds = new Set(base.processes.map((p) => p.id));
  console.log(`console processes: ${base.processes.length} default, ${wide.processes.length} with from=${first}`);
  console.table(wide.processes.filter((p) => !baseIds.has(p.id)).slice(0, 15));

  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const sh = await getShiftAdherence(y, 0, undefined, undefined);
  const lobSum = sh.processes.reduce((s, p) => s + p.lobs.reduce((a, l) => a + l.planned, 0), 0);
  const procSum = sh.processes.reduce((s, p) => s + p.planned, 0);
  console.log(`shift adherence ${y}: ${sh.processes.length} processes, planned=${procSum}, lob-rows planned=${lobSum}`);
  if (lobSum !== procSum) bad++;
  console.table(sh.processes.slice(0, 3).map((p) => ({ process: p.process, planned: p.planned, lobs: p.lobs.map((l) => `${l.lob}:${l.planned}`).join(" | ") })));

  console.log(bad ? `RESULT: ${bad} CHECK(S) FAILED` : "RESULT: ALL CHECKS PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
