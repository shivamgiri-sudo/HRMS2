import type { RowDataPacket } from "mysql2";
import { db, pingDb } from "../src/db/mysql.js";

interface AuditCheck {
  key: string;
  area: "schema" | "attendance" | "roster" | "biometric" | "payroll" | "master_data";
  severity: "critical" | "warning" | "info";
  description: string;
  sql: string;
}

interface AuditResult {
  key: string;
  area: string;
  severity: string;
  description: string;
  issueCount: number;
  sample?: Record<string, unknown>[];
  error?: string;
}

const requiredTables = [
  "employees",
  "attendance_daily_record",
  "integration_biometric_daily",
  "wfm_roster_assignment",
  "wfm_shift_master",
  "attendance_regularization",
  "attendance_manual_override",
  "salary_prep_run",
  "salary_prep_line",
  "salary_payslip",
  "salary_advance_log",
  "branch_master",
  "department_master",
  "process_master",
  "cost_centre_master",
  "grade_band_master",
];

const checks: AuditCheck[] = [
  {
    key: "duplicate_attendance_employee_date",
    area: "attendance",
    severity: "critical",
    description: "More than one processed attendance record exists for the same employee and date.",
    sql: `SELECT employee_id, record_date, COUNT(*) AS duplicate_count
            FROM attendance_daily_record
           GROUP BY employee_id, record_date
          HAVING COUNT(*) > 1
           ORDER BY duplicate_count DESC
           LIMIT 50`,
  },
  {
    key: "attendance_without_employee",
    area: "attendance",
    severity: "critical",
    description: "Attendance rows reference a missing employee master record.",
    sql: `SELECT adr.employee_id, COUNT(*) AS issue_count
            FROM attendance_daily_record adr
            LEFT JOIN employees e ON e.id = adr.employee_id
           WHERE e.id IS NULL
           GROUP BY adr.employee_id
           LIMIT 50`,
  },
  {
    key: "present_without_biometric_evidence_90d",
    area: "biometric",
    severity: "critical",
    description: "Present/half-day records have no matching biometric daily evidence in the last 90 days.",
    sql: `SELECT adr.record_date, e.employee_code, adr.attendance_status
            FROM attendance_daily_record adr
            JOIN employees e ON e.id = adr.employee_id
            LEFT JOIN integration_biometric_daily ibd
              ON ibd.employee_code = e.employee_code
             AND ibd.activity_date = adr.record_date
           WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
             AND adr.attendance_status IN ('present','half_day','week_off_worked')
             AND ibd.employee_code IS NULL
           ORDER BY adr.record_date DESC
           LIMIT 50`,
  },
  {
    key: "biometric_unmapped_employee_90d",
    area: "biometric",
    severity: "warning",
    description: "Biometric daily records cannot be mapped to an employee code.",
    sql: `SELECT ibd.employee_code, MIN(ibd.activity_date) AS first_seen,
                  MAX(ibd.activity_date) AS last_seen, COUNT(*) AS issue_count
            FROM integration_biometric_daily ibd
            LEFT JOIN employees e ON e.employee_code = ibd.employee_code
           WHERE ibd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
             AND e.id IS NULL
           GROUP BY ibd.employee_code
           ORDER BY issue_count DESC
           LIMIT 50`,
  },
  {
    key: "invalid_biometric_duration_90d",
    area: "biometric",
    severity: "warning",
    description: "Biometric duration is negative or exceeds 24 hours.",
    sql: `SELECT employee_code, activity_date, biometric_minutes
            FROM integration_biometric_daily
           WHERE activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
             AND (biometric_minutes < 0 OR biometric_minutes > 1440)
           ORDER BY activity_date DESC
           LIMIT 50`,
  },
  {
    key: "attendance_without_roster_90d",
    area: "roster",
    severity: "warning",
    description: "Attendance exists without a dated roster assignment; shift adherence and shrinkage are not measurable.",
    sql: `SELECT adr.record_date, e.employee_code, adr.attendance_status
            FROM attendance_daily_record adr
            JOIN employees e ON e.id = adr.employee_id
            LEFT JOIN wfm_roster_assignment wra
              ON wra.employee_id = adr.employee_id
             AND wra.roster_date = adr.record_date
           WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
             AND wra.id IS NULL
           ORDER BY adr.record_date DESC
           LIMIT 50`,
  },
  {
    key: "roster_without_shift_master_90d",
    area: "roster",
    severity: "critical",
    description: "Roster assignment references a missing shift master row.",
    sql: `SELECT wra.roster_date, wra.employee_id, wra.shift_id
            FROM wfm_roster_assignment wra
            LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
           WHERE wra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
             AND wsm.id IS NULL
           ORDER BY wra.roster_date DESC
           LIMIT 50`,
  },
  {
    key: "roster_without_attendance_90d",
    area: "roster",
    severity: "warning",
    description: "Rostered employee-date has no processed attendance row.",
    sql: `SELECT wra.roster_date, e.employee_code, wsm.shift_name
            FROM wfm_roster_assignment wra
            JOIN employees e ON e.id = wra.employee_id
            LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
            LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = wra.employee_id
             AND adr.record_date = wra.roster_date
           WHERE wra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
             AND adr.id IS NULL
           ORDER BY wra.roster_date DESC
           LIMIT 50`,
  },
  {
    key: "duplicate_payroll_employee_month",
    area: "payroll",
    severity: "critical",
    description: "An employee has more than one non-draft payroll line for the same month.",
    sql: `SELECT spr.run_month, spl.employee_id, COUNT(*) AS duplicate_count
            FROM salary_prep_line spl
            JOIN salary_prep_run spr ON spr.id = spl.run_id
           WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
           GROUP BY spr.run_month, spl.employee_id
          HAVING COUNT(*) > 1
           ORDER BY duplicate_count DESC
           LIMIT 50`,
  },
  {
    key: "payroll_header_detail_mismatch",
    area: "payroll",
    severity: "critical",
    description: "Payroll run header totals do not reconcile with salary line totals.",
    sql: `SELECT spr.id, spr.run_month, spr.status,
                  spr.total_employees, COUNT(spl.id) AS line_count,
                  spr.total_gross, ROUND(COALESCE(SUM(spl.gross_salary),0),2) AS line_gross,
                  spr.total_deductions, ROUND(COALESCE(SUM(spl.total_deductions),0),2) AS line_deductions,
                  spr.total_net, ROUND(COALESCE(SUM(spl.net_salary),0),2) AS line_net
            FROM salary_prep_run spr
            LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
           WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
           GROUP BY spr.id, spr.run_month, spr.status, spr.total_employees,
                    spr.total_gross, spr.total_deductions, spr.total_net
          HAVING COALESCE(spr.total_employees,0) <> COUNT(spl.id)
              OR ABS(COALESCE(spr.total_gross,0)-COALESCE(SUM(spl.gross_salary),0)) > 1
              OR ABS(COALESCE(spr.total_deductions,0)-COALESCE(SUM(spl.total_deductions),0)) > 1
              OR ABS(COALESCE(spr.total_net,0)-COALESCE(SUM(spl.net_salary),0)) > 1
           ORDER BY spr.run_month DESC
           LIMIT 50`,
  },
  {
    key: "payroll_net_formula_mismatch",
    area: "payroll",
    severity: "critical",
    description: "Salary line net is not gross minus total deductions.",
    sql: `SELECT spr.run_month, e.employee_code, spl.gross_salary,
                  spl.total_deductions, spl.net_salary,
                  ROUND(spl.gross_salary-spl.total_deductions-spl.net_salary,2) AS difference
            FROM salary_prep_line spl
            JOIN salary_prep_run spr ON spr.id = spl.run_id
            JOIN employees e ON e.id = spl.employee_id
           WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
             AND ABS(COALESCE(spl.gross_salary,0)-COALESCE(spl.total_deductions,0)-COALESCE(spl.net_salary,0)) > 1
           ORDER BY spr.run_month DESC, ABS(COALESCE(spl.gross_salary,0)-COALESCE(spl.total_deductions,0)-COALESCE(spl.net_salary,0)) DESC
           LIMIT 50`,
  },
  {
    key: "payroll_lwp_attendance_mismatch",
    area: "payroll",
    severity: "critical",
    description: "Payroll LWP days do not match processed attendance LWP for the same employee-month.",
    sql: `WITH attendance_lwp AS (
            SELECT employee_id, DATE_FORMAT(record_date,'%Y-%m') AS run_month,
                   ROUND(SUM(lwp_value),2) AS attendance_lwp_days
              FROM attendance_daily_record
             GROUP BY employee_id, DATE_FORMAT(record_date,'%Y-%m')
          ), ranked_payroll AS (
            SELECT spr.run_month, spl.employee_id, spl.lwp_days,
                   ROW_NUMBER() OVER (
                     PARTITION BY spr.run_month, spl.employee_id
                     ORDER BY spr.updated_at DESC, spr.created_at DESC, spr.id DESC
                   ) AS rn
              FROM salary_prep_line spl
              JOIN salary_prep_run spr ON spr.id = spl.run_id
             WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
          )
          SELECT rp.run_month, e.employee_code, rp.lwp_days AS payroll_lwp_days,
                 COALESCE(al.attendance_lwp_days,0) AS attendance_lwp_days,
                 ROUND(rp.lwp_days-COALESCE(al.attendance_lwp_days,0),2) AS difference
            FROM ranked_payroll rp
            JOIN employees e ON e.id = rp.employee_id
            LEFT JOIN attendance_lwp al
              ON al.employee_id = rp.employee_id
             AND al.run_month = rp.run_month
           WHERE rp.rn = 1
             AND ABS(COALESCE(rp.lwp_days,0)-COALESCE(al.attendance_lwp_days,0)) > 0.01
           ORDER BY rp.run_month DESC, ABS(COALESCE(rp.lwp_days,0)-COALESCE(al.attendance_lwp_days,0)) DESC
           LIMIT 50`,
  },
  {
    key: "processed_payroll_without_payslip",
    area: "payroll",
    severity: "warning",
    description: "Final/approved payroll line has no payslip record.",
    sql: `SELECT spr.run_month, e.employee_code, spr.status
            FROM salary_prep_line spl
            JOIN salary_prep_run spr ON spr.id = spl.run_id
            JOIN employees e ON e.id = spl.employee_id
            LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
           WHERE LOWER(COALESCE(spr.status,'')) IN ('approved','locked','finalized','released','paid','disbursed')
             AND sp.id IS NULL
           ORDER BY spr.run_month DESC
           LIMIT 50`,
  },
  {
    key: "payroll_missing_master_mapping",
    area: "master_data",
    severity: "warning",
    description: "Employees in processed payroll are missing branch, process, cost-centre or grade mappings.",
    sql: `SELECT spr.run_month, e.employee_code, e.branch_id, e.process_id,
                  e.cost_centre_id, e.grade_id
            FROM salary_prep_line spl
            JOIN salary_prep_run spr ON spr.id = spl.run_id
            JOIN employees e ON e.id = spl.employee_id
           WHERE LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
             AND (e.branch_id IS NULL OR e.process_id IS NULL OR e.cost_centre_id IS NULL OR e.grade_id IS NULL)
           ORDER BY spr.run_month DESC
           LIMIT 50`,
  },
  {
    key: "salary_advance_unexpected_status",
    area: "payroll",
    severity: "warning",
    description: "Salary advances use a status outside Approved/Rejected workflow values.",
    sql: `SELECT status, COUNT(*) AS issue_count
            FROM salary_advance_log
           WHERE LOWER(COALESCE(status,'')) NOT IN ('approved','approve','rejected','reject')
           GROUP BY status
           ORDER BY issue_count DESC`,
  },
];

