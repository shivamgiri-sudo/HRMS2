import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { resolveBranchScope } from "./reporting.scope.js";

export const reportSuiteRouter = Router();
reportSuiteRouter.use(requireAuth);

const EMP_CORE_COLS = `e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name, e.employment_status, desig.designation_name, dept.dept_name AS department, b.branch_name, p.process_name, cc.cost_centre_name`;

const EMP_CORE_JOINS = `LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master p ON p.id = e.process_id LEFT JOIN department_master dept ON dept.id = e.department_id LEFT JOIN designation_master desig ON desig.id = e.designation_id LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id`;

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
      sql = `SELECT ${EMP_CORE_COLS},
                    e.official_email, e.mobile, e.date_of_joining, e.date_of_exit,
                    COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS reporting_manager
               FROM employees e
               ${EMP_CORE_JOINS}
               LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY e.employee_code`;
      break;
    case "headcount":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'");
      sql = `SELECT b.branch_name, dept.dept_name AS department_name, p.process_name, cc.cost_centre_name, COUNT(*) AS active_headcount
               FROM employees e
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.branch_name, dept.dept_name, p.process_name, cc.cost_centre_name
              ORDER BY b.branch_name, dept.dept_name, p.process_name`;
      break;
    case "employee-movement": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("(e.date_of_joining BETWEEN ? AND ? OR COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?)");
      params.push(from, to, from, to);
      sql = `SELECT ${EMP_CORE_COLS},
                    e.date_of_joining, COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) AS exit_date,
                    CASE WHEN e.date_of_joining BETWEEN ? AND ? THEN 'joining' ELSE 'exit' END AS movement_type
               FROM employees e
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY COALESCE(e.date_of_joining,e.date_of_exit,e.date_of_leaving,e.resignation_date) DESC`;
      params.push(from, to);
      break;
    }
    case "exit-movement-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?");
      params.push(from, to);
      if (req.query.exitType) { clauses.push("e.exit_type = ?"); params.push(String(req.query.exitType)); }
      sql = `SELECT ${EMP_CORE_COLS},
                    e.date_of_joining,
                    COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) AS exit_date,
                    DATEDIFF(COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date), e.date_of_joining) AS tenure_days,
                    e.exit_type, e.exit_sub_type, e.exit_reason_category
               FROM employees e
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) DESC`;
      break;
    }
    case "manager-mapping":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT ${EMP_CORE_COLS},
                    e.reporting_manager_id, e.manager_id,
                    COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS manager_name,
                    CASE WHEN e.reporting_manager_id IS NULL AND e.manager_id IS NULL THEN 'MISSING_MANAGER'
                         WHEN e.reporting_manager_id IS NOT NULL AND e.manager_id IS NOT NULL AND e.reporting_manager_id <> e.manager_id THEN 'MANAGER_FIELD_MISMATCH'
                         ELSE 'OK' END AS mapping_status
               FROM employees e
               ${EMP_CORE_JOINS}
               LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
              WHERE ${clauses.join(" AND ")}
              ORDER BY mapping_status DESC, employee_name`;
      break;
    case "attendance-daily": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      const attDailyScope = await resolveBranchScope(String(req.authUser.id));
      if (!attDailyScope.isSuperAdmin && attDailyScope.branchIds.length > 0) {
        clauses.push(`e.branch_id IN (${attDailyScope.branchIds.map(() => '?').join(',')})`);
        params.push(...attDailyScope.branchIds);
      }
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT ${EMP_CORE_COLS}, adr.record_date,
                    adr.attendance_source, adr.attendance_status, adr.raw_minutes, adr.dialler_minutes, adr.biometric_minutes,
                    adr.lwp_value, adr.late_mark, adr.late_by_minutes, adr.is_locked
               FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, employee_name`;
      break;
    }
    case "attendance-summary": {
      const month = monthParam(req.query.month);
      const attSummaryScope = await resolveBranchScope(String(req.authUser.id));
      const scopeClauses: string[] = [];
      const scopeParams: unknown[] = [];
      if (!attSummaryScope.isSuperAdmin && attSummaryScope.branchIds.length > 0) {
        scopeClauses.push(`e.branch_id IN (${attSummaryScope.branchIds.map(() => '?').join(',')})`);
        scopeParams.push(...attSummaryScope.branchIds);
      }
      const filterClauses: string[] = [];
      const filterParams: unknown[] = [];
      addEmployeeFilters(req.query, filterClauses, filterParams);

      const coreGroupBy = `e.id, e.employee_code, e.first_name, e.last_name, e.employment_status, desig.designation_name, dept.dept_name, b.branch_name, p.process_name, cc.cost_centre_name`;
      const whereActive = [...scopeClauses, ...filterClauses, 'e.active_status = 1'].filter(Boolean).join(' AND ') || '1=1';
      const whereInactive = [...scopeClauses, ...filterClauses, 'e.active_status = 0'].filter(Boolean).join(' AND ') || '1=1';

      sql = `(SELECT ${EMP_CORE_COLS},
                     COALESCE(SUM(adr.attendance_status='present'),0) AS present_days,
                     COALESCE(SUM(adr.attendance_status='half_day'),0) AS half_days,
                     COALESCE(SUM(adr.attendance_status='absent'),0) AS absent_days,
                     COALESCE(SUM(adr.attendance_status='leave_approved'),0) AS leave_days,
                     COALESCE(SUM(adr.lwp_value),0) AS lwp_days,
                     COALESCE(SUM(adr.late_mark=1),0) AS late_days,
                     ROUND(COALESCE(SUM(COALESCE(adr.raw_minutes,adr.biometric_minutes,adr.dialler_minutes,0)),0)/60,2) AS total_hours
                FROM employees e
                ${EMP_CORE_JOINS}
                LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?
               WHERE ${whereActive}
               GROUP BY ${coreGroupBy})
             UNION ALL
             (SELECT ${EMP_CORE_COLS},
                     SUM(adr.attendance_status='present') AS present_days,
                     SUM(adr.attendance_status='half_day') AS half_days,
                     SUM(adr.attendance_status='absent') AS absent_days,
                     SUM(adr.attendance_status='leave_approved') AS leave_days,
                     SUM(adr.lwp_value) AS lwp_days,
                     SUM(adr.late_mark=1) AS late_days,
                     ROUND(SUM(COALESCE(adr.raw_minutes,adr.biometric_minutes,adr.dialler_minutes,0))/60,2) AS total_hours
                FROM attendance_daily_record adr
                JOIN employees e ON e.id = adr.employee_id
                ${EMP_CORE_JOINS}
               WHERE DATE_FORMAT(adr.record_date,'%Y-%m') = ? AND ${whereInactive}
               GROUP BY ${coreGroupBy}
               HAVING SUM(adr.attendance_status IN ('present','half_day')) > 0)
             ORDER BY branch_name, employee_name`;
      params.push(...scopeParams, ...filterParams, month, month, ...scopeParams, ...filterParams);
      break;
    }
    case "biometric-reconciliation": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT ${EMP_CORE_COLS}, adr.record_date,
                    adr.attendance_status, adr.biometric_minutes, ibd.first_punch, ibd.last_punch, ibd.biometric_minutes AS imported_minutes,
                    CASE WHEN ibd.first_punch IS NULL AND adr.attendance_status IN ('present','half_day') THEN 'NO_BIOMETRIC_FOR_PRESENT'
                         WHEN ibd.first_punch IS NOT NULL AND adr.attendance_status='absent' THEN 'PUNCHED_BUT_ABSENT'
                         ELSE 'OK' END AS reconciliation_status
               FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
               ${EMP_CORE_JOINS}
               LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, reconciliation_status DESC`;
      break;
    }
    case "leave-balance":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lbl.balance_year = ?"); params.push(Number(req.query.year ?? new Date().getFullYear()));
      sql = `SELECT ${EMP_CORE_COLS},
                    lt.leave_code, lt.leave_name, lbl.allocated_days, lbl.used_days, lbl.adjusted_days,
                    (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS remaining_days
               FROM leave_balance_ledger lbl JOIN employees e ON e.id = lbl.employee_id
               ${EMP_CORE_JOINS}
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, lt.leave_code`;
      break;
    case "leave-utilization": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lr.from_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT ${EMP_CORE_COLS},
                    lr.from_date, lr.to_date,
                    lt.leave_code, lt.leave_name, lr.total_days, lr.status
               FROM leave_request lr JOIN employees e ON e.id = lr.employee_id
               ${EMP_CORE_JOINS}
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lr.from_date DESC`;
      break;
    }
    case "payroll-register": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT ${EMP_CORE_COLS}, spr.run_month,
                    spl.gross_salary, spl.total_deductions, spl.net_salary, spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days, spl.status
               FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id JOIN employees e ON e.id = spl.employee_id
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name`;
      break;
    }
    case "payroll-variance": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT ${EMP_CORE_COLS},
                    spr.run_month, spl.net_salary AS current_net,
                    prev.net_salary AS previous_net,
                    ROUND(((spl.net_salary - COALESCE(prev.net_salary,0)) / NULLIF(prev.net_salary,0))*100,2) AS net_variance_pct,
                    spl.lwp_days
               FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id JOIN employees e ON e.id = spl.employee_id
               ${EMP_CORE_JOINS}
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
      sql = `SELECT ${EMP_CORE_COLS}, spr.run_month,
                    sp.payslip_ref, sp.file_url, sp.acknowledged_at,
                    CASE WHEN sp.id IS NULL THEN 'NOT_GENERATED' WHEN sp.acknowledged_at IS NULL THEN 'RELEASED_NOT_ACKNOWLEDGED' ELSE 'ACKNOWLEDGED' END AS payslip_status
               FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id JOIN employees e ON e.id = spl.employee_id
               ${EMP_CORE_JOINS}
               LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
              WHERE ${clauses.join(" AND ")}
              ORDER BY payslip_status DESC, employee_name`;
      break;
    }
    case "statutory-missing":
      addEmployeeFilters(req.query, clauses, params); clauses.push("e.active_status = 1");
      sql = `SELECT ${EMP_CORE_COLS},
                    e.pan_number, eu.uan, e.epf_number, e.esic_number,
                    CONCAT_WS(',', IF(COALESCE(e.pan_number,'')='', 'PAN_MISSING', NULL), IF(eu.uan IS NULL, 'UAN_MISSING', NULL), IF(COALESCE(e.esic_number,'')='', 'ESIC_MISSING', NULL)) AS missing_items
               FROM employees e
               ${EMP_CORE_JOINS}
               LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
              WHERE ${clauses.join(" AND ")}
                AND (COALESCE(e.pan_number,'')='' OR eu.uan IS NULL OR COALESCE(e.esic_number,'')='')
              ORDER BY employee_name`;
      break;
    case "bank-missing":
      addEmployeeFilters(req.query, clauses, params); clauses.push("e.active_status = 1");
      sql = `SELECT ${EMP_CORE_COLS},
                    CASE WHEN ebd.id IS NULL THEN 'MISSING_BANK' WHEN COALESCE(ebd.verified,0)=0 THEN 'UNVERIFIED_BANK' ELSE 'OK' END AS bank_status
               FROM employees e
               ${EMP_CORE_JOINS}
               LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
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

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — PAYROLL ANALYSIS & STATUTORY
    // ══════════════════════════════════════════════════════════════════════════

    case "ytd-salary-summary": {
      const fy = String(req.query.financialYear ?? "").trim();
      const fyStart = fy.match(/^(\d{4})-\d{2}$/) ? `${fy.split('-')[0]}-04-01` : `${new Date().getFullYear() - 1}-04-01`;
      const fyEnd   = fy.match(/^(\d{4})-(\d{2})$/) ? `20${fy.split('-')[1]}-03-31` : `${new Date().getFullYear()}-03-31`;
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month BETWEEN DATE_FORMAT(?,'%Y-%m') AND DATE_FORMAT(?,'%Y-%m')");
      params.push(fyStart, fyEnd);
      sql = `SELECT ${EMP_CORE_COLS},
                    SUM(spl.gross_salary) AS ytd_gross,
                    SUM(spl.net_salary) AS ytd_net,
                    SUM(COALESCE(spl.tds_amount,0)) AS ytd_tds,
                    SUM(COALESCE(spl.pf_employee,0)) AS ytd_pf_employee,
                    SUM(COALESCE(spl.esic_employee,0)) AS ytd_esic_employee,
                    COUNT(DISTINCT spr.run_month) AS months_included
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.employment_status, desig.designation_name, dept.dept_name, b.branch_name, p.process_name, cc.cost_centre_name
              ORDER BY employee_name`;
      break;
    }

    case "cost-centre-salary-summary": {
      const month = monthParam(req.query.month);
      if (req.query.costCentreId) { clauses.push("e.cost_centre_id = ?"); params.push(String(req.query.costCentreId)); }
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT cc.cost_centre_code, cc.cost_centre_name,
                    COUNT(DISTINCT spl.employee_id) AS headcount,
                    SUM(spl.gross_salary) AS total_gross,
                    SUM(spl.net_salary) AS total_net,
                    ROUND(AVG(spl.net_salary),2) AS avg_net,
                    SUM(COALESCE(spl.pf_employer,0)+COALESCE(spl.esic_employer,0)) AS employer_statutory_cost,
                    SUM(COALESCE(spl.professional_tax,0)) AS total_pt
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY cc.id, cc.cost_centre_code, cc.cost_centre_name
              ORDER BY cc.cost_centre_name`;
      break;
    }

    case "process-lob-salary-cost": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT p.process_name, l.lob_name,
                    COUNT(DISTINCT spl.employee_id) AS headcount,
                    SUM(spl.gross_salary) AS total_gross,
                    SUM(spl.net_salary) AS total_net,
                    SUM(COALESCE(spl.pf_employer,0)+COALESCE(spl.esic_employer,0)) AS employer_statutory_cost,
                    SUM(spl.gross_salary+COALESCE(spl.pf_employer,0)+COALESCE(spl.esic_employer,0)) AS total_ctc
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN lob_master l ON l.id = p.lob_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.id, p.process_name, l.lob_name
              ORDER BY total_ctc DESC`;
      break;
    }

    case "grade-salary-distribution": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT COALESCE(e.grade_code, e.grade, 'Ungraded') AS grade,
                    COUNT(DISTINCT spl.employee_id) AS headcount,
                    MIN(spl.net_salary) AS min_net,
                    MAX(spl.net_salary) AS max_net,
                    ROUND(AVG(spl.net_salary),2) AS avg_net,
                    SUM(spl.net_salary) AS total_net
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY COALESCE(e.grade_code, e.grade, 'Ungraded')
              ORDER BY avg_net DESC`;
      break;
    }

    case "salary-advance-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("sa.advance_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.status) { clauses.push("sa.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT ${EMP_CORE_COLS},
                    sa.advance_date, sa.amount, sa.recovery_months,
                    COALESCE(sa.recovered_amount,0) AS recovered_amount,
                    (sa.amount - COALESCE(sa.recovered_amount,0)) AS outstanding,
                    sa.status
               FROM salary_advance sa
               JOIN employees e ON e.id = sa.employee_id
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY sa.advance_date DESC`;
      break;
    }

    case "lwp-deduction-register": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT ${EMP_CORE_COLS},
                    spl.lwp_days,
                    ROUND(spl.gross_salary / NULLIF(spl.working_days,0), 2) AS daily_rate,
                    COALESCE(spl.lwp_deduction, ROUND(spl.gross_salary / NULLIF(spl.working_days,0) * spl.lwp_days, 2)) AS lwp_deduction_amount
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")} AND spl.lwp_days > 0
              ORDER BY spl.lwp_days DESC`;
      break;
    }

    case "bank-change-requests": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("pua.request_type = 'bank_details'", "pua.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.status) { clauses.push("pua.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    pua.request_type, pua.status, pua.created_at AS requested_at,
                    pua.reviewed_at AS approved_at,
                    COALESCE(NULLIF(rev.full_name,''), CONCAT(rev.first_name,' ',COALESCE(rev.last_name,''))) AS approved_by
               FROM profile_update_approval pua
               JOIN employees e ON e.id = pua.employee_id
               LEFT JOIN employees rev ON rev.user_id = pua.reviewed_by
              WHERE ${clauses.join(" AND ")}
              ORDER BY pua.created_at DESC`;
      break;
    }

    case "payroll-readiness-status": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("prf.run_month = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    prf.readiness_status, prf.blockers, b.branch_name, p.process_name
               FROM payroll_readiness_flag prf
               JOIN employees e ON e.id = prf.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY prf.readiness_status, employee_name`;
      break;
    }

    case "payroll-audit-trail": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params, "e");
      clauses.push("DATE_FORMAT(sal.acted_at,'%Y-%m') = ?"); params.push(month);
      if (req.query.actionType) { clauses.push("sal.action_type = ?"); params.push(String(req.query.actionType)); }
      sql = `SELECT sal.acted_at, sal.action_type, sal.module_key, sal.entity_type, sal.entity_id,
                    sal.change_summary,
                    COALESCE(NULLIF(u.full_name,''), CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS actor_name,
                    sal.ip_address
               FROM sensitive_action_log sal
               LEFT JOIN employees u ON u.user_id = sal.actor_user_id
               LEFT JOIN employees e ON e.id = sal.entity_id AND sal.entity_type = 'salary_prep_line'
              WHERE sal.module_key = 'payroll' AND ${clauses.join(" AND ")}
              ORDER BY sal.acted_at DESC`;
      break;
    }

    case "pf-esi-optout-register": {
      addEmployeeFilters(req.query, clauses, params);
      if (req.query.status) { clauses.push("so.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    so.override_type, so.status, so.effective_from, so.reason,
                    COALESCE(NULLIF(ap.full_name,''), CONCAT(ap.first_name,' ',COALESCE(ap.last_name,''))) AS approved_by,
                    so.approved_at, b.branch_name
               FROM statutory_override so
               JOIN employees e ON e.id = so.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN employees ap ON ap.user_id = so.approved_by_user_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY so.effective_from DESC`;
      break;
    }

    // ── STATUTORY ─────────────────────────────────────────────────────────────

    case "pf-ecr-export": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT ${EMP_CORE_COLS},
                    eu.uan, eu.member_id,
                    COALESCE(spl.epf_wages, spl.basic_salary) AS epf_wages,
                    COALESCE(spl.eps_wages, LEAST(COALESCE(spl.basic_salary,0), 15000)) AS eps_wages,
                    COALESCE(spl.gross_salary, 0) AS edli_wages,
                    COALESCE(spl.pf_employee,0) AS epf_contribution,
                    COALESCE(spl.pf_employee,0) AS eps_contribution,
                    COALESCE(spl.pf_employer,0) AS epf_employer,
                    (spl.working_days - spl.present_days) AS ncp_days,
                    0 AS refund_of_advances
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               ${EMP_CORE_JOINS}
               LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
              WHERE ${clauses.join(" AND ")}
              ORDER BY eu.uan`;
      break;
    }

    case "pf-monthly-summary": {
      const month = monthParam(req.query.month);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT spr.run_month,
                    COUNT(DISTINCT spl.employee_id) AS total_employees,
                    SUM(COALESCE(spl.epf_wages, spl.basic_salary)) AS total_epf_wages,
                    SUM(COALESCE(spl.pf_employee,0)) AS total_pf_employee,
                    SUM(COALESCE(spl.pf_employer,0)) AS total_pf_employer,
                    SUM(COALESCE(spl.pf_employee,0)+COALESCE(spl.pf_employer,0)) AS challan_amount
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY spr.run_month`;
      break;
    }

    case "uan-master-register": {
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    eu.uan, eu.member_id, eu.epf_join_date,
                    CASE WHEN COALESCE(e.basic_salary,0) <= 15000 THEN 'Yes' ELSE 'No' END AS eps_eligible,
                    b.branch_name
               FROM employees e
               LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name`;
      break;
    }

    case "esic-challan-data": {
      const month = monthParam(req.query.month);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(e.esic_number,'') AS esic_number,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
                    spl.gross_salary AS gross_wages,
                    COALESCE(spl.esic_employee,0) AS esic_employee,
                    COALESCE(spl.esic_employer,0) AS esic_employer,
                    COALESCE(spl.esic_employee,0)+COALESCE(spl.esic_employer,0) AS total_contribution
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
              WHERE ${clauses.join(" AND ")} AND COALESCE(spl.esic_employee,0) > 0
              ORDER BY e.employee_code`;
      break;
    }

    case "esic-monthly-summary": {
      const month = monthParam(req.query.month);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT spr.run_month,
                    COUNT(DISTINCT spl.employee_id) AS total_employees,
                    SUM(spl.gross_salary) AS total_wages,
                    SUM(COALESCE(spl.esic_employee,0)) AS total_employee_contribution,
                    SUM(COALESCE(spl.esic_employer,0)) AS total_employer_contribution,
                    SUM(COALESCE(spl.esic_employee,0)+COALESCE(spl.esic_employer,0)) AS challan_amount
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE ${clauses.join(" AND ")} AND COALESCE(spl.esic_employee,0) > 0
              GROUP BY spr.run_month`;
      break;
    }

    case "pt-monthly-register": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      if (req.query.state) { clauses.push("e.state = ?"); params.push(String(req.query.state)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(e.state, b.state, 'Unknown') AS state,
                    spl.gross_salary AS gross_wages,
                    COALESCE(spl.professional_tax,0) AS pt_amount,
                    b.branch_name
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")} AND COALESCE(spl.professional_tax,0) > 0
              ORDER BY state, employee_name`;
      break;
    }

    case "pt-slab-master": {
      if (req.query.state) { clauses.push("pts.state = ?"); params.push(String(req.query.state)); }
      sql = `SELECT pts.state, pts.income_from, pts.income_to, pts.pt_amount, pts.frequency, pts.effective_from, pts.active_status
               FROM pt_slab_master pts
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY pts.state, pts.income_from`;
      break;
    }

    case "tds-working-sheet": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    spl.gross_salary, spl.net_salary,
                    COALESCE(spl.tds,0) AS tds_deducted,
                    COALESCE(spl.tds_override,0) AS tds_manual_override,
                    COALESCE(spl.tds, spl.tds_override, 0) AS tds_final,
                    b.branch_name
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name`;
      break;
    }

    case "form16-data": {
      const fy = String(req.query.financialYear ?? "").trim();
      const fyStart = fy ? `${fy.split('-')[0]}-04` : `${new Date().getFullYear()-1}-04`;
      const fyEnd   = fy ? `20${fy.split('-')[1]}-03` : `${new Date().getFullYear()}-03`;
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month BETWEEN ? AND ?"); params.push(fyStart, fyEnd);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.pan_number,
                    SUM(spl.gross_salary) AS total_gross,
                    SUM(spl.net_salary) AS total_net,
                    SUM(COALESCE(spl.tds,0)) AS total_tds_deducted,
                    SUM(COALESCE(spl.pf_employee,0)) AS total_pf,
                    COUNT(DISTINCT spr.run_month) AS months
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, e.pan_number
              ORDER BY employee_name`;
      break;
    }

    case "gratuity-liability-register": {
      const minYears = Number(req.query.minYears ?? 5);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "DATEDIFF(CURDATE(), e.date_of_joining) / 365 >= ?"); params.push(minYears);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining,
                    ROUND(DATEDIFF(CURDATE(), e.date_of_joining) / 365, 2) AS years_of_service,
                    COALESCE(esa.basic_salary, e.basic_salary, 0) AS last_basic,
                    ROUND((COALESCE(esa.basic_salary, e.basic_salary, 0) / 26) * 15 * FLOOR(DATEDIFF(CURDATE(), e.date_of_joining) / 365), 2) AS gratuity_liability,
                    CASE WHEN DATEDIFF(CURDATE(), e.date_of_joining) / 365 >= 5 THEN 'Eligible' ELSE 'Not Eligible' END AS eligible,
                    b.branch_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN (
                 SELECT employee_id, basic_salary, ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY effective_from DESC) AS rn
                 FROM employee_salary_assignment WHERE active_status = 1
               ) esa ON esa.employee_id = e.id AND esa.rn = 1
              WHERE ${clauses.join(" AND ")}
              ORDER BY gratuity_liability DESC`;
      break;
    }

    case "gratuity-monthly-accrual": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(gal.accrual_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    gal.accrual_date, gal.monthly_accrual, gal.ytd_accrual, b.branch_name
               FROM gratuity_accrual_ledger gal
               JOIN employees e ON e.id = gal.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY gal.monthly_accrual DESC`;
      break;
    }

    case "neft-transfer-file": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ebd.bank_name, ebd.ifsc_code, ebd.account_number, spl.net_salary,
                    b.branch_name
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")} AND spl.net_salary > 0
              ORDER BY employee_name`;
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — HR, ATTENDANCE & LEAVE
    // ══════════════════════════════════════════════════════════════════════════

    case "org-structure-snapshot": {
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT b.branch_name, d.dept_name AS department, des.designation_name AS designation,
                    COALESCE(e.grade_code, e.grade, 'Ungraded') AS grade,
                    COUNT(*) AS headcount,
                    ROUND(AVG(DATEDIFF(CURDATE(), e.date_of_joining) / 30), 1) AS avg_tenure_months
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN designation_master des ON des.id = e.designation_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.branch_name, d.dept_name, des.designation_name, COALESCE(e.grade_code, e.grade, 'Ungraded')
              ORDER BY b.branch_name, d.dept_name, headcount DESC`;
      break;
    }

    case "cost-centre-headcount": {
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT cc.cost_centre_code, cc.cost_centre_name,
                    COUNT(*) AS headcount,
                    SUM(CASE WHEN e.employment_type='permanent' THEN 1 ELSE 0 END) AS permanent,
                    SUM(CASE WHEN e.employment_type='contractual' OR e.employment_type='contract' THEN 1 ELSE 0 END) AS contractual,
                    SUM(CASE WHEN e.employment_type NOT IN ('permanent','contractual','contract') THEN 1 ELSE 0 END) AS other
               FROM employees e
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY cc.id, cc.cost_centre_code, cc.cost_centre_name
              ORDER BY headcount DESC`;
      break;
    }

    case "confirmation-due-list": {
      const days = Number(req.query.daysAhead ?? 30);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "e.probation_end_date IS NOT NULL", "e.probation_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)");
      params.push(days);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining, e.probation_end_date,
                    DATEDIFF(e.probation_end_date, CURDATE()) AS days_remaining,
                    b.branch_name, p.process_name, des.designation_name, e.employment_status
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN designation_master des ON des.id = e.designation_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY e.probation_end_date ASC`;
      break;
    }

    case "contract-expiry-list": {
      const days = Number(req.query.daysAhead ?? 30);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "e.contract_end_date IS NOT NULL", "e.contract_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)");
      params.push(days);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.employment_type AS contract_type, e.date_of_joining AS start_date, e.contract_end_date AS end_date,
                    DATEDIFF(e.contract_end_date, CURDATE()) AS days_remaining, b.branch_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY e.contract_end_date ASC`;
      break;
    }

    case "lifecycle-events": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ele.effective_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.eventType) { clauses.push("ele.event_type = ?"); params.push(String(req.query.eventType)); }
      sql = `SELECT ele.event_type, ele.effective_date, ele.old_value, ele.new_value,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    b.branch_name,
                    COALESCE(NULLIF(ini.full_name,''), CONCAT(ini.first_name,' ',COALESCE(ini.last_name,''))) AS initiated_by
               FROM employee_lifecycle_event ele
               JOIN employees e ON e.id = ele.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN employees ini ON ini.user_id = ele.created_by
              WHERE ${clauses.join(" AND ")}
              ORDER BY ele.effective_date DESC`;
      break;
    }

    case "increment-promotion-history": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("sir.effective_from BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    'INCREMENT' AS event_type,
                    sir.current_ctc AS old_ctc, sir.proposed_ctc AS new_ctc,
                    sir.increment_percentage AS increment_pct,
                    sir.effective_from, sir.status,
                    COALESCE(NULLIF(ap.full_name,''), CONCAT(ap.first_name,' ',COALESCE(ap.last_name,''))) AS approved_by
               FROM salary_increment_request sir
               JOIN employees e ON e.id = sir.employee_id
               LEFT JOIN employees ap ON ap.user_id = sir.approved_by_user_id
              WHERE ${clauses.join(" AND ")} AND sir.status = 'approved'
              ORDER BY sir.effective_from DESC`;
      break;
    }

    case "birthday-list": {
      const month = monthParam(req.query.month);
      const mo = month.split('-')[1];
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "MONTH(e.date_of_birth) = ?"); params.push(Number(mo));
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_birth, DATE_FORMAT(e.date_of_birth,'%d-%b') AS birthday, e.mobile,
                    b.branch_name, p.process_name,
                    YEAR(CURDATE()) - YEAR(e.date_of_birth) AS age_turning
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY DAY(e.date_of_birth)`;
      break;
    }

    case "anniversary-list": {
      const month = monthParam(req.query.month);
      const mo = month.split('-')[1];
      const yearsMin = Number(req.query.yearsMin ?? 1);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "MONTH(e.date_of_joining) = ?", "YEAR(CURDATE()) - YEAR(e.date_of_joining) >= ?");
      params.push(Number(mo), yearsMin);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining, DATE_FORMAT(e.date_of_joining,'%d-%b') AS anniversary_date,
                    YEAR(CURDATE()) - YEAR(e.date_of_joining) AS years_completing,
                    b.branch_name, p.process_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY DAY(e.date_of_joining)`;
      break;
    }

    // ── ATTENDANCE (Phase C) ────────────────────────────────────────────────

    case "daily-hc-shift": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to   = dateParam(req.query.to, from);
      clauses.push("sds.snapshot_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId)  { clauses.push("sds.branch_id = ?");  params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("sds.process_id = ?"); params.push(String(req.query.processId)); }
      sql = `SELECT sds.snapshot_date, b.branch_name, p.process_name,
                    sds.rostered_headcount, sds.present_headcount,
                    sds.absent_headcount, sds.on_leave_headcount,
                    ROUND(sds.present_headcount / NULLIF(sds.rostered_headcount,0) * 100, 2) AS coverage_pct,
                    sds.total_shrinkage_pct
               FROM shrinkage_daily_snapshot sds
               LEFT JOIN branch_master b ON b.id = sds.branch_id
               LEFT JOIN process_master p ON p.id = sds.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY sds.snapshot_date DESC, b.branch_name, p.process_name`;
      break;
    }

    case "shift-adherence-detail": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to   = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("arr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT arr.record_date, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    arr.planned_shift_code, arr.planned_start_time, arr.planned_end_time,
                    arr.actual_login_time, arr.actual_logout_time,
                    COALESCE(arr.late_by_minutes,0) AS late_by_minutes,
                    COALESCE(arr.early_exit_minutes,0) AS early_exit_minutes,
                    COALESCE(arr.adherence_pct, 0) AS adherence_pct
               FROM attendance_reconciliation_record arr
               JOIN employees e ON e.id = arr.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY arr.record_date DESC, employee_name`;
      break;
    }

    case "attendance-register-grid": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    adr.record_date, adr.attendance_status, adr.lwp_value, adr.late_mark
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, adr.record_date`;
      break;
    }

    case "late-arrival-summary": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    SUM(adr.late_mark) AS total_late_days,
                    ROUND(AVG(CASE WHEN adr.late_mark=1 THEN adr.late_by_minutes END),1) AS avg_late_mins,
                    MAX(adr.late_by_minutes) AS max_late_mins,
                    b.branch_name, p.process_name
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")} AND adr.late_mark = 1
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, p.process_name
              ORDER BY total_late_days DESC`;
      break;
    }

    case "overtime-summary": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COUNT(DISTINCT adr.record_date) AS working_days,
                    ROUND(SUM(COALESCE(adr.raw_minutes, adr.biometric_minutes,0))/60,2) AS actual_hrs,
                    ROUND(SUM(GREATEST(COALESCE(adr.raw_minutes,adr.biometric_minutes,0) - 480, 0))/60,2) AS overtime_hrs,
                    b.branch_name, p.process_name
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")} AND adr.attendance_status = 'present'
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, p.process_name
              HAVING overtime_hrs > 0
              ORDER BY overtime_hrs DESC`;
      break;
    }

    case "regularization-summary": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(ar.request_date,'%Y-%m') = ?"); params.push(month);
      if (req.query.status) { clauses.push("ar.stage = ?"); params.push(String(req.query.status)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ar.request_date, ar.old_status, ar.new_status, ar.stage,
                    ar.payroll_impact, ar.submitted_at,
                    ar.resolved_at, ar.resolver_remarks
               FROM attendance_regularization ar
               JOIN employees e ON e.id = ar.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ar.request_date DESC`;
      break;
    }

    case "attendance-dispute-summary": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(ad.dispute_date,'%Y-%m') = ?"); params.push(month);
      if (req.query.status) { clauses.push("ad.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ad.dispute_date, ad.dispute_type, ad.status, ad.payroll_impact,
                    ad.resolved_at, ad.resolution_note
               FROM attendance_dispute ad
               JOIN employees e ON e.id = ad.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ad.dispute_date DESC`;
      break;
    }

    case "habitual-absentee-list": {
      const month = monthParam(req.query.month);
      const threshold = Number(req.query.thresholdPct ?? 25);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    SUM(adr.attendance_status='absent') AS absent_days,
                    SUM(adr.late_mark=1) AS late_days,
                    COUNT(*) AS total_days,
                    ROUND(SUM(adr.attendance_status='absent') / NULLIF(COUNT(*),0)*100,1) AS absent_pct,
                    ROUND(SUM(adr.late_mark=1) / NULLIF(COUNT(*),0)*100,1) AS late_pct,
                    b.branch_name, p.process_name
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, p.process_name
              HAVING absent_pct >= ? OR late_pct >= ?
              ORDER BY absent_pct DESC`;
      params.push(threshold, threshold);
      break;
    }

    case "daily-shrinkage-report": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to   = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params, "sds");
      clauses.push("sds.snapshot_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT sds.snapshot_date, b.branch_name, p.process_name,
                    sds.rostered_headcount, sds.present_headcount, sds.absent_headcount, sds.on_leave_headcount,
                    sds.planned_shrinkage_pct, sds.unplanned_shrinkage_pct, sds.total_shrinkage_pct, sds.avg_adherence_pct
               FROM shrinkage_daily_snapshot sds
               LEFT JOIN branch_master b ON b.id = sds.branch_id
               LEFT JOIN process_master p ON p.id = sds.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY sds.snapshot_date DESC`;
      break;
    }

    case "monthly-shrinkage-trend": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params, "sds");
      clauses.push("DATE_FORMAT(sds.snapshot_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT DATE_FORMAT(sds.snapshot_date,'%Y-%m') AS month, b.branch_name, p.process_name,
                    ROUND(AVG(sds.total_shrinkage_pct),2) AS avg_shrinkage_pct,
                    MAX(sds.total_shrinkage_pct) AS peak_shrinkage_pct,
                    SUM(sds.absent_headcount) AS total_absent_days,
                    ROUND(AVG(sds.unplanned_shrinkage_pct),2) AS avg_unplanned_pct
               FROM shrinkage_daily_snapshot sds
               LEFT JOIN branch_master b ON b.id = sds.branch_id
               LEFT JOIN process_master p ON p.id = sds.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(sds.snapshot_date,'%Y-%m'), b.branch_name, p.process_name
              ORDER BY month DESC`;
      break;
    }

    case "punch-raw-export": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to   = dateParam(req.query.to, from);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ibd.activity_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ibd.activity_date, ibd.first_punch, ibd.last_punch, ibd.biometric_minutes,
                    ibd.device_id, 'BIOMETRIC' AS punch_source
               FROM integration_biometric_daily ibd
               JOIN employees e ON e.employee_code = ibd.employee_code
              WHERE ${clauses.join(" AND ")}
              ORDER BY ibd.activity_date DESC, e.employee_code`;
      break;
    }

    // ── LEAVE (Phase C) ────────────────────────────────────────────────────

    case "leave-allocation-register": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lbl.balance_year = ?"); params.push(year);
      if (req.query.leaveType) { clauses.push("lt.leave_code = ?"); params.push(String(req.query.leaveType)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    lt.leave_code, lt.leave_name,
                    lbl.allocated_days, lbl.used_days, lbl.adjusted_days,
                    (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS closing_balance,
                    b.branch_name, p.process_name
               FROM leave_balance_ledger lbl
               JOIN employees e ON e.id = lbl.employee_id
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, lt.leave_code`;
      break;
    }

    case "leave-trend-monthly": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("YEAR(lr.from_date) = ?"); params.push(year);
      if (req.query.leaveType) { clauses.push("lt.leave_code = ?"); params.push(String(req.query.leaveType)); }
      sql = `SELECT DATE_FORMAT(lr.from_date,'%Y-%m') AS month, lt.leave_code, lt.leave_name,
                    COUNT(*) AS total_applications,
                    SUM(lr.total_days) AS total_days,
                    SUM(CASE WHEN lr.status='approved' THEN lr.total_days ELSE 0 END) AS approved_days,
                    SUM(CASE WHEN lr.status='rejected' THEN lr.total_days ELSE 0 END) AS rejected_days,
                    SUM(CASE WHEN lr.status='pending' THEN lr.total_days ELSE 0 END) AS pending_days
               FROM leave_request lr
               JOIN employees e ON e.id = lr.employee_id
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(lr.from_date,'%Y-%m'), lt.leave_code, lt.leave_name
              ORDER BY month DESC, lt.leave_code`;
      break;
    }

    case "leave-lwp-reconciliation": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    SUM(adr.attendance_status='absent') AS absent_days_attendance,
                    SUM(adr.lwp_value) AS lwp_days_attendance,
                    COALESCE(spl.lwp_days,0) AS lwp_days_payroll,
                    CASE WHEN SUM(adr.lwp_value) <> COALESCE(spl.lwp_days,0) THEN 'MISMATCH' ELSE 'OK' END AS reconciliation_status,
                    b.branch_name
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN salary_prep_run spr ON spr.run_month = DATE_FORMAT(adr.record_date,'%Y-%m')
               LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id AND spl.employee_id = e.id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, spl.lwp_days, b.branch_name
              ORDER BY reconciliation_status DESC, employee_name`;
      break;
    }

    case "maternity-paternity-register": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("YEAR(lr.from_date) = ?", "lt.leave_code IN ('ML','PL','MATERNITY','PATERNITY')"); params.push(year);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.gender, lt.leave_code, lt.leave_name, lr.from_date, lr.to_date, lr.total_days, lr.status,
                    b.branch_name
               FROM leave_request lr
               JOIN employees e ON e.id = lr.employee_id
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lr.from_date DESC`;
      break;
    }

    case "leave-encashment-register": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lbl.balance_year = ?", "lt.leave_code IN ('EL','PL','EARN')"); params.push(year);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    lt.leave_code, lbl.allocated_days,
                    (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS available_balance,
                    GREATEST((lbl.allocated_days + lbl.adjusted_days - lbl.used_days) - 15, 0) AS encashable_days,
                    b.branch_name
               FROM leave_balance_ledger lbl
               JOIN employees e ON e.id = lbl.employee_id
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY encashable_days DESC`;
      break;
    }

    case "leave-lapse-summary": {
      const year = Number(req.query.year ?? new Date().getFullYear() - 1);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("lbl.balance_year = ?"); params.push(year);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    lt.leave_code, lt.leave_name,
                    (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS year_end_balance,
                    lbl.balance_year AS lapse_year, b.branch_name
               FROM leave_balance_ledger lbl
               JOIN employees e ON e.id = lbl.employee_id
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
                AND (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) > 0
                AND lt.carry_forward = 0
              ORDER BY year_end_balance DESC`;
      break;
    }

    case "holiday-master-list": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      clauses.push("YEAR(lhm.holiday_date) = ?"); params.push(year);
      if (req.query.branchId) { clauses.push("(lhm.branch_id = ? OR lhm.branch_id IS NULL)"); params.push(String(req.query.branchId)); }
      sql = `SELECT lhm.holiday_date, lhm.holiday_name, lhm.holiday_type,
                    DAYNAME(lhm.holiday_date) AS weekday,
                    COALESCE(b.branch_name, 'All Branches') AS branch
               FROM leave_holiday_master lhm
               LEFT JOIN branch_master b ON b.id = lhm.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lhm.holiday_date`;
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE D — ATS, EXIT, PERFORMANCE
    // ══════════════════════════════════════════════════════════════════════════

    case "ats-pipeline-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("acsl.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("ac.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("ac.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.stage) { clauses.push("acsl.stage = ?"); params.push(String(req.query.stage)); }
      sql = `SELECT acsl.stage,
                    COUNT(*) AS count,
                    ROUND(AVG(DATEDIFF(COALESCE(acsl.exited_at, NOW()), acsl.created_at)),1) AS avg_days_in_stage
               FROM ats_candidate_stage_log acsl
               JOIN ats_candidate ac ON ac.id = acsl.candidate_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY acsl.stage
              ORDER BY count DESC`;
      break;
    }

    case "candidate-source-analysis": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("ac.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("ac.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT COALESCE(ac.sourcing_channel,'Unknown') AS sourcing_channel,
                    COUNT(*) AS total_applied,
                    SUM(ac.overall_stage IN ('offer_given','selected')) AS offer_given,
                    SUM(ac.overall_stage = 'joined') AS joined,
                    SUM(ac.overall_stage = 'rejected') AS rejected,
                    ROUND(SUM(ac.overall_stage='joined') / NULLIF(COUNT(*),0)*100,1) AS join_conversion_pct
               FROM ats_candidate ac
              WHERE ${clauses.join(" AND ")}
              GROUP BY COALESCE(ac.sourcing_channel,'Unknown')
              ORDER BY total_applied DESC`;
      break;
    }

    case "offer-to-joining-tracker": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("aeo.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("ac.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    aeo.offered_ctc, aeo.created_at AS offer_date,
                    aob.joining_date, aob.status AS onboarding_status,
                    DATEDIFF(aob.joining_date, aeo.created_at) AS offer_to_join_days
               FROM ats_employment_offer aeo
               JOIN ats_candidate ac ON ac.id = aeo.candidate_id
               LEFT JOIN ats_onboarding_bridge aob ON aob.candidate_id = ac.id
              WHERE ${clauses.join(" AND ")}
              ORDER BY aeo.created_at DESC`;
      break;
    }

    case "bgv-status-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("ac.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("ac.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.status) { clauses.push("ac.bgv_status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    ac.bgv_status AS overall_bgv_status, ac.bgv_score,
                    ac.created_at
               FROM ats_candidate ac
              WHERE ${clauses.join(" AND ")}
              ORDER BY ac.created_at DESC`;
      break;
    }

    case "bgv-vendor-dispatch-log": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("cvd.dispatched_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    cvd.check_type, cvd.vendor_name, cvd.dispatched_at AS dispatch_date,
                    cvd.vendor_result, cvd.resolved_at
               FROM candidate_bgv_vendor_dispatch cvd
               JOIN ats_candidate ac ON ac.id = cvd.candidate_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY cvd.dispatched_at DESC`;
      break;
    }

    case "onboarding-request-status": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("aor.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("aor.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.status) { clauses.push("aor.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    b.branch_name, p.process_name, aor.status AS request_status,
                    aor.created_at AS submitted_at, aor.approved_at,
                    DATEDIFF(COALESCE(aor.approved_at, NOW()), aor.created_at) AS days_pending
               FROM ats_onboarding_request aor
               JOIN ats_candidate ac ON ac.id = aor.candidate_id
               LEFT JOIN branch_master b ON b.id = aor.branch_id
               LEFT JOIN process_master p ON p.id = aor.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY aor.created_at DESC`;
      break;
    }

    case "offer-letter-tat-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("aeo.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("ac.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT ac.candidate_code, ac.full_name,
                    aeo.created_at AS offer_created_at, aeo.sent_at AS offer_sent_at,
                    tti.created_at AS tat_started_at, tti.completed_at, tti.due_at,
                    TIMESTAMPDIFF(HOUR, aeo.created_at, COALESCE(tti.completed_at, NOW())) AS tat_hours,
                    CASE WHEN tti.sla_breached = 1 THEN 'BREACHED' ELSE 'OK' END AS breach_flag
               FROM ats_employment_offer aeo
               JOIN ats_candidate ac ON ac.id = aeo.candidate_id
               LEFT JOIN task_tat_instance tti ON tti.entity_id = CAST(aeo.id AS CHAR) AND tti.task_type_key = 'APPOINTMENT_LETTER'
              WHERE ${clauses.join(" AND ")}
              ORDER BY aeo.created_at DESC`;
      break;
    }

    case "recruiter-performance-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("acsl.created_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT COALESCE(NULLIF(u.full_name,''), CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS recruiter_name,
                    COUNT(DISTINCT acsl.candidate_id) AS candidates_handled,
                    SUM(ac.overall_stage IN ('offer_given','selected')) AS offers_given,
                    SUM(ac.overall_stage = 'joined') AS joined,
                    SUM(ac.overall_stage = 'rejected') AS rejected
               FROM ats_candidate_stage_log acsl
               JOIN ats_candidate ac ON ac.id = acsl.candidate_id
               LEFT JOIN employees u ON u.user_id = acsl.updated_by
              WHERE ${clauses.join(" AND ")}
              GROUP BY u.id, u.full_name, u.first_name, u.last_name
              ORDER BY candidates_handled DESC`;
      break;
    }

    case "interview-slot-utilization": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to   = dateParam(req.query.to, from);
      clauses.push("ais.slot_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("ais.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT ais.slot_date, ais.slot_time, b.branch_name, p.process_name,
                    ais.max_capacity, ais.registered_count,
                    ROUND(ais.registered_count / NULLIF(ais.max_capacity,0)*100,1) AS fill_pct
               FROM ats_interview_slot ais
               LEFT JOIN branch_master b ON b.id = ais.branch_id
               LEFT JOIN process_master p ON p.id = ais.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ais.slot_date DESC`;
      break;
    }

    case "cheque-name-mismatch-report": {
      if (req.query.status) { clauses.push("cnv.match_status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    cnv.name_in_profile, cnv.name_on_cheque, cnv.match_status,
                    COALESCE(NULLIF(val.full_name,''), CONCAT(val.first_name,' ',COALESCE(val.last_name,''))) AS validated_by,
                    cnv.validated_at, cob.bank_name
               FROM cheque_name_validation cnv
               JOIN ats_candidate ac ON ac.id = cnv.candidate_id
               LEFT JOIN candidate_onboarding_bank_detail cob ON cob.id = cnv.bank_detail_id
               LEFT JOIN employees val ON val.user_id = cnv.validated_by
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY cnv.created_at DESC`;
      break;
    }

    // ── EXIT & ATTRITION (Phase D) ─────────────────────────────────────────

    case "notice-period-adherence": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("er.resignation_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    er.notice_period_days, er.resignation_date AS notice_start,
                    DATE_ADD(er.resignation_date, INTERVAL er.notice_period_days DAY) AS notice_end,
                    er.last_working_date, er.buyout_flag,
                    GREATEST(DATEDIFF(DATE_ADD(er.resignation_date, INTERVAL er.notice_period_days DAY), COALESCE(er.last_working_date, CURDATE())), 0) AS short_notice_days
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY er.resignation_date DESC`;
      break;
    }

    case "exit-interview-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ei.interview_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ei.interview_date, ei.primary_reason, ei.secondary_reason,
                    ei.manager_score, ei.salary_score, ei.work_life_score,
                    ei.would_rejoin, ei.regrettable_exit, b.branch_name
               FROM exit_interview ei
               JOIN employees e ON e.id = ei.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ei.interview_date DESC`;
      break;
    }

    case "rehire-eligibility-register": {
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.employment_status IN ('resigned','terminated','exited')");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_exit, er.exit_sub_type,
                    COALESCE(er.rehire_eligible, 'TBD') AS rehire_eligible,
                    des.designation_name AS previous_designation, b.branch_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN designation_master des ON des.id = e.designation_id
               LEFT JOIN exit_request er ON er.employee_id = e.id
              WHERE ${clauses.join(" AND ")}
              ORDER BY e.date_of_exit DESC`;
      break;
    }

    case "monthly-attrition-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("ats.snapshot_month BETWEEN DATE_FORMAT(?,'%Y-%m') AND DATE_FORMAT(?,'%Y-%m')"); params.push(from, to);
      if (req.query.branchId) { clauses.push("ats.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("ats.process_id = ?"); params.push(String(req.query.processId)); }
      sql = `SELECT ats.snapshot_month, b.branch_name, p.process_name,
                    ats.opening_headcount, ats.closing_headcount,
                    ats.voluntary_exits, ats.involuntary_exits, ats.new_joiners,
                    ROUND((ats.voluntary_exits+ats.involuntary_exits) / NULLIF(ats.opening_headcount,0)*100,2) AS attrition_rate_pct
               FROM attrition_snapshot ats
               LEFT JOIN branch_master b ON b.id = ats.branch_id
               LEFT JOIN process_master p ON p.id = ats.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ats.snapshot_month DESC`;
      break;
    }

    case "attrition-by-exit-reason": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("YEAR(er.resignation_date) = ?"); params.push(year);
      sql = `SELECT COALESCE(er.exit_reason_category,'Unknown') AS exit_reason_category,
                    COUNT(*) AS total_exits,
                    ROUND(COUNT(*) / SUM(COUNT(*)) OVER () * 100, 1) AS pct_of_total,
                    ROUND(AVG(DATEDIFF(COALESCE(er.last_working_date, CURDATE()), e.date_of_joining)/30),1) AS avg_tenure_months
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY COALESCE(er.exit_reason_category,'Unknown')
              ORDER BY total_exits DESC`;
      break;
    }

    case "ff-settlement-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ffc.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.status) { clauses.push("ffc.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_exit AS lwd, ffc.status AS ff_status,
                    ffc.gross_dues, ffc.total_deductions, ffc.net_payable,
                    ffc.settled_at, b.branch_name
               FROM full_final_calculation ffc
               JOIN employees e ON e.id = ffc.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ffc.created_at DESC`;
      break;
    }

    case "clearance-status-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ecc.created_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_exit AS lwd, ecc.clearance_area, ecc.status,
                    ecc.cleared_at, ecc.cleared_by_name, ecc.remarks
               FROM exit_clearance_checklist ecc
               JOIN employees e ON e.id = ecc.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY e.date_of_exit DESC, ecc.clearance_area`;
      break;
    }

    // ── PERFORMANCE & KPI (Phase D) ─────────────────────────────────────────

    case "kpi-score-summary": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(ks.score_period,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    kmm.metric_name, ks.target_value, ks.actual_value,
                    ROUND(ks.actual_value / NULLIF(ks.target_value,0)*100,1) AS score_pct,
                    ks.rating, b.branch_name, p.process_name
               FROM kpi_score ks
               JOIN employees e ON e.id = ks.employee_id
               JOIN kpi_metric_master kmm ON kmm.id = ks.metric_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, kmm.metric_name`;
      break;
    }

    case "kpi-leaderboard": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(mks.score_period,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT mks.rank_position AS rank, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    mks.overall_score AS weighted_score_pct, mks.rating, mks.trend, b.branch_name, p.process_name
               FROM management_kpi_summary mks
               JOIN employees e ON e.id = mks.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY mks.rank_position ASC`;
      break;
    }

    case "below-target-kpi": {
      const month = monthParam(req.query.month);
      const threshold = Number(req.query.thresholdPct ?? 70);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(ks.score_period,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    kmm.metric_name, ks.target_value, ks.actual_value,
                    ROUND(ks.actual_value / NULLIF(ks.target_value,0)*100,1) AS score_pct,
                    (ks.target_value - ks.actual_value) AS gap, b.branch_name
               FROM kpi_score ks
               JOIN employees e ON e.id = ks.employee_id
               JOIN kpi_metric_master kmm ON kmm.id = ks.metric_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
                AND ks.actual_value / NULLIF(ks.target_value,0)*100 < ?
              ORDER BY score_pct ASC`;
      params.push(threshold);
      break;
    }

    case "appraisal-rating-summary": {
      if (req.query.cycle) { clauses.push("ar.appraisal_cycle = ?"); params.push(String(req.query.cycle)); }
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ar.appraisal_cycle, ar.self_rating, ar.manager_rating, ar.final_rating, ar.status,
                    ar.calibration_notes, b.branch_name
               FROM appraisal_rating ar
               JOIN employees e ON e.id = ar.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY ar.final_rating DESC NULLS LAST, employee_name`;
      break;
    }

    case "pip-register": {
      addEmployeeFilters(req.query, clauses, params);
      if (req.query.status) { clauses.push("pr.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    pr.start_date, pr.end_date, pr.reason, pr.status, pr.outcome, b.branch_name
               FROM pip_record pr
               JOIN employees e ON e.id = pr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY pr.start_date DESC`;
      break;
    }

    case "goal-completion-summary": {
      addEmployeeFilters(req.query, clauses, params);
      if (req.query.period) { clauses.push("g.period = ?"); params.push(String(req.query.period)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COUNT(*) AS total_goals,
                    SUM(g.status='completed') AS completed,
                    SUM(g.status='in_progress') AS in_progress,
                    SUM(g.status='not_started') AS not_started,
                    ROUND(SUM(COALESCE(g.completion_pct,0))/NULLIF(COUNT(*),0),1) AS avg_completion_pct
               FROM goal g
               JOIN employees e ON e.id = g.employee_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name
              ORDER BY avg_completion_pct DESC`;
      break;
    }

    case "training-needs-summary": {
      addEmployeeFilters(req.query, clauses, params);
      if (req.query.priority) { clauses.push("tn.priority = ?"); params.push(String(req.query.priority)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    sm.skill_name, tn.training_type, tn.priority,
                    tn.requested_date, tn.target_completion_date, tn.status
               FROM training_need tn
               JOIN employees e ON e.id = tn.employee_id
               LEFT JOIN skill_master sm ON sm.id = tn.skill_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY tn.priority, e.employee_code`;
      break;
    }

    case "feedback-360-summary": {
      if (req.query.cycle) { clauses.push("pfr.feedback_cycle = ?"); params.push(String(req.query.cycle)); }
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    pfr.feedback_cycle, pfr.total_reviewers, pfr.manager_score, pfr.peer_avg_score,
                    pfr.overall_score, pfr.strengths, pfr.development_areas, b.branch_name
               FROM performance_feedback_report pfr
               JOIN employees e ON e.id = pfr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY pfr.overall_score DESC NULLS LAST, employee_name`;
      break;
    }

    case "dialer-hours-report": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(dsl.session_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    dsl.session_date, dsl.login_minutes, dsl.call_count,
                    ROUND(dsl.login_minutes/60,2) AS login_hours,
                    p.process_name, b.branch_name
               FROM dialer_session_log dsl
               JOIN employees e ON e.id = dsl.employee_id
               LEFT JOIN process_master p ON p.id = dsl.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY dsl.session_date DESC, employee_name`;
      break;
    }

    case "coverage-gap-actions": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("rca.action_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.processId) { clauses.push("rca.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.status)    { clauses.push("rca.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT rca.action_date, p.process_name, rca.coverage_gap, rca.root_cause,
                    rca.recovery_plan, rca.owner, rca.due_by, rca.status
               FROM roster_coverage_action rca
               LEFT JOIN process_master p ON p.id = rca.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY rca.action_date DESC, rca.status`;
      break;
    }

    case "process-hc-vs-mandate": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("wm.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("DATE_FORMAT(wm.effective_from,'%Y-%m') <= ? AND (wm.effective_to IS NULL OR DATE_FORMAT(wm.effective_to,'%Y-%m') >= ?)");
      params.push(month, month);
      sql = `SELECT p.process_name, cm.client_name,
                    wm.mandated_headcount AS mandated_hc,
                    COUNT(DISTINCT e.id) AS actual_hc,
                    (wm.mandated_headcount - COUNT(DISTINCT e.id)) AS gap,
                    ROUND(COUNT(DISTINCT e.id) / NULLIF(wm.mandated_headcount,0)*100,1) AS actual_vs_mandate_pct
               FROM workforce_mandate wm
               JOIN process_master p ON p.id = wm.process_id
               LEFT JOIN client_master cm ON cm.id = p.client_id
               LEFT JOIN employees e ON e.process_id = p.id AND e.active_status = 1
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.id, p.process_name, cm.client_name, wm.mandated_headcount
              ORDER BY gap DESC`;
      break;
    }

    // ── COMPLIANCE / STATUTORY / ONBOARDING / GRIEVANCE ───────────────────────

    case "statutory-compliance-calendar": {
      const month = monthParam(req.query.month);
      clauses.push("DATE_FORMAT(scc.due_date,'%Y-%m') = ?"); params.push(month);
      if (req.query.state) { clauses.push("scc.state = ?"); params.push(String(req.query.state)); }
      if (req.query.status) { clauses.push("scc.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT scc.due_date, scc.regulation_name, scc.compliance_type, scc.state, scc.frequency,
                    scc.status, scc.assigned_to, scc.filed_at, scc.remarks
               FROM statutory_compliance_calendar scc
              WHERE ${clauses.join(" AND ")}
              ORDER BY scc.due_date ASC, scc.regulation_name`;
      break;
    }

    case "posh-compliance-register": {
      const year = String(req.query.year ?? new Date().getFullYear());
      clauses.push("YEAR(pc.incident_date) = ?"); params.push(year);
      if (req.query.branchId) { clauses.push("pc.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT pc.incident_code, pc.incident_date, b.branch_name,
                    pc.complainant_anonymous_flag, pc.respondent_designation,
                    pc.case_status, pc.inquiry_committee, pc.closure_date, pc.outcome
               FROM posh_complaint pc
               LEFT JOIN branch_master b ON b.id = pc.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY pc.incident_date DESC`;
      break;
    }

    case "labour-compliance-register": {
      const year = String(req.query.year ?? new Date().getFullYear());
      clauses.push("YEAR(lcr.period_date) = ?"); params.push(year);
      if (req.query.branchId) { clauses.push("lcr.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT b.branch_name, lcr.regulation_name, lcr.period_date, lcr.register_type,
                    lcr.status, lcr.inspected_at, lcr.inspector_name, lcr.remarks
               FROM labour_compliance_register lcr
               LEFT JOIN branch_master b ON b.id = lcr.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lcr.period_date DESC, b.branch_name`;
      break;
    }

    case "onboarding-doc-checklist": {
      if (req.query.branchId) { clauses.push("aor.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.status)   { clauses.push("aor.request_status = ?"); params.push(String(req.query.status)); }
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("aor.submitted_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT ac.candidate_code, CONCAT(ac.first_name,' ',COALESCE(ac.last_name,'')) AS candidate_name,
                    b.branch_name, p.process_name, aor.request_status,
                    GROUP_CONCAT(
                      CONCAT(odoc.document_type,': ',IF(odoc.file_path IS NOT NULL,'Uploaded','Missing'))
                      ORDER BY odoc.document_type SEPARATOR ' | '
                    ) AS document_status,
                    aor.submitted_at
               FROM ats_onboarding_request aor
               JOIN ats_candidate ac ON ac.id = aor.candidate_id
               LEFT JOIN branch_master b ON b.id = aor.branch_id
               LEFT JOIN process_master p ON p.id = aor.process_id
               LEFT JOIN onboarding_document odoc ON odoc.onboarding_request_id = aor.id
              WHERE ${clauses.join(" AND ")}
              GROUP BY aor.id, ac.candidate_code, ac.first_name, ac.last_name, b.branch_name, p.process_name, aor.request_status, aor.submitted_at
              ORDER BY aor.submitted_at DESC`;
      break;
    }

    case "bgv-completion-rate": {
      if (req.query.branchId)  { clauses.push("aor.branch_id = ?");  params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("aor.process_id = ?"); params.push(String(req.query.processId)); }
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("aor.submitted_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT b.branch_name, p.process_name,
                    COUNT(aor.id) AS total_onboarding_requests,
                    SUM(bg.overall_bgv_status = 'cleared') AS bgv_cleared,
                    SUM(bg.overall_bgv_status = 'pending') AS bgv_pending,
                    SUM(bg.overall_bgv_status = 'failed') AS bgv_failed,
                    ROUND(SUM(bg.overall_bgv_status='cleared')/NULLIF(COUNT(aor.id),0)*100,1) AS clearance_rate_pct
               FROM ats_onboarding_request aor
               LEFT JOIN branch_master b ON b.id = aor.branch_id
               LEFT JOIN process_master p ON p.id = aor.process_id
               LEFT JOIN candidate_bgv bg ON bg.candidate_id = aor.candidate_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.branch_name, p.process_name
              ORDER BY clearance_rate_pct ASC`;
      break;
    }

    case "esign-digilocker-status": {
      if (req.query.branchId) { clauses.push("aor.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.status)   { clauses.push("aeo.esign_status = ?"); params.push(String(req.query.status)); }
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("aeo.created_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT ac.candidate_code, CONCAT(ac.first_name,' ',COALESCE(ac.last_name,'')) AS candidate_name,
                    b.branch_name, aeo.offer_date, aeo.esign_status, aeo.esign_completed_at,
                    aeo.digilocker_verified, aeo.appointment_letter_sent_at
               FROM ats_employment_offer aeo
               JOIN ats_onboarding_request aor ON aor.candidate_id = aeo.candidate_id
               JOIN ats_candidate ac ON ac.id = aeo.candidate_id
               LEFT JOIN branch_master b ON b.id = aor.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY aeo.created_at DESC`;
      break;
    }

    case "grievance-tat-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("g.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.status) { clauses.push("g.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT g.grievance_code, g.category, g.status, g.created_at, g.resolved_at,
                    TIMESTAMPDIFF(HOUR, g.created_at, COALESCE(g.resolved_at, NOW())) AS tat_hours,
                    CASE WHEN g.target_tat_hours IS NOT NULL AND
                              TIMESTAMPDIFF(HOUR,g.created_at,COALESCE(g.resolved_at,NOW())) > g.target_tat_hours
                         THEN 'BREACHED' ELSE 'ON TIME' END AS tat_status,
                    g.assigned_to, g.resolution_summary
               FROM grievance g
              WHERE ${clauses.join(" AND ")}
              ORDER BY tat_hours DESC`;
      break;
    }

    case "grievance-category-analysis": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("g.created_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT g.category, COUNT(*) AS total,
                    SUM(g.status = 'resolved') AS resolved,
                    SUM(g.status = 'open') AS open_count,
                    SUM(g.status = 'escalated') AS escalated,
                    ROUND(AVG(TIMESTAMPDIFF(HOUR,g.created_at,COALESCE(g.resolved_at,NOW()))),1) AS avg_tat_hours,
                    ROUND(SUM(g.status='resolved')/NULLIF(COUNT(*),0)*100,1) AS resolution_rate_pct
               FROM grievance g
              WHERE ${clauses.join(" AND ")}
              GROUP BY g.category
              ORDER BY total DESC`;
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE E — WFM, ASSETS, INTEGRATION, PORTAL
    // ══════════════════════════════════════════════════════════════════════════

    case "roster-adherence": {
      const month = monthParam(req.query.month);
      clauses.push("DATE_FORMAT(sds.snapshot_date,'%Y-%m') = ?"); params.push(month);
      if (req.query.branchId)  { clauses.push("sds.branch_id = ?");  params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("sds.process_id = ?"); params.push(String(req.query.processId)); }
      sql = `SELECT wrc.cycle_week, b.branch_name, p.process_name,
                    SUM(sds.rostered_headcount) AS rostered_hc, SUM(sds.present_headcount) AS present_hc,
                    SUM(sds.absent_headcount) AS absent_hc,
                    ROUND(SUM(sds.present_headcount)/NULLIF(SUM(sds.rostered_headcount),0)*100,2) AS coverage_pct,
                    wrc.status
               FROM shrinkage_daily_snapshot sds
               LEFT JOIN branch_master b ON b.id = sds.branch_id
               LEFT JOIN process_master p ON p.id = sds.process_id
               LEFT JOIN weekly_roster_cycle wrc ON wrc.process_id = sds.process_id
                 AND sds.snapshot_date BETWEEN wrc.week_start_date AND wrc.week_end_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY wrc.cycle_week, b.branch_name, p.process_name, wrc.status
              ORDER BY wrc.cycle_week DESC`;
      break;
    }

    case "workforce-mandate-vs-actual": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("wm.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.branchId) { clauses.push("p.branch_id = ?"); params.push(String(req.query.branchId)); }
      clauses.push("DATE_FORMAT(wm.effective_from,'%Y-%m') <= ? AND (wm.effective_to IS NULL OR DATE_FORMAT(wm.effective_to,'%Y-%m') >= ?)");
      params.push(month, month);
      sql = `SELECT p.process_name, b.branch_name, wm.mandated_headcount,
                    COUNT(DISTINCT e.id) AS actual_hc,
                    (wm.mandated_headcount - COUNT(DISTINCT e.id)) AS gap
               FROM workforce_mandate wm
               JOIN process_master p ON p.id = wm.process_id
               LEFT JOIN branch_master b ON b.id = p.branch_id
               LEFT JOIN employees e ON e.process_id = p.id AND e.active_status = 1
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.id, p.process_name, b.branch_name, wm.mandated_headcount
              ORDER BY gap DESC`;
      break;
    }

    case "roster-change-audit": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.processId) { clauses.push("rcl.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("rcl.changed_at BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    rcl.change_type, rcl.roster_date, rcl.old_shift_code, rcl.new_shift_code, rcl.reason,
                    COALESCE(NULLIF(ch.full_name,''), CONCAT(ch.first_name,' ',COALESCE(ch.last_name,''))) AS changed_by,
                    rcl.changed_at
               FROM roster_change_log rcl
               JOIN employees e ON e.id = rcl.employee_id
               LEFT JOIN employees ch ON ch.user_id = rcl.changed_by_user_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY rcl.changed_at DESC`;
      break;
    }

    case "roster-cycle-status": {
      const month = monthParam(req.query.month);
      clauses.push("DATE_FORMAT(wrc.week_start_date,'%Y-%m') = ?"); params.push(month);
      if (req.query.processId) { clauses.push("wrc.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.branchId)  { clauses.push("p.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT wrc.cycle_week, wrc.week_start_date, wrc.week_end_date,
                    p.process_name, b.branch_name, wrc.status,
                    COALESCE(NULLIF(pub.full_name,''), CONCAT(pub.first_name,' ',COALESCE(pub.last_name,''))) AS published_by,
                    wrc.published_at, wrc.locked_at, wrc.payroll_input_ready_at
               FROM weekly_roster_cycle wrc
               LEFT JOIN process_master p ON p.id = wrc.process_id
               LEFT JOIN branch_master b ON b.id = p.branch_id
               LEFT JOIN employees pub ON pub.user_id = wrc.published_by_user_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY wrc.cycle_week DESC`;
      break;
    }

    case "asset-inventory-report": {
      addEmployeeFilters(req.query, clauses, params, "e");
      if (req.query.category) { clauses.push("am.category = ?"); params.push(String(req.query.category)); }
      if (req.query.status) { clauses.push("am.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT am.asset_code, am.asset_name, am.category, am.serial_number,
                    am.purchase_date, am.purchase_cost, am.status, am.warranty_expiry,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS assigned_to,
                    b.branch_name
               FROM asset_master am
               LEFT JOIN asset_assignment aa ON aa.asset_id = am.id AND aa.returned_date IS NULL
               LEFT JOIN employees e ON e.id = aa.employee_id
               LEFT JOIN branch_master b ON b.id = COALESCE(e.branch_id, am.branch_id)
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY am.category, am.asset_name`;
      break;
    }

    case "asset-assignment-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("aa.assigned_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    am.asset_code, am.asset_name, am.category,
                    aa.assigned_date, aa.returned_date, aa.condition_at_assignment,
                    b.branch_name
               FROM asset_assignment aa
               JOIN employees e ON e.id = aa.employee_id
               JOIN asset_master am ON am.id = aa.asset_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY aa.assigned_date DESC`;
      break;
    }

    case "asset-service-log": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.branchId) { clauses.push("am.branch_id = ?"); params.push(String(req.query.branchId)); }
      clauses.push("asl.service_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT am.asset_code, am.asset_name, asl.service_date, asl.service_type,
                    asl.cost, asl.performed_by, asl.notes
               FROM asset_service_log asl
               JOIN asset_master am ON am.id = asl.asset_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY asl.service_date DESC`;
      break;
    }

    case "employee-document-compliance": {
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      if (req.query.docType) { clauses.push("ed.document_type = ?"); params.push(String(req.query.docType)); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ed.document_type, ed.file_url IS NOT NULL AS uploaded,
                    COALESCE(ed.verified, 0) AS verified, ed.expiry_date, b.branch_name
               FROM employees e
               LEFT JOIN employee_documents ed ON ed.employee_id = e.id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, ed.document_type`;
      break;
    }

    case "integration-run-history": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("icr.started_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.integrationKey) { clauses.push("icr.connector_key = ?"); params.push(String(req.query.integrationKey)); }
      if (req.query.status) { clauses.push("icr.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT icr.connector_key AS integration_key, icr.status,
                    icr.rows_fetched, icr.rows_staged, icr.rows_promoted, icr.rows_failed,
                    icr.duration_ms, icr.started_at, icr.completed_at,
                    COALESCE(NULLIF(u.full_name,''), CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS triggered_by,
                    icr.error_summary
               FROM integration_connector_run icr
               LEFT JOIN employees u ON u.user_id = icr.triggered_by_user_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY icr.started_at DESC`;
      break;
    }

    case "tat-escalation-breach": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("tti.due_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.taskType) { clauses.push("tti.task_type_key = ?"); params.push(String(req.query.taskType)); }
      clauses.push("tti.sla_breached = 1");
      sql = `SELECT tti.task_type_key, tti.entity_id, tti.due_at, tti.completed_at,
                    TIMESTAMPDIFF(HOUR, tti.due_at, COALESCE(tti.completed_at, NOW())) AS breach_hours,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS assigned_to,
                    COUNT(tel.id) AS escalation_count
               FROM task_tat_instance tti
               LEFT JOIN employees e ON e.user_id = tti.assigned_to_user_id
               LEFT JOIN task_escalation_log tel ON tel.tat_instance_id = tti.id
              WHERE ${clauses.join(" AND ")}
              GROUP BY tti.id, tti.task_type_key, tti.entity_id, tti.due_at, tti.completed_at, e.id, e.full_name, e.first_name, e.last_name
              ORDER BY breach_hours DESC`;
      break;
    }

    case "sensitive-action-audit": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("sal.acted_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.module) { clauses.push("sal.module_key = ?"); params.push(String(req.query.module)); }
      if (req.query.actionType) { clauses.push("sal.action_type = ?"); params.push(String(req.query.actionType)); }
      sql = `SELECT sal.acted_at, sal.action_type, sal.module_key, sal.entity_type, sal.entity_id,
                    sal.change_summary, sal.ip_address,
                    COALESCE(NULLIF(u.full_name,''), CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS actor_name
               FROM sensitive_action_log sal
               LEFT JOIN employees u ON u.user_id = sal.actor_user_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY sal.acted_at DESC`;
      break;
    }

    case "communication-dispatch-log": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("dl.sent_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.channel) { clauses.push("dl.channel = ?"); params.push(String(req.query.channel)); }
      if (req.query.status) { clauses.push("dl.delivery_status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT dl.sent_at, dl.channel, dl.recipient, dl.template_code, dl.delivery_status,
                    dl.delivered_at, dl.opened_at, dl.error_message
               FROM dispatch_log dl
              WHERE ${clauses.join(" AND ")}
              ORDER BY dl.sent_at DESC`;
      break;
    }

    case "helpdesk-ticket-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("ht.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.ticketCategory) { clauses.push("ht.category = ?"); params.push(String(req.query.ticketCategory)); }
      if (req.query.status) { clauses.push("ht.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT ht.ticket_code, ht.category, ht.priority, ht.status,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(NULLIF(ag.full_name,''), CONCAT(ag.first_name,' ',COALESCE(ag.last_name,''))) AS assigned_to,
                    ht.created_at, ht.resolved_at, ht.resolution_note,
                    TIMESTAMPDIFF(HOUR, ht.created_at, COALESCE(ht.resolved_at, NOW())) AS resolution_hrs
               FROM helpdesk_ticket ht
               JOIN employees e ON e.id = ht.employee_id
               LEFT JOIN employees ag ON ag.user_id = ht.assigned_to_user_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ht.created_at DESC`;
      break;
    }

    case "grievance-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("g.created_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.status) { clauses.push("g.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT g.grievance_code, g.category, g.status,
                    CASE WHEN g.is_anonymous = 1 THEN 'Anonymous' ELSE COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) END AS submitted_by,
                    COALESCE(NULLIF(ag.full_name,''), CONCAT(ag.first_name,' ',COALESCE(ag.last_name,''))) AS assigned_to,
                    g.created_at, g.resolved_at, g.resolution_summary
               FROM grievance g
               LEFT JOIN employees e ON e.id = g.employee_id AND g.is_anonymous = 0
               LEFT JOIN employees ag ON ag.user_id = g.assigned_to_user_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY g.created_at DESC`;
      break;
    }

    case "dpdp-consent-status": {
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    dc.purpose_code, dc.consented_at, dc.withdrawn_at, dc.channel,
                    CASE WHEN dc.withdrawn_at IS NOT NULL THEN 'Withdrawn'
                         WHEN dc.consented_at IS NOT NULL THEN 'Active'
                         ELSE 'Not Given' END AS consent_status
               FROM data_consent dc
               JOIN employees e ON e.id = dc.employee_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY e.employee_code, dc.purpose_code`;
      break;
    }

    case "portal-kpi-commitment-vs-actual": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("gpc.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("DATE_FORMAT(gpc.commitment_month,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT p.process_name, gpc.metric_name, gpc.committed_value, ks.actual_value,
                    ROUND(ks.actual_value / NULLIF(gpc.committed_value,0)*100,2) AS achievement_pct,
                    CASE WHEN ks.actual_value >= gpc.committed_value THEN 'MET' ELSE 'MISSED' END AS status
               FROM glide_path_commitment gpc
               LEFT JOIN process_master p ON p.id = gpc.process_id
               LEFT JOIN kpi_score ks ON ks.process_id = gpc.process_id
                 AND ks.metric_key = gpc.metric_code
                 AND DATE_FORMAT(ks.score_period,'%Y-%m') = DATE_FORMAT(gpc.commitment_month,'%Y-%m')
              WHERE ${clauses.join(" AND ")}
              ORDER BY p.process_name, gpc.metric_name`;
      break;
    }

    case "action-plan-status": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("ap.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("DATE_FORMAT(ap.due_date,'%Y-%m') = ?"); params.push(month);
      if (req.query.status) { clauses.push("ap.status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT p.process_name, ap.action_text, ap.owner_level, ap.owner_name,
                    ap.due_date, ap.status, ap.completed_at
               FROM action_plan ap
               LEFT JOIN process_master p ON p.id = ap.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ap.due_date, ap.status`;
      break;
    }

    case "governance-checklist-completion": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("gcl.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("DATE_FORMAT(gcl.log_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT p.process_name, gam.activity_name, gam.level, gam.frequency,
                    COUNT(gcl.id) AS completed_count,
                    ROUND(COUNT(gcl.id) / NULLIF(
                      CASE gam.frequency WHEN 'daily' THEN DAY(LAST_DAY(STR_TO_DATE(CONCAT(?,'-01'),'%Y-%m-%d')))
                                         WHEN 'weekly' THEN 4
                                         ELSE 1 END, 0)*100, 1) AS compliance_pct
               FROM governance_checklist_log gcl
               JOIN governance_activity_master gam ON gam.id = gcl.activity_id
               LEFT JOIN process_master p ON p.id = gcl.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, gam.id, gam.activity_name, gam.level, gam.frequency
              ORDER BY compliance_pct ASC`;
      params.push(month);
      break;
    }

    case "portal-access-log": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("pal.accessed_at BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.clientId) { clauses.push("cm.id = ?"); params.push(String(req.query.clientId)); }
      sql = `SELECT cm.client_name, cu.username AS user_name, pal.page_accessed,
                    pal.ip_address, pal.accessed_at
               FROM portal_access_log pal
               JOIN client_user cu ON cu.id = pal.client_user_id
               JOIN client_master cm ON cm.id = cu.client_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY pal.accessed_at DESC`;
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PRODUCTIVITY ANALYTICS — CEO / All Levels
    // ══════════════════════════════════════════════════════════════════════════

    case "productivity-individual-scorecard": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.shiftCode)  { clauses.push("wra.shift_code = ?"); params.push(String(req.query.shiftCode)); }
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    b.branch_name, p.process_name, cc.cost_centre_name,
                    COUNT(adr.id) AS working_days,
                    SUM(adr.attendance_status = 'present') AS present_days,
                    SUM(adr.late_mark = 1) AS late_days,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_login_hours,
                    ROUND(AVG(NULLIF(adr.present_minutes,0))/60,2) AS avg_daily_login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/60,1) AS dialer_login_hours,
                    ROUND(COALESCE(AVG(dsl.avg_handle_time_secs),0)/60,2) AS avg_aht_mins,
                    ROUND(SUM(adr.attendance_status='present') / NULLIF(COUNT(adr.id),0)*100,1) AS attendance_pct,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0) / NULLIF(SUM(adr.present_minutes),0)*100,1) AS utilization_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
               LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = e.id AND wra.roster_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, p.process_name, cc.cost_centre_name
              ORDER BY utilization_pct DESC NULLS LAST, employee_name`;
      break;
    }

    case "productivity-daily-heatmap": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date,
                    b.branch_name, p.process_name, cc.cost_centre_name,
                    COUNT(DISTINCT e.id) AS total_employees,
                    SUM(adr.attendance_status='present') AS present_count,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_login_hours,
                    ROUND(AVG(NULLIF(adr.present_minutes,0))/60,2) AS avg_login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS utilization_pct,
                    ROUND(SUM(adr.attendance_status='present')/NULLIF(COUNT(DISTINCT e.id),0)*100,1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY adr.record_date, b.branch_name, p.process_name, cc.cost_centre_name
              ORDER BY adr.record_date DESC`;
      break;
    }

    case "productivity-top-bottom-performers": {
      const month = monthParam(req.query.month);
      const topN  = Math.min(Math.max(1, Number(req.query.topN ?? 10)), 100);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    b.branch_name, p.process_name, cc.cost_centre_name,
                    SUM(adr.attendance_status='present') AS present_days,
                    ROUND(SUM(adr.present_minutes)/60,1) AS login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(AVG(dsl.avg_handle_time_secs),0)/60,2) AS avg_aht_mins,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS utilization_pct,
                    ROUND(SUM(adr.attendance_status='present')/NULLIF(COUNT(adr.id),0)*100,1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id
                 AND DATE_FORMAT(dsl.session_date,'%Y-%m') = DATE_FORMAT(adr.record_date,'%Y-%m')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, p.process_name, cc.cost_centre_name
              ORDER BY utilization_pct DESC`;
      /* topN rows via queryRows limit override */
      const topData = await queryRows(sql, params, topN);
      return res.json({ success: true, code, data: topData, meta: { count: topData.length, limit: topN } });
    }

    case "productivity-team-rollup": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT COALESCE(NULLIF(mgr.full_name,''), CONCAT(mgr.first_name,' ',COALESCE(mgr.last_name,''))) AS team_manager,
                    b.branch_name, p.process_name, cc.cost_centre_name,
                    COUNT(DISTINCT e.id) AS team_size,
                    SUM(adr.attendance_status='present') AS total_present,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_login_hours,
                    ROUND(AVG(NULLIF(adr.present_minutes,0))/60,2) AS avg_daily_login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS team_utilization_pct,
                    ROUND(SUM(adr.attendance_status='present')/NULLIF(COUNT(adr.id),0)*100,1) AS team_attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY COALESCE(e.reporting_manager_id,e.manager_id), b.branch_name, p.process_name, cc.cost_centre_name
              ORDER BY team_utilization_pct DESC NULLS LAST`;
      break;
    }

    case "productivity-process-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT p.process_name, b.branch_name, cc.cost_centre_name,
                    COUNT(DISTINCT e.id) AS headcount,
                    SUM(adr.attendance_status='present') AS total_present,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_login_hours,
                    ROUND(AVG(NULLIF(adr.present_minutes,0))/60,2) AS avg_daily_login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(AVG(dsl.avg_handle_time_secs),0)/60,2) AS avg_aht_mins,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS utilization_pct,
                    ROUND(SUM(adr.attendance_status='present')/NULLIF(COUNT(adr.id),0)*100,1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.id, p.process_name, b.branch_name, cc.cost_centre_name
              ORDER BY utilization_pct DESC NULLS LAST`;
      break;
    }

    case "productivity-aht-trend": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.processId) { clauses.push("e.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.branchId)  { clauses.push("e.branch_id = ?");  params.push(String(req.query.branchId)); }
      clauses.push("dsl.session_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(dsl.session_date,'%Y-%m-%d') AS session_date,
                    p.process_name, b.branch_name,
                    COUNT(DISTINCT dsl.employee_id) AS agent_count,
                    SUM(dsl.call_count) AS total_calls,
                    ROUND(AVG(NULLIF(dsl.avg_handle_time_secs,0))/60,2) AS avg_aht_mins,
                    ROUND(SUM(dsl.login_minutes)/60,1) AS total_dialer_hours
               FROM dialer_session_log dsl
               JOIN employees e ON e.id = dsl.employee_id
               LEFT JOIN process_master p ON p.id = COALESCE(dsl.process_id, e.process_id)
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(dsl.session_date,'%Y-%m-%d'), p.id, b.branch_name
              ORDER BY session_date ASC`;
      break;
    }

    case "productivity-branch-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.branchId)      { clauses.push("e.branch_id = ?");       params.push(String(req.query.branchId)); }
      if (req.query.costCentreId)  { clauses.push("e.cost_centre_id = ?");  params.push(String(req.query.costCentreId)); }
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT b.branch_name,
                    COUNT(DISTINCT e.id) AS headcount,
                    SUM(adr.attendance_status='present') AS total_present,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(AVG(dsl.avg_handle_time_secs),0)/60,2) AS avg_aht_mins,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS utilization_pct,
                    ROUND(SUM(adr.attendance_status='present')/NULLIF(COUNT(adr.id),0)*100,1) AS attendance_pct,
                    ROUND(SUM(adr.late_mark=1)/NULLIF(COUNT(adr.id),0)*100,1) AS late_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.id, b.branch_name
              ORDER BY utilization_pct DESC NULLS LAST`;
      break;
    }

    case "productivity-cost-centre-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT cc.cost_centre_code, cc.cost_centre_name, b.branch_name, p.process_name,
                    COUNT(DISTINCT e.id) AS headcount,
                    SUM(adr.attendance_status='present') AS total_present,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(AVG(dsl.avg_handle_time_secs),0)/60,2) AS avg_aht_mins,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS utilization_pct,
                    ROUND(SUM(adr.attendance_status='present')/NULLIF(COUNT(adr.id),0)*100,1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.cost_centre_id, cc.cost_centre_code, cc.cost_centre_name, b.branch_name, p.process_name
              ORDER BY utilization_pct DESC NULLS LAST`;
      break;
    }

    case "productivity-org-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT
                    COUNT(DISTINCT e.id) AS total_employees,
                    COUNT(DISTINCT adr.record_date) AS working_days,
                    SUM(adr.attendance_status='present') AS total_present_slots,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_login_hours,
                    ROUND(AVG(NULLIF(adr.present_minutes,0))/60,2) AS avg_daily_login_hours_per_agent,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(AVG(NULLIF(dsl.avg_handle_time_secs,0)),0)/60,2) AS org_avg_aht_mins,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS org_utilization_pct,
                    ROUND(SUM(adr.attendance_status='present')/NULLIF(COUNT(adr.id),0)*100,1) AS org_attendance_pct,
                    ROUND(SUM(adr.late_mark=1)/NULLIF(COUNT(adr.id),0)*100,1) AS org_late_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
              WHERE ${clauses.join(" AND ")}`;
      break;
    }

    case "productivity-occupancy-utilization": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(adr.record_date,'%Y-%m') AS month,
                    p.process_name, b.branch_name, cc.cost_centre_name,
                    ROUND(SUM(adr.present_minutes)/60,1) AS total_available_hours,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/60,1) AS total_dialer_hours,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS occupancy_pct,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(sds.rostered_headcount * 480),0)*100,1) AS utilization_vs_rostered_pct,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(AVG(NULLIF(dsl.avg_handle_time_secs,0)),0)/60,2) AS avg_aht_mins
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = adr.record_date
               LEFT JOIN shrinkage_daily_snapshot sds ON sds.branch_id = e.branch_id AND sds.process_id = e.process_id AND sds.snapshot_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), p.id, b.id, e.cost_centre_id
              ORDER BY month ASC, p.process_name`;
      break;
    }

    case "productivity-adherence-vs-kpi": {
      const month = monthParam(req.query.month);
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("DATE_FORMAT(arr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name, b.branch_name, cc.cost_centre_name,
                    ROUND(AVG(COALESCE(arr.adherence_pct,0)),1) AS avg_schedule_adherence_pct,
                    ROUND(AVG(NULLIF(adr.present_minutes,0))/60,2) AS avg_daily_login_hours,
                    COALESCE(SUM(dsl.call_count),0) AS total_calls,
                    ROUND(COALESCE(AVG(NULLIF(dsl.avg_handle_time_secs,0)),0)/60,2) AS avg_aht_mins,
                    ROUND(COALESCE(SUM(dsl.login_minutes),0)/NULLIF(SUM(adr.present_minutes),0)*100,1) AS utilization_pct,
                    ROUND(AVG(COALESCE(ks.actual_value/NULLIF(ks.target_value,0)*100,0)),1) AS avg_kpi_score_pct
               FROM attendance_reconciliation_record arr
               JOIN employees e ON e.id = arr.employee_id
               LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND adr.record_date = arr.record_date
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN dialer_session_log dsl ON dsl.employee_id = e.id AND dsl.session_date = arr.record_date
               LEFT JOIN kpi_score ks ON ks.employee_id = e.id AND DATE_FORMAT(ks.score_period,'%Y-%m') = DATE_FORMAT(arr.record_date,'%Y-%m')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, b.branch_name, cc.cost_centre_name
              ORDER BY avg_schedule_adherence_pct DESC`;
      break;
    }

    case "productivity-shrinkage-impact": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("sds.snapshot_date BETWEEN ? AND ?"); params.push(from, to);
      if (req.query.branchId)  { clauses.push("sds.branch_id = ?");  params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("sds.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.costCentreId) { clauses.push("e.cost_centre_id = ?"); params.push(String(req.query.costCentreId)); }
      sql = `SELECT DATE_FORMAT(sds.snapshot_date,'%Y-%m') AS month,
                    b.branch_name, p.process_name,
                    ROUND(AVG(sds.total_shrinkage_pct),2) AS avg_shrinkage_pct,
                    ROUND(AVG(sds.planned_shrinkage_pct),2) AS avg_planned_shrinkage_pct,
                    ROUND(AVG(sds.unplanned_shrinkage_pct),2) AS avg_unplanned_shrinkage_pct,
                    ROUND(SUM(COALESCE(dsl_agg.total_calls,0)),0) AS total_calls,
                    ROUND(AVG(COALESCE(dsl_agg.avg_aht_mins,0)),2) AS avg_aht_mins,
                    ROUND(AVG(COALESCE(dsl_agg.utilization_pct,0)),1) AS avg_utilization_pct,
                    ROUND(SUM(sds.rostered_headcount) - SUM(sds.present_headcount),0) AS total_lost_agent_days,
                    ROUND((SUM(sds.rostered_headcount) - SUM(sds.present_headcount)) * 8,0) AS total_lost_hours
               FROM shrinkage_daily_snapshot sds
               LEFT JOIN branch_master b ON b.id = sds.branch_id
               LEFT JOIN process_master p ON p.id = sds.process_id
               LEFT JOIN (
                 SELECT DATE_FORMAT(dsl.session_date,'%Y-%m') AS month,
                        e2.process_id, e2.branch_id,
                        SUM(dsl.call_count) AS total_calls,
                        ROUND(AVG(NULLIF(dsl.avg_handle_time_secs,0))/60,2) AS avg_aht_mins,
                        ROUND(SUM(dsl.login_minutes)/NULLIF(SUM(adr2.present_minutes),0)*100,1) AS utilization_pct
                   FROM dialer_session_log dsl
                   JOIN employees e2 ON e2.id = dsl.employee_id
                   LEFT JOIN attendance_daily_record adr2 ON adr2.employee_id = e2.id AND adr2.record_date = dsl.session_date
                  GROUP BY DATE_FORMAT(dsl.session_date,'%Y-%m'), e2.process_id, e2.branch_id
               ) dsl_agg ON dsl_agg.process_id = sds.process_id AND dsl_agg.branch_id = sds.branch_id
                 AND dsl_agg.month = DATE_FORMAT(sds.snapshot_date,'%Y-%m')
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(sds.snapshot_date,'%Y-%m'), b.branch_name, p.process_name
              ORDER BY month ASC, avg_shrinkage_pct DESC`;
      break;
    }

    default:
      return res.status(404).json({ success: false, message: "Unknown report code", available: CATALOG });
  }

  const data = await queryRows(sql, params, limit);
  return res.json({ success: true, code, data, meta: { count: data.length, limit } });
}));
