/**
 * Report Worker Executor — SUPERSEDED AND UNREFERENCED. Do not extend.
 *
 * Nothing imports this file. `executeReportForWorker` has no call sites anywhere in
 * backend/src (verified 2026-08-07); the only other mentions of it are comments. The path
 * that actually builds a scheduled or emailed report is:
 *
 *   report-subscription.worker  → inserts a report_request row
 *   report-generation.worker    → picks it up and calls executeReport()
 *
 * i.e. the same executor layer the screen and the direct XLSX download use. Adding a report
 * here does nothing; adding one to executors/ serves all three delivery paths at once.
 *
 * It is kept rather than deleted because this repository does not delete working code on
 * sight, but treat it as documentation of a retired design. Its SQL has already drifted
 * from the live definitions — its `headcount` still filters on active_status AND
 * employment_status, which returns 1,123 where every current surface returns 1,125, and its
 * payroll-register predates the population and floored-deduction disclosure. Reading it as
 * a reference will teach you the wrong numbers.
 *
 * A stale copy is not harmless: a hardcoded six-code allowlist in
 * communication/notification-admin.routes.ts cited this file as the reason only six reports
 * could be scheduled, which blocked 92 working reports until it was corrected.
 *
 * ── Original header ────────────────────────────────────────────────────────────
 * Executes report queries for the background generation worker using the
 * resolved scope snapshot stored at request time. This avoids HTTP round-trips
 * and HTTP-layer dependencies while reusing the existing SQL patterns.
 *
 * The scope snapshot (resolved_scope_json) is immutable after request creation,
 * so re-execution is deterministic and cannot be scope-escalated.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export interface ResolvedScope {
  isSuperAdmin: boolean;
  branchIds: string[];
}

export interface WorkerExecutionResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

function addScopeFilters(
  scope: ResolvedScope,
  clauses: string[],
  params: unknown[],
  alias = 'e'
): void {
  if (!scope.isSuperAdmin && scope.branchIds.length > 0) {
    clauses.push(`${alias}.branch_id IN (${scope.branchIds.map(() => '?').join(',')})`);
    params.push(...scope.branchIds);
  }
}

function dateParam(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

function monthParam(value: unknown): string {
  const today = new Date();
  const def = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) return value;
  return def;
}

async function run(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows as Record<string, unknown>[];
}

export async function executeReportForWorker(
  reportCode: string,
  filters: Record<string, unknown>,
  scope: ResolvedScope
): Promise<WorkerExecutionResult> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let rows: Record<string, unknown>[] = [];

  switch (reportCode) {
    case 'employee-master': {
      addScopeFilters(scope, clauses, params);
      const where = clauses.length ? clauses.join(' AND ') : '1=1';
      rows = await run(
        `SELECT e.employee_code,
                COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                e.official_email, e.mobile, e.employment_status, e.date_of_joining, e.date_of_exit,
                b.branch_name, d.dept_name AS department_name, p.process_name, cc.cost_centre_name,
                COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS reporting_manager
           FROM employees e
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN department_master d ON d.id = e.department_id
           LEFT JOIN process_master p ON p.id = e.process_id
           LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
           LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
          WHERE ${where}
          ORDER BY e.employee_code`,
        params
      );
      break;
    }

    case 'notification-undeliverable-recipients': {
      // Every active employee with at least one delivery gap, and which gap.
      //
      // 'gap_reason' is built from the same rules shared/recipient-resolver.ts applies at
      // send time, so this report and the resolver cannot drift into disagreeing about who
      // is reachable:
      //   * fin events force official_email on an allowed company domain, no fallback;
      //   * every manager CC resolves through employees.reporting_manager_id.
      // The domain list mirrors shared/email-domains.ts.
      addScopeFilters(scope, clauses, params);
      clauses.push('e.active_status = 1');
      const where = clauses.join(' AND ');
      rows = await run(
        `SELECT e.employee_code,
                COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                b.branch_name,
                p.process_name,
                NULLIF(TRIM(COALESCE(e.official_email, e.office_email)),'') AS official_email,
                NULLIF(TRIM(COALESCE(e.email, e.personal_email)),'')        AS personal_email,
                COALESCE(NULLIF(TRIM(m.full_name),''), m.employee_code)      AS reporting_manager,
                TRIM(BOTH '; ' FROM CONCAT_WS('; ',
                  CASE WHEN NULLIF(TRIM(COALESCE(e.official_email, e.office_email)),'') IS NULL
                       THEN 'No official email - cannot receive payslip, F&F or increment' END,
                  CASE WHEN NULLIF(TRIM(COALESCE(e.official_email, e.office_email)),'') IS NOT NULL
                        AND SUBSTRING_INDEX(LOWER(COALESCE(e.official_email, e.office_email)),'@',-1)
                            NOT IN ('teammas.in','teammas.co.in','mascallnet.com')
                        AND SUBSTRING_INDEX(LOWER(COALESCE(e.official_email, e.office_email)),'@',-1)
                            NOT LIKE '%.teammas.in'
                       THEN 'Official email is not on a company domain' END,
                  CASE WHEN NULLIF(TRIM(COALESCE(e.official_email, e.office_email, e.email, e.personal_email)),'') IS NULL
                       THEN 'No email address of any kind' END,
                  CASE WHEN m.id IS NULL
                       THEN 'No reporting manager - every manager CC resolves to nobody' END,
                  CASE WHEN m.id IS NOT NULL AND m.active_status <> 1
                       THEN 'Reporting manager is inactive' END
                )) AS gap_reason,
                CASE WHEN NULLIF(TRIM(COALESCE(e.official_email, e.office_email)),'') IS NULL
                     THEN 'Yes' ELSE 'No' END AS blocks_financial_mail
           FROM employees e
           LEFT JOIN branch_master b  ON b.id = e.branch_id
           LEFT JOIN process_master p ON p.id = e.process_id
           LEFT JOIN employees m      ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
          WHERE ${where}
            AND (
                  NULLIF(TRIM(COALESCE(e.official_email, e.office_email)),'') IS NULL
               OR NULLIF(TRIM(COALESCE(e.official_email, e.office_email, e.email, e.personal_email)),'') IS NULL
               OR m.id IS NULL
               OR m.active_status <> 1
               OR (SUBSTRING_INDEX(LOWER(COALESCE(e.official_email, e.office_email)),'@',-1)
                     NOT IN ('teammas.in','teammas.co.in','mascallnet.com')
                   AND SUBSTRING_INDEX(LOWER(COALESCE(e.official_email, e.office_email)),'@',-1)
                     NOT LIKE '%.teammas.in')
                )
          ORDER BY blocks_financial_mail DESC, b.branch_name, e.employee_code`,
        params
      );
      break;
    }

    case 'headcount': {
      addScopeFilters(scope, clauses, params);
      clauses.push("e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'");
      rows = await run(
        `SELECT b.branch_name, d.dept_name AS department_name, p.process_name, COUNT(*) AS active_headcount
           FROM employees e
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN department_master d ON d.id = e.department_id
           LEFT JOIN process_master p ON p.id = e.process_id
          WHERE ${clauses.join(' AND ')}
          GROUP BY b.branch_name, d.dept_name, p.process_name
          ORDER BY b.branch_name, d.dept_name, p.process_name`,
        params
      );
      break;
    }

    case 'attendance-daily': {
      const from = dateParam(filters.from, new Date().toISOString().slice(0, 10));
      const to   = dateParam(filters.to, from);
      addScopeFilters(scope, clauses, params);
      clauses.push('adr.record_date BETWEEN ? AND ?');
      params.push(from, to);
      if (filters.processId) { clauses.push('e.process_id = ?'); params.push(String(filters.processId)); }
      rows = await run(
        `SELECT adr.record_date, e.employee_code,
                COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                b.branch_name, p.process_name, d.dept_name AS department_name,
                adr.attendance_status, adr.late_by_minutes, adr.raw_minutes AS productive_minutes,
                adr.lwp_value, adr.attendance_source
           FROM attendance_daily_record adr
           JOIN employees e ON e.id = adr.employee_id
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN process_master p ON p.id = e.process_id
           LEFT JOIN department_master d ON d.id = e.department_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY adr.record_date DESC, e.employee_code`,
        params
      );
      break;
    }

    case 'leave-balance': {
      const year = Number(filters.year ?? new Date().getFullYear());
      addScopeFilters(scope, clauses, params);
      clauses.push('e.active_status = 1');
      rows = await run(
        `SELECT e.employee_code,
                COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                b.branch_name, p.process_name, lt.leave_name, lt.leave_code,
                COALESCE(lbl.allocated_days,0) AS allocated_days,
                COALESCE(lbl.used_days,0) AS used_days,
                COALESCE(lbl.adjusted_days,0) AS adjusted_days,
                COALESCE(lbl.allocated_days,0) + COALESCE(lbl.adjusted_days,0) - COALESCE(lbl.used_days,0) AS remaining_days
           FROM employees e
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN process_master p ON p.id = e.process_id
           JOIN leave_type_master lt ON lt.active_status = 1
           LEFT JOIN leave_balance_ledger lbl ON lbl.employee_id = e.id AND lbl.leave_type_id = lt.id AND lbl.balance_year = ?
          WHERE ${clauses.join(' AND ')}
          ORDER BY e.employee_code, lt.leave_name`,
        [year, ...params]
      );
      break;
    }

    case 'payroll-register': {
      const month = monthParam(filters.month);
      addScopeFilters(scope, clauses, params);
      clauses.push('spr.run_month = ?');
      params.push(month);
      rows = await run(
        `SELECT spr.run_month AS payroll_month, e.employee_code,
                COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                b.branch_name, p.process_name, d.dept_name AS department_name,
                des.designation_name,
                -- salary_prep_line stores basic, net_salary and
                -- final_payable_days. The names used here exist on no table, so
                -- this payroll register raised ER_BAD_FIELD_ERROR and produced
                -- nothing. Output aliases are unchanged, so the report's columns
                -- stay as they were.
                COALESCE(spl.basic,0) AS basic_pay,
                COALESCE(spl.hra,0) AS hra,
                COALESCE(spl.gross_salary,0) AS gross_salary,
                COALESCE(spl.pf_employee,0) AS pf_employee,
                COALESCE(spl.esic_employee,0) AS esic_employee,
                COALESCE(spl.professional_tax,0) AS professional_tax,
                COALESCE(spl.tds,0) AS tds,
                COALESCE(spl.lwp_deduction,0) AS lwp_deduction,
                COALESCE(spl.total_deductions,0) AS total_deductions,
                COALESCE(spl.net_salary,0) AS net_pay,
                COALESCE(spl.final_payable_days,0) AS payable_days,
                COALESCE(spl.lwp_days,0) AS lwp_days
           FROM salary_prep_line spl
           JOIN salary_prep_run spr ON spr.id = spl.run_id
           JOIN employees e ON e.id = spl.employee_id
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN process_master p ON p.id = e.process_id
           LEFT JOIN department_master d ON d.id = e.department_id
           LEFT JOIN designation_master des ON des.id = e.designation_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY e.employee_code`,
        params
      );
      break;
    }

    case 'birthday-list': {
      const month = Number(filters.month ?? new Date().getMonth() + 1);
      addScopeFilters(scope, clauses, params);
      clauses.push('e.active_status = 1', 'MONTH(e.date_of_birth) = ?');
      params.push(month);
      rows = await run(
        `SELECT e.employee_code,
                COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                e.date_of_birth, MONTH(e.date_of_birth) AS birth_month, DAY(e.date_of_birth) AS birth_day,
                b.branch_name, p.process_name, d.dept_name AS department_name
           FROM employees e
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN process_master p ON p.id = e.process_id
           LEFT JOIN department_master d ON d.id = e.department_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY birth_month, birth_day, e.employee_code`,
        params
      );
      break;
    }

    default: {
      // Generic fallback — return a metadata-only row indicating the report needs a dedicated builder
      rows = [{
        REPORT_CODE: reportCode,
        STATUS: 'PENDING_DEDICATED_BUILDER',
        NOTE: `Report '${reportCode}' does not yet have a dedicated server-side builder. Please contact the HRMS team.`,
        GENERATED_AT: new Date().toISOString(),
      }];
    }
  }

  return { rows, rowCount: rows.length };
}
