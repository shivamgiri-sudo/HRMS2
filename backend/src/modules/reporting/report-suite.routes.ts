import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const reportSuiteRouter = Router();
reportSuiteRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const CATALOG = [
  { code: "employee-master", module: "HR", title: "Employee Master Report" },
  { code: "headcount", module: "HR", title: "Active Headcount Report" },
  { code: "employee-movement", module: "HR", title: "Joining / Exit Movement Report" },
  { code: "manager-mapping", module: "HR", title: "Reporting Manager Mapping Report" },
  { code: "attendance-daily", module: "Attendance", title: "Daily Attendance Report" },
  { code: "attendance-summary", module: "Attendance", title: "Monthly Attendance Summary" },
  { code: "biometric-reconciliation", module: "Attendance", title: "Biometric Reconciliation Report" },
  { code: "leave-balance", module: "Leave", title: "Leave Balance Report" },
  { code: "leave-utilization", module: "Leave", title: "Leave Utilization Report" },
  { code: "payroll-register", module: "Payroll", title: "Payroll Register" },
  { code: "payroll-variance", module: "Payroll", title: "Payroll Variance Report" },
  { code: "payslip-status", module: "Payroll", title: "Payslip Release/Acknowledgement Report" },
  { code: "statutory-missing", module: "Compliance", title: "Missing Statutory Details Report" },
  { code: "bank-missing", module: "Payroll", title: "Missing/Unverified Bank Details Report" },
  { code: "increment-requests", module: "Payroll", title: "Salary Increment Request Report" },
  { code: "cosec-unmapped", module: "Integration", title: "Unmapped COSEC Users Report" },
];

function dateParam(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function monthParam(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 7);
}

function limitParam(value: unknown) {
  const n = Number(value ?? 500);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 5000) : 500;
}

function addEmployeeFilters(query: any, clauses: string[], params: unknown[], alias = "e") {
  if (query.branchId) { clauses.push(`${alias}.branch_id = ?`); params.push(String(query.branchId)); }
  if (query.departmentId) { clauses.push(`${alias}.department_id = ?`); params.push(String(query.departmentId)); }
  if (query.processId) { clauses.push(`${alias}.process_id = ?`); params.push(String(query.processId)); }
  if (query.costCentreId) { clauses.push(`${alias}.cost_centre_id = ?`); params.push(String(query.costCentreId)); }
  if (query.managerId) { clauses.push(`(${alias}.reporting_manager_id = ? OR ${alias}.manager_id = ?)`); params.push(String(query.managerId), String(query.managerId)); }
}

async function queryRows(sql: string, params: unknown[], limit: number) {
  const [rows] = await db.execute<RowDataPacket[]>(`${sql} LIMIT ${limit}`, params);
  return rows;
}

reportSuiteRouter.get("/catalog", h(async (_req, res) => res.json({ success: true, data: CATALOG })));

