import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const reportSuiteReferenceFormatRouter = Router();
reportSuiteReferenceFormatRouter.use(requireAuth);

const roles = requireRole(
  "super_admin", "admin", "hr", "finance", "payroll", "payroll_head",
  "wfm", "manager", "ceo",
);

function monthParam(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 7);
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const monthLabel = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return { from, to, days: Number(to.slice(8, 10)), monthLabel };
}

function addEmployeeFilters(query: Record<string, unknown>, clauses: string[], params: unknown[]) {
  if (query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(query.branchId)); }
  if (query.departmentId) { clauses.push("e.department_id = ?"); params.push(String(query.departmentId)); }
  if (query.processId) { clauses.push("e.process_id = ?"); params.push(String(query.processId)); }
  if (query.costCentreId) { clauses.push("e.cost_centre_id = ?"); params.push(String(query.costCentreId)); }
}

function attendanceCode(status: unknown) {
  const value = String(status ?? "").toLowerCase();
  if (value === "present" || value === "week_off_worked") return "P";
  if (value === "half_day") return "HD";
  if (value === "absent") return "A";
  if (value === "leave_approved") return "L";
  if (value === "holiday") return "H";
  if (value === "week_off") return "W";
  if (value === "missing_punch") return "MP";
  if (value === "unreconciled") return "UR";
  return value ? value.toUpperCase() : "";
}

function sendRows(res: Response, rows: Record<string, unknown>[], warnings: string[]) {
  return res.json({
    success: true,
    code: "attendance-summary",
    data: rows,
    meta: {
      reportCode: "attendance-summary",
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
      accuracyStatus: warnings.length ? "validated_with_warnings" : "validated_query",
      sourceTables: ["attendance_daily_record", "employees", "salary_prep_run", "salary_prep_line"],
      warnings,
      assurance: "Output columns follow the supplied monthly attendance workbook: employee master fields, month-day grid, attendance counters, salary days and total calendar days.",
    },
  });
}

reportSuiteReferenceFormatRouter.get("/attendance-summary", roles, async (req, res, next: NextFunction) => {
  try {
    const month = monthParam(req.query.month);
    const { from, to, days, monthLabel } = monthBounds(month);
    const clauses: string[] = ["adr.record_date BETWEEN ? AND ?"];
    const params: unknown[] = [from, to];
    addEmployeeFilters(req.query as Record<string, unknown>, clauses, params);

    const [detailRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code, e.biometric_code,
              COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
              d.dept_name AS department_name, dm.designation_name,
              p.process_name, cc.cost_centre_name, b.branch_name,
              adr.record_date, adr.attendance_status
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
         LEFT JOIN department_master d ON d.id = e.department_id
         LEFT JOIN designation_master dm ON dm.id = e.designation_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY employee_name, adr.record_date`,
      params,
    );

    const [payRows] = await db.execute<RowDataPacket[]>(
      `WITH ranked_payroll AS (
         SELECT spl.employee_id, spl.working_days, spl.lwp_days,
                ROW_NUMBER() OVER (
                  PARTITION BY spl.employee_id
                  ORDER BY CASE LOWER(COALESCE(spr.status,''))
                    WHEN 'paid' THEN 100 WHEN 'released' THEN 95 WHEN 'disbursed' THEN 90
                    WHEN 'finalized' THEN 85 WHEN 'locked' THEN 80 WHEN 'approved' THEN 75
                    WHEN 'calculated' THEN 70 WHEN 'reviewed' THEN 65 WHEN 'processing' THEN 60
                    ELSE 10 END DESC,
                    spr.updated_at DESC, spr.created_at DESC, spr.id DESC
                ) AS line_rank
           FROM salary_prep_line spl
           JOIN salary_prep_run spr ON spr.id = spl.run_id
          WHERE spr.run_month = ?
            AND LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
       )
       SELECT employee_id, GREATEST(COALESCE(working_days,0) - COALESCE(lwp_days,0), 0) AS salary_days
         FROM ranked_payroll
        WHERE line_rank = 1`,
      [month],
    );

    const salaryDays = new Map(payRows.map((row) => [String(row.employee_id), Number(row.salary_days ?? 0)]));
    const employeeMap = new Map<string, Record<string, string | number>>();

    for (const row of detailRows) {
      const employeeId = String(row.employee_id);
      if (!employeeMap.has(employeeId)) {
        employeeMap.set(employeeId, {
          SNo: employeeMap.size + 1,
          EmpCode: String(row.employee_code ?? ""),
          BioCode: String(row.biometric_code ?? ""),
          EmpName: String(row.employee_name ?? ""),
          Department: String(row.department_name ?? ""),
          Designation: String(row.designation_name ?? ""),
          Profile: String(row.process_name ?? ""),
          CostCenter: String(row.cost_centre_name ?? ""),
          EmpLocation: String(row.branch_name ?? ""),
          Billable: "",
          A: 0, P: 0, OD: 0, "HD/DH/FTP": 0, L: 0, H: 0, W: 0,
          SalDays: salaryDays.get(employeeId) ?? 0,
          Total: days,
        });
      }

      const target = employeeMap.get(employeeId)!;
      const dateText = String(row.record_date).slice(0, 10);
      const day = Number(dateText.slice(8, 10));
      const header = `${monthLabel}-${String(day).padStart(2, "0")}`;
      const code = attendanceCode(row.attendance_status);
      target[header] = code;
      if (code === "A") target.A = Number(target.A) + 1;
      else if (code === "P") target.P = Number(target.P) + 1;
      else if (code === "HD") target["HD/DH/FTP"] = Number(target["HD/DH/FTP"]) + 1;
      else if (code === "L") target.L = Number(target.L) + 1;
      else if (code === "H") target.H = Number(target.H) + 1;
      else if (code === "W") target.W = Number(target.W) + 1;
      else if (code === "OD") target.OD = Number(target.OD) + 1;
    }

    const rows = Array.from(employeeMap.values()).map((row) => {
      const ordered: Record<string, unknown> = {
        SNo: row.SNo,
        EmpCode: row.EmpCode,
        BioCode: row.BioCode,
        EmpName: row.EmpName,
        Department: row.Department,
        Designation: row.Designation,
        Profile: row.Profile,
        CostCenter: row.CostCenter,
        EmpLocation: row.EmpLocation,
        Billable: row.Billable,
      };
      for (let day = 1; day <= days; day += 1) {
        const header = `${monthLabel}-${String(day).padStart(2, "0")}`;
        ordered[header] = row[header] ?? "";
      }
      Object.assign(ordered, {
        A: row.A, P: row.P, OD: row.OD, "HD/DH/FTP": row["HD/DH/FTP"],
        L: row.L, H: row.H, W: row.W, SalDays: row.SalDays, Total: row.Total,
      });
      return ordered;
    });

    const warnings = payRows.length
      ? []
      : ["No processed payroll lines were found for the selected month; SalDays is shown as 0 until payroll is calculated."];
    return sendRows(res, rows, warnings);
  } catch (error) {
    next(error);
  }
});
