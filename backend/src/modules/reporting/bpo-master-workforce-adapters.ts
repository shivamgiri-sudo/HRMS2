import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import type { BranchScope } from "./reporting.scope.js";
import { getBpoMasterReport } from "./bpo-master-report-catalog.js";

export interface WorkforceAdapterFilters {
  month?: string;
  from?: string;
  to?: string;
  branchId?: string;
  processId?: string;
  employeeCode?: string;
  limit: number;
  offset: number;
}

export interface WorkforceAdapterResult {
  rows: Record<string, unknown>[];
  totalCount: number;
  sourceTable: string;
  availableKeys: string[];
}

const SUPPORTED = new Set([
  "bpo-operations-productivity-master",
  "bpo-employee-performance-360-master",
  "bpo-wfm-attendance-shrinkage-master",
  "bpo-hr-workforce-lifecycle-master",
  "bpo-payroll-statutory-master",
]);
const NO_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";

function period(value?: string) {
  return /^\d{4}-\d{2}$/.test(String(value ?? ""))
    ? String(value)
    : new Date().toISOString().slice(0, 7);
}

function dateBounds(filters: WorkforceAdapterFilters) {
  const reportMonth = period(filters.month);
  const [year, month] = reportMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    reportMonth,
    from: filters.from ?? `${reportMonth}-01`,
    to: filters.to ?? `${reportMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

function scopeWhere(
  scope: BranchScope,
  filters: WorkforceAdapterFilters,
  alias = "e"
) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!scope.isSuperAdmin && scope.branchIds.length > 0) {
    if (scope.branchIds.includes(NO_SCOPE_SENTINEL)) {
      clauses.push("1 = 0");
    } else if (filters.branchId) {
      clauses.push(`${alias}.branch_id = ?`);
      params.push(filters.branchId);
    } else {
      clauses.push(`${alias}.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
  } else if (filters.branchId) {
    clauses.push(`${alias}.branch_id = ?`);
    params.push(filters.branchId);
  }
  if (filters.processId) {
    clauses.push(`${alias}.process_id = ?`);
    params.push(filters.processId);
  }
  if (filters.employeeCode) {
    clauses.push(`${alias}.employee_code = ?`);
    params.push(filters.employeeCode);
  }
  return { clauses, params };
}

function normalize(code: string, rows: RowDataPacket[]) {
  const definition = getBpoMasterReport(code);
  if (!definition) return { rows: rows as Record<string, unknown>[], availableKeys: [] as string[] };
  const normalized = rows.map((row) => Object.fromEntries(
    definition.columns.map((column) => [column.key, row[column.key] ?? null])
  ));
  const availableKeys = [...new Set(rows.flatMap((row) =>
    Object.entries(row)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key]) => key)
  ))];
  return { rows: normalized, availableKeys };
}

