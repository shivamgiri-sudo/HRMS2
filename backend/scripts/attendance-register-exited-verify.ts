/**
 * Read-only: confirms the Attendance Register lists employees who exited mid-month.
 * Run: npx tsx scripts/attendance-register-exited-verify.ts [YYYY-MM]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceRegisterMonthly } from "../src/modules/reporting/executors/attendance.executor.js";
import type { ExecScope } from "../src/modules/reporting/executors/types.js";

async function main() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = process.argv[2] ?? `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()).padStart(2, "0")}`;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.active_status,
            COALESCE(e.date_of_exit, e.date_of_leaving) AS exit_date,
            (SELECT COUNT(*) FROM attendance_daily_record x
              WHERE x.employee_id = e.id AND x.record_date BETWEEN ? AND ?) AS att_rows
       FROM employees e
      WHERE COALESCE(e.date_of_exit, e.date_of_leaving) BETWEEN ? AND ?
        AND e.active_status = 0
      ORDER BY e.id LIMIT 300`,
    [first, last, first, last],
  );
  console.log(`month=${month} inactive leavers with exit in month: ${rows.length}`);
  if (!rows.length) return;
  const all = { mode: "all", ids: [] as string[] } as ExecScope["branchScope"];
  let found = 0;
  const missing: string[] = [];
  const byCompany = new Map<string, RowDataPacket[]>();
  for (const r of rows) byCompany.set("co", [...(byCompany.get("co") ?? []), r]);
  for (const [companyId, list] of byCompany) {
    const scope: ExecScope = {
      companyId, isSuperAdmin: true, branchScope: all, processScope: all, departmentScope: all,
      costCentreScope: all, canViewAllEmployees: true, canViewSensitiveFields: false,
    } as ExecScope;
    const res = await attendanceRegisterMonthly(
      { month, employeeStatus: "all", employeeIds: list.map((r) => String(r.id)) } as never,
      scope,
      { limit: 1000, offset: 0, includeTotal: true, mode: "preview" },
    );
    const got = new Set(res.rows.map((r) => String(r.emp_code)));
    console.log(`register returned ${res.rows.length} rows for ${list.length} requested`);
    for (const r of list) {
      if (got.has(String(r.employee_code))) found++;
      else missing.push(`${r.employee_code} exit=${String(r.exit_date).slice(0, 10)} att_rows=${r.att_rows}`);
    }
  }
  console.log(`listed in register: ${found}/${rows.length}`);
  console.log(`missing (${missing.length}):`, missing.slice(0, 20).join("\n  "));
  const noRows = rows.filter((r) => Number(r.att_rows) === 0).length;
  console.log(`of which had zero attendance rows (new arm): ${noRows}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
