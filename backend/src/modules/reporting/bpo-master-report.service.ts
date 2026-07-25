import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { BranchScope } from "./reporting.scope.js";
import {
  BPO_MASTER_REPORTS,
  getBpoMasterReport,
  type BpoMasterColumn,
  type BpoMasterFormat,
} from "./bpo-master-report-catalog.js";

interface ColumnRow extends RowDataPacket {
  table_name: string;
  column_name: string;
  data_type: string;
}

interface TableRow extends RowDataPacket {
  table_name: string;
}

interface SchemaSnapshot {
  loadedAt: number;
  tables: Set<string>;
  columns: Map<string, Map<string, string>>;
}

export interface BpoMasterReportFilters {
  month?: string;
  from?: string;
  to?: string;
  branchId?: string;
  processId?: string;
  employeeCode?: string;
  clientId?: string;
  limit?: number;
  offset?: number;
  export?: boolean;
}

interface SourcePlan {
  baseCandidates: string[];
  aggregate: boolean;
  dateCandidates: string[];
  monthCandidates: string[];
  employeeIdCandidates: string[];
  employeeCodeCandidates: string[];
  extraJoins?: "payroll" | "attendance" | "finance" | "quality" | "recruitment" | "asset";
}

interface QueryContext {
  reportCode: string;
  sourceTable: string;
  sourceAlias: string;
  sourceColumns: Map<string, string>;
  employeeAvailable: boolean;
  employeeAlias: string;
  aliases: Map<string, { table: string; columns: Map<string, string> }>;
  aggregate: boolean;
  dateExpression: string | null;
  monthExpression: string | null;
  fromSql: string;
  joins: string[];
}

const CACHE_TTL_MS = 5 * 60_000;
const IDENTIFIER = /^[A-Za-z0-9_]+$/;
const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NO_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";
let schemaCache: SchemaSnapshot | null = null;

