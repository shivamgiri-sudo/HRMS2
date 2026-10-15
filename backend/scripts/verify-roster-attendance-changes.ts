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
(async () => {
  let bad = 0;
  const reg = async (f: Record<string, unknown>, limit = 25) =>
    (await attendanceRegisterMonthly({ month, employeeStatus: "all", ...f } as any, scope, { limit, offset: 0, includeTotal: true, mode: "preview" } as any)) as any;

  // Population size (count query only; limit 1 keeps the per-employee work to a single row).
  const total = (await reg({}, 1)).rowCount;
  console.log(`register ${month}: total employees listed = ${total}`);

  // Targeted: people who left before the month must NOT come back, whatever active_status says.
  const gone = await q(
    `SELECT id, employee_code, active_status, COALESCE(date_of_exit, date_of_leaving) AS exit_date FROM employees
      WHERE COALESCE(date_of_exit, date_of_leaving) < ? AND (date_of_joining IS NULL OR COALESCE(date_of_exit, date_of_leaving) >= DATE(date_of_joining))
        AND (branch_id IS NULL OR branch_id IN (SELECT id FROM branch_master WHERE active_status = 1))
      ORDER BY active_status DESC, exit_date DESC LIMIT 25`, [first]);
  console.log(`left-before-month sample: ${gone.length} (active_status=1 among them: ${gone.filter((g) => Number(g.active_status) === 1).length})`);
  if (gone.length) {
    const r = await reg({ employeeIds: gone.map((g) => g.id) }, 25);
    console.log(`  listed in register: ${r.rows.length} (must be 0)`);
    if (r.rows.length) { bad++; console.table(r.rows.map((x: any) => ({ code: x.emp_code, status: x.employee_status, exit: x.date_of_exit }))); }
  }
  // Positive control: people who left DURING the month stay visible.
  const during = await q(
    `SELECT id FROM employees WHERE COALESCE(date_of_exit, date_of_leaving) BETWEEN ? AND LAST_DAY(?) AND DATE(date_of_joining) <= LAST_DAY(?) LIMIT 25`, [first, first, first]);
  if (during.length) {
    const r = await reg({ employeeIds: during.map((g) => g.id) }, 25);
    console.log(`left during ${month}: ${during.length} in DB, ${r.rows.length} listed (branch filter may drop some)`);
  }

  const [lob] = await q(`SELECT lob_id, COUNT(*) n FROM employees WHERE active_status = 1 AND lob_id IS NOT NULL GROUP BY lob_id ORDER BY n DESC LIMIT 1`);
  if (lob) {
    const r = await reg({ lobId: lob.lob_id }, 25);
    const wrong = r.rows.length ? await q(`SELECT COUNT(*) n FROM employees WHERE id IN (${r.rows.map(() => "?").join(",")}) AND (lob_id <> ? OR lob_id IS NULL)`, [...r.rows.map((x: any) => x.employee_id), lob.lob_id]) : [{ n: 0 }];
    console.log(`LOB ${lob.lob_id}: total ${r.rowCount} (of ${total}), page rows ${r.rows.length}, off-LOB: ${wrong[0].n}`);
    if (wrong[0].n > 0 || r.rowCount >= total) bad++;
  }
  const [mgr] = await q(`SELECT reporting_manager_id, COUNT(*) n FROM employees WHERE active_status = 1 AND reporting_manager_id IS NOT NULL GROUP BY reporting_manager_id ORDER BY n DESC LIMIT 1`);
  if (mgr) {
    const r = await reg({ managerId: mgr.reporting_manager_id }, 25);
    const wrong = r.rows.length ? await q(`SELECT COUNT(*) n FROM employees WHERE id IN (${r.rows.map(() => "?").join(",")}) AND reporting_manager_id <> ? AND (manager_id IS NULL OR manager_id <> ?)`, [...r.rows.map((x: any) => x.employee_id), mgr.reporting_manager_id, mgr.reporting_manager_id]) : [{ n: 0 }];
    console.log(`manager ${mgr.reporting_manager_id}: total ${r.rowCount} (of ${total}), page rows ${r.rows.length}, off-manager: ${wrong[0].n}`);
    if (wrong[0].n > 0 || r.rowCount >= total) bad++;
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
