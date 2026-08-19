import type { RowDataPacket } from "mysql2";
import type { BranchScope } from "./reporting.scope.js";
import {
  addField,
  branchScopeWhere,
  constantField,
  dateBounds,
  derivedField,
  directField,
  executeVerifiedReport,
  quote,
  type FieldSpec,
  type VerifiedAdapterFilters,
  type VerifiedAdapterResult,
} from "./bpo-master-adapter-utils.js";
import {
  sourceColumns,
  sourceTableExists,
  sourceTableSql,
  type SourceColumn,
} from "./bpo-master-source-registry.js";

const SUPPORTED = new Set([
  "bpo-operations-productivity-master",
  "bpo-wfm-attendance-shrinkage-master",
  "bpo-employee-performance-360-master",
  "bpo-hr-workforce-lifecycle-master",
  "bpo-payroll-statutory-master",
]);

function has(columns: Map<string, SourceColumn>, column: string) {
  return columns.has(column.toLowerCase());
}

function first(columns: Map<string, SourceColumn>, candidates: string[]) {
  for (const candidate of candidates) {
    const value = columns.get(candidate.toLowerCase());
    if (value) return value.column;
  }
  return null;
}

function fmtDate(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(${expression},'%d-%b-%Y')) END`;
}

function fmtMonth(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(CONCAT(SUBSTRING(CAST(${expression} AS CHAR),1,7),'-01'),'%b-%Y')) END`;
}