const SOURCE_PLANS: Record<string, SourcePlan> = {
  "bpo-operations-productivity-master": {
    baseCandidates: ["performance_daily_fact", "apr_daily_fact", "dialer_daily_fact", "process_delivery_actual", "attendance_daily_record"],
    aggregate: false,
    dateCandidates: ["record_date", "activity_date", "delivery_date", "work_date", "report_date", "event_date", "created_at"],
    monthCandidates: ["report_month", "period_code", "month"],
    employeeIdCandidates: ["employee_id", "agent_id", "analyst_id", "user_id"],
    employeeCodeCandidates: ["employee_code", "agent_code", "analyst_code"],
    extraJoins: "attendance",
  },
  "bpo-employee-performance-360-master": {
    baseCandidates: ["employees"],
    aggregate: false,
    dateCandidates: ["updated_at", "date_of_joining", "created_at"],
    monthCandidates: [],
    employeeIdCandidates: ["id"],
    employeeCodeCandidates: ["employee_code"],
  },
  "bpo-client-sla-delivery-master": {
    baseCandidates: ["process_delivery_actual", "performance_daily_fact", "apr_daily_fact", "dialer_daily_fact"],
    aggregate: true,
    dateCandidates: ["delivery_date", "record_date", "activity_date", "report_date", "created_at"],
    monthCandidates: ["period_code", "report_month", "month"],
    employeeIdCandidates: [],
    employeeCodeCandidates: [],
  },
  "bpo-wfm-attendance-shrinkage-master": {
    baseCandidates: ["attendance_daily_record", "wfm_attendance_session", "integration_biometric_daily"],
    aggregate: false,
    dateCandidates: ["record_date", "session_date", "activity_date", "attendance_date", "created_at"],
    monthCandidates: [],
    employeeIdCandidates: ["employee_id"],
    employeeCodeCandidates: ["employee_code"],
    extraJoins: "attendance",
  },
  "bpo-hr-workforce-lifecycle-master": {
    baseCandidates: ["employees"],
    aggregate: false,
    dateCandidates: ["updated_at", "date_of_joining", "created_at"],
    monthCandidates: [],
    employeeIdCandidates: ["id"],
    employeeCodeCandidates: ["employee_code"],
  },
  "bpo-payroll-statutory-master": {
    baseCandidates: ["salary_prep_line", "payroll_line", "payroll_employee_line"],
    aggregate: false,
    dateCandidates: ["updated_at", "created_at"],
    monthCandidates: ["payroll_month", "run_month", "period_code", "month"],
    employeeIdCandidates: ["employee_id"],
    employeeCodeCandidates: ["employee_code"],
    extraJoins: "payroll",
  },
  "bpo-finance-pnl-profitability-master": {
    baseCandidates: ["pnl_period_snapshot", "process_lob_monthly_plan", "process_delivery_actual", "finance_period"],
    aggregate: true,
    dateCandidates: ["snapshot_date", "delivery_date", "period_end", "updated_at", "created_at"],
    monthCandidates: ["period_code", "finance_month", "report_month", "month"],
    employeeIdCandidates: [],
    employeeCodeCandidates: [],
    extraJoins: "finance",
  },
  "bpo-quality-risk-compliance-master": {
    baseCandidates: ["quality_audit", "quality_audit_log", "qa_audit", "quality_daily_summary", "quality_performance_fact"],
    aggregate: false,
    dateCandidates: ["audit_date", "record_date", "activity_date", "created_at"],
    monthCandidates: ["report_month", "month"],
    employeeIdCandidates: ["employee_id", "agent_id", "analyst_id"],
    employeeCodeCandidates: ["employee_code", "agent_code", "analyst_code"],
    extraJoins: "quality",
  },
  "bpo-recruitment-training-readiness-master": {
    baseCandidates: ["ats_candidate", "ats_candidates", "candidate_master", "ats_candidate_master", "candidate_onboarding"],
    aggregate: false,
    dateCandidates: ["application_date", "created_at", "updated_at", "joining_date"],
    monthCandidates: [],
    employeeIdCandidates: ["employee_id"],
    employeeCodeCandidates: ["employee_code"],
    extraJoins: "recruitment",
  },
  "bpo-admin-asset-facility-master": {
    baseCandidates: ["asset_assignment", "asset_allocation", "asset_master", "assets"],
    aggregate: false,
    dateCandidates: ["assignment_date", "issued_at", "created_at", "updated_at"],
    monthCandidates: [],
    employeeIdCandidates: ["employee_id", "assigned_to_employee_id", "custodian_employee_id"],
    employeeCodeCandidates: ["employee_code", "assigned_to_employee_code"],
    extraJoins: "asset",
  },
  "bpo-management-executive-master": {
    baseCandidates: ["pnl_period_snapshot", "process_delivery_actual", "performance_daily_fact", "process_lob_monthly_plan"],
    aggregate: true,
    dateCandidates: ["snapshot_date", "delivery_date", "record_date", "updated_at", "created_at"],
    monthCandidates: ["period_code", "report_month", "month"],
    employeeIdCandidates: [],
    employeeCodeCandidates: [],
  },
};

const COLUMN_SYNONYMS: Record<string, string[]> = {
  EMPLOYEE_CODE: ["employee_code", "agent_code", "analyst_code"],
  EMPLOYEE_NAME: ["employee_name", "full_name", "candidate_name", "agent_name", "analyst_name"],
  EMPLOYMENT_STATUS: ["employment_status", "employee_status", "status"],
  DATE_OF_JOINING: ["date_of_joining", "joining_date", "actual_joining_date"],
  DATE_OF_EXIT: ["date_of_exit", "date_of_leaving", "last_working_date", "exit_date"],
  BRANCH: ["branch_name", "branch"],
  LOCATION: ["location_name", "location", "city"],
  DEPARTMENT: ["department_name", "dept_name", "department"],
  DESIGNATION: ["designation_name", "designation", "role_name"],
  PROCESS: ["process_name", "process"],
  CLIENT: ["client_name", "client"],
  LOB: ["lob_name", "line_of_business", "lob"],
  COST_CENTRE: ["cost_centre_name", "cost_center_name", "cost_centre", "cost_center"],
  REPORTING_MANAGER_CODE: ["reporting_manager_code", "manager_code"],
  REPORTING_MANAGER_NAME: ["reporting_manager_name", "manager_name"],
  TEAM_LEADER_CODE: ["team_leader_code", "tl_code"],
  TEAM_LEADER_NAME: ["team_leader_name", "tl_name"],
  REPORT_MONTH: ["report_month", "period_code", "month"],
  PAYROLL_MONTH: ["payroll_month", "run_month", "period_code", "month"],
  FINANCE_MONTH: ["finance_month", "period_code", "report_month", "month"],
  PAYROLL_RUN_ID: ["payroll_run_id", "run_id"],
  PAYROLL_RUN_STATUS: ["payroll_run_status", "run_status", "status"],
  AUDIT_ID: ["audit_id", "id", "quality_audit_id"],
  AUDIT_DATE: ["audit_date", "record_date", "activity_date", "created_at"],
  CANDIDATE_ID: ["candidate_id", "id"],
  CANDIDATE_NAME: ["candidate_name", "full_name", "name"],
  REQUISITION_ID: ["requisition_id", "job_requisition_id"],
  ITEM_ID: ["asset_id", "item_id", "id"],
  ITEM_TYPE: ["item_type", "asset_category", "asset_type"],
  ASSET_TAG: ["asset_tag", "tag_number", "asset_code"],
  SERIAL_NUMBER: ["serial_number", "serial_no"],
  MAKE_MODEL: ["make_model", "model", "asset_model"],
  DATA_SOURCE: ["data_source", "source_system", "source"],
};

