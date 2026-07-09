import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const employeeVerifyRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => {
  fn(req, res).catch(next);
};

function normalizeMonthYear(value: string) {
  const text = decodeURIComponent(value).trim();
  const monthName = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthName) {
    const monthIndex = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ].indexOf(monthName[1].toLowerCase()) + 1;
    return monthIndex > 0 ? `${monthName[2]}-${String(monthIndex).padStart(2, "0")}` : text;
  }
  const yyyymm = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (yyyymm) return `${yyyymm[1]}-${yyyymm[2]}`;
  const mmyyyy = text.match(/^(\d{1,2})[/-](\d{4})$/);
  if (mmyyyy) return `${mmyyyy[2]}-${String(Number(mmyyyy[1])).padStart(2, "0")}`;
  return text;
}

function normalizePublicPhotoUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.replace(/^\/api\/files\/employee-photos\//, "/uploads/employee-photos/");
}

employeeVerifyRouter.get("/emp/:employeeCode", h(async (req, res) => {
  const employeeCode = String(req.params.employeeCode ?? "").trim();
  if (!employeeCode) return res.status(400).json({ success: false, message: "Employee code is required" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), e.employee_code) AS full_name,
            d.designation_name AS designation,
            b.branch_name,
            COALESCE(NULLIF(e.employment_status, ''), IF(e.active_status = 1, 'Active', 'Inactive')) AS employment_status,
            e.employment_type,
            e.date_of_joining,
            COALESCE(NULLIF(e.avatar_url, ''), NULLIF(e.photo_url, '')) AS avatar_url
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.employee_code = ?
      LIMIT 1`,
    [employeeCode],
  );

  const employee = rows[0];
  if (!employee) return res.status(404).json({ success: false, message: "Employee not found" });

  return res.json({
    success: true,
    data: {
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      designation: employee.designation,
      branch_name: employee.branch_name,
      employment_status: employee.employment_status,
      employment_type: employee.employment_type,
      date_of_joining: employee.date_of_joining,
      avatar_url: normalizePublicPhotoUrl(employee.avatar_url),
      verified_at: new Date().toISOString(),
    },
  });
}));

employeeVerifyRouter.get("/payslip/:employeeCode/:monthYear", h(async (req, res) => {
  const employeeCode = String(req.params.employeeCode ?? "").trim();
  const runMonth = normalizeMonthYear(String(req.params.monthYear ?? ""));
  if (!employeeCode || !runMonth) return res.status(400).json({ success: false, message: "Employee code and month are required" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), e.employee_code) AS full_name,
            d.designation_name AS designation,
            b.branch_name,
            spr.run_month,
            CASE WHEN sp.acknowledged_at IS NOT NULL THEN 'acknowledged'
                 WHEN sp.id IS NOT NULL THEN 'generated'
                 ELSE 'calculated'
            END AS status
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.employee_code = ?
        AND LEFT(spr.run_month, 7) = ?
      ORDER BY sp.generated_at DESC, spr.created_at DESC
      LIMIT 1`,
    [employeeCode, runMonth],
  );

  const payslip = rows[0];
  if (!payslip) return res.status(404).json({ success: false, message: "Payslip not found" });

  const [year, month] = String(payslip.run_month).split("-").map(Number);
  return res.json({
    success: true,
    data: {
      employee_code: payslip.employee_code,
      full_name: payslip.full_name,
      designation: payslip.designation,
      branch_name: payslip.branch_name,
      month,
      year,
      status: payslip.status,
      verified_at: new Date().toISOString(),
    },
  });
}));
