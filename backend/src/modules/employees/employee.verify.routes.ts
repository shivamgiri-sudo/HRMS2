/**
 * Public (no-auth) employee verification endpoint.
 * Called when someone scans the QR code on an ID card or payslip.
 * Returns only safe, non-PII fields: name, code, designation, branch, status.
 */
import { Router } from "express";
import { db } from "../../db/mysql.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res, next).catch(next);

// GET /api/public/verify/emp/:employeeCode
router.get("/emp/:employeeCode", h(async (req: any, res: any) => {
  const { employeeCode } = req.params;
  if (!employeeCode || typeof employeeCode !== "string" || employeeCode.length > 50) {
    return res.status(400).json({ success: false, message: "Invalid employee code." });
  }

  const [rows] = await db.execute(
    `SELECT
       e.employee_code,
       e.full_name,
       e.employment_status,
       e.employment_type,
       e.date_of_joining,
       e.avatar_url,
       d.designation_name AS designation,
       b.branch_name
     FROM employees e
     LEFT JOIN designation_master d ON d.id = e.designation_id
     LEFT JOIN branch_master      b ON b.id = e.branch_id
     WHERE e.employee_code = ? AND e.active_status = 1
     LIMIT 1`,
    [employeeCode]
  ) as any[];

  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Employee not found or inactive." });
  }

  const emp = rows[0];
  return res.json({
    success: true,
    data: {
      employee_code:     emp.employee_code,
      full_name:         emp.full_name,
      designation:       emp.designation ?? null,
      branch_name:       emp.branch_name ?? null,
      employment_status: emp.employment_status,
      employment_type:   emp.employment_type ?? null,
      date_of_joining:   emp.date_of_joining
        ? String(emp.date_of_joining).slice(0, 10)
        : null,
      avatar_url:        emp.avatar_url ?? null,
      verified_at:       new Date().toISOString(),
    },
  });
}));

// GET /api/public/verify/payslip/:employeeCode/:monthYear
router.get("/payslip/:employeeCode/:monthYear", h(async (req: any, res: any) => {
  const { employeeCode, monthYear } = req.params;
  if (!employeeCode || !monthYear) {
    return res.status(400).json({ success: false, message: "Invalid parameters." });
  }

  // monthYear format: "Jan - 2025" → parse month + year
  const match = monthYear.match(/([A-Za-z]+)\s*[-–]\s*(\d{4})/);
  if (!match) {
    return res.status(400).json({ success: false, message: "Invalid month-year format." });
  }
  const monthNames: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const month = monthNames[match[1].toLowerCase()];
  const year  = parseInt(match[2], 10);
  if (!month || !year) {
    return res.status(400).json({ success: false, message: "Could not parse month/year." });
  }

  const [rows] = await db.execute(
    `SELECT ps.id, ps.month, ps.year, ps.gross_pay, ps.net_pay, ps.status,
            e.employee_code, e.full_name, e.employment_status,
            d.designation_name AS designation,
            b.branch_name
     FROM payslip ps
     JOIN employees e ON e.id = ps.employee_id
     LEFT JOIN designation_master d ON d.id = e.designation_id
     LEFT JOIN branch_master      b ON b.id = e.branch_id
     WHERE e.employee_code = ? AND ps.month = ? AND ps.year = ? AND e.active_status = 1
     LIMIT 1`,
    [employeeCode, month, year]
  ) as any[];

  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Payslip not found." });
  }

  const row = rows[0];
  return res.json({
    success: true,
    data: {
      employee_code: row.employee_code,
      full_name:     row.full_name,
      designation:   row.designation ?? null,
      branch_name:   row.branch_name ?? null,
      month:         row.month,
      year:          row.year,
      status:        row.status,
      // Only show net pay for verification — no full salary breakdown via public endpoint
      net_pay:       Number(row.net_pay),
      verified_at:   new Date().toISOString(),
    },
  });
}));

export const employeeVerifyRouter = router;