function quote(identifier: string) {
  if (!IDENTIFIER.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `\`${identifier}\``;
}

function normalizeFilters(filters: BpoMasterReportFilters): Required<Pick<BpoMasterReportFilters, "limit" | "offset" | "export">> & BpoMasterReportFilters {
  const limit = filters.export ? 100_000 : Math.min(Math.max(Number(filters.limit ?? 250), 1), 2_000);
  return {
    ...filters,
    month: filters.month && MONTH.test(filters.month) ? filters.month : undefined,
    from: filters.from && DATE.test(filters.from) ? filters.from : undefined,
    to: filters.to && DATE.test(filters.to) ? filters.to : undefined,
    branchId: filters.branchId ? String(filters.branchId).trim() : undefined,
    processId: filters.processId ? String(filters.processId).trim() : undefined,
    employeeCode: filters.employeeCode ? String(filters.employeeCode).trim() : undefined,
    clientId: filters.clientId ? String(filters.clientId).trim() : undefined,
    limit,
    offset: Math.max(Number(filters.offset ?? 0), 0),
    export: Boolean(filters.export),
  };
}

async function loadSchema(): Promise<SchemaSnapshot> {
  if (schemaCache && Date.now() - schemaCache.loadedAt < CACHE_TTL_MS) return schemaCache;
  const [tableRows] = await db.execute<TableRow[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()`
  );
  const [columnRows] = await db.execute<ColumnRow[]>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()`
  );
  const tables = new Set(tableRows.map((row) => String(row.table_name)));
  const columns = new Map<string, Map<string, string>>();
  for (const row of columnRows) {
    const table = String(row.table_name);
    if (!columns.has(table)) columns.set(table, new Map());
    columns.get(table)!.set(String(row.column_name), String(row.data_type));
  }
  schemaCache = { loadedAt: Date.now(), tables, columns };
  return schemaCache;
}

function firstExistingTable(schema: SchemaSnapshot, candidates: string[]) {
  return candidates.find((table) => schema.tables.has(table)) ?? null;
}

function firstColumn(columns: Map<string, string> | undefined, candidates: string[]) {
  if (!columns) return null;
  return candidates.find((column) => columns.has(column)) ?? null;
}

function addAlias(
  aliases: QueryContext["aliases"],
  alias: string,
  table: string,
  schema: SchemaSnapshot
) {
  const columns = schema.columns.get(table);
  if (columns) aliases.set(alias, { table, columns });
}

function createContext(
  schema: SchemaSnapshot,
  reportCode: string
): QueryContext | null {
  const plan = SOURCE_PLANS[reportCode];
  if (!plan) return null;
  const sourceTable = firstExistingTable(schema, plan.baseCandidates);
  if (!sourceTable) return null;
  const sourceColumns = schema.columns.get(sourceTable) ?? new Map<string, string>();
  const aliases = new Map<string, { table: string; columns: Map<string, string> }>();
  aliases.set("src", { table: sourceTable, columns: sourceColumns });
  const joins: string[] = [];
  let employeeAvailable = false;

  if (sourceTable === "employees") {
    aliases.set("e", { table: "employees", columns: sourceColumns });
    employeeAvailable = true;
  } else if (schema.tables.has("employees")) {
    const employeeColumns = schema.columns.get("employees") ?? new Map<string, string>();
    const sourceEmployeeId = firstColumn(sourceColumns, plan.employeeIdCandidates);
    const sourceEmployeeCode = firstColumn(sourceColumns, plan.employeeCodeCandidates);
    if (sourceEmployeeId && employeeColumns.has("id")) {
      joins.push(`LEFT JOIN employees e ON e.${quote("id")} = src.${quote(sourceEmployeeId)}`);
      employeeAvailable = true;
      aliases.set("e", { table: "employees", columns: employeeColumns });
    } else if (sourceEmployeeCode && employeeColumns.has("employee_code")) {
      joins.push(`LEFT JOIN employees e ON e.${quote("employee_code")} = src.${quote(sourceEmployeeCode)}`);
      employeeAvailable = true;
      aliases.set("e", { table: "employees", columns: employeeColumns });
    }
  }

  if (employeeAvailable) {
    const employeeColumns = aliases.get("e")!.columns;
    const orgJoins: Array<[string, string, string, string[]]> = [
      ["b", "branch_master", "branch_id", ["id"]],
      ["d", "department_master", "department_id", ["id"]],
      ["des", "designation_master", "designation_id", ["id"]],
      ["p", "process_master", "process_id", ["id"]],
      ["cc", "cost_centre_master", "cost_centre_id", ["id"]],
    ];
    for (const [alias, table, employeeFk, targetKeys] of orgJoins) {
      if (!employeeColumns.has(employeeFk) || !schema.tables.has(table)) continue;
      const targetColumns = schema.columns.get(table) ?? new Map<string, string>();
      const targetKey = firstColumn(targetColumns, targetKeys);
      if (!targetKey) continue;
      joins.push(`LEFT JOIN ${quote(table)} ${alias} ON ${alias}.${quote(targetKey)} = e.${quote(employeeFk)}`);
      addAlias(aliases, alias, table, schema);
    }
    if (schema.tables.has("employees") && (employeeColumns.has("reporting_manager_id") || employeeColumns.has("manager_id"))) {
      const managerJoin = employeeColumns.has("reporting_manager_id") && employeeColumns.has("manager_id")
        ? "COALESCE(e.`reporting_manager_id`, e.`manager_id`)"
        : employeeColumns.has("reporting_manager_id")
          ? "e.`reporting_manager_id`"
          : "e.`manager_id`";
      joins.push(`LEFT JOIN employees mgr ON mgr.${quote("id")} = ${managerJoin}`);
      addAlias(aliases, "mgr", "employees", schema);
    }
  }

  if (plan.extraJoins === "payroll" && sourceColumns.has("run_id") && schema.tables.has("salary_prep_run")) {
    const runColumns = schema.columns.get("salary_prep_run") ?? new Map<string, string>();
    if (runColumns.has("id")) {
      joins.push(`LEFT JOIN salary_prep_run spr ON spr.${quote("id")} = src.${quote("run_id")}`);
      addAlias(aliases, "spr", "salary_prep_run", schema);
    }
  }

  if (plan.extraJoins === "attendance" && employeeAvailable) {
    if (schema.tables.has("wfm_roster_assignment") && schema.tables.has("wfm_shift_master")) {
      const rosterColumns = schema.columns.get("wfm_roster_assignment") ?? new Map<string, string>();
      const shiftColumns = schema.columns.get("wfm_shift_master") ?? new Map<string, string>();
      const sourceDate = firstColumn(sourceColumns, plan.dateCandidates);
      if (sourceDate && rosterColumns.has("employee_id") && rosterColumns.has("roster_date") && rosterColumns.has("shift_id") && shiftColumns.has("id")) {
        joins.push(`LEFT JOIN wfm_roster_assignment wra ON wra.${quote("employee_id")} = e.${quote("id")} AND wra.${quote("roster_date")} = DATE(src.${quote(sourceDate)})`);
        joins.push(`LEFT JOIN wfm_shift_master wsm ON wsm.${quote("id")} = wra.${quote("shift_id")}`);
        addAlias(aliases, "wra", "wfm_roster_assignment", schema);
        addAlias(aliases, "wsm", "wfm_shift_master", schema);
      }
    }
  }

  const dateColumn = firstColumn(sourceColumns, plan.dateCandidates);
  const monthColumn = firstColumn(sourceColumns, plan.monthCandidates);
  return {
    reportCode,
    sourceTable,
    sourceAlias: "src",
    sourceColumns,
    employeeAvailable,
    employeeAlias: "e",
    aliases,
    aggregate: plan.aggregate,
    dateExpression: dateColumn ? `src.${quote(dateColumn)}` : null,
    monthExpression: monthColumn ? `src.${quote(monthColumn)}` : null,
    fromSql: `${quote(sourceTable)} src`,
    joins,
  };
}

function aliasColumn(context: QueryContext, alias: string, candidates: string[]) {
  const entry = context.aliases.get(alias);
  const column = firstColumn(entry?.columns, candidates);
  return column ? `${alias}.${quote(column)}` : null;
}

function anyColumn(context: QueryContext, candidates: string[]) {
  const preferredAliases = ["src", "e", "b", "d", "des", "p", "cc", "mgr", "spr", "wsm", "wra"];
  const expressions: string[] = [];
  for (const alias of preferredAliases) {
    const expression = aliasColumn(context, alias, candidates);
    if (expression) expressions.push(expression);
  }
  if (!expressions.length) return null;
  return expressions.length === 1 ? expressions[0] : `COALESCE(${expressions.join(", ")})`;
}

function standardCandidates(key: string) {
  const lower = key.toLowerCase();
  return [...new Set([
    ...(COLUMN_SYNONYMS[key] ?? []),
    lower,
    lower.replace(/_percentage$/, "_pct"),
    lower.replace(/_percentage$/, "_percent"),
    lower.replace(/_count$/, "_cnt"),
    lower.replace(/_amount$/, "_value"),
    lower.replace(/_minutes$/, "_mins"),
    lower.replace(/_seconds$/, "_secs"),
  ])];
}

function expressionForColumn(context: QueryContext, column: BpoMasterColumn, filters: BpoMasterReportFilters) {
  if (column.key === "EMPLOYEE_CODE") {
    if (context.aggregate) return `'AGGREGATE'`;
    return anyColumn(context, ["employee_code", "agent_code", "analyst_code"]) ?? `'PENDING EMPLOYEE CODE'`;
  }
  if (column.key === "REPORT_DATE") {
    const monthlyReports = new Set([
      "bpo-employee-performance-360-master",
      "bpo-payroll-statutory-master",
      "bpo-finance-pnl-profitability-master",
      "bpo-management-executive-master",
    ]);
    if (monthlyReports.has(context.reportCode)) {
      if (filters.month) return `LAST_DAY('${filters.month}-01')`;
      if (context.monthExpression) return `LAST_DAY(CONCAT(SUBSTRING(CAST(${context.monthExpression} AS CHAR),1,7),'-01'))`;
      return "LAST_DAY(CURRENT_DATE())";
    }
    if (context.reportCode === "bpo-hr-workforce-lifecycle-master") {
      return filters.to ? `DATE('${filters.to}')` : "CURRENT_DATE()";
    }
    if (context.dateExpression) return context.dateExpression;
    if (context.monthExpression) return `LAST_DAY(CONCAT(SUBSTRING(CAST(${context.monthExpression} AS CHAR),1,7),'-01'))`;
    if (filters.month) return `LAST_DAY('${filters.month}-01')`;
    return "CURRENT_DATE()";
  }
  if (column.key === "EMPLOYEE_NAME") {
    const fullName = aliasColumn(context, "e", ["full_name", "employee_name"]);
    if (fullName) return fullName;
    const first = aliasColumn(context, "e", ["first_name"]);
    const last = aliasColumn(context, "e", ["last_name"]);
    if (first) return `TRIM(CONCAT(COALESCE(${first},''),' ',COALESCE(${last ?? "NULL"},'')))`;
  }
  if (column.key === "BRANCH") return anyColumn(context, ["branch_name", "branch"]);
  if (column.key === "DEPARTMENT") return anyColumn(context, ["department_name", "dept_name", "department"]);
  if (column.key === "DESIGNATION") return anyColumn(context, ["designation_name", "designation"]);
  if (column.key === "PROCESS") return anyColumn(context, ["process_name", "process"]);
  if (column.key === "COST_CENTRE") return anyColumn(context, ["cost_centre_name", "cost_center_name", "cost_centre", "cost_center"]);
  if (column.key === "REPORTING_MANAGER_CODE") return aliasColumn(context, "mgr", ["employee_code"]);
  if (column.key === "REPORTING_MANAGER_NAME") {
    const fullName = aliasColumn(context, "mgr", ["full_name", "employee_name"]);
    if (fullName) return fullName;
    const first = aliasColumn(context, "mgr", ["first_name"]);
    const last = aliasColumn(context, "mgr", ["last_name"]);
    if (first) return `TRIM(CONCAT(COALESCE(${first},''),' ',COALESCE(${last ?? "NULL"},'')))`;
  }
  if (column.key === "TENURE_DAYS") {
    const joining = anyColumn(context, ["date_of_joining", "joining_date"]);
    const exit = anyColumn(context, ["date_of_exit", "date_of_leaving", "last_working_date", "exit_date"]);
    return joining ? `DATEDIFF(COALESCE(${exit ?? "NULL"}, CURRENT_DATE()), ${joining})` : null;
  }
  if (column.key === "ROSTER_SHIFT") return anyColumn(context, ["shift_name", "roster_shift"]);
  if (column.key === "SHIFT_START_TIME") return anyColumn(context, ["start_time", "shift_start", "shift_start_time"]);
  if (column.key === "SHIFT_END_TIME") return anyColumn(context, ["end_time", "shift_end", "shift_end_time"]);
  if (column.key === "PAYROLL_MONTH" || column.key === "FINANCE_MONTH" || column.key === "REPORT_MONTH") {
    if (filters.month) return `'${filters.month}'`;
    return context.monthExpression ?? (context.dateExpression ? `DATE_FORMAT(${context.dateExpression},'%Y-%m')` : `DATE_FORMAT(CURRENT_DATE(),'%Y-%m')`);
  }
  return anyColumn(context, standardCandidates(column.key));
}

function formatExpression(expression: string | null, format: BpoMasterFormat, key: string) {
  if (!expression) return `NULL AS ${quote(key)}`;
  if (format === "date") {
    return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(${expression}, '%d-%b-%Y')) END AS ${quote(key)}`;
  }
  if (format === "month") {
    return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(CONCAT(SUBSTRING(CAST(${expression} AS CHAR),1,7),'-01'), '%b-%Y')) END AS ${quote(key)}`;
  }
  if (format === "time") {
    return `CASE WHEN ${expression} IS NULL THEN NULL ELSE TIME_FORMAT(${expression}, '%H:%i:%s') END AS ${quote(key)}`;
  }
  if (format === "boolean") {
    return `CASE WHEN ${expression} IN (1,'1','true','TRUE','yes','YES','Y') THEN 'YES' WHEN ${expression} IS NULL THEN NULL ELSE 'NO' END AS ${quote(key)}`;
  }
  return `${expression} AS ${quote(key)}`;
}

