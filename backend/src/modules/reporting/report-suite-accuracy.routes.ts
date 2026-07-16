import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const reportSuiteAccuracyRouter = Router();
reportSuiteAccuracyRouter.use(requireAuth);

const roles = requireRole(
  "super_admin",
  "admin",
  "hr",
  "finance",
  "payroll",
  "payroll_head",
  "wfm",
  "manager",
  "ceo",
);

const ACCURACY_CODES = new Set([
  "attendance-daily",
  "daily-hc-shift",
  "shift-adherence-detail",
  "attendance-summary",
  "late-arrival-summary",
  "overtime-summary",
  "biometric-reconciliation",
  "regularization-summary",
  "attendance-dispute-summary",
  "habitual-absentee-list",
  "daily-shrinkage-report",
  "monthly-shrinkage-trend",
  "punch-raw-export",
  "payroll-register",
  "payroll-variance",
  "payslip-status",
  "ytd-salary-summary",
  "cost-centre-salary-summary",
  "process-lob-salary-cost",
  "grade-salary-distribution",
  "salary-advance-register",
  "lwp-deduction-register",
]);

const REPORT_SOURCES: Record<string, string[]> = {
  "attendance-daily": ["attendance_daily_record", "integration_biometric_daily", "employees"],
  "daily-hc-shift": ["wfm_roster_assignment", "wfm_shift_master", "attendance_daily_record"],
  "shift-adherence-detail": ["wfm_roster_assignment", "wfm_shift_master", "integration_biometric_daily"],
  "attendance-summary": ["attendance_daily_record", "employees", "salary_prep_run", "salary_prep_line"],
  "late-arrival-summary": ["attendance_daily_record", "wfm_roster_assignment", "wfm_shift_master", "integration_biometric_daily"],
  "overtime-summary": ["attendance_daily_record", "wfm_roster_assignment", "wfm_shift_master", "integration_biometric_daily"],
  "biometric-reconciliation": ["attendance_daily_record", "integration_biometric_daily"],
  "regularization-summary": ["attendance_regularization", "employees"],
  "attendance-dispute-summary": ["attendance_regularization", "employees"],
  "habitual-absentee-list": ["attendance_daily_record", "employees"],
  "daily-shrinkage-report": ["wfm_roster_assignment", "attendance_daily_record", "employees"],
  "monthly-shrinkage-trend": ["wfm_roster_assignment", "attendance_daily_record", "employees"],
  "punch-raw-export": ["integration_biometric_daily", "employees"],
  "payroll-register": ["salary_prep_run", "salary_prep_line", "employees"],
  "payroll-variance": ["salary_prep_run", "salary_prep_line", "employees"],
  "payslip-status": ["salary_prep_run", "salary_prep_line", "salary_payslip"],
  "ytd-salary-summary": ["salary_prep_run", "salary_prep_line", "employees"],
  "cost-centre-salary-summary": ["salary_prep_run", "salary_prep_line", "cost_centre_master"],
  "process-lob-salary-cost": ["salary_prep_run", "salary_prep_line", "process_master", "lob_master"],
  "grade-salary-distribution": ["salary_prep_run", "salary_prep_line", "grade_band_master"],
  "salary-advance-register": ["salary_advance_log", "employees"],
  "lwp-deduction-register": ["salary_prep_run", "salary_prep_line", "attendance_daily_record"],
};

const PAYROLL_STATUS_RANK = `CASE LOWER(COALESCE(spr.status,''))
  WHEN 'paid' THEN 100 WHEN 'released' THEN 95 WHEN 'disbursed' THEN 90
  WHEN 'finalized' THEN 85 WHEN 'locked' THEN 80 WHEN 'approved' THEN 75
  WHEN 'calculated' THEN 70 WHEN 'reviewed' THEN 65 WHEN 'processing' THEN 60
  ELSE 10 END`;

function dateParam(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function monthParam(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 7);
}

function limitParam(value: unknown) {
  const n = Number(value ?? 5000);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100000) : 5000;
}

function addEmployeeFilters(query: any, clauses: string[], params: unknown[], alias = "e") {
  if (query.branchId) { clauses.push(`${alias}.branch_id = ?`); params.push(String(query.branchId)); }
  if (query.departmentId) { clauses.push(`${alias}.department_id = ?`); params.push(String(query.departmentId)); }
  if (query.processId) { clauses.push(`${alias}.process_id = ?`); params.push(String(query.processId)); }
  if (query.costCentreId) { clauses.push(`${alias}.cost_centre_id = ?`); params.push(String(query.costCentreId)); }
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { from, to, days: Number(to.slice(8, 10)) };
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dt = new Date(Date.UTC(year, monthNumber - 2, 1));
  return dt.toISOString().slice(0, 7);
}

async function queryRows(sql: string, params: unknown[], limit: number) {
  const [rows] = await db.execute<RowDataPacket[]>(`${sql}\nLIMIT ${limit}`, params);
  return rows as Record<string, unknown>[];
}

function responseMeta(code: string, rows: Record<string, unknown>[], warnings: string[] = []) {
  return {
    reportCode: code,
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
    accuracyStatus: warnings.length ? "validated_with_warnings" : "validated_query",
    sourceTables: REPORT_SOURCES[code] ?? [],
    warnings,
    assurance: "The query prevents known duplicate-run and duplicate-join risks. Final business accuracy still depends on source-data completeness and report-health checks.",
  };
}

