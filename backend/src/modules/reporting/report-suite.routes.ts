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

function humanizeCode(code: string) {
  return code
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackReport(code: string) {
  return {
    sql: `SELECT
            ? AS report_code,
            ? AS report_name,
            'PENDING_DATA_BUILDER' AS report_status,
            'This report tile is available in HRMS, but its dedicated backend data builder is not configured yet.' AS note,
            NOW() AS generated_at`,
    params: [code, humanizeCode(code)],
  };
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
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name
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

    // ─── A1: HR & Workforce ───────────────────────────────────────────────────
    case "org-structure-snapshot":
      sql = `SELECT b.branch_name, d.dept_name AS department_name, p.process_name,
                    COUNT(e.id) AS headcount,
                    SUM(CASE WHEN e.reporting_manager_id IS NOT NULL OR e.manager_id IS NOT NULL THEN 1 ELSE 0 END) AS with_manager,
                    SUM(CASE WHEN e.reporting_manager_id IS NULL AND e.manager_id IS NULL THEN 1 ELSE 0 END) AS without_manager
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE e.active_status = 1 AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
              GROUP BY b.branch_name, d.dept_name, p.process_name
              ORDER BY b.branch_name, d.dept_name, p.process_name`;
      break;

    case "cost-centre-headcount":
      sql = `SELECT cc.cost_centre_code, cc.cost_centre_name, b.branch_name,
                    COUNT(e.id) AS active_headcount
               FROM employees e
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE e.active_status = 1 AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
              GROUP BY cc.cost_centre_code, cc.cost_centre_name, b.branch_name
              ORDER BY cc.cost_centre_name`;
      break;

    case "confirmation-due-list": {
      const days = Number(req.query.days ?? 30);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining, ep.probation_end_date,
                    DATEDIFF(ep.probation_end_date, CURDATE()) AS days_remaining,
                    b.branch_name, d.dept_name AS department_name
               FROM employees e
               JOIN employee_probation ep ON ep.employee_id = e.id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE e.active_status = 1
                AND ep.status = 'active'
                AND ep.probation_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
              ORDER BY ep.probation_end_date ASC`;
      params.push(days);
      break;
    }

    case "contract-expiry-list": {
      const days = Number(req.query.days ?? 60);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining, ec.contract_end_date, ec.contract_type,
                    DATEDIFF(ec.contract_end_date, CURDATE()) AS days_to_expiry,
                    e.employment_type, b.branch_name, d.dept_name AS department_name
               FROM employees e
               JOIN employee_contract ec ON ec.employee_id = e.id AND ec.status = 'active'
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE e.active_status = 1
                AND ec.contract_end_date IS NOT NULL
                AND ec.contract_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
              ORDER BY ec.contract_end_date ASC`;
      params.push(days);
      break;
    }

    case "lifecycle-events": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ele.effective_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ele.event_type, ele.effective_date AS event_date,
                    ele.old_value_json AS old_value, ele.new_value_json AS new_value, ele.remarks,
                    COALESCE(NULLIF(actor.full_name,''), CONCAT(actor.first_name,' ',COALESCE(actor.last_name,''))) AS actor_name
               FROM employee_lifecycle_event ele
               JOIN employees e ON e.id = ele.employee_id
               LEFT JOIN employees actor ON actor.id = ele.initiated_by
              WHERE ${clauses.join(" AND ")}
              ORDER BY ele.effective_date DESC`;
      break;
    }

    case "increment-promotion-history": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ejh.effective_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ejh.change_type, ejh.effective_date,
                    fd.designation_name AS old_designation, td.designation_name AS new_designation,
                    ejh.from_ctc_annual AS old_ctc, ejh.to_ctc_annual AS new_ctc,
                    ejh.reason AS remarks
               FROM employee_job_history ejh
               JOIN employees e ON e.id = ejh.employee_id
               LEFT JOIN designation_master fd ON fd.id = ejh.from_designation_id
               LEFT JOIN designation_master td ON td.id = ejh.to_designation_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ejh.effective_date DESC`;
      break;
    }

    case "birthday-list":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "e.date_of_birth IS NOT NULL");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_birth,
                    DATE_FORMAT(e.date_of_birth, '%d %b') AS birthday_display,
                    DATEDIFF(
                      DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_birth), '-', DAY(e.date_of_birth))),
                      CURDATE()
                    ) + IF(
                      DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_birth), '-', DAY(e.date_of_birth))) < CURDATE(), 365, 0
                    ) AS days_until_birthday,
                    b.branch_name, d.dept_name AS department_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY days_until_birthday ASC`;
      break;

    case "anniversary-list":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "e.date_of_joining IS NOT NULL");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining,
                    TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS years_of_service,
                    DATEDIFF(
                      DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_joining), '-', DAY(e.date_of_joining))),
                      CURDATE()
                    ) + IF(
                      DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_joining), '-', DAY(e.date_of_joining))) < CURDATE(), 365, 0
                    ) AS days_until_anniversary,
                    b.branch_name, d.dept_name AS department_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY days_until_anniversary ASC`;
      break;

    // ─── A2: Attendance ───────────────────────────────────────────────────────
    case "daily-hc-shift": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, COALESCE(ws.shift_name, 'Unassigned') AS shift_name,
                    SUM(adr.attendance_status IN ('present','half_day')) AS present_count,
                    SUM(adr.attendance_status = 'absent') AS absent_count,
                    SUM(adr.late_mark = 1) AS late_count,
                    COUNT(*) AS total_count
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
                 AND wra.roster_date = adr.record_date
               LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY adr.record_date, ws.shift_name
              ORDER BY adr.record_date DESC, shift_name`;
      break;
    }

    case "shift-adherence-detail": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(ws.shift_name, 'Unassigned') AS roster_shift,
                    ws.start_time AS shift_start,
                    adr.attendance_status,
                    adr.late_mark,
                    adr.late_by_minutes,
                    CASE WHEN adr.late_mark = 1 THEN 'LATE' WHEN adr.attendance_status = 'absent' THEN 'ABSENT' ELSE 'ON_TIME' END AS adherence_status
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
                 AND wra.roster_date = adr.record_date
               LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, adherence_status DESC`;
      break;
    }

    case "attendance-register-grid": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    adr.record_date,
                    CASE
                      WHEN adr.attendance_status = 'present' THEN 'P'
                      WHEN adr.attendance_status = 'half_day' THEN 'HD'
                      WHEN adr.attendance_status = 'absent' THEN 'A'
                      WHEN adr.attendance_status = 'leave_approved' THEN 'L'
                      WHEN adr.attendance_status = 'week_off' THEN 'WO'
                      WHEN adr.attendance_status = 'holiday' THEN 'H'
                      ELSE UPPER(SUBSTRING(COALESCE(adr.attendance_status,'A'),1,3))
                    END AS day_status,
                    adr.late_mark, adr.lwp_value
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, adr.record_date`;
      break;
    }

    case "overtime-summary": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    b.branch_name, d.dept_name AS department_name,
                    ROUND(SUM(COALESCE(spl2.overtime_pay,0)), 0) AS total_overtime_pay,
                    COUNT(DISTINCT adr.record_date) AS days_attended
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN salary_prep_line spl2 ON spl2.employee_id = e.id
               LEFT JOIN salary_prep_run spr2 ON spr2.id = spl2.run_id AND spr2.run_month = ?
              WHERE ${clauses.join(" AND ")} AND COALESCE(spl2.overtime_pay, 0) > 0
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name, b.branch_name, d.dept_name
              ORDER BY total_overtime_pay DESC`;
      params.push(month);
      break;
    }

    case "habitual-absentee-list": {
      const month = monthParam(req.query.month);
      const threshold = Number(req.query.threshold ?? 3);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    b.branch_name, d.dept_name AS department_name,
                    SUM(adr.attendance_status = 'absent') AS absent_days,
                    SUM(adr.lwp_value) AS lwp_days,
                    COUNT(*) AS total_working_days,
                    ROUND(SUM(adr.attendance_status = 'absent') / COUNT(*) * 100, 1) AS absent_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name, b.branch_name, d.dept_name
              HAVING absent_days >= ?
              ORDER BY absent_days DESC`;
      params.push(threshold);
      break;
    }

    case "daily-shrinkage-report": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, b.branch_name, p.process_name,
                    COUNT(*) AS total_scheduled,
                    SUM(adr.attendance_status IN ('present','half_day')) AS present_hc,
                    COUNT(*) - SUM(adr.attendance_status IN ('present','half_day')) AS absent_hc,
                    ROUND((COUNT(*) - SUM(adr.attendance_status IN ('present','half_day'))) / COUNT(*) * 100, 2) AS shrinkage_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY adr.record_date, b.branch_name, p.process_name
              ORDER BY adr.record_date DESC, shrinkage_pct DESC`;
      break;
    }

    case "monthly-shrinkage-trend": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(adr.record_date,'%Y-%m') AS month, b.branch_name, p.process_name,
                    COUNT(*) AS total_scheduled,
                    SUM(adr.attendance_status IN ('present','half_day')) AS present_hc,
                    ROUND((COUNT(*) - SUM(adr.attendance_status IN ('present','half_day'))) / COUNT(*) * 100, 2) AS avg_shrinkage_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), b.branch_name, p.process_name
              ORDER BY month DESC, avg_shrinkage_pct DESC`;
      break;
    }

    case "punch-raw-export": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      clauses.push("ibd.activity_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT ibd.employee_code, e.biometric_code, ibd.activity_date,
                    ibd.first_punch, ibd.last_punch, ibd.biometric_minutes, ibd.total_punches
               FROM integration_biometric_daily ibd
               LEFT JOIN employees e ON e.employee_code = ibd.employee_code
              WHERE ${clauses.join(" AND ")}
              ORDER BY ibd.activity_date DESC, ibd.employee_code`;
      break;
    }

    // ─── A3: Leave ────────────────────────────────────────────────────────────
    case "leave-allocation-register": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lbl.balance_year = ?"); params.push(year);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    lt.leave_code, lt.leave_name, lbl.allocated_days, lbl.adjusted_days,
                    lbl.used_days, (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS remaining_days,
                    b.branch_name
               FROM leave_balance_ledger lbl
               JOIN employees e ON e.id = lbl.employee_id
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, lt.leave_code`;
      break;
    }

    case "leave-trend-monthly": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("lr.from_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(lr.from_date,'%Y-%m') AS month, lt.leave_code, lt.leave_name,
                    COUNT(*) AS applications_count,
                    SUM(CASE WHEN lr.status = 'approved' THEN lr.total_days ELSE 0 END) AS approved_days,
                    SUM(CASE WHEN lr.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
               FROM leave_request lr
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY DATE_FORMAT(lr.from_date,'%Y-%m'), lt.leave_code, lt.leave_name
              ORDER BY month DESC, lt.leave_code`;
      break;
    }

    case "leave-lwp-reconciliation": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    SUM(adr.lwp_value) AS lwp_days_attendance,
                    COALESCE(spl.lwp_days, 0) AS lwp_days_payroll,
                    SUM(adr.lwp_value) - COALESCE(spl.lwp_days, 0) AS variance
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN salary_prep_run spr ON spr.run_month = ?
               LEFT JOIN salary_prep_line spl ON spl.employee_id = e.id AND spl.run_id = spr.id
              WHERE ${clauses.join(" AND ")} AND adr.lwp_value > 0
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name, spl.lwp_days
              HAVING lwp_days_attendance > 0
              ORDER BY ABS(variance) DESC`;
      params.push(month);
      break;
    }

    case "maternity-paternity-register": {
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lt.leave_code IN ('MAT','PAT','MATERNITY','PATERNITY','ML','PL')");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.gender, lt.leave_code, lt.leave_name,
                    lr.from_date AS start_date, lr.to_date AS end_date, lr.total_days,
                    lr.status, lr.created_at AS applied_on
               FROM leave_request lr
               JOIN employees e ON e.id = lr.employee_id
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lr.from_date DESC`;
      break;
    }

    case "leave-lapse-summary": {
      const currentYear = new Date().getFullYear();
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lbl.balance_year < ?"); params.push(currentYear);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    lt.leave_code, lt.leave_name, lbl.balance_year,
                    GREATEST(lbl.allocated_days + lbl.adjusted_days - lbl.used_days, 0) AS lapsed_days
               FROM leave_balance_ledger lbl
               JOIN employees e ON e.id = lbl.employee_id
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
              WHERE ${clauses.join(" AND ")}
                AND (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) > 0
              ORDER BY employee_name, lbl.balance_year`;
      break;
    }

    case "holiday-master-list": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      sql = `SELECT lhm.holiday_date, lhm.holiday_name, lhm.holiday_type,
                    lhm.active_status, b.branch_name
               FROM leave_holiday_master lhm
               LEFT JOIN branch_master b ON b.id = lhm.branch_id
              WHERE YEAR(lhm.holiday_date) = ?
              ORDER BY lhm.holiday_date ASC`;
      params.push(year);
      break;
    }

    // ─── A4: Payroll ─────────────────────────────────────────────────────────
    case "ytd-salary-summary": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("YEAR(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d')) = ?"); params.push(year);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    b.branch_name, d.dept_name AS department_name,
                    COUNT(DISTINCT spr.run_month) AS months_paid,
                    SUM(spl.gross_salary) AS ytd_gross,
                    SUM(spl.basic) AS ytd_basic,
                    SUM(spl.pf_employee) AS ytd_pf,
                    SUM(spl.tds_amount) AS ytd_tds,
                    SUM(spl.net_salary) AS ytd_net
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name, b.branch_name, d.dept_name
              ORDER BY employee_name`;
      break;
    }

    case "cost-centre-salary-summary": {
      const month = monthParam(req.query.month);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'Unassigned') AS cost_centre_name,
                    COUNT(spl.id) AS headcount,
                    SUM(spl.gross_salary) AS total_gross,
                    SUM(spl.net_salary) AS total_net,
                    ROUND(AVG(esa.ctc_annual / 12), 0) AS avg_ctc_monthly
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
              WHERE ${clauses.join(" AND ")}
              GROUP BY cc.cost_centre_code, cc.cost_centre_name
              ORDER BY total_gross DESC`;
      break;
    }

    case "process-lob-salary-cost": {
      const month = monthParam(req.query.month);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT p.process_name, COALESCE(l.lob_name, 'N/A') AS lob_name,
                    COUNT(spl.id) AS headcount,
                    SUM(spl.gross_salary) AS total_gross,
                    SUM(spl.net_salary) AS total_net,
                    ROUND(AVG(spl.net_salary), 0) AS avg_net
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN lob_master l ON l.id = e.lob_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, l.lob_name
              ORDER BY total_gross DESC`;
      break;
    }

    case "salary-advance-register":
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    sal.advance_date, sal.advance_amount, sal.recovery_start_month,
                    sal.total_recovered, sal.outstanding_amount, sal.status, sal.remarks
               FROM salary_advance_log sal
               JOIN employees e ON e.id = sal.employee_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY sal.advance_date DESC`;
      break;

    case "lwp-deduction-register": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    spr.run_month, spl.lwp_days, spl.lwp_deduction AS lwp_deduction_amount,
                    spl.gross_salary, spl.net_salary, b.branch_name
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")} AND spl.lwp_days > 0
              ORDER BY spl.lwp_days DESC`;
      break;
    }

    case "bank-change-requests":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ebd.verified = 0");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ebd.bank_name, ebd.account_number, ebd.ifsc_code, ebd.account_holder_name,
                    ebd.is_primary, ebd.created_at AS requested_at
               FROM employee_bank_detail ebd
               JOIN employees e ON e.id = ebd.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ebd.created_at DESC`;
      break;

    case "payroll-audit-trail": {
      const month = monthParam(req.query.month);
      sql = `SELECT spr.id AS run_id, spr.run_month, spr.status AS run_status,
                    spr.created_at, spr.disbursed_at,
                    COALESCE(NULLIF(creator.full_name,''), CONCAT(creator.first_name,' ',COALESCE(creator.last_name,''))) AS created_by,
                    COALESCE(NULLIF(approver.full_name,''), CONCAT(approver.first_name,' ',COALESCE(approver.last_name,''))) AS approved_by,
                    COUNT(spl.id) AS line_count,
                    SUM(spl.net_salary) AS total_net
               FROM salary_prep_run spr
               LEFT JOIN employees creator ON creator.id = spr.created_by
               LEFT JOIN employees approver ON approver.id = spr.approved_by
               LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
              WHERE spr.run_month = ?
              GROUP BY spr.id, spr.run_month, spr.status, spr.created_at, spr.disbursed_at,
                       creator.full_name, creator.first_name, creator.last_name,
                       approver.full_name, approver.first_name, approver.last_name
              ORDER BY spr.created_at DESC`;
      params.push(month);
      break;
    }

    case "pf-esi-optout-register":
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    eso.override_type AS opt_out_type,
                    eso.effective_from_month AS effective_month,
                    eso.status, eso.approved_at, eso.audit_note AS reason
               FROM employee_statutory_override eso
               JOIN employees e ON e.id = eso.employee_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY employee_name, eso.override_type`;
      break;

    case "grade-salary-distribution": {
      const month = monthParam(req.query.month);
      sql = `SELECT COALESCE(CONCAT(gb.grade_code,' - ',gb.grade_name), 'Ungraded') AS grade_band,
                    COUNT(DISTINCT e.id) AS headcount,
                    ROUND(AVG(esa.ctc_annual / 12), 0) AS avg_ctc_monthly,
                    MIN(esa.ctc_annual / 12) AS min_ctc_monthly,
                    MAX(esa.ctc_annual / 12) AS max_ctc_monthly,
                    SUM(COALESCE(spl.net_salary, 0)) AS total_net_paid
               FROM employees e
               LEFT JOIN grade_band_master gb ON gb.id = e.grade_id
               LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
               LEFT JOIN salary_prep_line spl ON spl.employee_id = e.id
               LEFT JOIN salary_prep_run spr ON spr.id = spl.run_id AND spr.run_month = ?
              WHERE e.active_status = 1
              GROUP BY gb.grade_code, gb.grade_name
              ORDER BY avg_ctc_monthly DESC`;
      params.push(month);
      break;
    }

    case "neft-transfer-file": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      clauses.push("spl.net_salary > 0");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ebd.bank_name, ebd.account_number, ebd.ifsc_code, ebd.account_holder_name, ebd.account_type,
                    spl.net_salary AS transfer_amount, spr.run_month
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
              WHERE ${clauses.join(" AND ")}
              ORDER BY ebd.bank_name, employee_name`;
      break;
    }

    // ─── A5: Statutory ────────────────────────────────────────────────────────
    case "pf-ecr-export": {
      const month = monthParam(req.query.month);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT eu.uan AS UAN, eu.member_id AS PF_member_id,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS member_name,
                    spl.gross_salary AS gross_wages,
                    LEAST(COALESCE(spl.basic, 0), 15000) AS epf_wages,
                    LEAST(COALESCE(spl.basic, 0), 15000) AS eps_wages,
                    COALESCE(spl.pf_employee, 0) AS ee_pf_share,
                    COALESCE(spl.pf_employer, 0) AS er_pf_share,
                    ROUND(COALESCE(spl.pf_employer,0) * 8.33/12, 0) AS eps_share,
                    e.date_of_joining, e.date_of_birth, e.gender,
                    spr.run_month
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
              WHERE ${clauses.join(" AND ")} AND COALESCE(spl.pf_employee,0) > 0
              ORDER BY eu.uan`;
      break;
    }

    case "pf-monthly-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT spr.run_month,
                    COUNT(DISTINCT spl.employee_id) AS total_employees,
                    SUM(spl.pf_employee) AS total_ee_pf,
                    SUM(spl.pf_employer) AS total_er_pf,
                    SUM(COALESCE(spl.eps_employer,0)) AS total_eps,
                    SUM(spl.pf_employee) + SUM(spl.pf_employer) AS total_pf_contribution
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE spl.pf_employee > 0
                AND STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d') BETWEEN ? AND ?
              GROUP BY spr.run_month
              ORDER BY spr.run_month DESC`;
      params.push(from, to);
      break;
    }

    case "uan-master-register":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "eu.uan IS NOT NULL");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    eu.uan, e.epf_number, eu.member_id AS pf_member_id,
                    e.date_of_joining AS pf_joining_date, e.date_of_birth, e.gender,
                    b.branch_name
               FROM employees e
               JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name`;
      break;

    case "esic-monthly-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT spr.run_month,
                    COUNT(DISTINCT spl.employee_id) AS total_employees,
                    SUM(spl.esic_employee) AS total_ee_esic,
                    SUM(spl.esic_employer) AS total_er_esic,
                    SUM(spl.esic_employee) + SUM(spl.esic_employer) AS total_esic_contribution
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE spl.esic_employee > 0
                AND STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d') BETWEEN ? AND ?
              GROUP BY spr.run_month
              ORDER BY spr.run_month DESC`;
      params.push(from, to);
      break;
    }

    case "pt-monthly-register": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(e.state, 'Unknown') AS state,
                    spl.gross_salary, spl.professional_tax AS pt_deducted, spr.run_month
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
              WHERE ${clauses.join(" AND ")} AND spl.professional_tax > 0
              ORDER BY e.state, employee_name`;
      break;
    }

    case "tds-working-sheet": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("YEAR(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d')) = ?"); params.push(year);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.pan_number,
                    SUM(spl.gross_salary) AS gross_ytd,
                    SUM(spl.net_salary) AS net_ytd,
                    SUM(spl.tds_amount) AS tds_deducted_ytd,
                    COUNT(DISTINCT spr.run_month) AS months
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.pan_number
              HAVING SUM(spl.tds_amount) > 0
              ORDER BY tds_deducted_ytd DESC`;
      break;
    }

    case "gratuity-liability-register":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "e.date_of_joining IS NOT NULL");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining,
                    TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS tenure_years,
                    ROUND(TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) / 12, 2) AS tenure_years_exact,
                    COALESCE(sca.basic, esa.ctc_annual / 12 * 0.4, 0) AS last_drawn_basic,
                    ROUND(COALESCE(sca.basic, esa.ctc_annual / 12 * 0.4, 0)
                          * (TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) / 12)
                          * (15.0 / 26.0), 0) AS gratuity_liability,
                    b.branch_name
               FROM employees e
               LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
               LEFT JOIN salary_component_assignments sca ON sca.employee_id = e.id
                 AND sca.status = 'active'
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")} AND TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) >= 5
              ORDER BY gratuity_liability DESC`;
      break;

    case "statutory-compliance-calendar": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      // Generate a virtual compliance calendar from known monthly filing obligations
      // using salary_prep_run data as the source of payroll months
      sql = `SELECT spr.run_month AS compliance_month,
                    'PAYROLL_FILING' AS compliance_type,
                    DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m-15') AS pf_due_date,
                    DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m-15') AS esic_due_date,
                    spr.status AS run_status,
                    spr.total_employees,
                    SUM(spl.pf_employee) + SUM(spl.pf_employer) AS total_pf,
                    SUM(spl.esic_employee) + SUM(spl.esic_employer) AS total_esic,
                    SUM(spl.professional_tax) AS total_pt
               FROM salary_prep_run spr
               LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
              WHERE YEAR(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d')) = ?
              GROUP BY spr.id, spr.run_month, spr.status, spr.total_employees
              ORDER BY spr.run_month ASC`;
      params.push(year);
      break;
    }

    // ─── A6: ATS / Recruitment ────────────────────────────────────────────────
    case "ats-pipeline-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT stage, COUNT(*) AS candidate_count,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
                    SUM(CASE WHEN status IN ('withdrawn','rejected','no_show') THEN 1 ELSE 0 END) AS dropped_count
               FROM ats_candidate
              WHERE created_at BETWEEN ? AND ?
              GROUP BY stage
              ORDER BY FIELD(stage,'applied','screening','shortlisted','interview_1','interview_2','interview_3','offer','offered','onboarded','joined') , stage`;
      params.push(from, to);
      break;
    }

    case "candidate-source-analysis": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT COALESCE(ac.source_channel, 'Unknown') AS source_name,
                    COUNT(*) AS total_candidates,
                    SUM(CASE WHEN ac.stage IN ('offered','offer','onboarded','joined') THEN 1 ELSE 0 END) AS reached_offer,
                    SUM(CASE WHEN ac.stage IN ('onboarded','joined') THEN 1 ELSE 0 END) AS joined,
                    ROUND(SUM(CASE WHEN ac.stage IN ('onboarded','joined') THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS joining_rate_pct
               FROM ats_candidate ac
              WHERE ac.created_at BETWEEN ? AND ?
              GROUP BY ac.source_channel
              ORDER BY total_candidates DESC`;
      params.push(from, to);
      break;
    }

    case "offer-to-joining-tracker": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile, ac.email,
                    aob.bridge_date AS offer_date, aob.joining_date AS offered_doj,
                    e.date_of_joining AS actual_doj,
                    DATEDIFF(e.date_of_joining, aob.joining_date) AS doj_variance_days,
                    aob.status AS onboarding_status
               FROM ats_onboarding_bridge aob
               JOIN ats_candidate ac ON ac.id = aob.candidate_id
               LEFT JOIN employees e ON e.id = aob.employee_id
              WHERE aob.created_at BETWEEN ? AND ?
              ORDER BY aob.bridge_date DESC`;
      params.push(from, to);
      break;
    }

    case "bgv-status-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    br.overall_status AS bgv_status, br.bgv_score,
                    br.created_at AS initiated_date,
                    br.completed_at AS completed_date,
                    br.locked AS is_locked
               FROM candidate_bgv_report br
               JOIN ats_candidate ac ON ac.id = br.candidate_id
              WHERE br.created_at BETWEEN ? AND ?
              ORDER BY br.created_at DESC`;
      params.push(from, to);
      break;
    }

    case "recruiter-performance-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT COALESCE(ac.recruiter_name, 'Unassigned') AS recruiter_name,
                    ac.recruiter_email,
                    COUNT(*) AS total_sourced,
                    SUM(CASE WHEN ac.stage NOT IN ('applied','screening') THEN 1 ELSE 0 END) AS shortlisted,
                    SUM(CASE WHEN ac.stage IN ('offered','offer','onboarded','joined') THEN 1 ELSE 0 END) AS offered,
                    SUM(CASE WHEN ac.stage IN ('onboarded','joined') THEN 1 ELSE 0 END) AS joined,
                    ROUND(SUM(CASE WHEN ac.stage IN ('onboarded','joined') THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0) * 100, 1) AS conversion_rate_pct
               FROM ats_candidate ac
              WHERE ac.created_at BETWEEN ? AND ?
              GROUP BY ac.recruiter_name, ac.recruiter_email
              ORDER BY joined DESC, total_sourced DESC`;
      params.push(from, to);
      break;
    }

    case "interview-slot-utilization": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ais.slot_date, ais.slot_time,
                    b.branch_name, p.process_name,
                    ais.max_capacity AS total_slots,
                    ais.registered AS booked_slots,
                    ais.max_capacity - ais.registered AS available_slots,
                    ROUND(ais.registered / NULLIF(ais.max_capacity,0) * 100, 1) AS utilization_pct
               FROM ats_interview_slot ais
               LEFT JOIN branch_master b ON b.id = ais.branch_id
               LEFT JOIN process_master p ON p.id = ais.process_id
              WHERE ais.slot_date BETWEEN ? AND ?
              ORDER BY ais.slot_date DESC`;
      params.push(from, to);
      break;
    }

    case "onboarding-doc-checklist": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name,
                    ed.doc_type, ed.doc_name,
                    CASE WHEN ed.file_url IS NOT NULL AND ed.file_url != '' THEN 'Submitted' ELSE 'Missing' END AS submitted_status,
                    CASE WHEN ed.verified = 1 THEN 'Verified' WHEN ed.file_url IS NOT NULL THEN 'Pending Verification' ELSE 'Not Submitted' END AS verification_status
               FROM ats_onboarding_bridge aob
               JOIN ats_candidate ac ON ac.id = aob.candidate_id
               LEFT JOIN employees e ON e.id = aob.employee_id
               LEFT JOIN employee_documents ed ON ed.employee_id = e.id
              WHERE aob.created_at BETWEEN ? AND ?
              ORDER BY ac.full_name, ed.doc_type`;
      params.push(from, to);
      break;
    }

    case "ats-offer-tat": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    MIN(CASE WHEN csl.to_stage = 'applied' THEN csl.created_at END) AS applied_date,
                    MIN(CASE WHEN csl.to_stage = 'shortlisted' THEN csl.created_at END) AS shortlisted_date,
                    MIN(CASE WHEN csl.to_stage IN ('offered','offer') THEN csl.created_at END) AS offered_date,
                    DATEDIFF(MIN(CASE WHEN csl.to_stage IN ('offered','offer') THEN csl.created_at END),
                             MIN(CASE WHEN csl.to_stage = 'applied' THEN csl.created_at END)) AS tat_days
               FROM ats_candidate ac
               LEFT JOIN ats_candidate_stage_log csl ON csl.candidate_id = ac.id
              WHERE ac.created_at BETWEEN ? AND ?
              GROUP BY ac.id, ac.candidate_code, ac.full_name, ac.mobile
              HAVING offered_date IS NOT NULL
              ORDER BY tat_days DESC`;
      params.push(from, to);
      break;
    }

    // ─── A7: Exit & Attrition ─────────────────────────────────────────────────
    case "exit-movement-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("er.submitted_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    er.submitted_at AS resignation_date,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    er.exit_type, er.exit_reason_category AS exit_reason,
                    er.status AS exit_status, b.branch_name, d.dept_name AS department_name, p.process_name,
                    TIMESTAMPDIFF(MONTH, e.date_of_joining,
                      COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed)) AS tenure_months
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY er.submitted_at DESC`;
      break;
    }

    case "notice-period-adherence": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    er.submitted_at AS resignation_date,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    ffc.notice_period_days AS notice_required,
                    DATEDIFF(COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed), er.submitted_at) AS notice_served,
                    GREATEST(ffc.notice_period_days - DATEDIFF(
                      COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed),
                      er.submitted_at), 0) AS shortfall_days,
                    COALESCE(ffc.notice_recovery, 0) AS recovery_amount
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN full_final_calculation ffc ON ffc.exit_request_id = er.id
              WHERE er.submitted_at BETWEEN ? AND ?
              ORDER BY shortfall_days DESC`;
      params.push(from, to);
      break;
    }

    case "exit-interview-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT COALESCE(er.exit_reason_category, 'Not Specified') AS exit_reason,
                    b.branch_name, p.process_name,
                    COUNT(*) AS exit_count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total,
                    ROUND(AVG(TIMESTAMPDIFF(MONTH, e.date_of_joining,
                      COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed))), 1) AS avg_tenure_months
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE er.submitted_at BETWEEN ? AND ?
              GROUP BY er.exit_reason_category, b.branch_name, p.process_name
              ORDER BY exit_count DESC`;
      params.push(from, to);
      break;
    }

    case "monthly-attrition-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT DATE_FORMAT(ar.exit_date,'%Y-%m') AS month,
                    COUNT(*) AS exits,
                    b.branch_name,
                    ROUND(COUNT(*) / NULLIF(
                      (SELECT COUNT(*) FROM employees e2 WHERE e2.active_status = 1),
                    0) * 100, 2) AS attrition_rate_pct
               FROM attrition_record ar
               LEFT JOIN employees e ON e.id = ar.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ar.exit_date BETWEEN ? AND ?
              GROUP BY DATE_FORMAT(ar.exit_date,'%Y-%m'), b.branch_name
              ORDER BY month DESC`;
      params.push(from, to);
      break;
    }

    case "ff-settlement-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    ffc.notice_recovery, ffc.earned_leave_encashment AS leave_encashment,
                    ffc.gratuity_amount, ffc.advances_recovery, ffc.salary_hold,
                    ffc.net_payable AS net_ff_payable,
                    ffc.status, ffc.is_ff_provisional
               FROM full_final_calculation ffc
               JOIN exit_request er ON er.id = ffc.exit_request_id
               JOIN employees e ON e.id = er.employee_id
              WHERE COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) BETWEEN ? AND ?
              ORDER BY COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) DESC`;
      params.push(from, to);
      break;
    }

    case "clearance-status-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    d.dept_name AS department_name,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    ecc.department AS clearance_department,
                    ecc.status AS clearance_status,
                    ecc.assigned_to, ecc.cleared_at, ecc.remarks
               FROM exit_clearance_checklist ecc
               JOIN exit_request er ON er.id = ecc.exit_request_id
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE er.submitted_at BETWEEN ? AND ?
              ORDER BY e.employee_code, ecc.department`;
      params.push(from, to);
      break;
    }

    // ─── A8: Performance & KPI ────────────────────────────────────────────────
    case "kpi-score-summary": {
      const period = String(req.query.period ?? "");
      addEmployeeFilters(req.query, clauses, params);
      if (period) { clauses.push("ksp.id = ?"); params.push(period); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name,
                    CONCAT(ksp.period_type,' ',ksp.period_start,' to ',ksp.period_end) AS period_label,
                    kss.final_score, kss.rating,
                    kss.rank_in_team, kss.rank_in_process, kss.rank_in_branch
               FROM kpi_score_summary kss
               JOIN employees e ON e.id = kss.employee_id
               JOIN kpi_score_period ksp ON ksp.id = kss.period_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY kss.final_score DESC`;
      break;
    }

    case "kpi-leaderboard": {
      const period = String(req.query.period ?? "");
      addEmployeeFilters(req.query, clauses, params);
      if (period) { clauses.push("ksp.id = ?"); params.push(period); }
      sql = `SELECT kss.rank_in_process AS rank_no, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name,
                    CONCAT(ksp.period_type,' ',ksp.period_start,' to ',ksp.period_end) AS period_label,
                    kss.final_score, kss.rating
               FROM kpi_score_summary kss
               JOIN employees e ON e.id = kss.employee_id
               JOIN kpi_score_period ksp ON ksp.id = kss.period_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY kss.rank_in_process ASC, kss.final_score DESC`;
      break;
    }

    case "below-target-kpi": {
      const period = String(req.query.period ?? "");
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("LOWER(kss.rating) IN ('below target','needs improvement','poor','unsatisfactory')");
      if (period) { clauses.push("ksp.id = ?"); params.push(period); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name,
                    CONCAT(ksp.period_type,' ',ksp.period_start,' to ',ksp.period_end) AS period_label,
                    kss.final_score, kss.rating,
                    100 - kss.final_score AS gap_from_target
               FROM kpi_score_summary kss
               JOIN employees e ON e.id = kss.employee_id
               JOIN kpi_score_period ksp ON ksp.id = kss.period_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY kss.final_score ASC`;
      break;
    }

    case "appraisal-rating-summary": {
      const cycle = String(req.query.cycle ?? "");
      if (cycle) { clauses.push("pfr.cycle_id = ?"); params.push(cycle); }
      sql = `SELECT
                    CASE
                      WHEN pfr.overall_score >= 4.5 THEN 'Outstanding'
                      WHEN pfr.overall_score >= 3.5 THEN 'Exceeds Expectations'
                      WHEN pfr.overall_score >= 2.5 THEN 'Meets Expectations'
                      WHEN pfr.overall_score >= 1.5 THEN 'Needs Improvement'
                      ELSE 'Unsatisfactory'
                    END AS rating,
                    COUNT(*) AS employee_count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total,
                    ROUND(AVG(pfr.overall_score), 2) AS avg_score
               FROM performance_feedback_report pfr
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY rating
              ORDER BY avg_score DESC`;
      break;
    }

    case "pip-register":
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    dp.overall_notes AS plan_notes,
                    dp.plan_start_date AS pip_start, dp.plan_end_date AS pip_end,
                    dp.status,
                    COUNT(dpg.goal_id) AS goal_count,
                    SUM(CASE WHEN dpg.status = 'completed' THEN 1 ELSE 0 END) AS completed_goals
               FROM development_plan dp
               JOIN employees e ON e.id = dp.employee_id
               LEFT JOIN development_plan_goal dpg ON dpg.plan_id = dp.plan_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY dp.plan_id, e.employee_code, e.full_name, e.first_name, e.last_name,
                       dp.overall_notes, dp.plan_start_date, dp.plan_end_date, dp.status
              ORDER BY dp.plan_start_date DESC`;
      break;

    // ─── A9: WFM & Roster ─────────────────────────────────────────────────────
    case "roster-adherence": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(ws.shift_name, 'Unassigned') AS roster_shift,
                    adr.attendance_status, adr.late_mark,
                    CASE WHEN adr.attendance_status IN ('present','half_day') AND adr.late_mark = 0 THEN 'Y'
                         WHEN adr.attendance_status IN ('present','half_day') AND adr.late_mark = 1 THEN 'LATE'
                         ELSE 'N' END AS adherent
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
                 AND wra.roster_date = adr.record_date
               LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, employee_name`;
      break;
    }

    case "workforce-mandate-vs-actual": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, p.process_name, b.branch_name,
                    COALESCE(wm.mandated_hc, 0) AS mandated_hc,
                    SUM(adr.attendance_status IN ('present','half_day')) AS actual_hc,
                    COALESCE(wm.mandated_hc, 0) - SUM(adr.attendance_status IN ('present','half_day')) AS gap,
                    ROUND((COALESCE(wm.mandated_hc,0) - SUM(adr.attendance_status IN ('present','half_day')))
                          / NULLIF(wm.mandated_hc,0) * 100, 1) AS gap_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN workforce_mandate wm ON wm.process_id = e.process_id
                 AND wm.effective_from <= adr.record_date
                 AND (wm.effective_to IS NULL OR wm.effective_to >= adr.record_date)
              WHERE ${clauses.join(" AND ")}
              GROUP BY adr.record_date, p.process_name, b.branch_name, wm.mandated_hc
              ORDER BY adr.record_date DESC, gap DESC`;
      break;
    }

    case "dialer-hours-report": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name,
                    adr.dialler_minutes AS net_login_minutes,
                    ROUND(adr.dialler_minutes / 60, 2) AS net_login_hours,
                    adr.attendance_status
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")} AND adr.dialler_minutes > 0
              ORDER BY adr.record_date DESC, employee_name`;
      break;
    }

    case "process-hc-vs-mandate":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT p.process_name, b.branch_name,
                    COUNT(e.id) AS current_hc,
                    COALESCE(MAX(wm.mandated_hc), 0) AS mandated_hc,
                    COALESCE(MAX(wm.mandated_hc), 0) - COUNT(e.id) AS gap
               FROM employees e
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN workforce_mandate wm ON wm.process_id = e.process_id
                 AND wm.effective_from <= CURDATE()
                 AND (wm.effective_to IS NULL OR wm.effective_to >= CURDATE())
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, b.branch_name
              ORDER BY gap DESC`;
      break;

    case "roster-change-audit": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT wrp.id AS plan_id, wrp.plan_name, wrp.plan_status AS status,
                    wrp.from_date, wrp.to_date,
                    wrp.required_headcount, wrp.assigned_headcount,
                    p.process_name, b.branch_name,
                    COALESCE(NULLIF(creator.full_name,''), CONCAT(creator.first_name,' ',COALESCE(creator.last_name,''))) AS created_by,
                    wrp.created_at AS changed_at
               FROM wfm_roster_plan wrp
               LEFT JOIN process_master p ON p.id = wrp.process_id
               LEFT JOIN branch_master b ON b.id = wrp.branch_id
               LEFT JOIN employees creator ON creator.id = wrp.created_by
              WHERE wrp.updated_at BETWEEN ? AND ?
              ORDER BY wrp.updated_at DESC`;
      params.push(from, to);
      break;
    }

    // ─── A10: Assets & Documents ──────────────────────────────────────────────
    case "asset-inventory-report":
      sql = `SELECT am.asset_code, am.asset_name, am.asset_category, am.asset_status,
                    am.purchase_cost, am.purchase_date, am.asset_condition,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS assigned_to,
                    e.employee_code AS assigned_employee_code,
                    aa.assigned_date
               FROM asset_master am
               LEFT JOIN asset_assignment aa ON aa.asset_id = am.id AND aa.returned_date IS NULL
               LEFT JOIN employees e ON e.id = aa.employee_id
              ORDER BY am.asset_category, am.asset_name`;
      break;

    case "asset-assignment-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT am.asset_code, am.asset_name, am.asset_category,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    aa.assigned_date, aa.returned_date, aa.return_condition,
                    CASE WHEN aa.returned_date IS NULL THEN 'assigned' ELSE 'returned' END AS assignment_status,
                    aa.notes AS remarks
               FROM asset_assignment aa
               JOIN asset_master am ON am.id = aa.asset_id
               LEFT JOIN employees e ON e.id = aa.employee_id
              WHERE aa.assigned_date BETWEEN ? AND ?
              ORDER BY aa.assigned_date DESC`;
      params.push(from, to);
      break;
    }

    case "employee-document-compliance":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    b.branch_name, d.dept_name AS department_name,
                    COUNT(ed.id) AS total_docs,
                    SUM(CASE WHEN ed.file_url IS NOT NULL AND ed.file_url != '' AND ed.file_url NOT LIKE 'legacy://%' THEN 1 ELSE 0 END) AS uploaded_docs,
                    SUM(CASE WHEN ed.verified = 1 THEN 1 ELSE 0 END) AS verified_docs,
                    SUM(CASE WHEN ed.file_url IS NULL OR ed.file_url = '' THEN 1 ELSE 0 END) AS missing_docs
               FROM employees e
               LEFT JOIN employee_documents ed ON ed.employee_id = e.id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, d.dept_name
              ORDER BY missing_docs DESC, employee_name`;
      break;

    case "asset-service-log":
      sql = `SELECT am.asset_code, am.asset_name, am.asset_category,
                    ams.service_date, ams.service_type, ams.performed_by,
                    ams.cost AS service_cost, ams.service_notes AS remarks
               FROM asset_service_log ams
               JOIN asset_master am ON am.id = ams.asset_id
              ORDER BY ams.service_date DESC`;
      break;

    // ─── A11: Productivity / APR ──────────────────────────────────────────────
    case "productivity-individual-scorecard": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS login_hours,
                    ROUND(SUM(adr.biometric_minutes) / 60, 2) AS biometric_hours,
                    COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END) AS present_days,
                    kss.final_score AS kpi_score, kss.rating AS kpi_rating,
                    ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, kss.final_score, kss.rating
              ORDER BY login_hours DESC`;
      params.push(month, month);
      break;
    }

    case "productivity-team-rollup": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT p.process_name, b.branch_name,
                    COUNT(DISTINCT e.id) AS headcount,
                    ROUND(SUM(adr.dialler_minutes) / 60 / NULLIF(COUNT(DISTINCT e.id),0), 2) AS avg_login_hours,
                    ROUND(AVG(kss.final_score), 2) AS avg_kpi_score
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, b.branch_name
              ORDER BY avg_kpi_score DESC`;
      params.push(month, month);
      break;
    }

    case "productivity-top-bottom-performers": {
      const month = monthParam(req.query.month);
      const tier = String(req.query.tier ?? "top");
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS login_hours,
                    ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct,
                    kss.final_score AS kpi_score,
                    ROUND(
                      ROUND(SUM(adr.dialler_minutes)/60, 2) * 0.4 + COALESCE(kss.final_score, 0) * 0.6,
                    2) AS composite_score
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, kss.final_score
              ORDER BY composite_score ${tier === "bottom" ? "ASC" : "DESC"}`;
      params.push(month, month);
      break;
    }

    case "dialer-aht-trend": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(adr.record_date,'%Y-%m') AS month, p.process_name,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS total_login_hours,
                    ROUND(SUM(adr.dialler_minutes) / NULLIF(COUNT(CASE WHEN adr.dialler_minutes > 0 THEN 1 END), 0), 1) AS avg_daily_login_minutes,
                    COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END) AS present_days
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), p.process_name
              ORDER BY month DESC, process_name`;
      break;
    }

    case "schedule-adherence-vs-kpi": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name,
                    ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct,
                    kss.final_score AS kpi_score, kss.rating,
                    CASE WHEN COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END)
                              / NULLIF(COUNT(*),0) < 0.85 AND kss.final_score < 70
                         THEN 'HIGH_RISK' ELSE 'OK' END AS correlation_flag
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, kss.final_score, kss.rating
              ORDER BY attendance_pct ASC`;
      params.push(month, month);
      break;
    }

    default: {
      const fallback = fallbackReport(code);
      sql = fallback.sql;
      params.push(...fallback.params);
      break;
    }
  }

  const data = await queryRows(sql, params, limit);
  return res.json({ success: true, code, data, meta: { count: data.length, limit, fallback: data[0]?.report_status === "PENDING_DATA_BUILDER" } });
}));