async function paginated(
  code: string,
  sourceTable: string,
  sql: string,
  params: unknown[],
  filters: WorkforceAdapterFilters
): Promise<WorkforceAdapterResult> {
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${sql}) bpo_master_count`,
    params
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `${sql} LIMIT ? OFFSET ?`,
    [...params, filters.limit, filters.offset]
  );
  const normalized = normalize(code, rows);
  return {
    rows: normalized.rows,
    totalCount: Number(countRows[0]?.total ?? 0),
    sourceTable,
    availableKeys: normalized.availableKeys,
  };
}

async function operations(
  code: string,
  filters: WorkforceAdapterFilters,
  scope: BranchScope
): Promise<WorkforceAdapterResult | null> {
  if (!(await tableExists("attendance_daily_record")) || !(await tableExists("employees"))) return null;
  const bounds = dateBounds(filters);
  const scoped = scopeWhere(scope, filters);
  const hasRoster = await tableExists("wfm_roster_assignment") && await tableExists("wfm_shift_master");
  const hasSession = await tableExists("wfm_attendance_session");
  const hasBreak = await tableExists("break_daily_summary");
  const hasRecon = await tableExists("attendance_reconciliation_record");
  const hasKpi = await tableExists("kpi_daily_actual") && await tableExists("kpi_metric_master");
  const hasTarget = await tableExists("kpi_employee_resolved") && await tableExists("kpi_metric_master");

  const joins = [
    "LEFT JOIN branch_master b ON b.id = e.branch_id",
    "LEFT JOIN department_master d ON d.id = e.department_id",
    "LEFT JOIN designation_master des ON des.id = e.designation_id",
    "LEFT JOIN process_master p ON p.id = e.process_id",
    "LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id",
    "LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)",
  ];
  if (hasRoster) {
    joins.push("LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = e.id AND wra.roster_date = adr.record_date");
    joins.push("LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id");
  }
  if (hasSession) {
    joins.push(`LEFT JOIN (
      SELECT employee_id, session_date,
             MIN(login_time) AS login_time,
             MAX(logout_time) AS logout_time,
             SUM(COALESCE(total_login_minutes,0)) AS login_minutes,
             SUM(COALESCE(break_minutes,0)) AS session_break_minutes
        FROM wfm_attendance_session
       GROUP BY employee_id, session_date
    ) ses ON ses.employee_id = e.id AND ses.session_date = adr.record_date`);
  }
  if (hasBreak) {
    joins.push("LEFT JOIN break_daily_summary bds ON bds.employee_id = e.id AND bds.shift_date = adr.record_date");
  }
  if (hasRecon) {
    joins.push("LEFT JOIN attendance_reconciliation_record arr ON arr.employee_id = e.id AND arr.roster_date = adr.record_date");
  }
  if (hasKpi) {
    joins.push(`LEFT JOIN (
      SELECT kda.employee_id, kda.metric_date,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('PRODUCTIVITY','DIALS','TASKS_COMPLETED') THEN kda.actual_value END) AS productivity,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('AHT','AVG_HANDLE_TIME') THEN kda.actual_value END) AS aht,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('QUALITY','QUALITY_SCORE','QA_SCORE') THEN kda.actual_value END) AS quality_score,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('SLA','SLA_ADHERENCE','SERVICE_LEVEL') THEN kda.actual_value END) AS sla,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('CSAT','CUSTOMER_SATISFACTION') THEN kda.actual_value END) AS csat,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('NPS','NPS_SCORE') THEN kda.actual_value END) AS nps,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('FATAL','FATAL_RATE','FATAL_ERROR') THEN kda.actual_value END) AS fatal,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('ADHERENCE','ROSTER_ADHERENCE','SCHEDULE_ADHERENCE') THEN kda.actual_value END) AS adherence,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('SHRINKAGE','SHRINKAGE_PCT') THEN kda.actual_value END) AS shrinkage,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('UTILISATION','UTILIZATION') THEN kda.actual_value END) AS utilisation,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('OCCUPANCY','OCCUPANCY_PCT') THEN kda.actual_value END) AS occupancy,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('REWORK','REWORK_COUNT') THEN kda.actual_value END) AS rework
        FROM kpi_daily_actual kda
        JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
       GROUP BY kda.employee_id, kda.metric_date
    ) kpi ON kpi.employee_id = e.id AND kpi.metric_date = adr.record_date`);
  }
  if (hasTarget) {
    joins.push(`LEFT JOIN (
      SELECT ker.employee_id,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('PRODUCTIVITY','DIALS','TASKS_COMPLETED') THEN ker.target_value END) AS productivity_target,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('AHT','AVG_HANDLE_TIME') THEN ker.target_value END) AS aht_target,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('QUALITY','QUALITY_SCORE','QA_SCORE') THEN ker.target_value END) AS quality_target,
             MAX(CASE WHEN UPPER(kmm.metric_code) IN ('SLA','SLA_ADHERENCE','SERVICE_LEVEL') THEN ker.target_value END) AS sla_target
        FROM kpi_employee_resolved ker
        JOIN kpi_metric_master kmm ON kmm.id = ker.metric_id
       GROUP BY ker.employee_id
    ) tgt ON tgt.employee_id = e.id`);
  }

  const scheduled = hasRecon ? "arr.required_minutes" : "NULL";
  const loginMinutes = hasSession ? "ses.login_minutes" : "NULL";
  const breakMinutes = hasBreak ? "bds.total_break_minutes" : hasSession ? "ses.session_break_minutes" : "NULL";
  const productive = hasRecon ? "arr.productive_minutes" : "adr.raw_minutes";
  const productivity = hasKpi ? "kpi.productivity" : "NULL";
  const productivityTarget = hasTarget ? "tgt.productivity_target" : "NULL";
  const sql = `SELECT
      e.employee_code AS EMPLOYEE_CODE,
      UPPER(DATE_FORMAT(adr.record_date,'%d-%b-%Y')) AS REPORT_DATE,
      COALESCE(NULLIF(e.full_name,''), TRIM(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')))) AS EMPLOYEE_NAME,
      e.employment_status AS EMPLOYMENT_STATUS,
      UPPER(DATE_FORMAT(e.date_of_joining,'%d-%b-%Y')) AS DATE_OF_JOINING,
      UPPER(DATE_FORMAT(e.date_of_exit,'%d-%b-%Y')) AS DATE_OF_EXIT,
      DATEDIFF(COALESCE(e.date_of_exit,CURRENT_DATE()),e.date_of_joining) AS TENURE_DAYS,
      b.branch_name AS BRANCH,
      d.dept_name AS DEPARTMENT,
      des.designation_name AS DESIGNATION,
      p.process_name AS PROCESS,
      cc.cost_centre_name AS COST_CENTRE,
      mgr.employee_code AS REPORTING_MANAGER_CODE,
      COALESCE(NULLIF(mgr.full_name,''), TRIM(CONCAT(COALESCE(mgr.first_name,''),' ',COALESCE(mgr.last_name,'')))) AS REPORTING_MANAGER_NAME,
      e.employment_type AS EMPLOYMENT_TYPE,
      e.shift_rotation_type AS SHIFT_ROTATION_TYPE,
      ${hasRoster ? "wsm.shift_name" : "NULL"} AS ROSTER_SHIFT,
      ${hasRoster ? "TIME_FORMAT(wsm.start_time,'%H:%i:%s')" : "NULL"} AS SHIFT_START_TIME,
      ${hasRoster ? "TIME_FORMAT(wsm.end_time,'%H:%i:%s')" : "NULL"} AS SHIFT_END_TIME,
      ${scheduled} AS SCHEDULED_MINUTES,
      ${hasSession ? "TIME_FORMAT(ses.login_time,'%H:%i:%s')" : "NULL"} AS LOGIN_TIME,
      ${hasSession ? "TIME_FORMAT(ses.logout_time,'%H:%i:%s')" : "NULL"} AS LOGOUT_TIME,
      ${loginMinutes} AS LOGIN_MINUTES,
      ${productive} AS PRODUCTIVE_MINUTES,
      GREATEST(0,COALESCE(${loginMinutes},0)-COALESCE(${productive},0)-COALESCE(${breakMinutes},0)) AS IDLE_MINUTES,
      ${breakMinutes} AS BREAK_MINUTES,
      COALESCE(${breakMinutes},0) + GREATEST(0,COALESCE(${scheduled},0)-COALESCE(${productive},0)) AS TOTAL_SHRINKAGE_MINUTES,
      CASE WHEN COALESCE(${scheduled},0)>0 THEN ROUND((COALESCE(${scheduled},0)-COALESCE(${productive},0))/COALESCE(${scheduled},0)*100,2) END AS SHRINKAGE_PERCENTAGE,
      ${hasRecon ? "arr.adherence_pct" : hasKpi ? "kpi.adherence" : "NULL"} AS ROSTER_ADHERENCE_PERCENTAGE,
      ${hasRecon ? "arr.adherence_pct" : hasKpi ? "kpi.adherence" : "NULL"} AS SCHEDULE_ADHERENCE_PERCENTAGE,
      adr.attendance_status AS ATTENDANCE_STATUS,
      adr.late_by_minutes AS LATE_BY_MINUTES,
      ${hasRecon ? "arr.early_exit_minutes" : "NULL"} AS EARLY_LOGOUT_MINUTES,
      GREATEST(0,COALESCE(${loginMinutes},0)-COALESCE(${scheduled},0)) AS OVERTIME_MINUTES,
      ${productivity} AS TASKS_COMPLETED,
      ${productivityTarget} AS PRODUCTIVITY_TARGET,
      ${productivity} AS PRODUCTIVITY_ACHIEVED,
      CASE WHEN COALESCE(${productivityTarget},0)>0 THEN ROUND(COALESCE(${productivity},0)/${productivityTarget}*100,2) END AS PRODUCTIVITY_PERCENTAGE,
      ${hasTarget ? "tgt.aht_target" : "NULL"} AS AHT_TARGET_SECONDS,
      ${hasKpi ? "kpi.aht" : "NULL"} AS AHT_ACHIEVED_SECONDS,
      ${hasKpi && hasTarget ? "kpi.aht-tgt.aht_target" : "NULL"} AS AHT_VARIANCE_SECONDS,
      ${hasTarget ? "tgt.sla_target" : "NULL"} AS SLA_TARGET_PERCENTAGE,
      ${hasKpi ? "kpi.sla" : "NULL"} AS SLA_ACHIEVED_PERCENTAGE,
      ${hasKpi ? "kpi.rework" : "NULL"} AS REWORK_COUNT,
      ${hasTarget ? "tgt.quality_target" : "NULL"} AS QUALITY_TARGET_PERCENTAGE,
      ${hasKpi ? "kpi.quality_score" : "NULL"} AS QUALITY_SCORE_PERCENTAGE,
      ${hasKpi ? "CASE WHEN COALESCE(kpi.fatal,0)>0 THEN 1 ELSE 0 END" : "NULL"} AS FATAL_ERROR_COUNT,
      ${hasKpi ? "kpi.csat" : "NULL"} AS CSAT_PERCENTAGE,
      ${hasKpi ? "kpi.nps" : "NULL"} AS NPS_SCORE,
      ${hasKpi ? "kpi.utilisation" : "NULL"} AS UTILISATION_PERCENTAGE,
      ${hasKpi ? "kpi.occupancy" : "NULL"} AS OCCUPANCY_PERCENTAGE,
      CASE
        WHEN COALESCE(${productivity},0) >= COALESCE(${productivityTarget},${productivity},0)
         AND COALESCE(${hasKpi ? "kpi.quality_score" : "NULL"},100) >= COALESCE(${hasTarget ? "tgt.quality_target" : "NULL"},0) THEN 'GREEN'
        WHEN COALESCE(${productivity},0) > 0 THEN 'AMBER'
        ELSE 'RED'
      END AS PERFORMANCE_RAG,
      'ATTENDANCE+KPI+ROSTER+BREAK' AS DATA_SOURCE
    FROM attendance_daily_record adr
    JOIN employees e ON e.id = adr.employee_id
    ${joins.join("\n")}
    WHERE adr.record_date BETWEEN ? AND ?
      ${scoped.clauses.length ? `AND ${scoped.clauses.join(" AND ")}` : ""}
    ORDER BY adr.record_date DESC, e.employee_code`;
  return paginated(code, "ATTENDANCE_DAILY_RECORD+KPI_DAILY_ACTUAL", sql, [bounds.from, bounds.to, ...scoped.params], filters);
}

async function wfm(
  code: string,
  filters: WorkforceAdapterFilters,
  scope: BranchScope
): Promise<WorkforceAdapterResult | null> {
  if (!(await tableExists("attendance_daily_record")) || !(await tableExists("employees"))) return null;
  const bounds = dateBounds(filters);
  const scoped = scopeWhere(scope, filters);
  const hasRoster = await tableExists("wfm_roster_assignment") && await tableExists("wfm_shift_master");
  const hasSession = await tableExists("wfm_attendance_session");
  const hasBreak = await tableExists("break_daily_summary");
  const hasRecon = await tableExists("attendance_reconciliation_record");
  const hasBio = await tableExists("integration_biometric_daily");
  const joins = [
    "LEFT JOIN branch_master b ON b.id=e.branch_id",
    "LEFT JOIN department_master d ON d.id=e.department_id",
    "LEFT JOIN designation_master des ON des.id=e.designation_id",
    "LEFT JOIN process_master p ON p.id=e.process_id",
    "LEFT JOIN cost_centre_master cc ON cc.id=e.cost_centre_id",
    "LEFT JOIN employees mgr ON mgr.id=COALESCE(e.reporting_manager_id,e.manager_id)",
  ];
  if (hasRoster) {
    joins.push("LEFT JOIN wfm_roster_assignment wra ON wra.employee_id=e.id AND wra.roster_date=adr.record_date");
    joins.push("LEFT JOIN wfm_shift_master wsm ON wsm.id=wra.shift_id");
  }
  if (hasSession) {
    joins.push(`LEFT JOIN (
      SELECT employee_id,session_date,MIN(login_time) login_time,MAX(logout_time) logout_time,SUM(total_login_minutes) login_minutes
      FROM wfm_attendance_session GROUP BY employee_id,session_date
    ) ses ON ses.employee_id=e.id AND ses.session_date=adr.record_date`);
  }
  if (hasBreak) joins.push("LEFT JOIN break_daily_summary bds ON bds.employee_id=e.id AND bds.shift_date=adr.record_date");
  if (hasRecon) joins.push("LEFT JOIN attendance_reconciliation_record arr ON arr.employee_id=e.id AND arr.roster_date=adr.record_date");
  if (hasBio) joins.push("LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code=e.employee_code AND ibd.activity_date=adr.record_date");
  const sql = `SELECT
      e.employee_code EMPLOYEE_CODE,
      UPPER(DATE_FORMAT(adr.record_date,'%d-%b-%Y')) REPORT_DATE,
      COALESCE(NULLIF(e.full_name,''),TRIM(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')))) EMPLOYEE_NAME,
      e.employment_status EMPLOYMENT_STATUS,
      UPPER(DATE_FORMAT(e.date_of_joining,'%d-%b-%Y')) DATE_OF_JOINING,
      UPPER(DATE_FORMAT(e.date_of_exit,'%d-%b-%Y')) DATE_OF_EXIT,
      DATEDIFF(COALESCE(e.date_of_exit,CURRENT_DATE()),e.date_of_joining) TENURE_DAYS,
      b.branch_name BRANCH,d.dept_name DEPARTMENT,des.designation_name DESIGNATION,p.process_name PROCESS,cc.cost_centre_name COST_CENTRE,
      mgr.employee_code REPORTING_MANAGER_CODE,COALESCE(NULLIF(mgr.full_name,''),TRIM(CONCAT(COALESCE(mgr.first_name,''),' ',COALESCE(mgr.last_name,'')))) REPORTING_MANAGER_NAME,
      e.employment_type EMPLOYMENT_TYPE,e.shift_rotation_type SHIFT_ROTATION_TYPE,
      ${hasRoster ? "wra.status" : "NULL"} ROSTER_STATUS,
      ${hasRoster ? "wra.roster_cycle_id" : "NULL"} ROSTER_VERSION,
      ${hasRoster ? "wsm.shift_name" : "NULL"} ROSTER_SHIFT,
      ${hasRoster ? "TIME_FORMAT(wsm.start_time,'%H:%i:%s')" : "NULL"} SHIFT_START_TIME,
      ${hasRoster ? "TIME_FORMAT(wsm.end_time,'%H:%i:%s')" : "NULL"} SHIFT_END_TIME,
      ${hasRecon ? "arr.required_minutes" : "NULL"} SCHEDULED_MINUTES,
      CASE WHEN adr.attendance_status='week_off' THEN 'YES' ELSE 'NO' END WEEK_OFF_FLAG,
      CASE WHEN adr.attendance_status='holiday' THEN 'YES' ELSE 'NO' END HOLIDAY_FLAG,
      ${hasBio ? "TIME_FORMAT(ibd.first_punch,'%H:%i:%s')" : "NULL"} BIOMETRIC_FIRST_PUNCH,
      ${hasBio ? "TIME_FORMAT(ibd.last_punch,'%H:%i:%s')" : "NULL"} BIOMETRIC_LAST_PUNCH,
      ${hasBio ? "ibd.biometric_minutes" : "adr.biometric_minutes"} BIOMETRIC_MINUTES,
      ${hasSession ? "TIME_FORMAT(ses.login_time,'%H:%i:%s')" : "NULL"} SYSTEM_LOGIN_TIME,
      ${hasSession ? "TIME_FORMAT(ses.logout_time,'%H:%i:%s')" : "NULL"} SYSTEM_LOGOUT_TIME,
      ${hasSession ? "ses.login_minutes" : "NULL"} SYSTEM_LOGIN_MINUTES,
      adr.attendance_source ATTENDANCE_SOURCE,adr.attendance_status ATTENDANCE_STATUS,
      (1-COALESCE(adr.lwp_value,0)) PAYABLE_DAY_VALUE,adr.lwp_value LWP_DAY_VALUE,
      CASE WHEN adr.attendance_status='half_day' THEN 'YES' ELSE 'NO' END HALF_DAY_FLAG,
      CASE WHEN adr.late_mark=1 THEN 'YES' ELSE 'NO' END LATE_MARK_FLAG,
      adr.late_by_minutes LATE_BY_MINUTES,
      ${hasRecon ? "arr.early_exit_minutes" : "NULL"} EARLY_LOGOUT_MINUTES,
      GREATEST(0,COALESCE(${hasRecon ? "arr.required_minutes" : "0"},0)-COALESCE(${hasSession ? "ses.login_minutes" : "adr.raw_minutes"},0)) SHORT_ATTENDANCE_MINUTES,
      GREATEST(0,COALESCE(${hasSession ? "ses.login_minutes" : "adr.raw_minutes"},0)-COALESCE(${hasRecon ? "arr.required_minutes" : "0"},0)) OVERTIME_MINUTES,
      adr.regularization_id REGULARISATION_ID,
      CASE WHEN adr.regularization_id IS NULL THEN 'NOT REQUESTED' ELSE 'APPLIED' END REGULARISATION_STATUS,
      ${hasBreak ? "bds.mini_break_count" : "NULL"} MINI_BREAK_COUNT,
      ${hasBreak ? "CASE WHEN bds.mini_break_count>0 THEN GREATEST(0,bds.total_break_minutes-(bds.long_break_count*30)) ELSE 0 END" : "NULL"} MINI_BREAK_MINUTES,
      ${hasBreak ? "bds.long_break_count" : "NULL"} LONG_BREAK_COUNT,
      ${hasBreak ? "CASE WHEN bds.long_break_count>0 THEN bds.total_break_minutes ELSE 0 END" : "NULL"} LONG_BREAK_MINUTES,
      ${hasBreak ? "bds.total_break_minutes" : "NULL"} TOTAL_BREAK_MINUTES,
      ${hasBreak ? "CASE WHEN bds.exception_count>0 OR bds.exceeded_break_count>0 THEN 'YES' ELSE 'NO' END" : "NULL"} BREAK_EXCEPTION_FLAG,
      ${hasRecon ? "arr.adherence_pct" : "NULL"} ROSTER_ADHERENCE_PERCENTAGE,
      ${hasRecon ? "arr.adherence_pct" : "NULL"} SCHEDULE_ADHERENCE_PERCENTAGE,
      ${hasRecon ? "arr.break_minutes" : hasBreak ? "bds.total_break_minutes" : "NULL"} TOTAL_SHRINKAGE_MINUTES,
      CASE WHEN COALESCE(${hasRecon ? "arr.required_minutes" : "0"},0)>0 THEN ROUND((COALESCE(${hasRecon ? "arr.required_minutes" : "0"},0)-COALESCE(${hasRecon ? "arr.productive_minutes" : "adr.raw_minutes"},0))/COALESCE(${hasRecon ? "arr.required_minutes" : "0"},0)*100,2) END SHRINKAGE_PERCENTAGE,
      CASE WHEN ${hasRecon ? "arr.attendance_status" : "adr.attendance_status"}<>adr.attendance_status THEN 'STATUS MISMATCH' ELSE NULL END MISMATCH_TYPE,
      CASE WHEN ${hasRecon ? "arr.attendance_status" : "adr.attendance_status"}<>adr.attendance_status THEN 'OPEN' ELSE 'RECONCILED' END MISMATCH_STATUS,
      CASE WHEN adr.is_locked=1 THEN 'LOCKED' ELSE 'OPEN' END LOCK_STATUS,
      CASE WHEN COALESCE(adr.lwp_value,0)>0 OR adr.regularization_id IS NOT NULL THEN 'YES' ELSE 'NO' END PAYROLL_IMPACT_FLAG,
      'ROSTER+BIOMETRIC+ATTENDANCE+BREAK+RECONCILIATION' DATA_SOURCE
    FROM attendance_daily_record adr JOIN employees e ON e.id=adr.employee_id
    ${joins.join("\n")}
    WHERE adr.record_date BETWEEN ? AND ? ${scoped.clauses.length ? `AND ${scoped.clauses.join(" AND ")}` : ""}
    ORDER BY adr.record_date DESC,e.employee_code`;
  return paginated(code,"ATTENDANCE_DAILY_RECORD+RECONCILIATION",sql,[bounds.from,bounds.to,...scoped.params],filters);
}

async function employee360(
  code: string,
  filters: WorkforceAdapterFilters,
  scope: BranchScope
): Promise<WorkforceAdapterResult | null> {
  if (!(await tableExists("employees"))) return null;
  const bounds = dateBounds(filters);
  const scoped = scopeWhere(scope, filters);
  const hasAttendance = await tableExists("attendance_daily_record");
  const hasKpi = await tableExists("kpi_daily_actual") && await tableExists("kpi_metric_master");
  const hasSummary = await tableExists("management_kpi_summary");
  const hasCoaching = await tableExists("coaching_session");
  const hasPip = await tableExists("pip_record");
  const hasLms = await tableExists("lms_learning_progress_snapshot");
  const hasCert = await tableExists("lms_certification_snapshot");
  const hasGrievance = await tableExists("grievance");
  const joins = [
    "LEFT JOIN branch_master b ON b.id=e.branch_id",
    "LEFT JOIN department_master d ON d.id=e.department_id",
    "LEFT JOIN designation_master des ON des.id=e.designation_id",
    "LEFT JOIN process_master p ON p.id=e.process_id",
    "LEFT JOIN cost_centre_master cc ON cc.id=e.cost_centre_id",
    "LEFT JOIN employees mgr ON mgr.id=COALESCE(e.reporting_manager_id,e.manager_id)",
  ];
  const params: unknown[] = [];
  if (hasAttendance) {
    joins.push(`LEFT JOIN (
      SELECT employee_id,
             COUNT(*) working_days,
             SUM(attendance_status='present') present_days,
             SUM(attendance_status='absent') absent_days,
             SUM(attendance_status='leave_approved') leave_days,
             SUM(COALESCE(lwp_value,0)) lwp_days,
             SUM(attendance_status='week_off') week_off_days,
             SUM(attendance_status='holiday') holiday_days,
             SUM(COALESCE(late_mark,0)) late_mark_count
      FROM attendance_daily_record WHERE record_date BETWEEN ? AND ? GROUP BY employee_id
    ) att ON att.employee_id=e.id`);
    params.push(bounds.from,bounds.to);
  }
  if (hasKpi) {
    joins.push(`LEFT JOIN (
      SELECT kda.employee_id,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('PRODUCTIVITY','DIALS','TASKS_COMPLETED') THEN kda.actual_value END) productivity,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('AHT','AVG_HANDLE_TIME') THEN kda.actual_value END) aht,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('QUALITY','QUALITY_SCORE','QA_SCORE') THEN kda.actual_value END) quality_score,
             SUM(CASE WHEN UPPER(kmm.metric_code) IN ('FATAL','FATAL_RATE','FATAL_ERROR') AND kda.actual_value>0 THEN 1 ELSE 0 END) fatal_count,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('CSAT','CUSTOMER_SATISFACTION') THEN kda.actual_value END) csat,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('NPS','NPS_SCORE') THEN kda.actual_value END) nps,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('SLA','SLA_ADHERENCE') THEN kda.actual_value END) sla,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('ADHERENCE','ROSTER_ADHERENCE') THEN kda.actual_value END) adherence,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('UTILISATION','UTILIZATION') THEN kda.actual_value END) utilisation,
             AVG(CASE WHEN UPPER(kmm.metric_code) IN ('OCCUPANCY','OCCUPANCY_PCT') THEN kda.actual_value END) occupancy
      FROM kpi_daily_actual kda JOIN kpi_metric_master kmm ON kmm.id=kda.metric_id
      WHERE kda.metric_date BETWEEN ? AND ? GROUP BY kda.employee_id
    ) kpi ON kpi.employee_id=e.id`);
    params.push(bounds.from,bounds.to);
  }
  if (hasSummary) {
    joins.push("LEFT JOIN management_kpi_summary mks ON mks.employee_id=e.id AND mks.period_code=?");
    params.push(bounds.reportMonth);
  }
  if (hasCoaching) {
    joins.push(`LEFT JOIN (
      SELECT employee_id,COUNT(*) coaching_count,MAX(session_date) last_coaching_date
      FROM coaching_session WHERE session_date BETWEEN ? AND ? GROUP BY employee_id
    ) coach ON coach.employee_id=e.id`);
    params.push(bounds.from,bounds.to);
  }
  if (hasPip) {
    joins.push(`LEFT JOIN (
      SELECT pr.* FROM pip_record pr JOIN (
        SELECT employee_id,MAX(created_at) max_created FROM pip_record GROUP BY employee_id
      ) latest ON latest.employee_id=pr.employee_id AND latest.max_created=pr.created_at
    ) pip ON pip.employee_id=e.id`);
  }
  if (hasLms) {
    joins.push(`LEFT JOIN (
      SELECT employee_id,COUNT(*) assigned_count,SUM(status='completed') completed_count,AVG(score) avg_score
      FROM lms_learning_progress_snapshot GROUP BY employee_id
    ) lms ON lms.employee_id=e.id`);
  }
  if (hasCert) {
    joins.push(`LEFT JOIN (
      SELECT employee_id,
             CASE WHEN SUM(status='active')>0 THEN 'ACTIVE' WHEN SUM(status='expired')>0 THEN 'EXPIRED' ELSE 'NONE' END certification_status
      FROM lms_certification_snapshot GROUP BY employee_id
    ) cert ON cert.employee_id=e.id`);
  }
  if (hasGrievance) {
    joins.push("LEFT JOIN (SELECT employee_id,COUNT(*) grievance_count FROM grievance GROUP BY employee_id) gr ON gr.employee_id=e.id");
  }
  const reportMonth = `UPPER(DATE_FORMAT('${bounds.reportMonth}-01','%b-%Y'))`;
  const sql = `SELECT
      e.employee_code EMPLOYEE_CODE,UPPER(DATE_FORMAT(LAST_DAY('${bounds.reportMonth}-01'),'%d-%b-%Y')) REPORT_DATE,
      COALESCE(NULLIF(e.full_name,''),TRIM(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')))) EMPLOYEE_NAME,
      e.employment_status EMPLOYMENT_STATUS,UPPER(DATE_FORMAT(e.date_of_joining,'%d-%b-%Y')) DATE_OF_JOINING,
      UPPER(DATE_FORMAT(e.date_of_exit,'%d-%b-%Y')) DATE_OF_EXIT,DATEDIFF(COALESCE(e.date_of_exit,CURRENT_DATE()),e.date_of_joining) TENURE_DAYS,
      b.branch_name BRANCH,d.dept_name DEPARTMENT,des.designation_name DESIGNATION,p.process_name PROCESS,cc.cost_centre_name COST_CENTRE,
      mgr.employee_code REPORTING_MANAGER_CODE,COALESCE(NULLIF(mgr.full_name,''),TRIM(CONCAT(COALESCE(mgr.first_name,''),' ',COALESCE(mgr.last_name,'')))) REPORTING_MANAGER_NAME,
      e.employment_type EMPLOYMENT_TYPE,e.shift_rotation_type SHIFT_ROTATION_TYPE,
      ${reportMonth} REPORT_MONTH,
      ${hasAttendance ? "att.working_days" : "NULL"} WORKING_DAYS,
      ${hasAttendance ? "att.working_days" : "NULL"} ROSTERED_DAYS,
      ${hasAttendance ? "att.present_days" : "NULL"} PRESENT_DAYS,
      ${hasAttendance ? "att.absent_days" : "NULL"} ABSENT_DAYS,
      ${hasAttendance ? "att.leave_days" : "NULL"} LEAVE_DAYS,
      ${hasAttendance ? "att.lwp_days" : "NULL"} LWP_DAYS,
      ${hasAttendance ? "att.week_off_days" : "NULL"} WEEK_OFF_DAYS,
      ${hasAttendance ? "att.holiday_days" : "NULL"} HOLIDAY_DAYS,
      ${hasAttendance ? "att.late_mark_count" : "NULL"} LATE_MARK_COUNT,
      ${hasAttendance ? "CASE WHEN att.working_days>0 THEN ROUND(att.present_days/att.working_days*100,2) END" : "NULL"} ATTENDANCE_PERCENTAGE,
      ${hasKpi ? "kpi.productivity" : "NULL"} PRODUCTIVITY_ACHIEVED,
      ${hasKpi ? "kpi.aht" : "NULL"} AHT_ACHIEVED_SECONDS,
      ${hasKpi ? "kpi.quality_score" : "NULL"} QUALITY_SCORE_PERCENTAGE,
      ${hasKpi ? "kpi.fatal_count" : "NULL"} FATAL_ERROR_COUNT,
      ${hasKpi ? "kpi.csat" : "NULL"} CSAT_PERCENTAGE,
      ${hasKpi ? "kpi.nps" : "NULL"} NPS_SCORE,
      ${hasKpi ? "kpi.sla" : "NULL"} SLA_ACHIEVEMENT_PERCENTAGE,
      ${hasKpi ? "kpi.adherence" : "NULL"} ADHERENCE_PERCENTAGE,
      ${hasKpi ? "kpi.utilisation" : "NULL"} UTILISATION_PERCENTAGE,
      ${hasKpi ? "kpi.occupancy" : "NULL"} OCCUPANCY_PERCENTAGE,
      ${hasSummary ? "mks.composite_score" : "NULL"} COMPOSITE_PERFORMANCE_SCORE,
      ${hasSummary ? "mks.performance_band" : "NULL"} PERFORMANCE_RATING,
      ${hasSummary ? "mks.risk_level" : "NULL"} PERFORMANCE_RAG,
      ${hasSummary ? "mks.previous_score" : "NULL"} PREVIOUS_MONTH_SCORE,
      ${hasSummary ? "mks.score_movement" : "NULL"} SCORE_MOVEMENT,
      ${hasSummary ? "mks.rolling_3m_avg" : "NULL"} THREE_MONTH_AVERAGE,
      ${hasSummary ? "mks.rank_in_team" : "NULL"} RANK_IN_TEAM,
      ${hasSummary ? "mks.rank_in_process" : "NULL"} RANK_IN_PROCESS,
      ${hasSummary ? "CASE WHEN mks.risk_level='bottom' THEN 'YES' ELSE 'NO' END" : "NULL"} BOTTOM_PERFORMER_FLAG,
      ${hasSummary ? "CASE WHEN mks.performance_band='excellent' THEN 'YES' ELSE 'NO' END" : "NULL"} TOP_PERFORMER_FLAG,
      ${hasPip ? "pip.status" : "NULL"} PIP_STATUS,
      ${hasPip ? "UPPER(DATE_FORMAT(pip.start_date,'%d-%b-%Y'))" : "NULL"} PIP_START_DATE,
      ${hasPip ? "UPPER(DATE_FORMAT(pip.end_date,'%d-%b-%Y'))" : "NULL"} PIP_END_DATE,
      ${hasPip ? "pip.outcome" : "NULL"} PIP_OUTCOME,
      ${hasCoaching ? "coach.coaching_count" : "NULL"} COACHING_COUNT,
      ${hasLms ? "lms.assigned_count" : "NULL"} TRAINING_ASSIGNED_COUNT,
      ${hasLms ? "lms.completed_count" : "NULL"} TRAINING_COMPLETED_COUNT,
      ${hasLms ? "lms.avg_score" : "NULL"} ASSESSMENT_SCORE_PERCENTAGE,
      ${hasCert ? "cert.certification_status" : "NULL"} CERTIFICATION_STATUS,
      ${hasGrievance ? "gr.grievance_count" : "NULL"} GRIEVANCE_CASE_COUNT,
      'EMPLOYEE+ATTENDANCE+KPI+PIP+LMS' DATA_SOURCE
    FROM employees e ${joins.join("\n")}
    WHERE ${scoped.clauses.length ? scoped.clauses.join(" AND ") : "1=1"}
    ORDER BY e.employee_code`;
  return paginated(code,"EMPLOYEE_360_GOVERNED_SOURCES",sql,[...params,...scoped.params],filters);
}

async function hrLifecycle(
  code: string,
  filters: WorkforceAdapterFilters,
  scope: BranchScope
): Promise<WorkforceAdapterResult | null> {
  if (!(await tableExists("employees"))) return null;
  const scoped = scopeWhere(scope, filters);
  const hasDocs = await tableExists("employee_documents");
  const hasLifecycle = await tableExists("employee_lifecycle_event");
  const hasUan = await tableExists("employee_uan");
  const hasAssets = await tableExists("asset_assignment");
  const joins = [
    "LEFT JOIN branch_master b ON b.id=e.branch_id","LEFT JOIN department_master d ON d.id=e.department_id",
    "LEFT JOIN designation_master des ON des.id=e.designation_id","LEFT JOIN process_master p ON p.id=e.process_id",
    "LEFT JOIN cost_centre_master cc ON cc.id=e.cost_centre_id","LEFT JOIN employees mgr ON mgr.id=COALESCE(e.reporting_manager_id,e.manager_id)",
  ];
  if (hasDocs) joins.push(`LEFT JOIN (
    SELECT employee_id,COUNT(*) document_count,SUM(COALESCE(verified,0)=1) verified_count,
           SUM(COALESCE(verified,0)=0) missing_count,SUM(expiry_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL 60 DAY)) expiring_count
    FROM employee_documents GROUP BY employee_id
  ) docs ON docs.employee_id=e.id`);
  if (hasLifecycle) joins.push(`LEFT JOIN (
    SELECT employee_id,COUNT(*) event_count,
      MAX(CASE WHEN event_type='promotion' THEN effective_date END) last_promotion_date,
      MAX(CASE WHEN event_type='increment' THEN effective_date END) last_increment_date,
      MAX(CASE WHEN event_type IN ('transfer','branch_change','process_change') THEN effective_date END) last_transfer_date
    FROM employee_lifecycle_event GROUP BY employee_id
  ) life ON life.employee_id=e.id`);
  if (hasUan) joins.push("LEFT JOIN employee_uan uan ON uan.employee_id=e.id AND uan.is_active=1");
  if (hasAssets) joins.push("LEFT JOIN (SELECT employee_id,COUNT(*) asset_count FROM asset_assignment WHERE returned_date IS NULL GROUP BY employee_id) ast ON ast.employee_id=e.id");
  const asOf = filters.to ?? new Date().toISOString().slice(0,10);
  const sql = `SELECT
    e.employee_code EMPLOYEE_CODE,UPPER(DATE_FORMAT('${asOf}','%d-%b-%Y')) REPORT_DATE,
    COALESCE(NULLIF(e.full_name,''),TRIM(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')))) EMPLOYEE_NAME,
    e.employment_status EMPLOYMENT_STATUS,UPPER(DATE_FORMAT(e.date_of_joining,'%d-%b-%Y')) DATE_OF_JOINING,
    UPPER(DATE_FORMAT(e.date_of_exit,'%d-%b-%Y')) DATE_OF_EXIT,DATEDIFF(COALESCE(e.date_of_exit,'${asOf}'),e.date_of_joining) TENURE_DAYS,
    b.branch_name BRANCH,e.location LOCATION,d.dept_name DEPARTMENT,des.designation_name DESIGNATION,p.process_name PROCESS,cc.cost_centre_name COST_CENTRE,
    mgr.employee_code REPORTING_MANAGER_CODE,COALESCE(NULLIF(mgr.full_name,''),TRIM(CONCAT(COALESCE(mgr.first_name,''),' ',COALESCE(mgr.last_name,'')))) REPORTING_MANAGER_NAME,
    e.employment_type EMPLOYMENT_TYPE,e.shift_rotation_type SHIFT_ROTATION_TYPE,e.gender GENDER,
    UPPER(DATE_FORMAT(e.date_of_birth,'%d-%b-%Y')) DATE_OF_BIRTH,TIMESTAMPDIFF(YEAR,e.date_of_birth,'${asOf}') AGE_YEARS,
    e.official_email OFFICIAL_EMAIL,e.personal_email PERSONAL_EMAIL,e.mobile MOBILE_NUMBER,e.current_address CURRENT_ADDRESS,e.permanent_address PERMANENT_ADDRESS,
    e.emergency_contact_name EMERGENCY_CONTACT_NAME,e.emergency_contact_phone EMERGENCY_CONTACT_NUMBER,
    e.grade GRADE,e.level LEVEL,e.band BAND,e.probation_status PROBATION_STATUS,UPPER(DATE_FORMAT(e.probation_end_date,'%d-%b-%Y')) PROBATION_END_DATE,
    UPPER(DATE_FORMAT(e.confirmation_date,'%d-%b-%Y')) CONFIRMATION_DUE_DATE,e.confirmation_status CONFIRMATION_STATUS,
    e.notice_period_days NOTICE_PERIOD_DAYS,
    ${hasLifecycle ? "UPPER(DATE_FORMAT(life.last_promotion_date,'%d-%b-%Y'))" : "NULL"} LAST_PROMOTION_DATE,
    ${hasLifecycle ? "UPPER(DATE_FORMAT(life.last_increment_date,'%d-%b-%Y'))" : "NULL"} LAST_INCREMENT_DATE,
    ${hasLifecycle ? "UPPER(DATE_FORMAT(life.last_transfer_date,'%d-%b-%Y'))" : "NULL"} LAST_TRANSFER_DATE,
    ${hasLifecycle ? "life.event_count" : "NULL"} LIFECYCLE_EVENT_COUNT,
    CASE WHEN e.pan_number IS NULL OR e.pan_number='' THEN 'MISSING' ELSE 'AVAILABLE' END PAN_STATUS,
    ${hasUan ? "CASE WHEN uan.uan IS NULL THEN 'MISSING' ELSE 'AVAILABLE' END" : "NULL"} UAN_STATUS,
    CASE WHEN e.bank_account_number IS NULL OR e.bank_account_number='' THEN 'MISSING' ELSE 'AVAILABLE' END BANK_VERIFICATION_STATUS,
    ${hasDocs ? "docs.document_count" : "NULL"} MANDATORY_DOCUMENT_COUNT,
    ${hasDocs ? "docs.verified_count" : "NULL"} VERIFIED_DOCUMENT_COUNT,
    ${hasDocs ? "docs.missing_count" : "NULL"} MISSING_DOCUMENT_COUNT,
    ${hasDocs ? "docs.expiring_count" : "NULL"} EXPIRING_DOCUMENT_COUNT,
    ${hasAssets ? "CASE WHEN ast.asset_count>0 THEN 'YES' ELSE 'NO' END" : "NULL"} ASSET_ISSUED_FLAG,
    UPPER(DATE_FORMAT(e.resignation_date,'%d-%b-%Y')) RESIGNATION_DATE,UPPER(DATE_FORMAT(e.last_working_date,'%d-%b-%Y')) LAST_WORKING_DATE,
    e.exit_reason EXIT_REASON,e.attrition_type ATTRITION_TYPE,
    CASE WHEN e.date_of_exit IS NOT NULL AND DATEDIFF(e.date_of_exit,e.date_of_joining)<=90 THEN 'YES' ELSE 'NO' END EARLY_ATTRITION_FLAG,
    CASE WHEN e.employee_code IS NOT NULL AND e.branch_id IS NOT NULL AND e.department_id IS NOT NULL AND e.designation_id IS NOT NULL THEN 100 ELSE 75 END HR_DATA_COMPLETENESS_PERCENTAGE,
    'EMPLOYEE+LIFECYCLE+DOCUMENTS+STATUTORY+ASSETS' DATA_SOURCE,UPPER(DATE_FORMAT(e.updated_at,'%d-%b-%Y')) LAST_UPDATED_AT
    FROM employees e ${joins.join("\n")}
    WHERE ${scoped.clauses.length ? scoped.clauses.join(" AND ") : "1=1"}
    ORDER BY e.employee_code`;
  return paginated(code,"EMPLOYEE_LIFECYCLE_GOVERNED_SOURCES",sql,scoped.params,filters);
}

async function payroll(
  code: string,
  filters: WorkforceAdapterFilters,
  scope: BranchScope
): Promise<WorkforceAdapterResult | null> {
  if (!(await tableExists("salary_prep_line")) || !(await tableExists("salary_prep_run")) || !(await tableExists("employees"))) return null;
  const reportMonth = period(filters.month);
  const scoped = scopeWhere(scope, filters);
  const hasUan = await tableExists("employee_uan");
  const sql = `SELECT
    e.employee_code EMPLOYEE_CODE,UPPER(DATE_FORMAT(LAST_DAY(CONCAT(spr.run_month,'-01')),'%d-%b-%Y')) REPORT_DATE,
    COALESCE(NULLIF(e.full_name,''),TRIM(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')))) EMPLOYEE_NAME,
    e.employment_status EMPLOYMENT_STATUS,UPPER(DATE_FORMAT(e.date_of_joining,'%d-%b-%Y')) DATE_OF_JOINING,
    UPPER(DATE_FORMAT(e.date_of_exit,'%d-%b-%Y')) DATE_OF_EXIT,DATEDIFF(COALESCE(e.date_of_exit,CURRENT_DATE()),e.date_of_joining) TENURE_DAYS,
    b.branch_name BRANCH,d.dept_name DEPARTMENT,des.designation_name DESIGNATION,p.process_name PROCESS,cc.cost_centre_name COST_CENTRE,
    mgr.employee_code REPORTING_MANAGER_CODE,COALESCE(NULLIF(mgr.full_name,''),TRIM(CONCAT(COALESCE(mgr.first_name,''),' ',COALESCE(mgr.last_name,'')))) REPORTING_MANAGER_NAME,
    e.employment_type EMPLOYMENT_TYPE,e.shift_rotation_type SHIFT_ROTATION_TYPE,
    UPPER(DATE_FORMAT(CONCAT(spr.run_month,'-01'),'%b-%Y')) PAYROLL_MONTH,spr.id PAYROLL_RUN_ID,spr.status PAYROLL_RUN_STATUS,
    CASE WHEN spr.status IN ('locked','disbursed','finalized','released','paid') THEN 'LOCKED' ELSE 'OPEN' END PAYROLL_LOCK_STATUS,
    DAY(LAST_DAY(CONCAT(spr.run_month,'-01'))) CALENDAR_DAYS,spl.payable_days WORKING_DAYS,
    spl.present_days PRESENT_DAYS,spl.paid_leave_days PAID_LEAVE_DAYS,spl.week_off_days WEEK_OFF_DAYS,spl.holiday_days HOLIDAY_DAYS,
    spl.lwp_days LWP_DAYS,spl.payable_days PAYABLE_DAYS,spl.basic_pay BASIC_PAY,spl.hra HRA,spl.special_allowance SPECIAL_ALLOWANCE,
    spl.conveyance_allowance CONVEYANCE_ALLOWANCE,spl.other_allowance OTHER_ALLOWANCE,spl.variable_pay VARIABLE_PAY,
    spl.incentive_amount INCENTIVE_AMOUNT,spl.overtime_amount OVERTIME_AMOUNT,spl.arrear_amount ARREAR_AMOUNT,
    spl.reimbursement_amount REIMBURSEMENT_AMOUNT,spl.gross_salary GROSS_EARNINGS,spl.lwp_deduction LWP_DEDUCTION,
    spl.pf_employee PF_EMPLOYEE,spl.pf_employer PF_EMPLOYER,spl.esic_employee ESIC_EMPLOYEE,spl.esic_employer ESIC_EMPLOYER,
    spl.professional_tax PROFESSIONAL_TAX,spl.tds TDS,spl.loan_deduction LOAN_DEDUCTION,spl.advance_deduction ADVANCE_DEDUCTION,
    spl.other_deduction OTHER_DEDUCTION,spl.total_deductions TOTAL_DEDUCTIONS,spl.net_pay NET_PAY,
    ${hasUan ? "uan.uan" : "NULL"} UAN_NUMBER,spl.esic_number ESIC_NUMBER,spl.pan_number PAN_NUMBER,spl.bank_account_number BANK_ACCOUNT_NUMBER,
    spl.ifsc_code IFSC_CODE,spl.bank_verification_status BANK_VERIFICATION_STATUS,spl.payroll_validation_status PAYSLIP_STATUS,
    spl.payment_status DISBURSAL_STATUS,UPPER(DATE_FORMAT(spl.payment_date,'%d-%b-%Y')) DISBURSAL_DATE,spl.utr_reference UTR_REFERENCE,
    spl.attendance_source DATA_SOURCE
    FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id=spl.run_id JOIN employees e ON e.id=spl.employee_id
    LEFT JOIN branch_master b ON b.id=e.branch_id LEFT JOIN department_master d ON d.id=e.department_id
    LEFT JOIN designation_master des ON des.id=e.designation_id LEFT JOIN process_master p ON p.id=e.process_id
    LEFT JOIN cost_centre_master cc ON cc.id=e.cost_centre_id LEFT JOIN employees mgr ON mgr.id=COALESCE(e.reporting_manager_id,e.manager_id)
    ${hasUan ? "LEFT JOIN employee_uan uan ON uan.employee_id=e.id AND uan.is_active=1" : ""}
    WHERE spr.run_month=? ${scoped.clauses.length ? `AND ${scoped.clauses.join(" AND ")}` : ""}
    ORDER BY e.employee_code`;
  return paginated(code,"SALARY_PREP_LINE+RUN",sql,[reportMonth,...scoped.params],filters);
}

export async function runWorkforceBpoMasterAdapter(
  code: string,
  filters: WorkforceAdapterFilters,
  scope: BranchScope
): Promise<WorkforceAdapterResult | null> {
  if (!SUPPORTED.has(code)) return null;
  if (code === "bpo-operations-productivity-master") return operations(code,filters,scope);
  if (code === "bpo-wfm-attendance-shrinkage-master") return wfm(code,filters,scope);
  if (code === "bpo-employee-performance-360-master") return employee360(code,filters,scope);
  if (code === "bpo-hr-workforce-lifecycle-master") return hrLifecycle(code,filters,scope);
  if (code === "bpo-payroll-statutory-master") return payroll(code,filters,scope);
  return null;
}