function sendRows(res: Response, code: string, rows: Record<string, unknown>[], warnings: string[] = []) {
  return res.json({ success: true, code, data: rows, meta: responseMeta(code, rows, warnings) });
}

const schemaCache = new Map<string, Set<string>>();
async function getColumns(table: string) {
  if (schemaCache.has(table)) return schemaCache.get(table)!;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  const result = new Set(rows.map((row) => String(row.COLUMN_NAME)));
  schemaCache.set(table, result);
  return result;
}

function canonicalPayrollCte(whereSql: string) {
  return `WITH ranked_payroll AS (
    SELECT spl.*, spr.run_month, spr.status AS run_status, spr.created_at AS run_created_at,
           spr.updated_at AS run_updated_at,
           ROW_NUMBER() OVER (
             PARTITION BY spr.run_month, spl.employee_id
             ORDER BY ${PAYROLL_STATUS_RANK} DESC, spr.updated_at DESC, spr.created_at DESC, spr.id DESC
           ) AS line_rank
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
     WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
       AND ${whereSql}
  ), canonical_payroll AS (
    SELECT * FROM ranked_payroll WHERE line_rank = 1
  )`;
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

reportSuiteAccuracyRouter.get("/health", roles, async (_req, res, next) => {
  try {
    const criticalTables = Array.from(new Set(Object.values(REPORT_SOURCES).flat()));
    const placeholders = criticalTables.map(() => "?").join(",");
    const [tableRows] = await db.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME AS table_name, TABLE_ROWS AS estimated_rows, UPDATE_TIME AS last_updated
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})
        ORDER BY TABLE_NAME`,
      criticalTables,
    );

    const [riskRows] = await db.execute<RowDataPacket[]>(`
      SELECT 'attendance_without_roster_30d' AS check_name, COUNT(*) AS issue_count
        FROM attendance_daily_record adr
       WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         AND NOT EXISTS (
           SELECT 1 FROM wfm_roster_assignment wra
            WHERE wra.employee_id = adr.employee_id AND wra.roster_date = adr.record_date
         )
      UNION ALL
      SELECT 'duplicate_payroll_employee_month', COUNT(*) AS issue_count
        FROM (
          SELECT spr.run_month, spl.employee_id
            FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id
           WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
           GROUP BY spr.run_month, spl.employee_id
          HAVING COUNT(*) > 1
        ) d
      UNION ALL
      SELECT 'payroll_header_line_total_mismatch', COUNT(*) AS issue_count
        FROM (
          SELECT spr.id
            FROM salary_prep_run spr
            LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
           WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
           GROUP BY spr.id, spr.total_employees, spr.total_gross, spr.total_deductions, spr.total_net
          HAVING ABS(COALESCE(spr.total_gross,0)-COALESCE(SUM(spl.gross_salary),0)) > 1
              OR ABS(COALESCE(spr.total_deductions,0)-COALESCE(SUM(spl.total_deductions),0)) > 1
              OR ABS(COALESCE(spr.total_net,0)-COALESCE(SUM(spl.net_salary),0)) > 1
              OR COALESCE(spr.total_employees,0) <> COUNT(spl.id)
        ) p
    `);

    return res.json({
      success: true,
      data: {
        status: riskRows.every((row) => Number(row.issue_count ?? 0) === 0) ? "healthy" : "attention_required",
        tables: tableRows,
        checks: riskRows,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

reportSuiteAccuracyRouter.get("/employee-lookup", roles, async (req, res, next) => {
  try {
    const employeeCode = String(req.query.employeeCode ?? "").trim();
    const date = dateParam(req.query.date, new Date().toISOString().slice(0, 10));
    if (!employeeCode) return res.status(400).json({ success: false, error: "employeeCode is required" });
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code,
              COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
              b.branch_name, p.process_name, adr.id AS attendance_record_id,
              adr.attendance_status, adr.lwp_value, adr.is_locked, adr.record_date
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND adr.record_date = ?
        WHERE UPPER(e.employee_code) = UPPER(?) OR UPPER(COALESCE(e.biometric_code,'')) = UPPER(?)
        LIMIT 1`,
      [date, employeeCode, employeeCode],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: "Employee not found" });
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