function buildWhere(
  context: QueryContext,
  filters: BpoMasterReportFilters,
  branchScope: BranchScope
) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const employeeBranch = aliasColumn(context, "e", ["branch_id"]);
  const sourceBranch = aliasColumn(context, "src", ["branch_id"]);
  const branchExpression = employeeBranch ?? sourceBranch;
  const employeeProcess = aliasColumn(context, "e", ["process_id"]);
  const sourceProcess = aliasColumn(context, "src", ["process_id"]);
  const processExpression = employeeProcess ?? sourceProcess;
  const employeeCodeExpression = anyColumn(context, ["employee_code", "agent_code", "analyst_code"]);
  const clientExpression = anyColumn(context, ["client_id"]);

  if (!branchScope.isSuperAdmin && branchScope.branchIds.length > 0) {
    if (branchScope.branchIds.includes(NO_SCOPE_SENTINEL)) {
      clauses.push("1 = 0");
    } else if (branchExpression) {
      if (filters.branchId) {
        clauses.push(`${branchExpression} = ?`);
        params.push(filters.branchId);
      } else {
        clauses.push(`${branchExpression} IN (${branchScope.branchIds.map(() => "?").join(",")})`);
        params.push(...branchScope.branchIds);
      }
    } else {
      clauses.push("1 = 0");
    }
  } else if (filters.branchId && branchExpression) {
    clauses.push(`${branchExpression} = ?`);
    params.push(filters.branchId);
  }

  if (filters.processId && processExpression) {
    clauses.push(`${processExpression} = ?`);
    params.push(filters.processId);
  }
  if (filters.employeeCode && employeeCodeExpression && !context.aggregate) {
    clauses.push(`${employeeCodeExpression} = ?`);
    params.push(filters.employeeCode);
  }
  if (filters.clientId && clientExpression) {
    clauses.push(`${clientExpression} = ?`);
    params.push(filters.clientId);
  }

  if (filters.month) {
    if (context.monthExpression) {
      clauses.push(`SUBSTRING(CAST(${context.monthExpression} AS CHAR),1,7) = ?`);
      params.push(filters.month);
    } else if (context.dateExpression) {
      clauses.push(`DATE_FORMAT(${context.dateExpression},'%Y-%m') = ?`);
      params.push(filters.month);
    }
  } else if (context.dateExpression) {
    if (filters.from) {
      clauses.push(`DATE(${context.dateExpression}) >= ?`);
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push(`DATE(${context.dateExpression}) <= ?`);
      params.push(filters.to);
    }
  }

  return { clauses, params };
}