reportSuiteRouter.get("/:code", requireRole("admin", "hr", "finance", "payroll", "wfm", "manager", "ceo"), h(async (req, res) => {
  const code = String(req.params.code);
  const limit = limitParam(req.query.limit);
  const params: unknown[] = [];
  const clauses: string[] = [];
  let sql = "";

  switch (code) {
    case "employee-master":
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.official_email, e.mobile, e.employment_status, e.date_of_joining, e.date_of_exit,
                    b.branch_name, d.dept_name AS department_name, p.process_name, cc.cost_centre_name,
                    COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS reporting_manager
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY e.employee_code`;
      break;
    case "headcount":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'");
      sql = `SELECT b.branch_name, d.dept_name AS department_name, p.process_name, COUNT(*) AS active_headcount
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.branch_name, d.dept_name, p.process_name
              ORDER BY b.branch_name, d.dept_name, p.process_name`;
      break;
    case "employee-movement": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("(e.date_of_joining BETWEEN ? AND ? OR COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?)");
      params.push(from, to, from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining, COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) AS exit_date,
                    CASE WHEN e.date_of_joining BETWEEN ? AND ? THEN 'joining' ELSE 'exit' END AS movement_type,
                    b.branch_name, d.dept_name AS department_name, p.process_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY COALESCE(e.date_of_joining,e.date_of_exit,e.date_of_leaving,e.resignation_date) DESC`;
      params.push(from, to);
      break;
    }
    case "manager-mapping":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.reporting_manager_id, e.manager_id,
                    COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS manager_name,
                    CASE WHEN e.reporting_manager_id IS NULL AND e.manager_id IS NULL THEN 'MISSING_MANAGER'
                         WHEN e.reporting_manager_id IS NOT NULL AND e.manager_id IS NOT NULL AND e.reporting_manager_id <> e.manager_id THEN 'MANAGER_FIELD_MISMATCH'
                         ELSE 'OK' END AS mapping_status
               FROM employees e
               LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
              WHERE ${clauses.join(" AND ")}
              ORDER BY mapping_status DESC, employee_name`;
      break;
    case "attendance-daily": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    adr.attendance_source, adr.attendance_status, adr.raw_minutes, adr.dialler_minutes, adr.biometric_minutes,
                    adr.lwp_value, adr.late_mark, adr.late_by_minutes, adr.is_locked
               FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, employee_name`;
      break;
    }
    case "attendance-summary": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    SUM(adr.attendance_status='present') AS present_days,
                    SUM(adr.attendance_status='half_day') AS half_days,
                    SUM(adr.attendance_status='absent') AS absent_days,
                    SUM(adr.attendance_status='leave_approved') AS leave_days,
                    SUM(adr.lwp_value) AS lwp_days,
                    SUM(adr.late_mark=1) AS late_days,
                    ROUND(SUM(COALESCE(adr.raw_minutes,adr.biometric_minutes,adr.dialler_minutes,0))/60,2) AS total_hours
               FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, employee_name
              ORDER BY employee_name`;
      break;
    }
    case "biometric-reconciliation": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    adr.attendance_status, adr.biometric_minutes, ibd.first_punch, ibd.last_punch, ibd.biometric_minutes AS imported_minutes,
                    CASE WHEN ibd.first_punch IS NULL AND adr.attendance_status IN ('present','half_day') THEN 'NO_BIOMETRIC_FOR_PRESENT'
                         WHEN ibd.first_punch IS NOT NULL AND adr.attendance_status='absent' THEN 'PUNCHED_BUT_ABSENT'
                         ELSE 'OK' END AS reconciliation_status
               FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, reconciliation_status DESC`;
      break;
    }
    case "leave-balance":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lbl.balance_year = ?"); params.push(Number(req.query.year ?? new Date().getFullYear()));
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    lt.leave_code, lt.leave_name, lbl.allocated_days, lbl.used_days, lbl.adjusted_days,
                    (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS remaining_days
               FROM leave_balance_ledger lbl JOIN employees e ON e.id = lbl.employee_id
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, lt.leave_code`;
      break;
    case "leave-utilization": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lr.from_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT lr.from_date, lr.to_date, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    lt.leave_code, lt.leave_name, lr.total_days, lr.status
               FROM leave_request lr JOIN employees e ON e.id = lr.employee_id
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lr.from_date DESC`;
      break;
    }
    case "payroll-register": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT spr.run_month, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    spl.gross_salary, spl.total_deductions, spl.net_salary, spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days, spl.status
               FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id JOIN employees e ON e.id = spl.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name`;
      break;
    }
    case "payroll-variance": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    spr.run_month, spl.net_salary AS current_net,
                    prev.net_salary AS previous_net,
                    ROUND(((spl.net_salary - COALESCE(prev.net_salary,0)) / NULLIF(prev.net_salary,0))*100,2) AS net_variance_pct,
                    spl.lwp_days
               FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN salary_prep_run pspr ON pspr.run_month = DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d'), INTERVAL 1 MONTH),'%Y-%m')
               LEFT JOIN salary_prep_line prev ON prev.run_id = pspr.id AND prev.employee_id = spl.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ABS(COALESCE(net_variance_pct,0)) DESC`;
      break;
    }
    case "payslip-status": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT spr.run_month, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    sp.payslip_ref, sp.file_url, sp.acknowledged_at,
                    CASE WHEN sp.id IS NULL THEN 'NOT_GENERATED' WHEN sp.acknowledged_at IS NULL THEN 'RELEASED_NOT_ACKNOWLEDGED' ELSE 'ACKNOWLEDGED' END AS payslip_status
               FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
              WHERE ${clauses.join(" AND ")}
              ORDER BY payslip_status DESC, employee_name`;
      break;
    }
    case "statutory-missing":
      addEmployeeFilters(req.query, clauses, params); clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.pan_number, eu.uan, e.epf_number, e.esic_number,
                    CONCAT_WS(',', IF(COALESCE(e.pan_number,'')='', 'PAN_MISSING', NULL), IF(eu.uan IS NULL, 'UAN_MISSING', NULL), IF(COALESCE(e.esic_number,'')='', 'ESIC_MISSING', NULL)) AS missing_items
               FROM employees e LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
              WHERE ${clauses.join(" AND ")}
                AND (COALESCE(e.pan_number,'')='' OR eu.uan IS NULL OR COALESCE(e.esic_number,'')='')
              ORDER BY employee_name`;
      break;
    case "bank-missing":
      addEmployeeFilters(req.query, clauses, params); clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    CASE WHEN ebd.id IS NULL THEN 'MISSING_BANK' WHEN COALESCE(ebd.verified,0)=0 THEN 'UNVERIFIED_BANK' ELSE 'OK' END AS bank_status
               FROM employees e LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
              WHERE ${clauses.join(" AND ")}
                AND (ebd.id IS NULL OR COALESCE(ebd.verified,0)=0)
              ORDER BY bank_status DESC, employee_name`;
      break;
    case "increment-requests":
      sql = `SELECT sir.id, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    sir.current_ctc, sir.proposed_ctc, sir.increment_percentage, sir.effective_from, sir.status,
                    sir.communication_status, sir.letter_status, sir.created_at
               FROM salary_increment_request sir JOIN employees e ON e.id = sir.employee_id
              ORDER BY sir.created_at DESC`;
      break;
    case "cosec-unmapped":
      sql = `SELECT ibd.employee_code, ibd.activity_date, ibd.first_punch, ibd.last_punch, ibd.biometric_minutes
               FROM integration_biometric_daily ibd
               LEFT JOIN employees e ON e.employee_code = ibd.employee_code
              WHERE e.id IS NULL
              ORDER BY ibd.activity_date DESC, ibd.employee_code`;
      break;
    default:
      return res.status(404).json({ success: false, message: "Unknown report code", available: CATALOG });
  }

  const data = await queryRows(sql, params, limit);
  return res.json({ success: true, code, data, meta: { count: data.length, limit } });
}));