reportSuiteAccuracyRouter.get("/:code", roles, async (req, res, next: NextFunction) => {
  const code = String(req.params.code);
  if (!ACCURACY_CODES.has(code)) return next();

  try {
    const limit = limitParam(req.query.limit);
    const clauses: string[] = [];
    const params: unknown[] = [];
    let sql = "";
    let warnings: string[] = [];

    switch (code) {
      case "attendance-daily": {
        const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
        const to = dateParam(req.query.to, from);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `SELECT adr.record_date, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, d.dept_name AS department_name, p.process_name,
                      adr.attendance_source, adr.attendance_status,
                      ibd.first_punch AS punch_in, ibd.last_punch AS punch_out,
                      SEC_TO_TIME(COALESCE(ibd.biometric_minutes, adr.biometric_minutes, 0) * 60) AS total_login_hours,
                      COALESCE(adr.raw_minutes, adr.dialler_minutes, adr.biometric_minutes, ibd.biometric_minutes, 0) AS productive_minutes,
                      adr.lwp_value, adr.late_mark, adr.late_by_minutes,
                      CASE WHEN adr.mismatch_flag = 1 THEN 'MISMATCH' ELSE 'OK' END AS source_reconciliation
                 FROM attendance_daily_record adr
                 JOIN employees e ON e.id = adr.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN department_master d ON d.id = e.department_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                 LEFT JOIN integration_biometric_daily ibd
                   ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
                WHERE ${clauses.join(" AND ")}
                ORDER BY adr.record_date DESC, employee_name`;
        break;
      }

      case "daily-hc-shift": {
        const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
        const to = dateParam(req.query.to, from);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("wra.roster_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `WITH rostered AS (
                 SELECT wra.roster_date, b.branch_name, p.process_name,
                        COALESCE(ws.shift_code,'MISSING_SHIFT_MASTER') AS shift_code,
                        COALESCE(ws.shift_name,'Missing Shift Master') AS shift_name,
                        COUNT(DISTINCT wra.employee_id) AS scheduled_hc,
                        SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS attended_hc,
                        SUM(CASE WHEN adr.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_hc,
                        SUM(CASE WHEN adr.late_mark = 1 THEN 1 ELSE 0 END) AS late_hc,
                        SUM(CASE WHEN adr.id IS NULL THEN 1 ELSE 0 END) AS attendance_not_processed_hc
                   FROM wfm_roster_assignment wra
                   JOIN employees e ON e.id = wra.employee_id
                   LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
                   LEFT JOIN attendance_daily_record adr ON adr.employee_id = wra.employee_id AND adr.record_date = wra.roster_date
                   LEFT JOIN branch_master b ON b.id = e.branch_id
                   LEFT JOIN process_master p ON p.id = e.process_id
                  WHERE ${clauses.join(" AND ")}
                  GROUP BY wra.roster_date, b.branch_name, p.process_name, ws.shift_code, ws.shift_name
               ), unrostered AS (
                 SELECT adr.record_date AS roster_date, b.branch_name, p.process_name,
                        'NO_ROSTER' AS shift_code, 'No Roster - Action Required' AS shift_name,
                        0 AS scheduled_hc,
                        COUNT(DISTINCT adr.employee_id) AS attended_hc,
                        SUM(adr.attendance_status = 'absent') AS absent_hc,
                        SUM(adr.late_mark = 1) AS late_hc,
                        0 AS attendance_not_processed_hc
                   FROM attendance_daily_record adr
                   JOIN employees e ON e.id = adr.employee_id
                   LEFT JOIN branch_master b ON b.id = e.branch_id
                   LEFT JOIN process_master p ON p.id = e.process_id
                  WHERE adr.record_date BETWEEN ? AND ?
                    AND NOT EXISTS (SELECT 1 FROM wfm_roster_assignment x WHERE x.employee_id = adr.employee_id AND x.roster_date = adr.record_date)
                  GROUP BY adr.record_date, b.branch_name, p.process_name
               )
               SELECT *, CASE WHEN shift_code = 'NO_ROSTER' THEN 'ROSTER_GAP' WHEN shift_code = 'MISSING_SHIFT_MASTER' THEN 'MASTER_GAP' ELSE 'OK' END AS roster_data_status
                 FROM (SELECT * FROM rostered UNION ALL SELECT * FROM unrostered) x
                ORDER BY roster_date DESC, branch_name, process_name, shift_name`;
        params.push(from, to);
        warnings.push("Rows labelled 'No Roster - Action Required' are not assigned to a guessed shift; they are surfaced as roster-data gaps.");
        break;
      }

      case "shift-adherence-detail": {
        const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
        const to = dateParam(req.query.to, from);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `SELECT adr.record_date, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name,
                      COALESCE(ws.shift_name,'No Roster - Action Required') AS roster_shift,
                      ws.start_time AS shift_start, ws.end_time AS shift_end,
                      ibd.first_punch AS punch_in, ibd.last_punch AS punch_out,
                      SEC_TO_TIME(COALESCE(ibd.biometric_minutes, adr.biometric_minutes, 0) * 60) AS total_login_hours,
                      adr.attendance_status, adr.late_by_minutes,
                      CASE WHEN wra.id IS NULL THEN 'NOT_MEASURABLE_NO_ROSTER'
                           WHEN adr.attendance_status = 'absent' THEN 'ABSENT'
                           WHEN adr.late_mark = 1 THEN 'LATE'
                           WHEN ibd.first_punch IS NULL THEN 'MISSING_PUNCH'
                           ELSE 'ADHERED' END AS adherence_status
                 FROM attendance_daily_record adr
                 JOIN employees e ON e.id = adr.employee_id
                 LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id AND wra.roster_date = adr.record_date
                 LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
                 LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY adr.record_date DESC, adherence_status DESC, employee_name`;
        warnings.push("Adherence is intentionally marked not measurable where no dated roster exists; the system does not infer a shift silently.");
        break;
      }

      case "attendance-summary": {
        const month = monthParam(req.query.month);
        const { from, to, days } = monthBounds(month);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
        const detailSql = `SELECT e.id AS employee_id, e.employee_code, e.biometric_code,
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
                            ORDER BY employee_name, adr.record_date`;
        const [detailRows] = await db.execute<RowDataPacket[]>(detailSql, params);
        const payrollSql = `${canonicalPayrollCte("spr.run_month = ?")}
          SELECT employee_id, GREATEST(COALESCE(working_days,0) - COALESCE(lwp_days,0), 0) AS salary_days
            FROM canonical_payroll`;
        const [payRows] = await db.execute<RowDataPacket[]>(payrollSql, [month]);
        const salaryDays = new Map(payRows.map((row) => [String(row.employee_id), Number(row.salary_days ?? 0)]));
        const employeeMap = new Map<string, Record<string, any>>();
        for (const row of detailRows) {
          const id = String(row.employee_id);
          if (!employeeMap.has(id)) {
            employeeMap.set(id, {
              SNo: employeeMap.size + 1,
              EmpCode: row.employee_code,
              BioCode: row.biometric_code,
              EmpName: row.employee_name,
              Department: row.department_name,
              Designation: row.designation_name,
              Profile: row.process_name,
              CostCenter: row.cost_centre_name,
              EmpLocation: row.branch_name,
              Billable: "",
              A: 0, P: 0, OD: 0, "HD/DH/FTP": 0, L: 0, H: 0, W: 0,
              SalDays: salaryDays.get(id) ?? 0,
              Total: days,
            });
          }
          const target = employeeMap.get(id)!;
          const date = String(row.record_date).slice(0, 10);
          const day = Number(date.slice(8, 10));
          const key = `${String(day).padStart(2, "0")}-${month}`;
          const value = attendanceCode(row.attendance_status);
          target[key] = value;
          if (value === "A") target.A += 1;
          else if (value === "P") target.P += 1;
          else if (value === "HD") target["HD/DH/FTP"] += 1;
          else if (value === "L") target.L += 1;
          else if (value === "H") target.H += 1;
          else if (value === "W") target.W += 1;
          else if (value === "OD") target.OD += 1;
        }
        const rows = Array.from(employeeMap.values()).map((row) => {
          const ordered: Record<string, unknown> = {
            SNo: row.SNo, EmpCode: row.EmpCode, BioCode: row.BioCode, EmpName: row.EmpName,
            Department: row.Department, Designation: row.Designation, Profile: row.Profile,
            CostCenter: row.CostCenter, EmpLocation: row.EmpLocation, Billable: row.Billable,
          };
          for (let day = 1; day <= days; day += 1) ordered[`${String(day).padStart(2, "0")}-${month}`] = row[`${String(day).padStart(2, "0")}-${month}`] ?? "";
          Object.assign(ordered, { A: row.A, P: row.P, OD: row.OD, "HD/DH/FTP": row["HD/DH/FTP"], L: row.L, H: row.H, W: row.W, SalDays: row.SalDays, Total: row.Total });
          return ordered;
        });
        return sendRows(res, code, rows, payRows.length ? [] : ["No processed payroll lines were found for the month; SalDays is shown as 0 until payroll is calculated."]);
      }

      case "late-arrival-summary": {
        const month = monthParam(req.query.month);
        const { from, to } = monthBounds(month);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `WITH late_data AS (
                 SELECT adr.record_date, e.employee_code,
                        COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                        b.branch_name, p.process_name, ws.shift_name, ws.start_time,
                        ibd.first_punch AS punch_in,
                        GREATEST(COALESCE(adr.late_by_minutes,
                          TIMESTAMPDIFF(MINUTE, TIMESTAMP(adr.record_date, ws.start_time), ibd.first_punch)), 0) AS late_by_minutes,
                        adr.attendance_status
                   FROM attendance_daily_record adr
                   JOIN employees e ON e.id = adr.employee_id
                   LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id AND wra.roster_date = adr.record_date
                   LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
                   LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
                   LEFT JOIN branch_master b ON b.id = e.branch_id
                   LEFT JOIN process_master p ON p.id = e.process_id
                  WHERE ${clauses.join(" AND ")}
               )
               SELECT *, CASE WHEN late_by_minutes >= 60 THEN 'CRITICAL' WHEN late_by_minutes >= 30 THEN 'HIGH' ELSE 'LATE' END AS severity
                 FROM late_data
                WHERE late_by_minutes > 0
                ORDER BY record_date DESC, late_by_minutes DESC`;
        break;
      }

      case "overtime-summary": {
        const month = monthParam(req.query.month);
        const { from, to } = monthBounds(month);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `SELECT adr.record_date, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name, ws.shift_name,
                      ibd.first_punch AS punch_in, ibd.last_punch AS punch_out,
                      SEC_TO_TIME(COALESCE(ibd.biometric_minutes, adr.biometric_minutes, 0) * 60) AS total_login_hours,
                      COALESCE(ws.required_minutes, 540) AS scheduled_minutes,
                      GREATEST(COALESCE(ibd.biometric_minutes, adr.biometric_minutes, 0) - COALESCE(ws.required_minutes, 540), 0) AS overtime_minutes,
                      SEC_TO_TIME(GREATEST(COALESCE(ibd.biometric_minutes, adr.biometric_minutes, 0) - COALESCE(ws.required_minutes, 540), 0) * 60) AS overtime_hours
                 FROM attendance_daily_record adr
                 JOIN employees e ON e.id = adr.employee_id
                 LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id AND wra.roster_date = adr.record_date
                 LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
                 LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                  AND COALESCE(ibd.biometric_minutes, adr.biometric_minutes, 0) > COALESCE(ws.required_minutes, 540)
                ORDER BY overtime_minutes DESC, adr.record_date DESC`;
        warnings.push("This report identifies excess login time. Payable overtime must still follow the approved OT policy/workflow.");
        break;
      }

      case "biometric-reconciliation": {
        const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
        const to = dateParam(req.query.to, from);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `SELECT adr.record_date, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name, adr.attendance_status,
                      ibd.first_punch AS punch_in, ibd.last_punch AS punch_out,
                      SEC_TO_TIME(COALESCE(ibd.biometric_minutes,0) * 60) AS total_login_hours,
                      COALESCE(ibd.biometric_minutes,0) AS total_login_minutes,
                      COALESCE(adr.biometric_minutes,0) AS processed_biometric_minutes,
                      COALESCE(adr.raw_minutes,0) AS productive_minutes,
                      CASE WHEN ibd.first_punch IS NULL AND adr.attendance_status IN ('present','half_day','week_off_worked') THEN 'NO_BIOMETRIC_FOR_PRESENT'
                           WHEN ibd.first_punch IS NOT NULL AND adr.attendance_status = 'absent' THEN 'PUNCHED_BUT_ABSENT'
                           WHEN ABS(COALESCE(ibd.biometric_minutes,0)-COALESCE(adr.biometric_minutes,0)) > 5 THEN 'MINUTES_MISMATCH'
                           WHEN adr.mismatch_flag = 1 THEN 'APR_BIOMETRIC_MISMATCH'
                           ELSE 'OK' END AS reconciliation_status
                 FROM attendance_daily_record adr
                 JOIN employees e ON e.id = adr.employee_id
                 LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY FIELD(reconciliation_status,'NO_BIOMETRIC_FOR_PRESENT','PUNCHED_BUT_ABSENT','MINUTES_MISMATCH','APR_BIOMETRIC_MISMATCH','OK'), adr.record_date DESC`;
        break;
      }

      case "regularization-summary":
      case "attendance-dispute-summary": {
        const month = monthParam(req.query.month);
        const { from, to } = monthBounds(month);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("ar.session_date BETWEEN ? AND ?"); params.push(from, to);
        if (code === "attendance-dispute-summary") clauses.push("ar.dispute_type IS NOT NULL");
        sql = `SELECT ar.id, ar.session_date AS attendance_date, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name, ar.dispute_type,
                      ar.old_status, ar.new_status, ar.old_punch_in, ar.old_punch_out,
                      ar.new_punch_in, ar.new_punch_out, ar.reason,
                      ar.status, ar.payroll_impact, ar.payroll_head_approval_required,
                      ar.escalated_to, ar.created_at, ar.reviewed_at, ar.reviewer_note
                 FROM attendance_regularization ar
                 JOIN employees e ON e.id = ar.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY ar.created_at DESC`;
        break;
      }

      case "habitual-absentee-list": {
        const month = monthParam(req.query.month);
        const thresholdPct = Math.max(0, Number(req.query.thresholdPct ?? 25));
        const { from, to } = monthBounds(month);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `SELECT e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name,
                      COUNT(*) AS processed_days,
                      SUM(adr.attendance_status = 'absent') AS absent_days,
                      SUM(adr.attendance_status = 'missing_punch') AS missing_punch_days,
                      SUM(adr.late_mark = 1) AS late_days,
                      SUM(adr.lwp_value) AS lwp_days,
                      ROUND(SUM(adr.attendance_status IN ('absent','missing_punch')) / NULLIF(COUNT(*),0) * 100, 2) AS absenteeism_pct,
                      ROUND(SUM(adr.late_mark = 1) / NULLIF(COUNT(*),0) * 100, 2) AS late_pct
                 FROM attendance_daily_record adr
                 JOIN employees e ON e.id = adr.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, p.process_name
               HAVING absenteeism_pct >= ? OR late_days >= 3
                ORDER BY absenteeism_pct DESC, late_days DESC`;
        params.push(thresholdPct);
        break;
      }

      case "daily-shrinkage-report": {
        const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
        const to = dateParam(req.query.to, from);
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("wra.roster_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `WITH base AS (
                 SELECT wra.roster_date, b.branch_name, p.process_name,
                        COUNT(DISTINCT wra.employee_id) AS scheduled_hc,
                        SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS productive_hc,
                        SUM(CASE WHEN adr.attendance_status IN ('leave_approved','holiday','week_off') THEN 1 ELSE 0 END) AS planned_shrinkage_hc,
                        SUM(CASE WHEN adr.id IS NULL OR adr.attendance_status IN ('absent','missing_punch','unreconciled') THEN 1 ELSE 0 END) AS unplanned_shrinkage_hc
                   FROM wfm_roster_assignment wra
                   JOIN employees e ON e.id = wra.employee_id
                   LEFT JOIN attendance_daily_record adr ON adr.employee_id = wra.employee_id AND adr.record_date = wra.roster_date
                   LEFT JOIN branch_master b ON b.id = e.branch_id
                   LEFT JOIN process_master p ON p.id = e.process_id
                  WHERE ${clauses.join(" AND ")}
                  GROUP BY wra.roster_date, b.branch_name, p.process_name
               ), detailed AS (
                 SELECT 'DETAIL' AS row_type, roster_date, branch_name, process_name, scheduled_hc, productive_hc,
                        planned_shrinkage_hc, unplanned_shrinkage_hc,
                        scheduled_hc - productive_hc AS total_shrinkage_hc,
                        ROUND((scheduled_hc - productive_hc) / NULLIF(scheduled_hc,0) * 100, 2) AS shrinkage_pct
                   FROM base
               )
               SELECT * FROM detailed
               UNION ALL
               SELECT 'OVERALL', NULL, 'ALL', 'ALL', SUM(scheduled_hc), SUM(productive_hc),
                      SUM(planned_shrinkage_hc), SUM(unplanned_shrinkage_hc), SUM(total_shrinkage_hc),
                      ROUND(SUM(total_shrinkage_hc) / NULLIF(SUM(scheduled_hc),0) * 100, 2)
                 FROM detailed
                ORDER BY row_type, roster_date DESC, branch_name, process_name`;
        warnings.push("Shrinkage denominator is dated roster assignments. Dates/processes without roster uploads are excluded and must be resolved through report health.");
        break;
      }

      case "monthly-shrinkage-trend": {
        const month = monthParam(req.query.month);
        const [year] = month.split("-");
        const from = `${year}-01-01`;
        const to = `${year}-12-31`;
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("wra.roster_date BETWEEN ? AND ?"); params.push(from, to);
        sql = `WITH monthly AS (
                 SELECT DATE_FORMAT(wra.roster_date,'%Y-%m') AS month, b.branch_name, p.process_name,
                        COUNT(DISTINCT CONCAT(wra.employee_id,'|',wra.roster_date)) AS scheduled_slots,
                        SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS productive_slots
                   FROM wfm_roster_assignment wra
                   JOIN employees e ON e.id = wra.employee_id
                   LEFT JOIN attendance_daily_record adr ON adr.employee_id = wra.employee_id AND adr.record_date = wra.roster_date
                   LEFT JOIN branch_master b ON b.id = e.branch_id
                   LEFT JOIN process_master p ON p.id = e.process_id
                  WHERE ${clauses.join(" AND ")}
                  GROUP BY DATE_FORMAT(wra.roster_date,'%Y-%m'), b.branch_name, p.process_name
               )
               SELECT month, branch_name, process_name, scheduled_slots, productive_slots,
                      scheduled_slots - productive_slots AS shrinkage_slots,
                      ROUND((scheduled_slots - productive_slots) / NULLIF(scheduled_slots,0) * 100, 2) AS shrinkage_pct
                 FROM monthly
                ORDER BY month DESC, shrinkage_pct DESC`;
        warnings.push("A month with no roster upload will correctly return no scheduled denominator instead of fabricating scheduled headcount.");
        break;
      }

      case "punch-raw-export": {
        const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
        const to = dateParam(req.query.to, from);
        clauses.push("ibd.activity_date BETWEEN ? AND ?"); params.push(from, to);
        addEmployeeFilters(req.query, clauses, params);
        const ibdColumns = await getColumns("integration_biometric_daily");
        const punchCountExpr = ibdColumns.has("total_punches") ? "ibd.total_punches" : "NULL";
        sql = `SELECT ibd.employee_code, e.biometric_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name, ibd.activity_date,
                      ibd.first_punch AS punch_in, ibd.last_punch AS punch_out,
                      SEC_TO_TIME(COALESCE(ibd.biometric_minutes,0) * 60) AS total_punching_hours,
                      COALESCE(ibd.biometric_minutes,0) AS total_punching_minutes,
                      ${punchCountExpr} AS total_punches
                 FROM integration_biometric_daily ibd
                 LEFT JOIN employees e ON e.employee_code = ibd.employee_code
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY ibd.activity_date DESC, ibd.employee_code`;
        break;
      }

      case "payroll-register": {
        const month = monthParam(req.query.month);
        addEmployeeFilters(req.query, clauses, params);
        const cte = canonicalPayrollCte("spr.run_month = ?");
        sql = `${cte}
               SELECT cp.run_month, cp.run_status, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, d.dept_name AS department_name, p.process_name, cc.cost_centre_name,
                      cp.working_days, cp.present_days, cp.leave_days, cp.lwp_days, cp.late_marks,
                      cp.basic, cp.hra, cp.special_allowance, cp.gross_salary,
                      cp.pf_employee, cp.esic_employee, cp.professional_tax, cp.tds_amount,
                      cp.lwp_deduction, cp.advance_recovery, cp.total_deductions, cp.net_salary,
                      CASE WHEN ABS(COALESCE(cp.gross_salary,0)-COALESCE(cp.total_deductions,0)-COALESCE(cp.net_salary,0)) > 1 THEN 'NET_MISMATCH' ELSE 'OK' END AS control_status
                 FROM canonical_payroll cp
                 JOIN employees e ON e.id = cp.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN department_master d ON d.id = e.department_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                 LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
                WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
                ORDER BY employee_name`;
        params.unshift(month);
        break;
      }

      case "payroll-variance": {
        const month = monthParam(req.query.month);
        const prevMonth = previousMonth(month);
        addEmployeeFilters(req.query, clauses, params);
        sql = `${canonicalPayrollCte("spr.run_month IN (?, ?)")}
               SELECT cur.run_month, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name,
                      prev.net_salary AS previous_net, cur.net_salary AS current_net,
                      cur.net_salary - COALESCE(prev.net_salary,0) AS variance_amount,
                      ROUND((cur.net_salary-COALESCE(prev.net_salary,0))/NULLIF(prev.net_salary,0)*100,2) AS variance_pct,
                      prev.gross_salary AS previous_gross, cur.gross_salary AS current_gross,
                      prev.lwp_days AS previous_lwp_days, cur.lwp_days AS current_lwp_days,
                      CASE WHEN prev.employee_id IS NULL THEN 'NO_PREVIOUS_MONTH'
                           WHEN ABS((cur.net_salary-COALESCE(prev.net_salary,0))/NULLIF(prev.net_salary,0)*100) >= 20 THEN 'HIGH_VARIANCE'
                           ELSE 'OK' END AS variance_status
                 FROM canonical_payroll cur
                 LEFT JOIN canonical_payroll prev ON prev.employee_id = cur.employee_id AND prev.run_month = ?
                 JOIN employees e ON e.id = cur.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE cur.run_month = ? ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
                ORDER BY ABS(cur.net_salary-COALESCE(prev.net_salary,0)) DESC`;
        params.unshift(month, prevMonth, prevMonth, month);
        break;
      }

      case "payslip-status": {
        const month = monthParam(req.query.month);
        addEmployeeFilters(req.query, clauses, params);
        sql = `${canonicalPayrollCte("spr.run_month = ?")}
               SELECT cp.run_month, e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name, cp.net_salary,
                      sp.file_url, sp.generated_at AS released_at,
                      CASE WHEN sp.id IS NULL THEN 'NOT_GENERATED' ELSE 'RELEASED' END AS payslip_status
                 FROM canonical_payroll cp
                 JOIN employees e ON e.id = cp.employee_id
                 LEFT JOIN salary_payslip sp ON sp.prep_line_id = cp.id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
                ORDER BY payslip_status DESC, employee_name`;
        params.unshift(month);
        break;
      }

      case "ytd-salary-summary": {
        const fyRaw = String(req.query.financialYear ?? req.query.year ?? "").trim();
        const fyMatch = fyRaw.match(/^(\d{4})-(\d{2,4})$/);
        const startYear = fyMatch ? Number(fyMatch[1]) : Number(fyRaw) || new Date().getFullYear();
        const monthFrom = fyMatch ? `${startYear}-04` : `${startYear}-01`;
        const monthTo = fyMatch ? `${startYear + 1}-03` : `${startYear}-12`;
        addEmployeeFilters(req.query, clauses, params);
        sql = `${canonicalPayrollCte("spr.run_month BETWEEN ? AND ?")}
               SELECT e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, d.dept_name AS department_name, p.process_name,
                      COUNT(DISTINCT cp.run_month) AS months_paid,
                      ROUND(SUM(cp.basic),2) AS ytd_basic,
                      ROUND(SUM(cp.hra),2) AS ytd_hra,
                      ROUND(SUM(cp.special_allowance),2) AS ytd_special_allowance,
                      ROUND(SUM(cp.gross_salary),2) AS ytd_gross,
                      ROUND(SUM(cp.pf_employee),2) AS ytd_pf,
                      ROUND(SUM(cp.esic_employee),2) AS ytd_esic,
                      ROUND(SUM(cp.professional_tax),2) AS ytd_pt,
                      ROUND(SUM(cp.tds_amount),2) AS ytd_tds,
                      ROUND(SUM(cp.total_deductions),2) AS ytd_deductions,
                      ROUND(SUM(cp.net_salary),2) AS ytd_net
                 FROM canonical_payroll cp
                 JOIN employees e ON e.id = cp.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN department_master d ON d.id = e.department_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
                GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, d.dept_name, p.process_name
                ORDER BY employee_name`;
        params.unshift(monthFrom, monthTo);
        break;
      }

      case "cost-centre-salary-summary": {
        const month = monthParam(req.query.month);
        if (req.query.costCentreId) { clauses.push("e.cost_centre_id = ?"); params.push(String(req.query.costCentreId)); }
        sql = `${canonicalPayrollCte("spr.run_month = ?")}
               SELECT COALESCE(cc.cost_centre_code,'UNASSIGNED') AS cost_centre_code,
                      COALESCE(cc.cost_centre_name,'Unassigned') AS cost_centre_name,
                      COUNT(DISTINCT cp.employee_id) AS headcount,
                      ROUND(SUM(cp.basic),2) AS total_basic,
                      ROUND(SUM(cp.hra),2) AS total_hra,
                      ROUND(SUM(cp.special_allowance),2) AS total_special_allowance,
                      ROUND(SUM(cp.gross_salary),2) AS total_gross,
                      ROUND(SUM(cp.total_deductions),2) AS total_deductions,
                      ROUND(SUM(cp.net_salary),2) AS total_net,
                      ROUND(AVG(cp.gross_salary),2) AS avg_gross
                 FROM canonical_payroll cp
                 JOIN employees e ON e.id = cp.employee_id
                 LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
                WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
                GROUP BY cc.id, cc.cost_centre_code, cc.cost_centre_name
                ORDER BY total_gross DESC`;
        params.unshift(month);
        break;
      }

      case "process-lob-salary-cost": {
        const month = monthParam(req.query.month);
        addEmployeeFilters(req.query, clauses, params);
        sql = `${canonicalPayrollCte("spr.run_month = ?")}
               SELECT COALESCE(p.process_name,'Unassigned') AS process_name,
                      COALESCE(l.lob_name,'N/A') AS lob_name,
                      COUNT(DISTINCT cp.employee_id) AS headcount,
                      ROUND(SUM(cp.basic),2) AS total_basic,
                      ROUND(SUM(cp.hra),2) AS total_hra,
                      ROUND(SUM(cp.special_allowance),2) AS total_special_allowance,
                      ROUND(SUM(cp.gross_salary),2) AS total_gross,
                      ROUND(SUM(cp.pf_employer),2) AS employer_pf,
                      ROUND(SUM(cp.esic_employer),2) AS employer_esic,
                      ROUND(SUM(cp.total_deductions),2) AS employee_deductions,
                      ROUND(SUM(cp.net_salary),2) AS total_net,
                      ROUND(SUM(cp.gross_salary + cp.pf_employer + cp.esic_employer),2) AS total_employer_cost
                 FROM canonical_payroll cp
                 JOIN employees e ON e.id = cp.employee_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                 LEFT JOIN lob_master l ON l.id = e.lob_id
                WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
                GROUP BY p.id, p.process_name, l.id, l.lob_name
                ORDER BY total_employer_cost DESC`;
        params.unshift(month);
        break;
      }

      case "grade-salary-distribution": {
        const month = monthParam(req.query.month);
        addEmployeeFilters(req.query, clauses, params);
        sql = `${canonicalPayrollCte("spr.run_month = ?")}
               SELECT COALESCE(CONCAT(gb.grade_code,' - ',gb.grade_name),'Ungraded') AS grade_band,
                      COUNT(DISTINCT cp.employee_id) AS headcount,
                      ROUND(AVG(cp.gross_salary),2) AS avg_gross,
                      ROUND(MIN(cp.gross_salary),2) AS min_gross,
                      ROUND(MAX(cp.gross_salary),2) AS max_gross,
                      ROUND(SUM(cp.gross_salary),2) AS total_gross,
                      ROUND(SUM(cp.total_deductions),2) AS total_deductions,
                      ROUND(SUM(cp.net_salary),2) AS total_net
                 FROM canonical_payroll cp
                 JOIN employees e ON e.id = cp.employee_id
                 LEFT JOIN grade_band_master gb ON gb.id = e.grade_id
                WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
                GROUP BY gb.id, gb.grade_code, gb.grade_name
                ORDER BY avg_gross DESC`;
        params.unshift(month);
        break;
      }

      case "salary-advance-register": {
        const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
        const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
        const columns = await getColumns("salary_advance_log");
        const amount = columns.has("advance_amount") ? "sal.advance_amount" : "sal.amount";
        const recovered = columns.has("total_recovered") ? "sal.total_recovered" : "sal.recovered_amount";
        const outstanding = columns.has("outstanding_amount") ? "sal.outstanding_amount" : `GREATEST(${amount}-${recovered},0)`;
        const recoveryStart = columns.has("recovery_start_month") ? "sal.recovery_start_month" : "NULL";
        const remarks = columns.has("remarks") ? "sal.remarks" : "sal.notes";
        addEmployeeFilters(req.query, clauses, params);
        clauses.push("sal.advance_date BETWEEN ? AND ?"); params.push(from, to);
        clauses.push("LOWER(COALESCE(sal.status,'')) IN ('approved','approve','rejected','reject')");
        sql = `SELECT e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name, sal.advance_date,
                      ${amount} AS advance_amount, ${recoveryStart} AS recovery_start_month,
                      ${recovered} AS total_recovered, ${outstanding} AS outstanding_amount,
                      CASE WHEN LOWER(sal.status) IN ('approved','approve') THEN 'Approved' ELSE 'Rejected' END AS status,
                      ${remarks} AS remarks
                 FROM salary_advance_log sal
                 JOIN employees e ON e.id = sal.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY sal.advance_date DESC`;
        break;
      }

      case "lwp-deduction-register": {
        const month = monthParam(req.query.month);
        const { from, to } = monthBounds(month);
        addEmployeeFilters(req.query, clauses, params);
        sql = `${canonicalPayrollCte("spr.run_month = ?")}, attendance_lwp AS (
                 SELECT employee_id, SUM(lwp_value) AS attendance_lwp_days
                   FROM attendance_daily_record
                  WHERE record_date BETWEEN ? AND ?
                  GROUP BY employee_id
               )
               SELECT e.employee_code,
                      COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
                      b.branch_name, p.process_name, cp.run_month,
                      COALESCE(al.attendance_lwp_days,0) AS attendance_lwp_days,
                      cp.lwp_days AS payroll_lwp_days,
                      cp.lwp_days - COALESCE(al.attendance_lwp_days,0) AS lwp_days_variance,
                      cp.lwp_deduction AS lwp_deduction_amount,
                      cp.gross_salary, cp.net_salary,
                      CASE WHEN ABS(cp.lwp_days-COALESCE(al.attendance_lwp_days,0)) > 0.01 THEN 'MISMATCH' ELSE 'OK' END AS reconciliation_status
                 FROM canonical_payroll cp
                 JOIN employees e ON e.id = cp.employee_id
                 LEFT JOIN attendance_lwp al ON al.employee_id = cp.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                WHERE cp.lwp_days > 0 ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
                ORDER BY reconciliation_status DESC, cp.lwp_days DESC`;
        params.unshift(month, from, to);
        break;
      }

      default:
        return next();
    }

    const rows = await queryRows(sql, params, limit);
    return sendRows(res, code, rows, warnings);
  } catch (error) {
    next(error);
  }
});
