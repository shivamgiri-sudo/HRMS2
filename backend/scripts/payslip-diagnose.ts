/**
 * Why does an employee's payslip show odd days / blank YTD? STRICTLY READ-ONLY (SELECTs only).
 *
 *   npx tsx scripts/payslip-diagnose.ts <name-fragment-or-employee-code> [YYYY-MM]
 *
 * Prints, for the financial year up to the month: each salary_prep_line (run status, line status,
 * days columns, component-row count), the legacy snapshot months, the YTD the payslip service
 * returns, and the raw attendance counts for the month.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { payslipService } from "../src/modules/payroll/payslip.service.js";

const Q = process.argv[2] ?? "";
const MONTH = process.argv[3] ?? "2026-08";

async function main() {
  // Comma-separated fragments; an employee matches when its full name contains ALL of them
  // (so "abbir,vache" is narrower than "abbir"). An exact employee code also matches.
  const frags = Q.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
  const nameClauses = frags.map(() => `LOWER(CONCAT(first_name,' ',COALESCE(last_name,''))) LIKE ?`).join(" AND ");
  const [emps] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, first_name, last_name, active_status, date_of_joining, branch_id
       FROM employees WHERE employee_code = ? OR (${nameClauses || "1=0"}) LIMIT 30`,
    [Q, ...frags.map((f) => `%${f}%`)]);
  console.log("EMPLOYEES", JSON.stringify(emps));
  if (emps.length > 4) { console.log("too many matches, narrow the fragments"); process.exit(0); }
  for (const e of emps) {
    const id = String(e.id);
    console.log(`\n=== ${e.employee_code} ${e.first_name} ${e.last_name ?? ""} ===`);
    const [yr, mo] = MONTH.split("-").map(Number);
    const fyStart = `${mo >= 4 ? yr : yr - 1}-04`;
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month, spr.status AS run_status, spl.status AS line_status, spl.calculation_version,
              spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days, spl.paid_working_days,
              spl.eligible_weekoff_days, spl.eligible_holiday_days, spl.final_payable_days, spl.active_calendar_days,
              spl.gross_salary, spl.net_salary,
              (SELECT COUNT(*) FROM salary_prep_line_component c WHERE c.line_id = spl.id) AS component_rows
         FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id
        WHERE spl.employee_id = ? AND spr.run_month BETWEEN ? AND ?
        ORDER BY spr.run_month, spr.created_at`, [id, fyStart, MONTH]);
    for (const l of lines) console.log("LINE", JSON.stringify(l));
    try {
      const [snap] = await db.execute<RowDataPacket[]>(
        `SELECT pay_month FROM legacy_payslip_snapshot WHERE employee_id = ? AND pay_month BETWEEN ? AND ?`, [id, fyStart, MONTH]);
      console.log("LEGACY SNAPSHOT MONTHS", JSON.stringify(snap.map((r) => r.pay_month)));
    } catch (err) { console.log("legacy snapshot n/a", (err as Error).message); }
    const ytd = await payslipService.getYtdForEmployee(id, MONTH);
    console.log("YTD BY TYPE", JSON.stringify(ytd.ytd_by_type));
    const [att] = await db.execute<RowDataPacket[]>(
      `SELECT attendance_status AS status, COUNT(*) AS n FROM attendance_daily_record
        WHERE employee_id = ? AND DATE_FORMAT(CONVERT_TZ(record_date, '+00:00', '+05:30'),'%Y-%m') = ? GROUP BY attendance_status`, [id, MONTH]);
    console.log("ATTENDANCE", MONTH, JSON.stringify(att));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
