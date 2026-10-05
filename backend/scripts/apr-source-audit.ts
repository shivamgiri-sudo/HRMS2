/**
 * APR source audit. READ-ONLY.
 *
 * For each process, compares what the engine will use (APR / COSEC / APR+COSEC) for its Operations
 * Executive-type employees against whether those employees actually have dialler (apr table)
 * activity in the last 30 days. Flags processes on COSEC whose people are clearly on the dialler,
 * and processes on APR whose people have no dialler feed. Also shows whether the process's own
 * apr_eligibility_config rows are active or were deactivated, and when.
 *
 *   npx tsx scripts/apr-source-audit.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { resolveAttendanceLogicFromRows } from "../src/modules/wfm/attendance-logic-resolver.js";
import type { AprEligibilityRow, AttendanceLogic } from "../src/modules/wfm/attendance-logic-resolver.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as any[];

(async () => {
  const cfg = await q(
    `SELECT id, rule_name, designation_id, department_id, process_id, attendance_logic, active_status,
            DATE_FORMAT(updated_at,'%Y-%m-%d') updated_at, created_by
       FROM apr_eligibility_config`);
  const active: AprEligibilityRow[] = cfg.filter((r) => Number(r.active_status) === 1).map((r) => ({
    id: String(r.id), rule_name: r.rule_name, designation_id: r.designation_id, department_id: r.department_id,
    process_id: r.process_id, attendance_logic: String(r.attendance_logic ?? "apr") as AttendanceLogic, active_status: 1,
  }));
  try {
    const ov = await q(`SELECT COUNT(*) n FROM employee_attendance_logic_override WHERE active_status = 1`);
    console.log(`employee_attendance_logic_override: table present, ${ov[0].n} active override(s)`);
  } catch (e: any) {
    console.log(`employee_attendance_logic_override: NOT PRESENT (${e?.code ?? e?.message})`);
  }
  console.log(`apr_eligibility_config: ${cfg.length} rows, ${active.length} active`);
  console.table(cfg.map((r) => ({
    rule: r.rule_name, process: r.process_id ? String(r.process_id).slice(0, 8) : "(company-wide)",
    logic: r.attendance_logic, active: r.active_status, updated: r.updated_at, by: String(r.created_by ?? "").slice(0, 8),
  })).slice(0, 80));

  const emps = await q(
    `SELECT e.id, e.employee_code, e.process_id, p.process_name, e.designation_id, e.department_id,
            LOWER(COALESCE(dept.dept_name,'')) dept_name, LOWER(COALESCE(desig.designation_name,'')) desig_name,
            EXISTS (SELECT 1 FROM apr a WHERE a.UserID = e.employee_code
                     AND a.ReportDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS apr_30d
       FROM employees e
       JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN designation_master desig ON desig.id = e.designation_id
      WHERE e.employment_status = 'active'
        AND LOWER(COALESCE(dept.dept_name,'')) IN ('operations','operation')
        AND LOWER(COALESCE(desig.designation_name,'')) REGEXP '^executive'`);

  type Agg = { total: number; withApr: number; apr: number; cosec: number; both: number };
  const by = new Map<string, Agg & { name: string; pid: string }>();
  for (const e of emps) {
    const res = resolveAttendanceLogicFromRows(
      active,
      { designationId: e.designation_id, departmentId: e.department_id, processId: e.process_id },
      { departmentName: e.dept_name, designationName: e.desig_name });
    const a = by.get(e.process_id) ?? { name: e.process_name, pid: e.process_id, total: 0, withApr: 0, apr: 0, cosec: 0, both: 0 };
    a.total++; if (Number(e.apr_30d)) a.withApr++;
    if (res.logic === "apr") a.apr++; else if (res.logic === "cosec") a.cosec++; else a.both++;
    by.set(e.process_id, a);
  }

  const rows = [...by.values()].sort((x, y) => y.total - x.total).map((a) => {
    const pct = a.total ? Math.round((100 * a.withApr) / a.total) : 0;
    const own = cfg.filter((r) => r.process_id === a.pid);
    const ownActive = own.filter((r) => Number(r.active_status) === 1).length;
    const lastOwn = own.map((r) => r.updated_at).filter(Boolean).sort().pop() ?? "";
    let flag = "";
    if (a.cosec > 0 && pct >= 50) flag = "COSEC but dialler-active";
    else if ((a.apr + a.both) > 0 && pct < 10) flag = "APR but no dialler feed";
    return { process: a.name, execs: a.total, dialler_active_30d: `${a.withApr} (${pct}%)`,
      on_APR: a.apr, on_COSEC: a.cosec, on_APR_COSEC: a.both,
      own_rows: `${ownActive}/${own.length} active`, own_rows_updated: lastOwn, flag };
  });
  console.log("\nOperations Executives per process: engine source vs dialler activity (last 30 days)");
  console.table(rows);
  console.log("\nFLAGGED:");
  console.table(rows.filter((r) => r.flag));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