function sourceCoverage(columns: BpoMasterColumn[], expressions: Map<string, string | null>) {
  const available = columns.filter((column) => Boolean(expressions.get(column.key))).map((column) => column.key);
  const unavailable = columns.filter((column) => !expressions.get(column.key)).map((column) => column.key);
  return {
    available,
    unavailable,
    percentage: columns.length ? Number(((available.length / columns.length) * 100).toFixed(1)) : 100,
  };
}

export const bpoMasterReportService = {
  list() {
    return BPO_MASTER_REPORTS;
  },

  async run(code: string, inputFilters: BpoMasterReportFilters, branchScope: BranchScope) {
    const definition = getBpoMasterReport(code);
    if (!definition) throw Object.assign(new Error("BPO master report not found"), { statusCode: 404 });
    const filters = normalizeFilters(inputFilters);
    const schema = await loadSchema();
    const context = createContext(schema, code);
    if (!context) {
      return {
        definition,
        generatedAt: new Date().toISOString(),
        sourceState: "unavailable" as const,
        sourceTable: null,
        rows: [],
        totalCount: 0,
        filters,
        coverage: { available: [], unavailable: definition.columns.map((column) => column.key), percentage: 0 },
        message: "No recognised source table exists for this BPO master report. No zero values were substituted.",
      };
    }

    const expressions = new Map<string, string | null>();
    const select = definition.columns.map((column) => {
      const expression = expressionForColumn(context, column, filters);
      expressions.set(column.key, expression);
      return formatExpression(expression, column.format, column.key);
    });
    const where = buildWhere(context, filters, branchScope);
    const whereSql = where.clauses.length ? `WHERE ${where.clauses.join(" AND ")}` : "";
    const sql = `SELECT ${select.join(",\n       ")}
                   FROM ${context.fromSql}
                   ${context.joins.join("\n")}
                   ${whereSql}`;
    const countSql = `SELECT COUNT(*) AS total FROM (${sql}) master_report_count`;
    const [countRows] = await db.execute<RowDataPacket[]>(countSql, where.params);
    const totalCount = Number(countRows[0]?.total ?? 0);
    const paginatedSql = `${sql} LIMIT ? OFFSET ?`;
    const [rows] = await db.execute<RowDataPacket[]>(paginatedSql, [...where.params, filters.limit, filters.offset]);

    return {
      definition,
      generatedAt: new Date().toISOString(),
      sourceState: "available" as const,
      sourceTable: context.sourceTable,
      rows,
      totalCount,
      filters,
      coverage: sourceCoverage(definition.columns, expressions),
      message: null,
    };
  },
};