async function existingTables() {
  const placeholders = requiredTables.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})`,
    requiredTables,
  );
  return new Set(rows.map((row) => String(row.table_name)));
}

async function runCheck(check: AuditCheck): Promise<AuditResult> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(check.sql);
    return {
      key: check.key,
      area: check.area,
      severity: check.severity,
      description: check.description,
      issueCount: rows.length,
      sample: rows.slice(0, 20) as Record<string, unknown>[],
    };
  } catch (error) {
    return {
      key: check.key,
      area: check.area,
      severity: check.severity,
      description: check.description,
      issueCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  await pingDb();
  const tableSet = await existingTables();
  const missingTables = requiredTables.filter((table) => !tableSet.has(table));

  const results: AuditResult[] = [];
  results.push({
    key: "required_report_tables",
    area: "schema",
    severity: missingTables.length ? "critical" : "info",
    description: "Required tables for the report hub must exist in the active database.",
    issueCount: missingTables.length,
    sample: missingTables.map((table) => ({ missing_table: table })),
  });

  for (const check of checks) {
    results.push(await runCheck(check));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    database: process.env.DB_NAME ?? "configured database",
    criticalIssueGroups: results.filter((result) => result.severity === "critical" && (result.issueCount > 0 || result.error)).length,
    warningIssueGroups: results.filter((result) => result.severity === "warning" && (result.issueCount > 0 || result.error)).length,
    checksRun: results.length,
    checksWithErrors: results.filter((result) => result.error).length,
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
  await db.end();

  if (summary.criticalIssueGroups > 0 || summary.checksWithErrors > 0) {
    process.exitCode = 2;
  }
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    generatedAt: new Date().toISOString(),
    fatal: true,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  try { await db.end(); } catch { /* no-op */ }
  process.exitCode = 1;
});