function fmtTime(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE TIME_FORMAT(${expression},'%H:%i:%s') END`;
}

interface EmployeeContext {
  fields: Map<string, FieldSpec>;
  joins: string[];
  columns: Map<string, SourceColumn>;
  branchExpression: string | null;
  processExpression: string | null;
  employeeCodeExpression: string | null;
}

async function employeeContext(alias = "e"): Promise<EmployeeContext | null> {
  const employeesSql = await sourceTableSql("employees");
  const columns = await sourceColumns("employees");
  if (!employeesSql || !has(columns, "id") || !has(columns, "employee_code")) return null;

  const fields = new Map<string, FieldSpec>();
  const joins: string[] = [];
  const employeeCode = directField(alias, "employees", columns, ["employee_code"]);
  addField(fields, "EMPLOYEE_CODE", employeeCode);

  const fullName = first(columns, ["full_name"]);
  const firstName = first(columns, ["first_name"]);
  const lastName = first(columns, ["last_name"]);
  if (fullName) {
    addField(fields, "EMPLOYEE_NAME", directField(alias, "employees", columns, [fullName]));
  } else if (firstName) {
    addField(fields, "EMPLOYEE_NAME", derivedField(
      columns.get(firstName.toLowerCase())?.schema ?? "mas_hrms",
      "employees",
      [firstName, lastName].filter(Boolean).join(","),
      `TRIM(CONCAT(COALESCE(${alias}.${quote(firstName)},''),' ',COALESCE(${lastName ? `${alias}.${quote(lastName)}` : "NULL"},'')))`,
      "CONCAT FIRST_NAME + LAST_NAME"
    ));
  }

  addField(fields, "EMPLOYMENT_STATUS", directField(alias, "employees", columns, ["employment_status"]));
  const doj = first(columns, ["date_of_joining"]);
  const doe = first(columns, ["date_of_exit", "date_of_leaving"]);
  if (doj) {
    addField(fields, "DATE_OF_JOINING", derivedField("mas_hrms", "employees", doj, fmtDate(`${alias}.${quote(doj)}`), "FORMAT DD-MMM-YYYY"));
    addField(fields, "TENURE_DAYS", derivedField(
      "mas_hrms", "employees", [doj, doe].filter(Boolean).join(","),
      `DATEDIFF(COALESCE(${doe ? `${alias}.${quote(doe)}` : "NULL"},CURRENT_DATE()),${alias}.${quote(doj)})`,
      "DATEDIFF EXIT/AS-OF MINUS JOINING"
    ));
  }
  if (doe) addField(fields, "DATE_OF_EXIT", derivedField("mas_hrms", "employees", doe, fmtDate(`${alias}.${quote(doe)}`), "FORMAT DD-MMM-YYYY"));
  addField(fields, "EMPLOYMENT_TYPE", directField(alias, "employees", columns, ["employment_type"]));
  addField(fields, "SHIFT_ROTATION_TYPE", directField(alias, "employees", columns, ["shift_rotation_type"]));

  const branchExpression = has(columns, "branch_id") ? `${alias}.${quote("branch_id")}` : null;
  const processExpression = has(columns, "process_id") ? `${alias}.${quote("process_id")}` : null;
  const employeeCodeExpression = employeeCode?.expression ?? null;

  if (branchExpression && await sourceTableExists("branch_master")) {
    const branchSql = await sourceTableSql("branch_master");
    const branchColumns = await sourceColumns("branch_master");
    if (branchSql && has(branchColumns, "id")) {
      joins.push(`LEFT JOIN ${branchSql} b ON b.${quote("id")}=${branchExpression}`);
      addField(fields, "BRANCH", directField("b", "branch_master", branchColumns, ["branch_name", "name"]));
      addField(fields, "LOCATION", directField("b", "branch_master", branchColumns, ["location", "city", "branch_name"]));
    }
  }
  if (has(columns, "department_id") && await sourceTableExists("department_master")) {
    const tableSql = await sourceTableSql("department_master");
    const tableColumns = await sourceColumns("department_master");
    if (tableSql && has(tableColumns, "id")) {
      joins.push(`LEFT JOIN ${tableSql} d ON d.${quote("id")}=${alias}.${quote("department_id")}`);
      addField(fields, "DEPARTMENT", directField("d", "department_master", tableColumns, ["dept_name", "department_name", "name"]));
    }
  }
  if (has(columns, "designation_id") && await sourceTableExists("designation_master")) {
    const tableSql = await sourceTableSql("designation_master");
    const tableColumns = await sourceColumns("designation_master");
    if (tableSql && has(tableColumns, "id")) {
      joins.push(`LEFT JOIN ${tableSql} des ON des.${quote("id")}=${alias}.${quote("designation_id")}`);
      addField(fields, "DESIGNATION", directField("des", "designation_master", tableColumns, ["designation_name", "name"]));
    }
  }
  if (processExpression && await sourceTableExists("process_master")) {
    const tableSql = await sourceTableSql("process_master");
    const tableColumns = await sourceColumns("process_master");
    if (tableSql && has(tableColumns, "id")) {
      joins.push(`LEFT JOIN ${tableSql} p ON p.${quote("id")}=${processExpression}`);
      addField(fields, "PROCESS", directField("p", "process_master", tableColumns, ["process_name", "name"]));
      addField(fields, "CLIENT", directField("p", "process_master", tableColumns, ["client_name"]));
    }
  }
  if (has(columns, "cost_centre_id") && await sourceTableExists("cost_centre_master")) {
    const tableSql = await sourceTableSql("cost_centre_master");
    const tableColumns = await sourceColumns("cost_centre_master");
    if (tableSql && has(tableColumns, "id")) {
      joins.push(`LEFT JOIN ${tableSql} cc ON cc.${quote("id")}=${alias}.${quote("cost_centre_id")}`);
      addField(fields, "COST_CENTRE", directField("cc", "cost_centre_master", tableColumns, ["cost_centre_name", "cost_center_name"]));
    }
  }
  if (has(columns, "lob_id") && await sourceTableExists("lob_master")) {
    const tableSql = await sourceTableSql("lob_master");
    const tableColumns = await sourceColumns("lob_master");
    if (tableSql && has(tableColumns, "id")) {
      joins.push(`LEFT JOIN ${tableSql} lob ON lob.${quote("id")}=${alias}.${quote("lob_id")}`);
      addField(fields, "LOB", directField("lob", "lob_master", tableColumns, ["lob_name", "name"]));
    }
  }
  const managerColumn = first(columns, ["reporting_manager_id", "manager_id"]);
  if (managerColumn) {
    joins.push(`LEFT JOIN ${employeesSql} mgr ON mgr.${quote("id")}=${alias}.${quote(managerColumn)}`);
    addField(fields, "REPORTING_MANAGER_CODE", directField("mgr", "employees", columns, ["employee_code"]));
    if (fullName) {
      addField(fields, "REPORTING_MANAGER_NAME", directField("mgr", "employees", columns, [fullName]));
    } else if (firstName) {
      addField(fields, "REPORTING_MANAGER_NAME", derivedField(
        "mas_hrms", "employees", [firstName, lastName].filter(Boolean).join(","),
        `TRIM(CONCAT(COALESCE(mgr.${quote(firstName)},''),' ',COALESCE(${lastName ? `mgr.${quote(lastName)}` : "NULL"},'')))`,
        "CONCAT MANAGER FIRST_NAME + LAST_NAME"
      ));
    }
  }

  return { fields, joins, columns, branchExpression, processExpression, employeeCodeExpression };
}

async function dailyWorkforce(
  code: string,
  filters: VerifiedAdapterFilters,
  scope: BranchScope,
  mode: "OPERATIONS" | "WFM"
): Promise<VerifiedAdapterResult | null> {
  const attendanceSql = await sourceTableSql("attendance_daily_record");
  const attendanceColumns = await sourceColumns("attendance_daily_record");
  const employee = await employeeContext("e");
  if (!attendanceSql || !employee || !has(attendanceColumns, "employee_id") || !has(attendanceColumns, "record_date")) return null;

  const bounds = dateBounds(filters);
  const fields = new Map(employee.fields);
  const joins = [...employee.joins];
  const reportDateColumn = first(attendanceColumns, ["record_date"])!;
  addField(fields, "REPORT_DATE", derivedField("mas_hrms", "attendance_daily_record", reportDateColumn, fmtDate(`adr.${quote(reportDateColumn)}`), "FORMAT ATTENDANCE DATE"));
  addField(fields, "ATTENDANCE_SOURCE", directField("adr", "attendance_daily_record", attendanceColumns, ["attendance_source"]));
  addField(fields, "ATTENDANCE_STATUS", directField("adr", "attendance_daily_record", attendanceColumns, ["attendance_status"]));
  addField(fields, "LATE_BY_MINUTES", directField("adr", "attendance_daily_record", attendanceColumns, ["late_by_minutes"]));
  addField(fields, "LATE_MARK_FLAG", directField("adr", "attendance_daily_record", attendanceColumns, ["late_mark"]));
  addField(fields, "LWP_DAY_VALUE", directField("adr", "attendance_daily_record", attendanceColumns, ["lwp_value"]));
  if (has(attendanceColumns, "lwp_value")) {
    addField(fields, "PAYABLE_DAY_VALUE", derivedField("mas_hrms", "attendance_daily_record", "lwp_value", `1-COALESCE(adr.${quote("lwp_value")},0)`, "ONE MINUS LWP DAY VALUE"));
  }
  if (has(attendanceColumns, "attendance_status")) {
    addField(fields, "HALF_DAY_FLAG", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", `CASE WHEN LOWER(adr.${quote("attendance_status")})='half_day' THEN 'YES' ELSE 'NO' END`, "STATUS=HALF_DAY"));
    addField(fields, "WEEK_OFF_FLAG", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", `CASE WHEN LOWER(adr.${quote("attendance_status")})='week_off' THEN 'YES' ELSE 'NO' END`, "STATUS=WEEK_OFF"));
    addField(fields, "HOLIDAY_FLAG", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", `CASE WHEN LOWER(adr.${quote("attendance_status")})='holiday' THEN 'YES' ELSE 'NO' END`, "STATUS=HOLIDAY"));
  }
  addField(fields, "REGULARISATION_ID", directField("adr", "attendance_daily_record", attendanceColumns, ["regularization_id"]));
  addField(fields, "LOCK_STATUS", has(attendanceColumns, "is_locked")
    ? derivedField("mas_hrms", "attendance_daily_record", "is_locked", `CASE WHEN adr.${quote("is_locked")}=1 THEN 'LOCKED' ELSE 'OPEN' END`, "ATTENDANCE LOCK FLAG")
    : null);

  let scheduledExpression: string | null = null;
  let loginExpression: string | null = null;
  let productiveExpression = has(attendanceColumns, "raw_minutes") ? `adr.${quote("raw_minutes")}` : null;
  let breakExpression: string | null = null;
  let adherenceExpression: string | null = null;

  const rosterSql = await sourceTableSql("wfm_roster_assignment");
  const rosterColumns = await sourceColumns("wfm_roster_assignment");
  const shiftSql = await sourceTableSql("wfm_shift_master");
  const shiftColumns = await sourceColumns("wfm_shift_master");
  if (rosterSql && shiftSql && has(rosterColumns, "employee_id") && has(rosterColumns, "roster_date") && has(rosterColumns, "shift_id") && has(shiftColumns, "id")) {
    joins.push(`LEFT JOIN ${rosterSql} wra ON wra.${quote("employee_id")}=e.${quote("id")} AND wra.${quote("roster_date")}=adr.${quote(reportDateColumn)}`);
    joins.push(`LEFT JOIN ${shiftSql} wsm ON wsm.${quote("id")}=wra.${quote("shift_id")}`);
    addField(fields, "ROSTER_STATUS", directField("wra", "wfm_roster_assignment", rosterColumns, ["roster_status", "status"]));
    addField(fields, "ROSTER_VERSION", directField("wra", "wfm_roster_assignment", rosterColumns, ["roster_cycle_id", "plan_id", "publish_status"]));
    addField(fields, "ROSTER_SHIFT", directField("wsm", "wfm_shift_master", shiftColumns, ["shift_name"]));
    const shiftStart = first(shiftColumns, ["start_time"]);
    const shiftEnd = first(shiftColumns, ["end_time"]);
    if (shiftStart) addField(fields, "SHIFT_START_TIME", derivedField("mas_hrms", "wfm_shift_master", shiftStart, fmtTime(`wsm.${quote(shiftStart)}`), "FORMAT SHIFT START"));
    if (shiftEnd) addField(fields, "SHIFT_END_TIME", derivedField("mas_hrms", "wfm_shift_master", shiftEnd, fmtTime(`wsm.${quote(shiftEnd)}`), "FORMAT SHIFT END"));
    const required = first(shiftColumns, ["required_minutes"]);
    if (required) scheduledExpression = `wsm.${quote(required)}`;
  }

  const sessionSql = await sourceTableSql("wfm_attendance_session");
  const sessionColumns = await sourceColumns("wfm_attendance_session");
  if (sessionSql && has(sessionColumns, "employee_id") && has(sessionColumns, "session_date")) {
    const login = first(sessionColumns, ["login_time"]);
    const logout = first(sessionColumns, ["logout_time"]);
    const minutes = first(sessionColumns, ["total_login_minutes"]);
    joins.push(`LEFT JOIN (
      SELECT ${quote("employee_id")} employee_id, ${quote("session_date")} session_date,
             ${login ? `MIN(${quote(login)})` : "NULL"} login_time,
             ${logout ? `MAX(${quote(logout)})` : "NULL"} logout_time,
             ${minutes ? `SUM(COALESCE(${quote(minutes)},0))` : "NULL"} login_minutes,
             MAX(${quote(first(sessionColumns, ["updated_at", "created_at"]) ?? "session_date")}) refreshed_at
        FROM ${sessionSql}
       GROUP BY ${quote("employee_id")},${quote("session_date")}
    ) ses ON ses.employee_id=e.${quote("id")} AND ses.session_date=adr.${quote(reportDateColumn)}`);
    addField(fields, mode === "OPERATIONS" ? "LOGIN_TIME" : "SYSTEM_LOGIN_TIME", derivedField("mas_hrms", "wfm_attendance_session", login, fmtTime("ses.login_time"), "MIN SESSION LOGIN"));
    addField(fields, mode === "OPERATIONS" ? "LOGOUT_TIME" : "SYSTEM_LOGOUT_TIME", derivedField("mas_hrms", "wfm_attendance_session", logout, fmtTime("ses.logout_time"), "MAX SESSION LOGOUT"));
    addField(fields, mode === "OPERATIONS" ? "LOGIN_MINUTES" : "SYSTEM_LOGIN_MINUTES", derivedField("mas_hrms", "wfm_attendance_session", minutes, "ses.login_minutes", "SUM SESSION LOGIN MINUTES"));
    loginExpression = "ses.login_minutes";
  }

  const breakSql = await sourceTableSql("break_daily_summary");
  const breakColumns = await sourceColumns("break_daily_summary");
  if (breakSql && has(breakColumns, "employee_id") && has(breakColumns, "shift_date")) {
    joins.push(`LEFT JOIN ${breakSql} bds ON bds.${quote("employee_id")}=e.${quote("id")} AND bds.${quote("shift_date")}=adr.${quote(reportDateColumn)}`);
    addField(fields, mode === "OPERATIONS" ? "BREAK_MINUTES" : "TOTAL_BREAK_MINUTES", directField("bds", "break_daily_summary", breakColumns, ["total_break_minutes"]));
    addField(fields, "MINI_BREAK_COUNT", directField("bds", "break_daily_summary", breakColumns, ["mini_break_count"]));
    addField(fields, "LONG_BREAK_COUNT", directField("bds", "break_daily_summary", breakColumns, ["long_break_count"]));
    addField(fields, "BREAK_EXCEPTION_FLAG", has(breakColumns, "exception_count") || has(breakColumns, "exceeded_break_count")
      ? derivedField("mas_hrms", "break_daily_summary", "exception_count,exceeded_break_count", `CASE WHEN COALESCE(bds.${quote(first(breakColumns,["exception_count"]) ?? "exception_count")},0)+COALESCE(bds.${quote(first(breakColumns,["exceeded_break_count"]) ?? "exceeded_break_count")},0)>0 THEN 'YES' ELSE 'NO' END`, "BREAK EXCEPTION OR THRESHOLD BREACH")
      : null);
    breakExpression = first(breakColumns, ["total_break_minutes"]) ? `bds.${quote(first(breakColumns, ["total_break_minutes"])!)}` : null;
  }

  const reconSql = await sourceTableSql("attendance_reconciliation_record");
  const reconColumns = await sourceColumns("attendance_reconciliation_record");
  if (reconSql && has(reconColumns, "employee_id") && has(reconColumns, "roster_date")) {
    joins.push(`LEFT JOIN ${reconSql} arr ON arr.${quote("employee_id")}=e.${quote("id")} AND arr.${quote("roster_date")}=adr.${quote(reportDateColumn)}`);
    const required = first(reconColumns, ["required_minutes"]);
    const productive = first(reconColumns, ["productive_minutes"]);
    const adherence = first(reconColumns, ["adherence_pct"]);
    if (required) scheduledExpression = `arr.${quote(required)}`;
    if (productive) productiveExpression = `arr.${quote(productive)}`;
    if (adherence) adherenceExpression = `arr.${quote(adherence)}`;
    addField(fields, "EARLY_LOGOUT_MINUTES", directField("arr", "attendance_reconciliation_record", reconColumns, ["early_exit_minutes"]));
    addField(fields, "MISMATCH_TYPE", has(reconColumns, "attendance_status") && has(attendanceColumns, "attendance_status")
      ? derivedField("mas_hrms", "attendance_reconciliation_record", "attendance_status", `CASE WHEN arr.${quote("attendance_status")}<>adr.${quote("attendance_status")} THEN 'STATUS MISMATCH' ELSE NULL END`, "COMPARE RECONCILED VS FINAL ATTENDANCE")
      : null);
    addField(fields, "MISMATCH_STATUS", has(reconColumns, "attendance_status") && has(attendanceColumns, "attendance_status")
      ? derivedField("mas_hrms", "attendance_reconciliation_record", "attendance_status", `CASE WHEN arr.${quote("attendance_status")}<>adr.${quote("attendance_status")} THEN 'OPEN' ELSE 'RECONCILED' END`, "COMPARE RECONCILED VS FINAL ATTENDANCE")
      : null);
  }

  if (scheduledExpression) addField(fields, "SCHEDULED_MINUTES", derivedField("mas_hrms", "ROSTER/RECONCILIATION", "required_minutes", scheduledExpression, "RECONCILIATION REQUIRED MINUTES, ELSE SHIFT REQUIRED MINUTES"));
  if (productiveExpression) addField(fields, "PRODUCTIVE_MINUTES", derivedField("mas_hrms", "ATTENDANCE/RECONCILIATION", "productive_minutes/raw_minutes", productiveExpression, "RECONCILED PRODUCTIVE MINUTES, ELSE FINAL RAW MINUTES"));
  if (loginExpression && productiveExpression && breakExpression) {
    addField(fields, "IDLE_MINUTES", derivedField("mas_hrms", "SESSION+BREAK+RECONCILIATION", "login/productive/break", `GREATEST(0,COALESCE(${loginExpression},0)-COALESCE(${productiveExpression},0)-COALESCE(${breakExpression},0))`, "LOGIN - PRODUCTIVE - BREAK"));
  }
  if (scheduledExpression && productiveExpression) {
    addField(fields, "TOTAL_SHRINKAGE_MINUTES", derivedField("mas_hrms", "ROSTER+RECONCILIATION", "required/productive", `GREATEST(0,COALESCE(${scheduledExpression},0)-COALESCE(${productiveExpression},0))`, "SCHEDULED - PRODUCTIVE"));
    addField(fields, "SHRINKAGE_PERCENTAGE", derivedField("mas_hrms", "ROSTER+RECONCILIATION", "required/productive", `CASE WHEN COALESCE(${scheduledExpression},0)>0 THEN ROUND(GREATEST(0,${scheduledExpression}-${productiveExpression})/${scheduledExpression}*100,2) END`, "(SCHEDULED-PRODUCTIVE)/SCHEDULED"));
  }
  if (adherenceExpression) {
    addField(fields, "ROSTER_ADHERENCE_PERCENTAGE", derivedField("mas_hrms", "attendance_reconciliation_record", "adherence_pct", adherenceExpression, "RECONCILED ADHERENCE"));
    addField(fields, "SCHEDULE_ADHERENCE_PERCENTAGE", derivedField("mas_hrms", "attendance_reconciliation_record", "adherence_pct", adherenceExpression, "RECONCILED ADHERENCE"));
  }
  if (loginExpression && scheduledExpression) {
    addField(fields, "OVERTIME_MINUTES", derivedField("mas_hrms", "SESSION+ROSTER", "login/required", `GREATEST(0,COALESCE(${loginExpression},0)-COALESCE(${scheduledExpression},0))`, "LOGIN MINUTES ABOVE SCHEDULE"));
    addField(fields, "SHORT_ATTENDANCE_MINUTES", derivedField("mas_hrms", "SESSION+ROSTER", "login/required", `GREATEST(0,COALESCE(${scheduledExpression},0)-COALESCE(${loginExpression},0))`, "SCHEDULE MINUTES ABOVE LOGIN"));
  }

  const biometricSql = await sourceTableSql("integration_biometric_daily");
  const biometricColumns = await sourceColumns("integration_biometric_daily");
  if (mode === "WFM" && biometricSql && has(biometricColumns, "employee_code") && has(biometricColumns, "activity_date")) {
    joins.push(`LEFT JOIN ${biometricSql} ibd ON ibd.${quote("employee_code")}=e.${quote("employee_code")} AND ibd.${quote("activity_date")}=adr.${quote(reportDateColumn)}`);
    const firstPunch = first(biometricColumns, ["first_punch"]);
    const lastPunch = first(biometricColumns, ["last_punch"]);
    if (firstPunch) addField(fields, "BIOMETRIC_FIRST_PUNCH", derivedField("mas_hrms", "integration_biometric_daily", firstPunch, fmtTime(`ibd.${quote(firstPunch)}`), "FORMAT FIRST BIOMETRIC PUNCH"));
    if (lastPunch) addField(fields, "BIOMETRIC_LAST_PUNCH", derivedField("mas_hrms", "integration_biometric_daily", lastPunch, fmtTime(`ibd.${quote(lastPunch)}`), "FORMAT LAST BIOMETRIC PUNCH"));
    addField(fields, "BIOMETRIC_MINUTES", directField("ibd", "integration_biometric_daily", biometricColumns, ["biometric_minutes"]));
  } else if (mode === "WFM") {
    addField(fields, "BIOMETRIC_MINUTES", directField("adr", "attendance_daily_record", attendanceColumns, ["biometric_minutes"]));
  }

  const regularizationSql = await sourceTableSql("attendance_regularization");
  const regularizationColumns = await sourceColumns("attendance_regularization");
  if (mode === "WFM" && regularizationSql && has(regularizationColumns, "id") && has(attendanceColumns, "regularization_id")) {
    joins.push(`LEFT JOIN ${regularizationSql} reg ON reg.${quote("id")}=adr.${quote("regularization_id")}`);
    addField(fields, "REGULARISATION_STATUS", directField("reg", "attendance_regularization", regularizationColumns, ["status"]));
    addField(fields, "REGULARISATION_REASON", directField("reg", "attendance_regularization", regularizationColumns, ["reason_code", "reason"]));
    addField(fields, "REGULARISATION_APPROVER", directField("reg", "attendance_regularization", regularizationColumns, ["reviewed_by"]));
    const reviewedAt = first(regularizationColumns, ["reviewed_at"]);
    if (reviewedAt) addField(fields, "REGULARISATION_APPROVED_AT", derivedField("mas_hrms", "attendance_regularization", reviewedAt, fmtDate(`reg.${quote(reviewedAt)}`), "FORMAT REVIEWED DATE"));
  }

  if (mode === "OPERATIONS") {
    const kpiSql = await sourceTableSql("kpi_daily_actual");
    const kpiColumns = await sourceColumns("kpi_daily_actual");
    const metricSql = await sourceTableSql("kpi_metric_master");
    const metricColumns = await sourceColumns("kpi_metric_master");
    const scoreDate = first(kpiColumns, ["score_date", "metric_date"]);
    if (kpiSql && metricSql && scoreDate && has(kpiColumns, "employee_id") && has(kpiColumns, "metric_id") && has(kpiColumns, "actual_value") && has(metricColumns, "id") && has(metricColumns, "metric_code")) {
      joins.push(`LEFT JOIN (
        SELECT kda.${quote("employee_id")} employee_id,kda.${quote(scoreDate)} score_date,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('PRODUCTIVITY','TASKS_COMPLETED') THEN kda.${quote("actual_value")} END) productivity,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='AHT' THEN kda.${quote("actual_value")} END) aht,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='QUALITY_SCORE' THEN kda.${quote("actual_value")} END) quality_score,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('SLA','SLA_ADHERENCE','SERVICE_LEVEL') THEN kda.${quote("actual_value")} END) sla,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='CSAT' THEN kda.${quote("actual_value")} END) csat,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='NPS' THEN kda.${quote("actual_value")} END) nps,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='ADHERENCE' THEN kda.${quote("actual_value")} END) adherence,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='SHRINKAGE' THEN kda.${quote("actual_value")} END) shrinkage,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('UTILISATION','UTILIZATION') THEN kda.${quote("actual_value")} END) utilisation,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='OCCUPANCY' THEN kda.${quote("actual_value")} END) occupancy,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='REWORK' THEN kda.${quote("actual_value")} END) rework
        FROM ${kpiSql} kda JOIN ${metricSql} kmm ON kmm.${quote("id")}=kda.${quote("metric_id")}
        GROUP BY kda.${quote("employee_id")},kda.${quote(scoreDate)}
      ) kpi ON kpi.employee_id=e.${quote("id")} AND kpi.score_date=adr.${quote(reportDateColumn)}`);
      addField(fields, "TASKS_COMPLETED", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.productivity", "METRIC_CODE PRODUCTIVITY/TASKS_COMPLETED ONLY"));
      addField(fields, "PRODUCTIVITY_ACHIEVED", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.productivity", "METRIC_CODE PRODUCTIVITY/TASKS_COMPLETED ONLY"));
      addField(fields, "AHT_ACHIEVED_SECONDS", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.aht", "METRIC_CODE=AHT"));
      addField(fields, "QUALITY_SCORE_PERCENTAGE", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.quality_score", "METRIC_CODE=QUALITY_SCORE"));
      addField(fields, "SLA_ACHIEVED_PERCENTAGE", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.sla", "SLA METRIC CODES ONLY"));
      addField(fields, "CSAT_PERCENTAGE", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.csat", "METRIC_CODE=CSAT"));
      addField(fields, "NPS_SCORE", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.nps", "METRIC_CODE=NPS"));
      addField(fields, "UTILISATION_PERCENTAGE", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.utilisation", "UTILISATION METRIC"));
      addField(fields, "OCCUPANCY_PERCENTAGE", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.occupancy", "OCCUPANCY METRIC"));
      addField(fields, "REWORK_COUNT", derivedField("mas_hrms", "kpi_daily_actual+kpi_metric_master", "actual_value", "kpi.rework", "REWORK METRIC"));
    }

    const targetSql = await sourceTableSql("kpi_employee_resolved");
    const targetColumns = await sourceColumns("kpi_employee_resolved");
    if (targetSql && metricSql && has(targetColumns, "employee_id") && has(targetColumns, "metric_id") && has(targetColumns, "target_value")) {
      joins.push(`LEFT JOIN (
        SELECT ker.${quote("employee_id")} employee_id,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('PRODUCTIVITY','TASKS_COMPLETED') THEN ker.${quote("target_value")} END) productivity_target,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='AHT' THEN ker.${quote("target_value")} END) aht_target,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='QUALITY_SCORE' THEN ker.${quote("target_value")} END) quality_target,
          MAX(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('SLA','SLA_ADHERENCE','SERVICE_LEVEL') THEN ker.${quote("target_value")} END) sla_target
        FROM ${targetSql} ker JOIN ${metricSql} kmm ON kmm.${quote("id")}=ker.${quote("metric_id")}
        GROUP BY ker.${quote("employee_id")}
      ) tgt ON tgt.employee_id=e.${quote("id")}`);
      addField(fields, "PRODUCTIVITY_TARGET", derivedField("mas_hrms", "kpi_employee_resolved+kpi_metric_master", "target_value", "tgt.productivity_target", "RESOLVED EMPLOYEE TARGET"));
      addField(fields, "AHT_TARGET_SECONDS", derivedField("mas_hrms", "kpi_employee_resolved+kpi_metric_master", "target_value", "tgt.aht_target", "RESOLVED EMPLOYEE AHT TARGET"));
      addField(fields, "QUALITY_TARGET_PERCENTAGE", derivedField("mas_hrms", "kpi_employee_resolved+kpi_metric_master", "target_value", "tgt.quality_target", "RESOLVED EMPLOYEE QUALITY TARGET"));
      addField(fields, "SLA_TARGET_PERCENTAGE", derivedField("mas_hrms", "kpi_employee_resolved+kpi_metric_master", "target_value", "tgt.sla_target", "RESOLVED EMPLOYEE SLA TARGET"));
      if (fields.has("PRODUCTIVITY_ACHIEVED")) {
        addField(fields, "PRODUCTIVITY_PERCENTAGE", derivedField("mas_hrms", "KPI_ACTUAL+KPI_TARGET", "actual_value,target_value", "CASE WHEN COALESCE(tgt.productivity_target,0)>0 THEN ROUND(kpi.productivity/tgt.productivity_target*100,2) END", "ACTUAL / TARGET"));
        addField(fields, "PERFORMANCE_RAG", derivedField("mas_hrms", "KPI_ACTUAL+KPI_TARGET", "actual_value,target_value", "CASE WHEN kpi.productivity IS NULL THEN 'NO DATA' WHEN kpi.productivity>=tgt.productivity_target AND (kpi.quality_score IS NULL OR kpi.quality_score>=COALESCE(tgt.quality_target,0)) THEN 'GREEN' WHEN kpi.productivity>0 THEN 'AMBER' ELSE 'RED' END", "PRODUCTIVITY AND QUALITY THRESHOLDS"));
      }
      if (fields.has("AHT_ACHIEVED_SECONDS")) addField(fields, "AHT_VARIANCE_SECONDS", derivedField("mas_hrms", "KPI_ACTUAL+KPI_TARGET", "actual_value,target_value", "CASE WHEN kpi.aht IS NULL OR tgt.aht_target IS NULL THEN NULL ELSE kpi.aht-tgt.aht_target END", "AHT ACTUAL - TARGET"));
    }
  }

  addField(fields, "PAYROLL_IMPACT_FLAG", has(attendanceColumns, "lwp_value") || has(attendanceColumns, "regularization_id")
    ? derivedField("mas_hrms", "attendance_daily_record", "lwp_value,regularization_id", `CASE WHEN COALESCE(${has(attendanceColumns,"lwp_value") ? `adr.${quote("lwp_value")}` : "0"},0)>0 OR ${has(attendanceColumns,"regularization_id") ? `adr.${quote("regularization_id")} IS NOT NULL` : "FALSE"} THEN 'YES' ELSE 'NO' END`, "LWP OR REGULARISATION AFFECTS PAYROLL")
    : null);
  addField(fields, "DATA_SOURCE", constantField(`'${mode === "OPERATIONS" ? "FINAL_ATTENDANCE+ROSTER+SESSION+BREAK+RECONCILIATION+EXACT_KPI" : "FINAL_ATTENDANCE+ROSTER+BIOMETRIC+SESSION+BREAK+RECONCILIATION"}'`, "EXPLICIT GOVERNED SOURCE SET"));

  // Branch scope: when !isSuperAdmin, scope enforces "branch_id IN (...branchIds)" via branchScopeWhere.
  const scoped = branchScopeWhere(scope, filters, {
    branch: employee.branchExpression,
    process: employee.processExpression,
    employeeCode: employee.employeeCodeExpression,
  });
  const where = [`adr.${quote(reportDateColumn)} BETWEEN ? AND ?`, ...scoped.clauses];
  return executeVerifiedReport({
    code,
    sourceTable: mode === "OPERATIONS" ? "ATTENDANCE_DAILY_RECORD+EXACT_KPI" : "ATTENDANCE_DAILY_RECORD+RECONCILIATION",
    fields,
    fromSql: `${attendanceSql} adr JOIN ${(await sourceTableSql("employees"))!} e ON e.${quote("id")}=adr.${quote("employee_id")}`,
    joins,
    where,
    params: [bounds.from, bounds.to, ...scoped.params],
    orderBy: `${quote("REPORT_DATE")} DESC,${quote("EMPLOYEE_CODE")}`,
    grainKeys: ["EMPLOYEE_CODE", "REPORT_DATE"],
    filters,
  });
}

async function employee360(code: string, filters: VerifiedAdapterFilters, scope: BranchScope) {
  const employee = await employeeContext("e");
  const employeesSql = await sourceTableSql("employees");
  if (!employee || !employeesSql) return null;
  const bounds = dateBounds(filters);
  const fields = new Map(employee.fields);
  const joins = [...employee.joins];
  addField(fields, "REPORT_DATE", constantField(fmtDate(`LAST_DAY('${bounds.reportMonth}-01')`), "REPORT MONTH END"));
  addField(fields, "REPORT_MONTH", constantField(fmtMonth(`'${bounds.reportMonth}'`), "SELECTED REPORT MONTH"));

  const attendanceSql = await sourceTableSql("attendance_daily_record");
  const attendanceColumns = await sourceColumns("attendance_daily_record");
  const params: unknown[] = [];
  if (attendanceSql && has(attendanceColumns, "employee_id") && has(attendanceColumns, "record_date") && has(attendanceColumns, "attendance_status")) {
    joins.push(`LEFT JOIN (
      SELECT ${quote("employee_id")} employee_id,
        COUNT(*) rostered_days,
        SUM(CASE WHEN LOWER(${quote("attendance_status")}) NOT IN ('week_off','holiday') THEN 1 ELSE 0 END) working_days,
        SUM(CASE WHEN LOWER(${quote("attendance_status")})='present' THEN 1 ELSE 0 END) present_days,
        SUM(CASE WHEN LOWER(${quote("attendance_status")})='half_day' THEN 1 ELSE 0 END) half_days,
        SUM(CASE WHEN LOWER(${quote("attendance_status")})='absent' THEN 1 ELSE 0 END) absent_days,
        SUM(CASE WHEN LOWER(${quote("attendance_status")})='leave_approved' THEN 1 ELSE 0 END) leave_days,
        ${has(attendanceColumns,"lwp_value") ? `SUM(COALESCE(${quote("lwp_value")},0))` : "NULL"} lwp_days,
        SUM(CASE WHEN LOWER(${quote("attendance_status")})='week_off' THEN 1 ELSE 0 END) week_off_days,
        SUM(CASE WHEN LOWER(${quote("attendance_status")})='holiday' THEN 1 ELSE 0 END) holiday_days,
        ${has(attendanceColumns,"late_mark") ? `SUM(COALESCE(${quote("late_mark")},0))` : "NULL"} late_marks
      FROM ${attendanceSql}
      WHERE ${quote("record_date")} BETWEEN ? AND ?
      GROUP BY ${quote("employee_id")}
    ) att ON att.employee_id=e.${quote("id")}`);
    params.push(bounds.from, bounds.to);
    addField(fields, "ROSTERED_DAYS", derivedField("mas_hrms", "attendance_daily_record", "record_date", "att.rostered_days", "COUNT ATTENDANCE RECORDS"));
    addField(fields, "WORKING_DAYS", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", "att.working_days", "EXCLUDE WEEK_OFF AND HOLIDAY"));
    addField(fields, "PRESENT_DAYS", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", "att.present_days", "COUNT PRESENT"));
    addField(fields, "ABSENT_DAYS", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", "att.absent_days", "COUNT ABSENT"));
    addField(fields, "LEAVE_DAYS", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", "att.leave_days", "COUNT APPROVED LEAVE"));
    addField(fields, "LWP_DAYS", derivedField("mas_hrms", "attendance_daily_record", "lwp_value", "att.lwp_days", "SUM LWP VALUE"));
    addField(fields, "WEEK_OFF_DAYS", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", "att.week_off_days", "COUNT WEEK OFF"));
    addField(fields, "HOLIDAY_DAYS", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", "att.holiday_days", "COUNT HOLIDAY"));
    addField(fields, "LATE_MARK_COUNT", derivedField("mas_hrms", "attendance_daily_record", "late_mark", "att.late_marks", "SUM LATE MARKS"));
    addField(fields, "ATTENDANCE_PERCENTAGE", derivedField("mas_hrms", "attendance_daily_record", "attendance_status", "CASE WHEN att.working_days>0 THEN ROUND((att.present_days+att.half_days*0.5)/att.working_days*100,2) END", "(PRESENT + HALF_DAY*0.5) / WORKING DAYS"));
  }

  const kpiSql = await sourceTableSql("kpi_daily_actual");
  const kpiColumns = await sourceColumns("kpi_daily_actual");
  const metricSql = await sourceTableSql("kpi_metric_master");
  const metricColumns = await sourceColumns("kpi_metric_master");
  const scoreDate = first(kpiColumns, ["score_date", "metric_date"]);
  if (kpiSql && metricSql && scoreDate && has(kpiColumns,"employee_id") && has(kpiColumns,"metric_id") && has(kpiColumns,"actual_value") && has(metricColumns,"metric_code")) {
    joins.push(`LEFT JOIN (
      SELECT kda.${quote("employee_id")} employee_id,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('PRODUCTIVITY','TASKS_COMPLETED') THEN kda.${quote("actual_value")} END) productivity,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")})='AHT' THEN kda.${quote("actual_value")} END) aht,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")})='QUALITY_SCORE' THEN kda.${quote("actual_value")} END) quality_score,
        SUM(CASE WHEN UPPER(kmm.${quote("metric_code")})='FATAL_RATE' AND kda.${quote("actual_value")}>0 THEN 1 ELSE 0 END) fatal_count,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")})='CSAT' THEN kda.${quote("actual_value")} END) csat,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")})='NPS' THEN kda.${quote("actual_value")} END) nps,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('SLA','SLA_ADHERENCE') THEN kda.${quote("actual_value")} END) sla,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")})='ADHERENCE' THEN kda.${quote("actual_value")} END) adherence,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('UTILISATION','UTILIZATION') THEN kda.${quote("actual_value")} END) utilisation,
        AVG(CASE WHEN UPPER(kmm.${quote("metric_code")})='OCCUPANCY' THEN kda.${quote("actual_value")} END) occupancy
      FROM ${kpiSql} kda JOIN ${metricSql} kmm ON kmm.${quote("id")}=kda.${quote("metric_id")}
      WHERE kda.${quote(scoreDate)} BETWEEN ? AND ?
      GROUP BY kda.${quote("employee_id")}
    ) kpi ON kpi.employee_id=e.${quote("id")}`);
    params.push(bounds.from, bounds.to);
    addField(fields,"PRODUCTIVITY_ACHIEVED",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.productivity","MONTHLY AVG PRODUCTIVITY METRIC"));
    addField(fields,"AHT_ACHIEVED_SECONDS",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.aht","MONTHLY AVG AHT"));
    addField(fields,"QUALITY_SCORE_PERCENTAGE",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.quality_score","MONTHLY AVG QUALITY_SCORE"));
    addField(fields,"FATAL_ERROR_COUNT",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.fatal_count","COUNT DAYS WITH FATAL_RATE > 0"));
    addField(fields,"CSAT_PERCENTAGE",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.csat","MONTHLY AVG CSAT"));
    addField(fields,"NPS_SCORE",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.nps","MONTHLY AVG NPS"));
    addField(fields,"SLA_ACHIEVEMENT_PERCENTAGE",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.sla","MONTHLY AVG SLA"));
    addField(fields,"ADHERENCE_PERCENTAGE",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.adherence","MONTHLY AVG ADHERENCE"));
    addField(fields,"UTILISATION_PERCENTAGE",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.utilisation","MONTHLY AVG UTILISATION"));
    addField(fields,"OCCUPANCY_PERCENTAGE",derivedField("mas_hrms","kpi_daily_actual+kpi_metric_master","actual_value","kpi.occupancy","MONTHLY AVG OCCUPANCY"));
  }

  const targetSql = await sourceTableSql("kpi_employee_resolved");
  const targetColumns = await sourceColumns("kpi_employee_resolved");
  if (targetSql && metricSql && has(targetColumns,"employee_id") && has(targetColumns,"metric_id") && has(targetColumns,"target_value")) {
    joins.push(`LEFT JOIN (
      SELECT ker.${quote("employee_id")} employee_id,
        MAX(CASE WHEN UPPER(kmm.${quote("metric_code")}) IN ('PRODUCTIVITY','TASKS_COMPLETED') THEN ker.${quote("target_value")} END) productivity_target,
        MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='AHT' THEN ker.${quote("target_value")} END) aht_target,
        MAX(CASE WHEN UPPER(kmm.${quote("metric_code")})='QUALITY_SCORE' THEN ker.${quote("target_value")} END) quality_target
      FROM ${targetSql} ker JOIN ${metricSql} kmm ON kmm.${quote("id")}=ker.${quote("metric_id")}
      GROUP BY ker.${quote("employee_id")}
    ) tgt ON tgt.employee_id=e.${quote("id")}`);
    addField(fields,"PRODUCTIVITY_TARGET",derivedField("mas_hrms","kpi_employee_resolved","target_value","tgt.productivity_target","RESOLVED PRODUCTIVITY TARGET"));
    addField(fields,"AHT_TARGET_SECONDS",derivedField("mas_hrms","kpi_employee_resolved","target_value","tgt.aht_target","RESOLVED AHT TARGET"));
    addField(fields,"QUALITY_TARGET_PERCENTAGE",derivedField("mas_hrms","kpi_employee_resolved","target_value","tgt.quality_target","RESOLVED QUALITY TARGET"));
    if (fields.has("PRODUCTIVITY_ACHIEVED")) addField(fields,"PRODUCTIVITY_PERCENTAGE",derivedField("mas_hrms","KPI_ACTUAL+TARGET","actual_value,target_value","CASE WHEN COALESCE(tgt.productivity_target,0)>0 THEN ROUND(kpi.productivity/tgt.productivity_target*100,2) END","ACTUAL / TARGET"));
  }

  const summarySql = await sourceTableSql("management_kpi_summary");
  const summaryColumns = await sourceColumns("management_kpi_summary");
  const summaryPeriod = first(summaryColumns,["period"]);
  if (summarySql && summaryPeriod && has(summaryColumns,"employee_id")) {
    joins.push(`LEFT JOIN ${summarySql} mks ON mks.${quote("employee_id")}=e.${quote("id")} AND mks.${quote(summaryPeriod)}=?`);
    params.push(bounds.reportMonth);
    addField(fields,"COMPOSITE_PERFORMANCE_SCORE",directField("mks","management_kpi_summary",summaryColumns,["overall_score"]));
    addField(fields,"RANK_IN_TEAM",directField("mks","management_kpi_summary",summaryColumns,["rank_position"]));
    addField(fields,"RANK_IN_PROCESS",directField("mks","management_kpi_summary",summaryColumns,["rank_position"]));
    addField(fields,"PERFORMANCE_RAG",has(summaryColumns,"overall_score") ? derivedField("mas_hrms","management_kpi_summary","overall_score","CASE WHEN mks.overall_score IS NULL THEN 'NO DATA' WHEN mks.overall_score>=90 THEN 'GREEN' WHEN mks.overall_score>=75 THEN 'AMBER' ELSE 'RED' END","SCORE BANDS") : null);
    addField(fields,"PERFORMANCE_RATING",has(summaryColumns,"overall_score") ? derivedField("mas_hrms","management_kpi_summary","overall_score","CASE WHEN mks.overall_score>=90 THEN 'EXCELLENT' WHEN mks.overall_score>=75 THEN 'MEETS EXPECTATION' WHEN mks.overall_score IS NULL THEN NULL ELSE 'NEEDS IMPROVEMENT' END","SCORE BANDS") : null);
    addField(fields,"SCORE_MOVEMENT",has(summaryColumns,"trend") ? derivedField("mas_hrms","management_kpi_summary","trend","mks.trend","PUBLISHED TREND DIRECTION") : null);
  }

  const coachingSql = await sourceTableSql("coaching_session");
  const coachingColumns = await sourceColumns("coaching_session");
  if (coachingSql && has(coachingColumns,"employee_id") && has(coachingColumns,"session_date")) {
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(*) coaching_count,MAX(${quote("session_date")}) last_feedback_date FROM ${coachingSql} WHERE ${quote("session_date")} BETWEEN ? AND ? GROUP BY ${quote("employee_id")}) coach ON coach.employee_id=e.${quote("id")}`);
    params.push(bounds.from,bounds.to);
    addField(fields,"COACHING_COUNT",derivedField("mas_hrms","coaching_session","id","coach.coaching_count","COUNT MONTHLY COACHING SESSIONS"));
    addField(fields,"FEEDBACK_COUNT",derivedField("mas_hrms","coaching_session","id","coach.coaching_count","COACHING SESSION COUNT AS DOCUMENTED FEEDBACK"));
    addField(fields,"LAST_FEEDBACK_DATE",derivedField("mas_hrms","coaching_session","session_date",fmtDate("coach.last_feedback_date"),"LATEST COACHING SESSION DATE"));
  }

  const pipSql = await sourceTableSql("pip_record");
  const pipColumns = await sourceColumns("pip_record");
  if (pipSql && has(pipColumns,"employee_id") && has(pipColumns,"created_at")) {
    joins.push(`LEFT JOIN (SELECT pr.* FROM ${pipSql} pr JOIN (SELECT ${quote("employee_id")} employee_id,MAX(${quote("created_at")}) max_created FROM ${pipSql} GROUP BY ${quote("employee_id")}) x ON x.employee_id=pr.${quote("employee_id")} AND x.max_created=pr.${quote("created_at")}) pip ON pip.${quote("employee_id")}=e.${quote("id")}`);
    addField(fields,"PIP_STATUS",directField("pip","pip_record",pipColumns,["status"]));
    const start = first(pipColumns,["start_date"]); const end = first(pipColumns,["end_date"]);
    if(start) addField(fields,"PIP_START_DATE",derivedField("mas_hrms","pip_record",start,fmtDate(`pip.${quote(start)}`),"FORMAT PIP START"));
    if(end) addField(fields,"PIP_END_DATE",derivedField("mas_hrms","pip_record",end,fmtDate(`pip.${quote(end)}`),"FORMAT PIP END"));
    addField(fields,"PIP_OUTCOME",directField("pip","pip_record",pipColumns,["outcome"]));
  }

  const lmsSql = await sourceTableSql("lms_learning_progress_snapshot");
  const lmsColumns = await sourceColumns("lms_learning_progress_snapshot");
  if(lmsSql && has(lmsColumns,"employee_id")) {
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(*) assigned_count,${has(lmsColumns,"status") ? `SUM(${quote("status")}='completed')` : "NULL"} completed_count,${has(lmsColumns,"score") ? `AVG(${quote("score")})` : "NULL"} avg_score FROM ${lmsSql} GROUP BY ${quote("employee_id")}) lms ON lms.employee_id=e.${quote("id")}`);
    addField(fields,"TRAINING_ASSIGNED_COUNT",derivedField("mas_hrms","lms_learning_progress_snapshot","id","lms.assigned_count","COUNT LEARNING ITEMS"));
    addField(fields,"TRAINING_COMPLETED_COUNT",derivedField("mas_hrms","lms_learning_progress_snapshot","status","lms.completed_count","COUNT STATUS=COMPLETED"));
    addField(fields,"ASSESSMENT_SCORE_PERCENTAGE",derivedField("mas_hrms","lms_learning_progress_snapshot","score","lms.avg_score","AVG LMS SCORE"));
  }
  const certSql=await sourceTableSql("lms_certification_snapshot"); const certColumns=await sourceColumns("lms_certification_snapshot");
  if(certSql && has(certColumns,"employee_id") && has(certColumns,"status")) {
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,CASE WHEN SUM(${quote("status")}='active')>0 THEN 'ACTIVE' WHEN SUM(${quote("status")}='expired')>0 THEN 'EXPIRED' ELSE 'NONE' END cert_status FROM ${certSql} GROUP BY ${quote("employee_id")}) cert ON cert.employee_id=e.${quote("id")}`);
    addField(fields,"CERTIFICATION_STATUS",derivedField("mas_hrms","lms_certification_snapshot","status","cert.cert_status","ACTIVE/EXPIRED CERTIFICATION SUMMARY"));
  }
  const grievanceSql=await sourceTableSql("grievance"); const grievanceColumns=await sourceColumns("grievance");
  if(grievanceSql && has(grievanceColumns,"employee_id")) {
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(*) grievance_count FROM ${grievanceSql} GROUP BY ${quote("employee_id")}) gr ON gr.employee_id=e.${quote("id")}`);
    addField(fields,"GRIEVANCE_CASE_COUNT",derivedField("mas_hrms","grievance","id","gr.grievance_count","COUNT EMPLOYEE GRIEVANCES"));
  }

  addField(fields,"DATA_COMPLETENESS_PERCENTAGE",constantField("ROUND((CASE WHEN e.employee_code IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.branch_id IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.department_id IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.designation_id IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.process_id IS NOT NULL THEN 1 ELSE 0 END)/5*100,2)","FIVE CORE EMPLOYEE DIMENSIONS"));
  addField(fields,"DATA_SOURCE",constantField("'EMPLOYEE+FINAL_ATTENDANCE+EXACT_KPI+PERFORMANCE_SUMMARY+COACHING+PIP+LMS'","EXPLICIT GOVERNED SOURCE SET"));

  const scoped=branchScopeWhere(scope,filters,{branch:employee.branchExpression,process:employee.processExpression,employeeCode:employee.employeeCodeExpression});
  return executeVerifiedReport({code,sourceTable:"EMPLOYEE_360_VERIFIED",fields,fromSql:`${employeesSql} e`,joins,where:scoped.clauses,params:[...params,...scoped.params],orderBy:quote("EMPLOYEE_CODE"),grainKeys:["EMPLOYEE_CODE","REPORT_MONTH"],filters});
}

async function hrLifecycle(code:string,filters:VerifiedAdapterFilters,scope:BranchScope) {
  const employee=await employeeContext("e"); const employeesSql=await sourceTableSql("employees");
  if(!employee||!employeesSql) return null;
  const asOf=filters.to??new Date().toISOString().slice(0,10); const fields=new Map(employee.fields); const joins=[...employee.joins];
  addField(fields,"REPORT_DATE",constantField(fmtDate(`'${asOf}'`),"AS-OF DATE"));
  addField(fields,"GENDER",directField("e","employees",employee.columns,["gender"]));
  const dob=first(employee.columns,["date_of_birth"]); if(dob){addField(fields,"DATE_OF_BIRTH",derivedField("mas_hrms","employees",dob,fmtDate(`e.${quote(dob)}`),"FORMAT DOB"));addField(fields,"AGE_YEARS",derivedField("mas_hrms","employees",dob,`TIMESTAMPDIFF(YEAR,e.${quote(dob)},'${asOf}')`,"AGE AS OF REPORT DATE"));}
  addField(fields,"OFFICIAL_EMAIL",directField("e","employees",employee.columns,["official_email","email"]));
  addField(fields,"PERSONAL_EMAIL",directField("e","employees",employee.columns,["personal_email"]));
  addField(fields,"MOBILE_NUMBER",directField("e","employees",employee.columns,["mobile","personal_phone"]));
  addField(fields,"EMPLOYEE_CATEGORY",directField("e","employees",employee.columns,["employee_category"]));

  const addressSql=await sourceTableSql("employee_address"); const addressColumns=await sourceColumns("employee_address");
  if(addressSql&&has(addressColumns,"employee_id")&&has(addressColumns,"address_type")){
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,MAX(CASE WHEN ${quote("address_type")}='current' THEN CONCAT_WS(', ',${quote("address_line1")},${quote("address_line2")},${quote("city")},${quote("state")},${quote("pincode")}) END) current_address,MAX(CASE WHEN ${quote("address_type")}='permanent' THEN CONCAT_WS(', ',${quote("address_line1")},${quote("address_line2")},${quote("city")},${quote("state")},${quote("pincode")}) END) permanent_address FROM ${addressSql} GROUP BY ${quote("employee_id")}) addr ON addr.employee_id=e.${quote("id")}`);
    addField(fields,"CURRENT_ADDRESS",derivedField("mas_hrms","employee_address","address fields","addr.current_address","CURRENT ADDRESS CONCATENATION"));
    addField(fields,"PERMANENT_ADDRESS",derivedField("mas_hrms","employee_address","address fields","addr.permanent_address","PERMANENT ADDRESS CONCATENATION"));
  }
  const emergencySql=await sourceTableSql("employee_emergency_contact"); const emergencyColumns=await sourceColumns("employee_emergency_contact");
  if(emergencySql&&has(emergencyColumns,"employee_id")){
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,MAX(${quote(first(emergencyColumns,["name"])??"name")}) contact_name,MAX(${quote(first(emergencyColumns,["mobile"])??"mobile")}) contact_mobile FROM ${emergencySql} GROUP BY ${quote("employee_id")}) ec ON ec.employee_id=e.${quote("id")}`);
    addField(fields,"EMERGENCY_CONTACT_NAME",derivedField("mas_hrms","employee_emergency_contact","name","ec.contact_name","LATEST/PRIMARY AGGREGATE"));
    addField(fields,"EMERGENCY_CONTACT_NUMBER",derivedField("mas_hrms","employee_emergency_contact","mobile","ec.contact_mobile","LATEST/PRIMARY AGGREGATE"));
  }
  const gradeSql=await sourceTableSql("grade_band_master"); const gradeColumns=await sourceColumns("grade_band_master");
  if(gradeSql&&has(employee.columns,"grade_id")&&has(gradeColumns,"id")){
    joins.push(`LEFT JOIN ${gradeSql} gb ON gb.${quote("id")}=e.${quote("grade_id")}`);
    addField(fields,"GRADE",directField("gb","grade_band_master",gradeColumns,["grade_name","grade_code"]));
    addField(fields,"BAND",directField("gb","grade_band_master",gradeColumns,["band"]));
  }
  const probationSql=await sourceTableSql("employee_probation"); const probationColumns=await sourceColumns("employee_probation");
  if(probationSql&&has(probationColumns,"employee_id")){
    joins.push(`LEFT JOIN ${probationSql} prob ON prob.${quote("employee_id")}=e.${quote("id")}`);
    addField(fields,"PROBATION_STATUS",directField("prob","employee_probation",probationColumns,["status"]));
    const end=first(probationColumns,["extended_end_date","actual_end_date","probation_end_date"]); if(end)addField(fields,"PROBATION_END_DATE",derivedField("mas_hrms","employee_probation",end,fmtDate(`prob.${quote(end)}`),"EFFECTIVE PROBATION END"));
    if(end)addField(fields,"CONFIRMATION_DUE_DATE",derivedField("mas_hrms","employee_probation",end,fmtDate(`prob.${quote(end)}`),"PROBATION END AS CONFIRMATION DUE"));
    addField(fields,"CONFIRMATION_STATUS",has(probationColumns,"status")?derivedField("mas_hrms","employee_probation","status","CASE WHEN prob.status='confirmed' THEN 'CONFIRMED' WHEN prob.status='extended' THEN 'EXTENDED' ELSE 'PENDING' END","PROBATION STATUS TO CONFIRMATION STATUS"):null);
  }
  const contractSql=await sourceTableSql("employee_contract"); const contractColumns=await sourceColumns("employee_contract");
  if(contractSql&&has(contractColumns,"employee_id")&&has(contractColumns,"created_at")){
    joins.push(`LEFT JOIN (SELECT c.* FROM ${contractSql} c JOIN (SELECT ${quote("employee_id")} employee_id,MAX(${quote("created_at")}) max_created FROM ${contractSql} GROUP BY ${quote("employee_id")}) x ON x.employee_id=c.${quote("employee_id")} AND x.max_created=c.${quote("created_at")}) con ON con.${quote("employee_id")}=e.${quote("id")}`);
    const start=first(contractColumns,["contract_start_date"]);const end=first(contractColumns,["contract_end_date"]);if(start)addField(fields,"CONTRACT_START_DATE",derivedField("mas_hrms","employee_contract",start,fmtDate(`con.${quote(start)}`),"FORMAT CONTRACT START"));if(end)addField(fields,"CONTRACT_END_DATE",derivedField("mas_hrms","employee_contract",end,fmtDate(`con.${quote(end)}`),"FORMAT CONTRACT END"));
    addField(fields,"NOTICE_PERIOD_DAYS",directField("con","employee_contract",contractColumns,["notice_period_days"]));
  }
  const lifecycleSql=await sourceTableSql("employee_lifecycle_event"); const lifecycleColumns=await sourceColumns("employee_lifecycle_event");
  if(lifecycleSql&&has(lifecycleColumns,"employee_id")&&has(lifecycleColumns,"event_type")&&has(lifecycleColumns,"effective_date")){
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(*) event_count,MAX(CASE WHEN ${quote("event_type")}='promotion' THEN ${quote("effective_date")} END) promotion_date,MAX(CASE WHEN ${quote("event_type")}='increment' THEN ${quote("effective_date")} END) increment_date,MAX(CASE WHEN ${quote("event_type")} IN ('transfer','branch_change','process_change') THEN ${quote("effective_date")} END) transfer_date FROM ${lifecycleSql} GROUP BY ${quote("employee_id")}) life ON life.employee_id=e.${quote("id")}`);
    addField(fields,"LIFECYCLE_EVENT_COUNT",derivedField("mas_hrms","employee_lifecycle_event","id","life.event_count","COUNT LIFECYCLE EVENTS"));
    addField(fields,"LAST_PROMOTION_DATE",derivedField("mas_hrms","employee_lifecycle_event","effective_date",fmtDate("life.promotion_date"),"LATEST PROMOTION"));
    addField(fields,"LAST_INCREMENT_DATE",derivedField("mas_hrms","employee_lifecycle_event","effective_date",fmtDate("life.increment_date"),"LATEST INCREMENT"));
    addField(fields,"LAST_TRANSFER_DATE",derivedField("mas_hrms","employee_lifecycle_event","effective_date",fmtDate("life.transfer_date"),"LATEST TRANSFER/MOVEMENT"));
  }
  const docsSql=await sourceTableSql("employee_documents"); const docsColumns=await sourceColumns("employee_documents");
  if(docsSql&&has(docsColumns,"employee_id")){
    const verified=first(docsColumns,["verified"]);const expiry=first(docsColumns,["expiry_date"]);
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(*) doc_count,${verified?`SUM(COALESCE(${quote(verified)},0)=1)`:"NULL"} verified_count,${verified?`SUM(COALESCE(${quote(verified)},0)=0)`:"NULL"} unverified_count,${expiry?`SUM(${quote(expiry)} BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL 60 DAY))`:"NULL"} expiring_count FROM ${docsSql} GROUP BY ${quote("employee_id")}) docs ON docs.employee_id=e.${quote("id")}`);
    addField(fields,"MANDATORY_DOCUMENT_COUNT",derivedField("mas_hrms","employee_documents","id","docs.doc_count","COUNT DOCUMENTS"));
    addField(fields,"VERIFIED_DOCUMENT_COUNT",derivedField("mas_hrms","employee_documents",verified,"docs.verified_count","COUNT VERIFIED"));
    addField(fields,"MISSING_DOCUMENT_COUNT",derivedField("mas_hrms","employee_documents",verified,"docs.unverified_count","COUNT UNVERIFIED/PENDING"));
    addField(fields,"EXPIRING_DOCUMENT_COUNT",derivedField("mas_hrms","employee_documents",expiry,"docs.expiring_count","EXPIRY WITHIN 60 DAYS"));
  }
  const bridgeSql=await sourceTableSql("ats_onboarding_bridge"); const bridgeColumns=await sourceColumns("ats_onboarding_bridge");
  if(bridgeSql&&has(bridgeColumns,"employee_id")&&has(bridgeColumns,"candidate_id")) joins.push(`LEFT JOIN ${bridgeSql} bridge ON bridge.${quote("employee_id")}=e.${quote("id")}`);
  const bgvSql=await sourceTableSql("candidate_bgv_check"); const bgvColumns=await sourceColumns("candidate_bgv_check");
  if(bgvSql&&bridgeSql&&has(bgvColumns,"candidate_id")&&has(bgvColumns,"status")){
    joins.push(`LEFT JOIN (SELECT ${quote("candidate_id")} candidate_id,COUNT(*) check_count,SUM(${quote("status")}='verified') verified_count,SUM(${quote("status")} IN ('mismatch','failed','manual_review')) risk_count,MAX(${quote(first(bgvColumns,["verified_at","reviewed_at","updated_at"])??"updated_at")}) completed_at FROM ${bgvSql} GROUP BY ${quote("candidate_id")}) bgv ON bgv.candidate_id=bridge.${quote("candidate_id")}`);
    addField(fields,"BGV_STATUS",derivedField("mas_hrms","candidate_bgv_check","status","CASE WHEN bgv.check_count IS NULL THEN 'NOT STARTED' WHEN bgv.risk_count>0 THEN 'REVIEW REQUIRED' WHEN bgv.verified_count=bgv.check_count THEN 'VERIFIED' ELSE 'IN PROGRESS' END","AGGREGATE CHECK STATUS"));
    addField(fields,"BGV_RISK_LEVEL",derivedField("mas_hrms","candidate_bgv_check","status","CASE WHEN bgv.risk_count>0 THEN 'HIGH' WHEN bgv.check_count IS NULL THEN 'UNKNOWN' ELSE 'LOW' END","MISMATCH/FAILED/MANUAL REVIEW"));
    addField(fields,"BGV_COMPLETED_DATE",derivedField("mas_hrms","candidate_bgv_check","verified_at/reviewed_at",fmtDate("bgv.completed_at"),"LATEST BGV COMPLETION"));
  }
  const uanSql=await sourceTableSql("employee_uan");const uanColumns=await sourceColumns("employee_uan");
  if(uanSql&&has(uanColumns,"employee_id")){joins.push(`LEFT JOIN ${uanSql} uan ON uan.${quote("employee_id")}=e.${quote("id")} ${has(uanColumns,"is_active")?`AND uan.${quote("is_active")}=1`:""}`);addField(fields,"UAN_STATUS",has(uanColumns,"uan")?derivedField("mas_hrms","employee_uan","uan","CASE WHEN uan.uan IS NULL OR uan.uan='' THEN 'MISSING' ELSE 'AVAILABLE' END","UAN PRESENCE"):null);}
  if(has(employee.columns,"pan_number"))addField(fields,"PAN_STATUS",derivedField("mas_hrms","employees","pan_number","CASE WHEN e.pan_number IS NULL OR e.pan_number='' THEN 'MISSING' ELSE 'AVAILABLE' END","PAN PRESENCE"));
  if(has(employee.columns,"aadhaar_last4"))addField(fields,"AADHAAR_STATUS",derivedField("mas_hrms","employees","aadhaar_last4","CASE WHEN e.aadhaar_last4 IS NULL OR e.aadhaar_last4='' THEN 'MISSING' ELSE 'AVAILABLE' END","MASKED AADHAAR PRESENCE"));
  if(has(employee.columns,"esic_number"))addField(fields,"ESIC_STATUS",derivedField("mas_hrms","employees","esic_number","CASE WHEN e.esic_number IS NULL OR e.esic_number='' THEN 'MISSING' ELSE 'AVAILABLE' END","ESIC PRESENCE"));
  const bankSql=await sourceTableSql("employee_bank_detail");const bankColumns=await sourceColumns("employee_bank_detail");
  if(bankSql&&has(bankColumns,"employee_id")){joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,MAX(COALESCE(${has(bankColumns,"verified")?quote("verified"):"0"},0)) verified FROM ${bankSql} ${has(bankColumns,"active_status")?`WHERE ${quote("active_status")}=1`:""} GROUP BY ${quote("employee_id")}) bank ON bank.employee_id=e.${quote("id")}`);addField(fields,"BANK_VERIFICATION_STATUS",derivedField("mas_hrms","employee_bank_detail","verified","CASE WHEN bank.employee_id IS NULL THEN 'MISSING' WHEN bank.verified=1 THEN 'VERIFIED' ELSE 'PENDING' END","BANK RECORD + VERIFIED FLAG"));}
  const assetSql=await sourceTableSql("asset_assignment");const assetColumns=await sourceColumns("asset_assignment");
  if(assetSql&&has(assetColumns,"employee_id")){joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(*) asset_count FROM ${assetSql} WHERE ${has(assetColumns,"returned_date")?`${quote("returned_date")} IS NULL`:"1=1"} GROUP BY ${quote("employee_id")}) ast ON ast.employee_id=e.${quote("id")}`);addField(fields,"ASSET_ISSUED_FLAG",derivedField("mas_hrms","asset_assignment","returned_date","CASE WHEN COALESCE(ast.asset_count,0)>0 THEN 'YES' ELSE 'NO' END","ACTIVE ASSET ASSIGNMENT"));}
  const authSql=await sourceTableSql("auth_user");const authColumns=await sourceColumns("auth_user");
  if(authSql&&has(employee.columns,"user_id")&&has(authColumns,"id")){joins.push(`LEFT JOIN ${authSql} au ON au.${quote("id")}=e.${quote("user_id")}`);addField(fields,"SYSTEM_ACCESS_READY_FLAG",derivedField("mas_hrms","auth_user","id,is_blocked","CASE WHEN au.id IS NOT NULL AND COALESCE(au.is_blocked,0)=0 THEN 'YES' ELSE 'NO' END","ACTIVE AUTH USER"));}
  if(has(employee.columns,"created_at"))addField(fields,"EMPLOYEE_CODE_CREATED_DATE",derivedField("mas_hrms","employees","created_at",fmtDate("e.created_at"),"EMPLOYEE ROW CREATION DATE"));
  const exitSql=await sourceTableSql("exit_request");const exitColumns=await sourceColumns("exit_request");
  if(exitSql&&has(exitColumns,"employee_id")&&has(exitColumns,"created_at")){
    joins.push(`LEFT JOIN (SELECT er.* FROM ${exitSql} er JOIN (SELECT ${quote("employee_id")} employee_id,MAX(${quote("created_at")}) max_created FROM ${exitSql} GROUP BY ${quote("employee_id")}) x ON x.employee_id=er.${quote("employee_id")} AND x.max_created=er.${quote("created_at")}) ex ON ex.${quote("employee_id")}=e.${quote("id")}`);
    const res=first(exitColumns,["submitted_at","created_at"]);const lwd=first(exitColumns,["last_working_day_confirmed","last_working_day_proposed"]);if(res)addField(fields,"RESIGNATION_DATE",derivedField("mas_hrms","exit_request",res,fmtDate(`ex.${quote(res)}`),"EXIT REQUEST SUBMISSION"));if(lwd)addField(fields,"LAST_WORKING_DATE",derivedField("mas_hrms","exit_request",lwd,fmtDate(`ex.${quote(lwd)}`),"CONFIRMED/PROPOSED LWD"));
    addField(fields,"EXIT_REASON",directField("ex","exit_request",exitColumns,["resignation_reason","exit_reason_category"]));addField(fields,"ATTRITION_TYPE",directField("ex","exit_request",exitColumns,["exit_type","exit_sub_type"]));
  }
  // 2026-08-19: was exit_clearance_checklist (0 live rows) — exit_clearance_task is what the
  // exit module writes (24 live rows). Only needs exit_request_id + status, both present on
  // the new table, so this is a clean table-name swap with no column remapping needed.
  const clearanceSql=await sourceTableSql("exit_clearance_task");const clearanceColumns=await sourceColumns("exit_clearance_task");
  if(clearanceSql&&exitSql&&has(clearanceColumns,"exit_request_id")&&has(clearanceColumns,"status")){joins.push(`LEFT JOIN (SELECT ${quote("exit_request_id")} exit_request_id,COUNT(*) items,SUM(${quote("status")} IN ('cleared','waived')) cleared_items FROM ${clearanceSql} GROUP BY ${quote("exit_request_id")}) clr ON clr.exit_request_id=ex.${quote("id")}`);addField(fields,"CLEARANCE_STATUS",derivedField("mas_hrms","exit_clearance_task","status","CASE WHEN clr.items IS NULL THEN 'NOT STARTED' WHEN clr.items=clr.cleared_items THEN 'CLEARED' ELSE 'PENDING' END","ALL TASKS CLEARED/WAIVED"));}
  addField(fields,"EARLY_ATTRITION_FLAG",has(employee.columns,"date_of_joining")&&first(employee.columns,["date_of_exit","date_of_leaving"])?derivedField("mas_hrms","employees","joining/exit",`CASE WHEN DATEDIFF(e.${quote(first(employee.columns,["date_of_exit","date_of_leaving"])!)},e.${quote("date_of_joining")})<=90 THEN 'YES' ELSE 'NO' END`,`EXIT WITHIN 90 DAYS`):null);
  addField(fields,"HR_DATA_COMPLETENESS_PERCENTAGE",constantField("ROUND((CASE WHEN e.employee_code IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.branch_id IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.department_id IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.designation_id IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN e.process_id IS NOT NULL THEN 1 ELSE 0 END)/5*100,2)","CORE HR DIMENSIONS"));
  addField(fields,"DATA_SOURCE",constantField("'EMPLOYEE+ADDRESS+PROBATION+CONTRACT+LIFECYCLE+DOCUMENTS+BGV+STATUTORY+ASSET+EXIT'","EXPLICIT GOVERNED SOURCE SET"));
  const scoped=branchScopeWhere(scope,filters,{branch:employee.branchExpression,process:employee.processExpression,employeeCode:employee.employeeCodeExpression});
  return executeVerifiedReport({code,sourceTable:"EMPLOYEE_LIFECYCLE_VERIFIED",fields,fromSql:`${employeesSql} e`,joins,where:scoped.clauses,params:scoped.params,orderBy:quote("EMPLOYEE_CODE"),grainKeys:["EMPLOYEE_CODE","REPORT_DATE"],filters});
}

async function payroll(code:string,filters:VerifiedAdapterFilters,scope:BranchScope){
  const lineSql=await sourceTableSql("salary_prep_line");const lineColumns=await sourceColumns("salary_prep_line");
  const runSql=await sourceTableSql("salary_prep_run");const runColumns=await sourceColumns("salary_prep_run");
  const employee=await employeeContext("e");const employeesSql=await sourceTableSql("employees");
  if(!lineSql||!runSql||!employee||!employeesSql||!has(lineColumns,"run_id")||!has(lineColumns,"employee_id")||!has(runColumns,"id")||!has(runColumns,"run_month"))return null;
  const reportMonth=dateBounds(filters).reportMonth;const fields=new Map(employee.fields);const joins=[...employee.joins];
  addField(fields,"REPORT_DATE",derivedField("mas_hrms","salary_prep_run","run_month",fmtDate("LAST_DAY(CONCAT(spr.run_month,'-01'))"),"PAYROLL MONTH END"));
  addField(fields,"PAYROLL_MONTH",derivedField("mas_hrms","salary_prep_run","run_month",fmtMonth("spr.run_month"),"FORMAT PAYROLL MONTH"));
  addField(fields,"PAYROLL_RUN_ID",directField("spr","salary_prep_run",runColumns,["id"]));
  addField(fields,"PAYROLL_RUN_STATUS",directField("spr","salary_prep_run",runColumns,["status"]));
  addField(fields,"PAYROLL_LOCK_STATUS",has(runColumns,"status")?derivedField("mas_hrms","salary_prep_run","status","CASE WHEN LOWER(spr.status) IN ('locked','disbursed','finalized','released','paid') THEN 'LOCKED' ELSE 'OPEN' END","RUN STATUS LOCK CLASSIFICATION"):null);
  addField(fields,"CALENDAR_DAYS",constantField("DAY(LAST_DAY(CONCAT(spr.run_month,'-01')))","CALENDAR DAYS IN RUN MONTH"));
  const mapping:Record<string,string[]>={
    WORKING_DAYS:["working_days","paid_working_days"],PRESENT_DAYS:["present_days"],PAID_LEAVE_DAYS:["leave_days"],WEEK_OFF_DAYS:["eligible_weekoff_days"],HOLIDAY_DAYS:["eligible_holiday_days"],LWP_DAYS:["lwp_days"],PAYABLE_DAYS:["final_payable_days","paid_working_days","working_days"],OVERTIME_HOURS:["overtime_hours"],BASIC_PAY:["basic"],HRA:["hra"],SPECIAL_ALLOWANCE:["special_allowance"],CONVEYANCE_ALLOWANCE:["conveyance_allowance"],OTHER_ALLOWANCE:["other_allowance"],VARIABLE_PAY:["variable_pay"],INCENTIVE_AMOUNT:["incentive_amount"],OVERTIME_AMOUNT:["overtime_amount","holiday_work_extra_payout"],ARREAR_AMOUNT:["arrear_amount"],REIMBURSEMENT_AMOUNT:["reimbursement_amount"],GROSS_EARNINGS:["gross_salary"],LWP_DEDUCTION:["lwp_deduction"],PF_EMPLOYEE:["pf_employee"],PF_EMPLOYER:["pf_employer"],ESIC_EMPLOYEE:["esic_employee"],ESIC_EMPLOYER:["esic_employer"],PROFESSIONAL_TAX:["professional_tax"],TDS:["tds_amount","tds"],LOAN_DEDUCTION:["loan_deduction"],ADVANCE_DEDUCTION:["advance_recovery"],OTHER_DEDUCTION:["other_deduction"],TOTAL_DEDUCTIONS:["total_deductions"],NET_PAY:["net_salary"],PAYROLL_EXCEPTION_COUNT:["exception_count"],PAYROLL_VARIANCE_AMOUNT:["variance_amount"],PAYROLL_VARIANCE_PERCENTAGE:["variance_percentage"],PAYSLIP_STATUS:["payroll_validation_status","status"],DATA_SOURCE:["attendance_source"]
  };
  for(const [key,candidates] of Object.entries(mapping))addField(fields,key,directField("spl","salary_prep_line",lineColumns,candidates));
  const salarySql=await sourceTableSql("employee_salary_assignment");const salaryColumns=await sourceColumns("employee_salary_assignment");
  if(salarySql&&has(salaryColumns,"employee_id")&&has(salaryColumns,"ctc_annual")){joins.push(`LEFT JOIN ${salarySql} esa ON esa.${quote("employee_id")}=e.${quote("id")} ${has(salaryColumns,"active_status")?`AND esa.${quote("active_status")}=1`:""}`);addField(fields,"CTC_MONTHLY",derivedField("mas_hrms","employee_salary_assignment","ctc_annual","esa.ctc_annual/12","ANNUAL CTC / 12"));}
  const uanSql=await sourceTableSql("employee_uan");const uanColumns=await sourceColumns("employee_uan");if(uanSql&&has(uanColumns,"employee_id")){joins.push(`LEFT JOIN ${uanSql} uan ON uan.${quote("employee_id")}=e.${quote("id")} ${has(uanColumns,"is_active")?`AND uan.${quote("is_active")}=1`:""}`);addField(fields,"UAN_NUMBER",directField("uan","employee_uan",uanColumns,["uan"]));}
  addField(fields,"ESIC_NUMBER",directField("e","employees",employee.columns,["esic_number"]));addField(fields,"PAN_NUMBER",directField("e","employees",employee.columns,["pan_number"]));
  const bankSql=await sourceTableSql("employee_bank_detail");const bankColumns=await sourceColumns("employee_bank_detail");if(bankSql&&has(bankColumns,"employee_id")){joins.push(`LEFT JOIN ${bankSql} bank ON bank.${quote("employee_id")}=e.${quote("id")} ${has(bankColumns,"is_primary")?`AND bank.${quote("is_primary")}=1`:""} ${has(bankColumns,"active_status")?`AND bank.${quote("active_status")}=1`:""}`);addField(fields,"BANK_ACCOUNT_NUMBER",directField("bank","employee_bank_detail",bankColumns,["account_number"]));addField(fields,"IFSC_CODE",directField("bank","employee_bank_detail",bankColumns,["ifsc_code"]));addField(fields,"BANK_VERIFICATION_STATUS",has(bankColumns,"verified")?derivedField("mas_hrms","employee_bank_detail","verified","CASE WHEN bank.verified=1 THEN 'VERIFIED' WHEN bank.employee_id IS NULL THEN 'MISSING' ELSE 'PENDING' END","BANK VERIFIED FLAG"):null);}
  const payslipSql=await sourceTableSql("salary_payslip");const payslipColumns=await sourceColumns("salary_payslip");if(payslipSql&&has(payslipColumns,"prep_line_id")){joins.push(`LEFT JOIN ${payslipSql} slip ON slip.${quote("prep_line_id")}=spl.${quote("id")}`);const generated=first(payslipColumns,["generated_at"]);if(generated)addField(fields,"PAYSLIP_RELEASE_DATE",derivedField("mas_hrms","salary_payslip",generated,fmtDate(`slip.${quote(generated)}`),"PAYSLIP GENERATED DATE"));addField(fields,"PAYSLIP_STATUS",derivedField("mas_hrms","salary_payslip","id","CASE WHEN slip.id IS NULL THEN 'NOT GENERATED' ELSE 'GENERATED' END","PAYSLIP RECORD PRESENCE"));}
  const disbursedAt=first(runColumns,["disbursed_at"]);if(disbursedAt){addField(fields,"DISBURSAL_DATE",derivedField("mas_hrms","salary_prep_run",disbursedAt,fmtDate(`spr.${quote(disbursedAt)}`),"RUN DISBURSAL DATE"));addField(fields,"DISBURSAL_STATUS",derivedField("mas_hrms","salary_prep_run","status,disbursed_at","CASE WHEN spr.disbursed_at IS NOT NULL THEN 'DISBURSED' ELSE UPPER(COALESCE(spr.status,'PENDING')) END","RUN DISBURSAL EVIDENCE"));}
  addField(fields,"MAKER",directField("spr","salary_prep_run",runColumns,["created_by"]));addField(fields,"CHECKER",directField("spr","salary_prep_run",runColumns,["approved_by"]));addField(fields,"FINAL_APPROVER",directField("spr","salary_prep_run",runColumns,["disbursed_by","approved_by"]));
  if(!fields.has("DATA_SOURCE"))addField(fields,"DATA_SOURCE",constantField("'SALARY_PREP_LINE+SALARY_PREP_RUN+EMPLOYEE_STATUTORY+BANK+PAYSLIP'","EXPLICIT GOVERNED SOURCE SET"));
  const scoped=branchScopeWhere(scope,filters,{branch:employee.branchExpression,process:employee.processExpression,employeeCode:employee.employeeCodeExpression});
  return executeVerifiedReport({code,sourceTable:"SALARY_PREP_LINE+RUN_VERIFIED",fields,fromSql:`${lineSql} spl JOIN ${runSql} spr ON spr.${quote("id")}=spl.${quote("run_id")} JOIN ${employeesSql} e ON e.${quote("id")}=spl.${quote("employee_id")}`,joins,where:[`spr.${quote("run_month")}=?`,...scoped.clauses],params:[reportMonth,...scoped.params],orderBy:quote("EMPLOYEE_CODE"),grainKeys:["EMPLOYEE_CODE","PAYROLL_MONTH","PAYROLL_RUN_ID"],filters});
}

export async function runVerifiedWorkforceAdapter(code:string,filters:VerifiedAdapterFilters,scope:BranchScope):Promise<VerifiedAdapterResult|null>{
  if(!SUPPORTED.has(code))return null;
  if(code==="bpo-operations-productivity-master")return dailyWorkforce(code,filters,scope,"OPERATIONS");
  if(code==="bpo-wfm-attendance-shrinkage-master")return dailyWorkforce(code,filters,scope,"WFM");
  if(code==="bpo-employee-performance-360-master")return employee360(code,filters,scope);
  if(code==="bpo-hr-workforce-lifecycle-master")return hrLifecycle(code,filters,scope);
  if(code==="bpo-payroll-statutory-master")return payroll(code,filters,scope);
  return null;
}
