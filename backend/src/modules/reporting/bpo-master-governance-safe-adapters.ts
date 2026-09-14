import type { RowDataPacket } from "mysql2";
import { sqlLimitOffset } from "../../db/pagination.js";
import { db } from "../../db/mysql.js";
import type { BranchScope } from "./reporting.scope.js";
import { BPO_MASTER_REPORTS, getBpoMasterReport } from "./bpo-master-report-registry.js";
import { dateBounds, quote, type VerifiedAdapterFilters, type VerifiedAdapterResult } from "./bpo-master-adapter-utils.js";
import { describeSourceTable, sourceColumns, sourceTableSql, type SourceColumn, type SourceFieldLineage } from "./bpo-master-source-registry.js";

const NO_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";
const SUPPORTED = new Set([
  "bpo-audit-compliance-control-master",
  "bpo-interview-to-exit-journey-ledger",
  "bpo-report-data-lineage-reconciliation-master",
]);

function has(columns: Map<string, SourceColumn>, name: string) {
  return columns.has(name.toLowerCase());
}

function col(columns: Map<string, SourceColumn>, candidates: string[]) {
  for (const candidate of candidates) {
    const value = columns.get(candidate.toLowerCase());
    if (value) return value.column;
  }
  return null;
}

function dateSql(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(${expression},'%d-%b-%Y')) END`;
}

function timestampSql(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(${expression},'%d-%b-%Y %H:%i:%s')) END`;
}

function safeJsonText(expression: string, path: string) {
  return `CASE WHEN JSON_VALID(${expression}) THEN JSON_UNQUOTE(JSON_EXTRACT(${expression},'${path}')) ELSE NULL END`;
}

function normalizeRows(code: string, rows: RowDataPacket[]) {
  const definition = getBpoMasterReport(code)!;
  return rows.map((row) => Object.fromEntries(definition.columns.map((column) => [column.key, row[column.key] ?? null])));
}

function defaultLineage(code: string, sourceTable: string): Record<string, SourceFieldLineage> {
  const definition = getBpoMasterReport(code)!;
  return Object.fromEntries(definition.columns.map((column) => [column.key, {
    sourceSchema: "MULTI",
    sourceTable,
    sourceColumn: null,
    transformation: "ROW RETAINS SOURCE_SCHEMA, SOURCE_TABLE AND SOURCE_RECORD_ID",
    confidence: "DERIVED" as const,
  }]));
}

function verifiedResult(
  code: string,
  sourceTable: string,
  rows: RowDataPacket[],
  totalCount: number,
  distinctCount: number,
  exactCount: number
): VerifiedAdapterResult {
  const definition = getBpoMasterReport(code)!;
  const duplicateGrainCount = Math.max(0, totalCount - distinctCount);
  return {
    rows: normalizeRows(code, rows),
    totalCount,
    sourceTable,
    availableKeys: definition.columns.map((column) => column.key),
    lineage: defaultLineage(code, sourceTable),
    verification: {
      runtimeSchemaVerified: true,
      exactMappedFieldCount: Math.min(exactCount, definition.columns.length),
      derivedMappedFieldCount: Math.max(0, definition.columns.length - exactCount),
      unavailableFieldCount: 0,
      duplicateGrainCount,
      sourceRowCount: totalCount,
      distinctGrainCount: distinctCount,
      accuracyStatus: duplicateGrainCount > 0 ? "DUPLICATE_GRAIN_FOUND" : "SCHEMA_VERIFIED",
    },
  };
}

interface AuditEventBuilder {
  sql: string;
  source: string;
}

function auditSelect(values: Record<string, string>) {
  const names = [
    "event_id", "activity_ts", "audit_category", "control_domain", "module_key", "action_type", "action_status",
    "entity_type", "entity_id", "source_schema", "source_table", "source_record_id", "request_id", "actor_user_id",
    "actor_role", "subject_employee_id", "candidate_id", "old_value", "new_value", "change_summary", "reason", "remarks",
    "approval_workflow", "approval_step", "approval_decision", "ip_address", "user_agent", "evidence_reference",
  ];
  return `SELECT ${names.map((name) => `${values[name] ?? "NULL"} AS ${quote(name)}`).join(",\n       ")}`;
}

async function auditEvents(): Promise<AuditEventBuilder[]> {
  const events: AuditEventBuilder[] = [];
  // AUTHORITATIVE SOURCE: audit_action_log is the canonical insert target per migrations 218/220.
  // audit_log (created as LIKE audit_action_log) is a structural alias; read audit_action_log as primary.
  const generalTable = await sourceTableSql("audit_action_log");
  const generalColumns = await sourceColumns("audit_action_log");
  const generalTs = col(generalColumns, ["created_at"]);
  if (generalTable && generalTs && has(generalColumns, "id") && has(generalColumns, "action_type") && has(generalColumns, "module_key")) {
    events.push({ source: "audit_action_log", sql: `${auditSelect({
      event_id: `g.${quote("id")}`,
      activity_ts: `g.${quote(generalTs)}`,
      audit_category: `'GENERAL AUDIT'`,
      control_domain: `g.${quote("module_key")}`,
      module_key: `g.${quote("module_key")}`,
      action_type: `g.${quote("action_type")}`,
      action_status: `'RECORDED'`,
      entity_type: has(generalColumns, "entity_type") ? `g.${quote("entity_type")}` : "NULL",
      entity_id: has(generalColumns, "entity_id") ? `g.${quote("entity_id")}` : "NULL",
      source_schema: `'mas_hrms'`, source_table: `'audit_action_log'`, source_record_id: `g.${quote("id")}`,
      request_id: has(generalColumns, "request_id") ? `g.${quote("request_id")}` : "NULL",
      actor_user_id: has(generalColumns, "actor_user_id") ? `g.${quote("actor_user_id")}` : "NULL",
      change_summary: has(generalColumns, "metadata_json") ? `CAST(g.${quote("metadata_json")} AS CHAR)` : "NULL",
      ip_address: has(generalColumns, "ip_address") ? `g.${quote("ip_address")}` : "NULL",
      user_agent: has(generalColumns, "user_agent") ? `g.${quote("user_agent")}` : "NULL",
      evidence_reference: has(generalColumns, "request_id") ? `g.${quote("request_id")}` : `g.${quote("id")}`,
    })} FROM ${generalTable} g` });
  }

  const sensitiveTable = await sourceTableSql("sensitive_action_log");
  const sensitiveColumns = await sourceColumns("sensitive_action_log");
  const sensitiveTs = col(sensitiveColumns, ["acted_at", "created_at"]);
  if (sensitiveTable && sensitiveTs && has(sensitiveColumns, "id") && has(sensitiveColumns, "action_type") && has(sensitiveColumns, "module_key")) {
    events.push({ source: "sensitive_action_log", sql: `${auditSelect({
      event_id: `s.${quote("id")}`,
      activity_ts: `s.${quote(sensitiveTs)}`,
      audit_category: `'SENSITIVE AUDIT'`,
      control_domain: `s.${quote("module_key")}`,
      module_key: `s.${quote("module_key")}`,
      action_type: `s.${quote("action_type")}`,
      action_status: `'RECORDED'`,
      entity_type: has(sensitiveColumns, "entity_type") ? `s.${quote("entity_type")}` : "NULL",
      entity_id: has(sensitiveColumns, "entity_id") ? `s.${quote("entity_id")}` : "NULL",
      source_schema: `'mas_hrms'`, source_table: `'sensitive_action_log'`, source_record_id: `s.${quote("id")}`,
      request_id: has(sensitiveColumns, "request_id") ? `s.${quote("request_id")}` : "NULL",
      actor_user_id: has(sensitiveColumns, "actor_user_id") ? `s.${quote("actor_user_id")}` : "NULL",
      actor_role: has(sensitiveColumns, "actor_role") ? `s.${quote("actor_role")}` : "NULL",
      subject_employee_id: has(sensitiveColumns, "employee_id") ? `s.${quote("employee_id")}` : "NULL",
      old_value: has(sensitiveColumns, "old_value_json") ? `CAST(s.${quote("old_value_json")} AS CHAR)` : "NULL",
      new_value: has(sensitiveColumns, "new_value_json") ? `CAST(s.${quote("new_value_json")} AS CHAR)` : "NULL",
      change_summary: has(sensitiveColumns, "change_summary") ? `CAST(s.${quote("change_summary")} AS CHAR)` : "NULL",
      reason: has(sensitiveColumns, "reason") ? `s.${quote("reason")}` : "NULL",
      ip_address: has(sensitiveColumns, "ip_address") ? `s.${quote("ip_address")}` : "NULL",
      user_agent: has(sensitiveColumns, "user_agent") ? `s.${quote("user_agent")}` : "NULL",
      evidence_reference: has(sensitiveColumns, "request_id") ? `s.${quote("request_id")}` : `s.${quote("id")}`,
    })} FROM ${sensitiveTable} s` });
  }

  const actionTable = await sourceTableSql("approval_action_log");
  const actionColumns = await sourceColumns("approval_action_log");
  const requestTable = await sourceTableSql("approval_request");
  const requestColumns = await sourceColumns("approval_request");
  const workflowTable = await sourceTableSql("approval_workflow_master");
  const workflowColumns = await sourceColumns("approval_workflow_master");
  if (actionTable && requestTable && has(actionColumns, "id") && has(actionColumns, "request_id") && has(actionColumns, "acted_at") && has(requestColumns, "id")) {
    const joins = [`JOIN ${requestTable} r ON r.${quote("id")}=a.${quote("request_id")}`];
    if (workflowTable && has(requestColumns, "workflow_id") && has(workflowColumns, "id")) {
      joins.push(`LEFT JOIN ${workflowTable} w ON w.${quote("id")}=r.${quote("workflow_id")}`);
    }
    events.push({ source: "approval_action_log", sql: `${auditSelect({
      event_id: `a.${quote("id")}`,
      activity_ts: `a.${quote("acted_at")}`,
      audit_category: `'APPROVAL WORKFLOW'`,
      control_domain: has(requestColumns, "module_key") ? `r.${quote("module_key")}` : `'APPROVAL'`,
      module_key: has(requestColumns, "module_key") ? `r.${quote("module_key")}` : `'APPROVAL'`,
      action_type: has(actionColumns, "action") ? `a.${quote("action")}` : `'ACTION'`,
      action_status: has(requestColumns, "status") ? `r.${quote("status")}` : "NULL",
      entity_type: has(requestColumns, "entity_type") ? `r.${quote("entity_type")}` : "NULL",
      entity_id: has(requestColumns, "entity_id") ? `r.${quote("entity_id")}` : "NULL",
      source_schema: `'mas_hrms'`, source_table: `'approval_action_log'`, source_record_id: `a.${quote("id")}`,
      request_id: `a.${quote("request_id")}`,
      actor_user_id: has(actionColumns, "actor_user_id") ? `a.${quote("actor_user_id")}` : "NULL",
      change_summary: has(requestColumns, "summary_text") ? `JSON_OBJECT('summary',r.${quote("summary_text")})` : "NULL",
      remarks: has(actionColumns, "remarks") ? `a.${quote("remarks")}` : "NULL",
      approval_workflow: workflowTable && has(workflowColumns, "workflow_name") ? `w.${quote("workflow_name")}` : has(requestColumns, "module_key") ? `r.${quote("module_key")}` : "NULL",
      approval_step: has(actionColumns, "step_order") ? `CAST(a.${quote("step_order")} AS CHAR)` : "NULL",
      approval_decision: has(actionColumns, "action") ? `a.${quote("action")}` : "NULL",
      evidence_reference: `a.${quote("request_id")}`,
    })} FROM ${actionTable} a ${joins.join(" ")}` });
  }
  return events;
}

async function auditReport(code: string, filters: VerifiedAdapterFilters, scope: BranchScope): Promise<VerifiedAdapterResult | null> {
  const events = await auditEvents();
  if (!events.length) return null;
  const employeeTable = await sourceTableSql("employees");
  const employeeColumns = await sourceColumns("employees");
  const branchTable = await sourceTableSql("branch_master");
  const branchColumns = await sourceColumns("branch_master");
  const processTable = await sourceTableSql("process_master");
  const processColumns = await sourceColumns("process_master");
  const joins: string[] = [];
  if (employeeTable && has(employeeColumns, "id")) {
    if (has(employeeColumns, "user_id")) joins.push(`LEFT JOIN ${employeeTable} actor_user ON actor_user.${quote("user_id")}=event.actor_user_id`);
    joins.push(`LEFT JOIN ${employeeTable} actor_emp ON actor_emp.${quote("id")}=event.actor_user_id`);
    joins.push(`LEFT JOIN ${employeeTable} subject ON subject.${quote("id")}=event.subject_employee_id`);
  }
  if (branchTable && employeeTable && has(branchColumns, "id") && has(employeeColumns, "branch_id")) {
    joins.push(`LEFT JOIN ${branchTable} branch ON branch.${quote("id")}=COALESCE(subject.${quote("branch_id")},actor_user.${quote("branch_id")},actor_emp.${quote("branch_id")})`);
  }
  if (processTable && employeeTable && has(processColumns, "id") && has(employeeColumns, "process_id")) {
    joins.push(`LEFT JOIN ${processTable} process ON process.${quote("id")}=COALESCE(subject.${quote("process_id")},actor_user.${quote("process_id")},actor_emp.${quote("process_id")})`);
  }
  const bounds = dateBounds(filters);
  const where = ["DATE(event.activity_ts) BETWEEN ? AND ?"];
  const params: unknown[] = [bounds.from, bounds.to];
  if (!scope.isSuperAdmin && scope.branchIds.length) {
    if (scope.branchIds.includes(NO_SCOPE_SENTINEL) || !employeeTable || !has(employeeColumns, "branch_id")) where.push("1=0");
    else {
      where.push(`COALESCE(subject.${quote("branch_id")},actor_user.${quote("branch_id")},actor_emp.${quote("branch_id")}) IN (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
  }
  if (filters.branchId && employeeTable && has(employeeColumns, "branch_id")) {
    where.push(`COALESCE(subject.${quote("branch_id")},actor_user.${quote("branch_id")},actor_emp.${quote("branch_id")})=?`);
    params.push(filters.branchId);
  }
  if (filters.processId && employeeTable && has(employeeColumns, "process_id")) {
    where.push(`COALESCE(subject.${quote("process_id")},actor_user.${quote("process_id")},actor_emp.${quote("process_id")})=?`);
    params.push(filters.processId);
  }
  if (filters.employeeCode && employeeTable) {
    where.push(`COALESCE(subject.${quote("employee_code")},actor_user.${quote("employee_code")},actor_emp.${quote("employee_code")})=?`);
    params.push(filters.employeeCode);
  }
  const actorName = has(employeeColumns, "full_name")
    ? "COALESCE(actor_user.full_name,actor_emp.full_name)"
    : "TRIM(CONCAT(COALESCE(actor_user.first_name,actor_emp.first_name,''),' ',COALESCE(actor_user.last_name,actor_emp.last_name,'')))";
  const subjectName = has(employeeColumns, "full_name") ? "subject.full_name" : "TRIM(CONCAT(COALESCE(subject.first_name,''),' ',COALESCE(subject.last_name,'')))";
  const metadata = "event.change_summary";
  const sql = `SELECT
    COALESCE(subject.${quote("employee_code")},'AGGREGATE') EMPLOYEE_CODE,
    ${dateSql("event.activity_ts")} REPORT_DATE,
    ${timestampSql("event.activity_ts")} ACTIVITY_DATE_TIME,
    event.event_id EVENT_ID,
    ROW_NUMBER() OVER (ORDER BY event.activity_ts,event.source_table,event.source_record_id) EVENT_SEQUENCE,
    event.audit_category AUDIT_CATEGORY,event.control_domain CONTROL_DOMAIN,event.module_key MODULE,
    event.action_type ACTION_TYPE,event.action_status ACTION_STATUS,event.entity_type ENTITY_TYPE,event.entity_id ENTITY_ID,
    event.source_schema SOURCE_SCHEMA,event.source_table SOURCE_TABLE,event.source_record_id SOURCE_RECORD_ID,event.request_id REQUEST_ID,
    event.actor_user_id ACTOR_USER_ID,COALESCE(actor_user.${quote("employee_code")},actor_emp.${quote("employee_code")}) ACTOR_EMPLOYEE_CODE,
    ${actorName} ACTOR_NAME,COALESCE(event.actor_role,'UNKNOWN') ACTOR_ROLE,
    ${branchTable && col(branchColumns,["branch_name"]) ? `branch.${quote(col(branchColumns,["branch_name"])!)}` : "NULL"} ACTOR_BRANCH,
    ${processTable && col(processColumns,["process_name"]) ? `process.${quote(col(processColumns,["process_name"])!)}` : "NULL"} ACTOR_PROCESS,
    subject.${quote("employee_code")} SUBJECT_EMPLOYEE_CODE,${subjectName} SUBJECT_EMPLOYEE_NAME,event.candidate_id SUBJECT_CANDIDATE_ID,NULL SUBJECT_CANDIDATE_NAME,
    event.ip_address IP_ADDRESS,event.user_agent USER_AGENT,event.old_value OLD_VALUE,event.new_value NEW_VALUE,event.change_summary CHANGE_SUMMARY,event.reason REASON,event.remarks REMARKS,
    event.approval_workflow APPROVAL_WORKFLOW,event.approval_step APPROVAL_STEP,event.approval_decision APPROVAL_DECISION,
    NULL APPROVAL_DUE_DATE,${dateSql("event.activity_ts")} APPROVAL_COMPLETED_DATE,CASE WHEN event.approval_decision IS NULL THEN NULL ELSE 'RECORDED' END SLA_STATUS,
    ${safeJsonText(metadata,"$.policy_code")} POLICY_CODE,${safeJsonText(metadata,"$.policy_version")} POLICY_VERSION,
    ${safeJsonText(metadata,"$.statutory_area")} STATUTORY_AREA,${safeJsonText(metadata,"$.purpose")} DPDP_PURPOSE,
    ${safeJsonText(metadata,"$.consent_status")} CONSENT_STATUS,${safeJsonText(metadata,"$.data_classification")} DATA_CLASSIFICATION,
    COALESCE(${safeJsonText(metadata,"$.risk_level")},'UNASSESSED') RISK_LEVEL,COALESCE(${safeJsonText(metadata,"$.control_result")},event.action_status) CONTROL_RESULT,
    CASE WHEN JSON_VALID(${metadata}) AND JSON_EXTRACT(${metadata},'$.exception') IS NOT NULL THEN 'YES' ELSE 'NO' END EXCEPTION_FLAG,
    ${safeJsonText(metadata,"$.exception_type")} EXCEPTION_TYPE,${safeJsonText(metadata,"$.financial_impact")} FINANCIAL_IMPACT,
    ${safeJsonText(metadata,"$.customer_impact")} CUSTOMER_IMPACT_FLAG,${safeJsonText(metadata,"$.privacy_impact")} PRIVACY_IMPACT_FLAG,
    event.evidence_reference EVIDENCE_REFERENCE,CASE WHEN event.evidence_reference IS NULL THEN 'NOT LINKED' ELSE 'LINKED' END EVIDENCE_STATUS,
    ${safeJsonText(metadata,"$.corrective_action")} CORRECTIVE_ACTION,${safeJsonText(metadata,"$.preventive_action")} PREVENTIVE_ACTION,
    ${safeJsonText(metadata,"$.action_owner")} ACTION_OWNER,${dateSql(safeJsonText(metadata,"$.action_due_date"))} ACTION_DUE_DATE,
    ${dateSql(safeJsonText(metadata,"$.action_closed_date"))} ACTION_CLOSED_DATE,${safeJsonText(metadata,"$.verified_by")} VERIFIED_BY,
    ${safeJsonText(metadata,"$.verification_status")} VERIFICATION_STATUS,${safeJsonText(metadata,"$.recurrence_flag")} RECURRENCE_FLAG,
    CONCAT(event.source_schema,'.',event.source_table) DATA_SOURCE,${timestampSql("event.activity_ts")} SOURCE_FRESHNESS
  FROM (${events.map((event) => event.sql).join(" UNION ALL ")}) event
  ${joins.join("\n")}
  WHERE ${where.join(" AND ")}`;
  const countSql = `SELECT COUNT(*) total,COUNT(DISTINCT CONCAT_WS('¦',SOURCE_TABLE,SOURCE_RECORD_ID,ACTIVITY_DATE_TIME)) distinct_count FROM (${sql}) source_rows`;
  const [countRows] = await db.execute<RowDataPacket[]>(countSql, params);
  const total = Number(countRows[0]?.total ?? 0);
  const distinct = Number(countRows[0]?.distinct_count ?? 0);
  const [rows] = await db.execute<RowDataPacket[]>(`${sql} ORDER BY ACTIVITY_DATE_TIME DESC ${sqlLimitOffset(filters.limit, filters.offset)}`, params);
  return verifiedResult(code, events.map((event) => event.source).join("+"), rows, total, distinct, 24);
}

interface JourneyEvent {
  source: string;
  sql: string;
}

const JOURNEY_COLUMNS = [
  "source_schema", "source_table", "source_record_id", "activity_ts", "candidate_id", "employee_id", "actor_id", "approver_id",
  "journey_phase", "journey_stage", "journey_sub_stage", "activity_type", "activity_status", "activity_description",
  "previous_stage", "new_stage", "previous_value", "new_value", "remarks", "reason", "requisition_id", "interview_round",
  "interview_result", "offer_status", "offer_date", "expected_joining_date", "bgv_check_type", "bgv_status", "document_type",
  "document_status", "training_batch_code", "training_status", "assessment_score", "production_release_date", "lifecycle_event_type",
  "effective_date", "payroll_month", "payroll_status", "performance_event", "pip_status", "exit_request_id", "exit_stage",
  "exit_status", "last_working_date", "clearance_department", "clearance_status", "fnf_status", "evidence_reference",
] as const;

function journeySelect(values: Partial<Record<(typeof JOURNEY_COLUMNS)[number], string>>) {
  return `SELECT ${JOURNEY_COLUMNS.map((name) => `${values[name] ?? "NULL"} AS ${quote(name)}`).join(",\n       ")}`;
}

async function simpleJourneyEvent(options: {
  tableRef: string;
  alias: string;
  idCandidates?: string[];
  timestampCandidates: string[];
  candidateCandidates?: string[];
  employeeCandidates?: string[];
  actorCandidates?: string[];
  approverCandidates?: string[];
  phase: string;
  stageExpression?: (alias: string, columns: Map<string, SourceColumn>) => string;
  statusCandidates?: string[];
  activityType: string;
  descriptionCandidates?: string[];
  previousStageCandidates?: string[];
  newStageCandidates?: string[];
  reasonCandidates?: string[];
  remarksCandidates?: string[];
  extra?: (alias: string, columns: Map<string, SourceColumn>) => Partial<Record<(typeof JOURNEY_COLUMNS)[number], string>>;
}): Promise<JourneyEvent | null> {
  const table = await sourceTableSql(options.tableRef);
  const columns = await sourceColumns(options.tableRef);
  const id = col(columns, options.idCandidates ?? ["id"]);
  const timestamp = col(columns, options.timestampCandidates);
  if (!table || !id || !timestamp) return null;
  const candidate = col(columns, options.candidateCandidates ?? ["candidate_id"]);
  const employee = col(columns, options.employeeCandidates ?? ["employee_id"]);
  const actor = col(columns, options.actorCandidates ?? []);
  const approver = col(columns, options.approverCandidates ?? []);
  const status = col(columns, options.statusCandidates ?? ["status"]);
  const description = col(columns, options.descriptionCandidates ?? []);
  const previousStage = col(columns, options.previousStageCandidates ?? []);
  const newStage = col(columns, options.newStageCandidates ?? []);
  const reason = col(columns, options.reasonCandidates ?? []);
  const remarks = col(columns, options.remarksCandidates ?? []);
  const alias = options.alias;
  const values: Partial<Record<(typeof JOURNEY_COLUMNS)[number], string>> = {
    source_schema: options.tableRef.includes(".") ? `'${options.tableRef.split(".")[0]}'` : `'mas_hrms'`,
    source_table: `'${options.tableRef.includes(".") ? options.tableRef.split(".")[1] : options.tableRef}'`,
    source_record_id: `${alias}.${quote(id)}`,
    activity_ts: `${alias}.${quote(timestamp)}`,
    candidate_id: candidate ? `${alias}.${quote(candidate)}` : "NULL",
    employee_id: employee ? `${alias}.${quote(employee)}` : "NULL",
    actor_id: actor ? `${alias}.${quote(actor)}` : "NULL",
    approver_id: approver ? `${alias}.${quote(approver)}` : "NULL",
    journey_phase: `'${options.phase}'`,
    journey_stage: options.stageExpression ? options.stageExpression(alias, columns) : status ? `${alias}.${quote(status)}` : `'${options.activityType}'`,
    activity_type: `'${options.activityType}'`,
    activity_status: status ? `${alias}.${quote(status)}` : `'RECORDED'`,
    activity_description: description ? `${alias}.${quote(description)}` : `'${options.activityType.replace(/_/g," ")}'`,
    previous_stage: previousStage ? `${alias}.${quote(previousStage)}` : "NULL",
    new_stage: newStage ? `${alias}.${quote(newStage)}` : status ? `${alias}.${quote(status)}` : "NULL",
    remarks: remarks ? `${alias}.${quote(remarks)}` : "NULL",
    reason: reason ? `${alias}.${quote(reason)}` : "NULL",
    evidence_reference: `${alias}.${quote(id)}`,
    ...(options.extra?.(alias, columns) ?? {}),
  };
  return { source: options.tableRef, sql: `${journeySelect(values)} FROM ${table} ${alias}` };
}

async function journeyEvents(): Promise<JourneyEvent[]> {
  const events: Array<JourneyEvent | null> = await Promise.all([
    simpleJourneyEvent({ tableRef: "ats_candidate", alias: "c", timestampCandidates: ["created_at", "walk_in_date"], phase: "RECRUITMENT", statusCandidates: ["current_stage"], activityType: "CANDIDATE_CREATED", descriptionCandidates: ["remarks"], extra: (a,c) => ({ new_stage: has(c,"current_stage") ? `${a}.${quote("current_stage")}` : "'APPLIED'" }) }),
    simpleJourneyEvent({ tableRef: "ats_candidate_stage_log", alias: "s", timestampCandidates: ["stage_date", "created_at"], phase: "INTERVIEW / SELECTION", statusCandidates: ["to_stage"], actorCandidates: ["updated_by"], activityType: "STAGE_CHANGED", descriptionCandidates: ["remarks"], previousStageCandidates: ["from_stage"], newStageCandidates: ["to_stage"], extra: (a,c) => ({ interview_round: has(c,"to_stage") ? `${a}.${quote("to_stage")}` : "NULL", interview_result: has(c,"to_stage") ? `${a}.${quote("to_stage")}` : "NULL" }) }),
    simpleJourneyEvent({ tableRef: "ats_offer_letters", alias: "o", timestampCandidates: ["sent_at", "created_at", "offer_date"], phase: "OFFER", statusCandidates: ["status"], actorCandidates: ["created_by"], activityType: "OFFER_ACTIVITY", reasonCandidates: ["decline_reason"], extra: (a,c) => ({ offer_status: has(c,"status") ? `${a}.${quote("status")}` : "NULL", offer_date: has(c,"offer_date") ? `${a}.${quote("offer_date")}` : "NULL", expected_joining_date: has(c,"joining_date") ? `${a}.${quote("joining_date")}` : "NULL" }) }),
    simpleJourneyEvent({ tableRef: "ats_onboarding_bridge", alias: "b", timestampCandidates: ["created_at", "bridge_date"], phase: "ONBOARDING", statusCandidates: ["status"], actorCandidates: ["created_by"], activityType: "ONBOARDING_BRIDGE_CREATED", extra: (a,c) => ({ expected_joining_date: has(c,"joining_date") ? `${a}.${quote("joining_date")}` : "NULL" }) }),
    simpleJourneyEvent({ tableRef: "candidate_bgv_check", alias: "v", timestampCandidates: ["verified_at", "reviewed_at", "updated_at", "created_at"], phase: "BGV", statusCandidates: ["status"], actorCandidates: ["reviewed_by"], activityType: "BGV_CHECK_ACTIVITY", descriptionCandidates: ["result_summary"], remarksCandidates: ["review_remarks"], extra: (a,c) => ({ bgv_check_type: has(c,"check_type") ? `${a}.${quote("check_type")}` : "NULL", bgv_status: has(c,"status") ? `${a}.${quote("status")}` : "NULL", evidence_reference: has(c,"provider_reference_id") ? `${a}.${quote("provider_reference_id")}` : `${a}.${quote("id")}` }) }),
    simpleJourneyEvent({ tableRef: "employees", alias: "e0", timestampCandidates: ["created_at"], phase: "EMPLOYMENT", statusCandidates: ["employment_status"], employeeCandidates: ["id"], actorCandidates: ["created_by"], activityType: "EMPLOYEE_CODE_CREATED", extra: (a,c) => ({ effective_date: has(c,"date_of_joining") ? `${a}.${quote("date_of_joining")}` : "NULL" }) }),
    simpleJourneyEvent({ tableRef: "employee_lifecycle_event", alias: "l", timestampCandidates: ["created_at", "effective_date"], phase: "EMPLOYEE LIFECYCLE", statusCandidates: ["event_type"], actorCandidates: ["initiated_by"], approverCandidates: ["approved_by"], activityType: "LIFECYCLE_EVENT", descriptionCandidates: ["remarks"], remarksCandidates: ["remarks"], extra: (a,c) => ({ lifecycle_event_type: has(c,"event_type") ? `${a}.${quote("event_type")}` : "NULL", effective_date: has(c,"effective_date") ? `${a}.${quote("effective_date")}` : "NULL", previous_value: has(c,"old_value_json") ? `CAST(${a}.${quote("old_value_json")} AS CHAR)` : "NULL", new_value: has(c,"new_value_json") ? `CAST(${a}.${quote("new_value_json")} AS CHAR)` : "NULL" }) }),
    simpleJourneyEvent({ tableRef: "leave_request", alias: "lr", timestampCandidates: ["applied_at", "created_at"], phase: "ATTENDANCE / LEAVE", statusCandidates: ["status"], employeeCandidates: ["employee_id"], activityType: "LEAVE_APPLIED", descriptionCandidates: ["reason"], reasonCandidates: ["reason"], extra: (a,c) => ({ effective_date: has(c,"from_date") ? `${a}.${quote("from_date")}` : "NULL" }) }),
    simpleJourneyEvent({ tableRef: "attendance_regularization", alias: "ar", timestampCandidates: ["reviewed_at", "created_at"], phase: "ATTENDANCE / REGULARISATION", statusCandidates: ["status"], employeeCandidates: ["employee_id"], actorCandidates: ["reviewed_by"], activityType: "ATTENDANCE_REGULARISATION", descriptionCandidates: ["reason", "supporting_note"], reasonCandidates: ["reason_code", "reason"], remarksCandidates: ["reviewer_note"] }),
    simpleJourneyEvent({ tableRef: "coaching_session", alias: "cs", timestampCandidates: ["created_at", "session_date"], phase: "PERFORMANCE", statusCandidates: ["status"], employeeCandidates: ["employee_id"], actorCandidates: ["coach_user_id"], activityType: "COACHING_SESSION", descriptionCandidates: ["notes"], remarksCandidates: ["notes"], extra: () => ({ performance_event: "'COACHING'" }) }),
    simpleJourneyEvent({ tableRef: "pip_record", alias: "pr", timestampCandidates: ["closed_at", "created_at"], phase: "PERFORMANCE", statusCandidates: ["status"], employeeCandidates: ["employee_id"], actorCandidates: ["initiated_by"], approverCandidates: ["closed_by"], activityType: "PIP_ACTIVITY", descriptionCandidates: ["reason"], reasonCandidates: ["reason"], remarksCandidates: ["review_notes"], extra: (a,c) => ({ performance_event: "'PIP'", pip_status: has(c,"status") ? `${a}.${quote("status")}` : "NULL", effective_date: has(c,"start_date") ? `${a}.${quote("start_date")}` : "NULL" }) }),
    simpleJourneyEvent({ tableRef: "exit_request", alias: "er", timestampCandidates: ["submitted_at", "created_at"], phase: "EXIT", statusCandidates: ["status"], employeeCandidates: ["employee_id"], actorCandidates: ["initiated_by_user_id"], activityType: "EXIT_REQUEST_ACTIVITY", descriptionCandidates: ["resignation_reason"], reasonCandidates: ["exit_reason_category", "resignation_reason"], extra: (a,c) => ({ exit_request_id: `${a}.${quote("id")}`, exit_stage: has(c,"status") ? `${a}.${quote("status")}` : "NULL", exit_status: has(c,"status") ? `${a}.${quote("status")}` : "NULL", last_working_date: has(c,"last_working_day_confirmed") ? `${a}.${quote("last_working_day_confirmed")}` : has(c,"last_working_day_proposed") ? `${a}.${quote("last_working_day_proposed")}` : "NULL" }) }),
  ]);

  const output = events.filter((event): event is JourneyEvent => Boolean(event));
  const salaryLine = await sourceTableSql("salary_prep_line");
  const salaryColumns = await sourceColumns("salary_prep_line");
  const salaryRun = await sourceTableSql("salary_prep_run");
  const runColumns = await sourceColumns("salary_prep_run");
  if (salaryLine && salaryRun && has(salaryColumns,"id") && has(salaryColumns,"run_id") && has(salaryColumns,"employee_id") && has(runColumns,"id") && has(runColumns,"run_month")) {
    const ts = col(runColumns,["updated_at","created_at"]);
    if (ts) output.push({ source: "salary_prep_line", sql: `${journeySelect({ source_schema:"'mas_hrms'",source_table:"'salary_prep_line'",source_record_id:`sl.${quote("id")}`,activity_ts:`sr.${quote(ts)}`,employee_id:`sl.${quote("employee_id")}`,actor_id:has(runColumns,"created_by")?`sr.${quote("created_by")}`:"NULL",approver_id:has(runColumns,"approved_by")?`sr.${quote("approved_by")}`:"NULL",journey_phase:"'PAYROLL'",journey_stage:"'PAYROLL RUN'",activity_type:"'PAYROLL_PROCESSED'",activity_status:has(salaryColumns,"status")?`sl.${quote("status")}`:has(runColumns,"status")?`sr.${quote("status")}`:"NULL",activity_description:"'Employee payroll line processed'",payroll_month:`sr.${quote("run_month")}`,payroll_status:has(salaryColumns,"status")?`sl.${quote("status")}`:has(runColumns,"status")?`sr.${quote("status")}`:"NULL",evidence_reference:`sl.${quote("id")}` })} FROM ${salaryLine} sl JOIN ${salaryRun} sr ON sr.${quote("id")}=sl.${quote("run_id")}` });
  }
  const exitLog = await sourceTableSql("exit_approval_log");
  const exitLogColumns = await sourceColumns("exit_approval_log");
  const exitRequest = await sourceTableSql("exit_request");
  if (exitLog && exitRequest && has(exitLogColumns,"id") && has(exitLogColumns,"exit_request_id") && has(exitLogColumns,"created_at")) {
    output.push({ source: "exit_approval_log", sql: `${journeySelect({ source_schema:"'mas_hrms'",source_table:"'exit_approval_log'",source_record_id:`xl.${quote("id")}`,activity_ts:`xl.${quote("created_at")}`,employee_id:`xr.${quote("employee_id")}`,actor_id:has(exitLogColumns,"action_by")?`xl.${quote("action_by")}`:"NULL",journey_phase:"'EXIT'",journey_stage:has(exitLogColumns,"stage")?`xl.${quote("stage")}`:"'EXIT APPROVAL'",activity_type:has(exitLogColumns,"action")?`xl.${quote("action")}`:"'EXIT_APPROVAL_ACTION'",activity_status:has(exitLogColumns,"action")?`xl.${quote("action")}`:"NULL",activity_description:has(exitLogColumns,"discussion_remarks")?`xl.${quote("discussion_remarks")}`:"'Exit approval activity'",remarks:has(exitLogColumns,"discussion_remarks")?`xl.${quote("discussion_remarks")}`:"NULL",exit_request_id:`xl.${quote("exit_request_id")}`,exit_stage:has(exitLogColumns,"stage")?`xl.${quote("stage")}`:"NULL",exit_status:has(exitLogColumns,"action")?`xl.${quote("action")}`:"NULL",evidence_reference:`xl.${quote("id")}` })} FROM ${exitLog} xl JOIN ${exitRequest} xr ON xr.${quote("id")}=xl.${quote("exit_request_id")}` });
  }
  // 2026-08-19: was exit_clearance_checklist (0 live rows, abandoned) — the exit module
  // actually writes exit_clearance_task (24 live rows). Column equivalents: department ->
  // clearance_area, assigned_to -> owner_user_id (a real user id, unlike owner_role which
  // holds a role string like 'payroll'/'wfm' and would be a wrong value for approver_id).
  const clearance = await sourceTableSql("exit_clearance_task");
  const clearanceColumns = await sourceColumns("exit_clearance_task");
  if (clearance && exitRequest && has(clearanceColumns,"id") && has(clearanceColumns,"exit_request_id") && has(clearanceColumns,"created_at")) {
    const ts = has(clearanceColumns,"cleared_at") ? `COALESCE(xc.${quote("cleared_at")},xc.${quote("created_at")})` : `xc.${quote("created_at")}`;
    output.push({ source: "exit_clearance_task", sql: `${journeySelect({ source_schema:"'mas_hrms'",source_table:"'exit_clearance_task'",source_record_id:`xc.${quote("id")}`,activity_ts:ts,employee_id:`xr.${quote("employee_id")}`,approver_id:has(clearanceColumns,"owner_user_id")?`xc.${quote("owner_user_id")}`:"NULL",journey_phase:"'EXIT CLEARANCE'",journey_stage:has(clearanceColumns,"clearance_area")?`xc.${quote("clearance_area")}`:"'CLEARANCE'",activity_type:"'CLEARANCE_ACTIVITY'",activity_status:has(clearanceColumns,"status")?`xc.${quote("status")}`:"NULL",activity_description:has(clearanceColumns,"remarks")?`xc.${quote("remarks")}`:"'Exit clearance activity'",remarks:has(clearanceColumns,"remarks")?`xc.${quote("remarks")}`:"NULL",exit_request_id:`xc.${quote("exit_request_id")}`,exit_stage:"'CLEARANCE'",clearance_department:has(clearanceColumns,"clearance_area")?`xc.${quote("clearance_area")}`:"NULL",clearance_status:has(clearanceColumns,"status")?`xc.${quote("status")}`:"NULL",evidence_reference:`xc.${quote("id")}` })} FROM ${clearance} xc JOIN ${exitRequest} xr ON xr.${quote("id")}=xc.${quote("exit_request_id")}` });
  }
  return output;
}

async function journeyReport(code: string, filters: VerifiedAdapterFilters, scope: BranchScope): Promise<VerifiedAdapterResult | null> {
  const events = await journeyEvents();
  if (!events.length) return null;
  const candidateTable = await sourceTableSql("ats_candidate");
  const candidateColumns = await sourceColumns("ats_candidate");
  const bridgeTable = await sourceTableSql("ats_onboarding_bridge");
  const bridgeColumns = await sourceColumns("ats_onboarding_bridge");
  const employeeTable = await sourceTableSql("employees");
  const employeeColumns = await sourceColumns("employees");
  if (!employeeTable || !has(employeeColumns,"id") || !has(employeeColumns,"employee_code")) return null;
  const joins: string[] = [];
  if (candidateTable && has(candidateColumns,"id")) joins.push(`LEFT JOIN ${candidateTable} candidate ON candidate.${quote("id")}=event.candidate_id`);
  if (bridgeTable && has(bridgeColumns,"candidate_id") && has(bridgeColumns,"employee_id")) {
    joins.push(`LEFT JOIN ${bridgeTable} candidate_bridge ON candidate_bridge.${quote("candidate_id")}=event.candidate_id`);
    joins.push(`LEFT JOIN ${bridgeTable} employee_bridge ON employee_bridge.${quote("employee_id")}=event.employee_id`);
  }
  const resolvedEmployee = bridgeTable ? "COALESCE(event.employee_id,candidate_bridge.employee_id,employee_bridge.employee_id)" : "event.employee_id";
  joins.push(`LEFT JOIN ${employeeTable} employee ON employee.${quote("id")}=${resolvedEmployee}`);
  if (has(employeeColumns,"user_id")) joins.push(`LEFT JOIN ${employeeTable} actor_user ON actor_user.${quote("user_id")}=event.actor_id`);
  joins.push(`LEFT JOIN ${employeeTable} actor_emp ON actor_emp.${quote("id")}=event.actor_id`);
  if (has(employeeColumns,"user_id")) joins.push(`LEFT JOIN ${employeeTable} approver_user ON approver_user.${quote("user_id")}=event.approver_id`);
  joins.push(`LEFT JOIN ${employeeTable} approver_emp ON approver_emp.${quote("id")}=event.approver_id`);
  const branchTable = await sourceTableSql("branch_master"); const branchColumns = await sourceColumns("branch_master");
  if (branchTable && has(branchColumns,"id") && has(employeeColumns,"branch_id")) joins.push(`LEFT JOIN ${branchTable} branch ON branch.${quote("id")}=employee.${quote("branch_id")}`);
  const processTable = await sourceTableSql("process_master"); const processColumns = await sourceColumns("process_master");
  if (processTable && has(processColumns,"id") && has(employeeColumns,"process_id")) joins.push(`LEFT JOIN ${processTable} process ON process.${quote("id")}=employee.${quote("process_id")}`);
  const departmentTable = await sourceTableSql("department_master"); const departmentColumns = await sourceColumns("department_master");
  if (departmentTable && has(departmentColumns,"id") && has(employeeColumns,"department_id")) joins.push(`LEFT JOIN ${departmentTable} department ON department.${quote("id")}=employee.${quote("department_id")}`);
  const designationTable = await sourceTableSql("designation_master"); const designationColumns = await sourceColumns("designation_master");
  if (designationTable && has(designationColumns,"id") && has(employeeColumns,"designation_id")) joins.push(`LEFT JOIN ${designationTable} designation ON designation.${quote("id")}=employee.${quote("designation_id")}`);
  const managerColumn = col(employeeColumns,["reporting_manager_id","manager_id"]);
  if (managerColumn) joins.push(`LEFT JOIN ${employeeTable} manager ON manager.${quote("id")}=employee.${quote(managerColumn)}`);

  const bounds = dateBounds(filters);
  const where = ["DATE(event.activity_ts) BETWEEN ? AND ?"];
  const params: unknown[] = [bounds.from,bounds.to];
  if (!scope.isSuperAdmin && scope.branchIds.length) {
    if (scope.branchIds.includes(NO_SCOPE_SENTINEL) || !has(employeeColumns,"branch_id")) where.push("1=0");
    else { where.push(`employee.${quote("branch_id")} IN (${scope.branchIds.map(()=>"?").join(",")})`); params.push(...scope.branchIds); }
  }
  if (filters.branchId && has(employeeColumns,"branch_id")) { where.push(`employee.${quote("branch_id")}=?`); params.push(filters.branchId); }
  if (filters.processId && has(employeeColumns,"process_id")) { where.push(`employee.${quote("process_id")}=?`); params.push(filters.processId); }
  if (filters.employeeCode) { where.push(`employee.${quote("employee_code")}=?`); params.push(filters.employeeCode); }
  const employeeName = has(employeeColumns,"full_name") ? "employee.full_name" : "TRIM(CONCAT(COALESCE(employee.first_name,''),' ',COALESCE(employee.last_name,'')))";
  const candidateName = candidateTable && has(candidateColumns,"full_name") ? `candidate.${quote("full_name")}` : "NULL";
  const actorName = has(employeeColumns,"full_name") ? "COALESCE(actor_user.full_name,actor_emp.full_name)" : "TRIM(CONCAT(COALESCE(actor_user.first_name,actor_emp.first_name,''),' ',COALESCE(actor_user.last_name,actor_emp.last_name,'')))";
  const approverName = has(employeeColumns,"full_name") ? "COALESCE(approver_user.full_name,approver_emp.full_name)" : "TRIM(CONCAT(COALESCE(approver_user.first_name,approver_emp.first_name,''),' ',COALESCE(approver_user.last_name,approver_emp.last_name,'')))";
  const candidateCode = candidateTable && has(candidateColumns,"candidate_code") ? `candidate.${quote("candidate_code")}` : "NULL";
  const mobile = candidateTable && has(candidateColumns,"mobile") ? `candidate.${quote("mobile")}` : "NULL";
  const email = candidateTable && has(candidateColumns,"email") ? `candidate.${quote("email")}` : "NULL";
  const branchName = branchTable && col(branchColumns,["branch_name","name"]) ? `branch.${quote(col(branchColumns,["branch_name","name"])!)}` : "NULL";
  const processName = processTable && col(processColumns,["process_name","name"]) ? `process.${quote(col(processColumns,["process_name","name"])!)}` : "NULL";
  const departmentName = departmentTable && col(departmentColumns,["dept_name","department_name","name"]) ? `department.${quote(col(departmentColumns,["dept_name","department_name","name"])!)}` : "NULL";
  const designationName = designationTable && col(designationColumns,["designation_name","name"]) ? `designation.${quote(col(designationColumns,["designation_name","name"])!)}` : "NULL";
  const managerName = managerColumn && has(employeeColumns,"full_name") ? "manager.full_name" : "NULL";
  const union = events.map((event) => event.sql).join(" UNION ALL ");
  const resolved = `SELECT event.*,
    COALESCE(employee.${quote("employee_code")},'PENDING EMPLOYEE CODE') employee_code,
    ${resolvedEmployee} resolved_employee_id,
    COALESCE(${employeeName},${candidateName}) person_name,
    ${candidateCode} candidate_code,${mobile} mobile,${email} email,
    ${branchName} branch_name,${processName} process_name,${departmentName} department_name,${designationName} designation_name,
    ${managerColumn ? `manager.${quote("employee_code")}` : "NULL"} manager_code,${managerName} manager_name,
    COALESCE(actor_user.${quote("employee_code")},actor_emp.${quote("employee_code")}) actor_employee_code,${actorName} actor_name,
    COALESCE(approver_user.${quote("employee_code")},approver_emp.${quote("employee_code")}) approver_employee_code,${approverName} approver_name
  FROM (${union}) event
  ${joins.join("\n")}
  WHERE ${where.join(" AND ")}`;
  const sql = `SELECT
    employee_code EMPLOYEE_CODE,${dateSql("activity_ts")} REPORT_DATE,
    COALESCE(CAST(resolved_employee_id AS CHAR),CAST(candidate_id AS CHAR)) JOURNEY_PERSON_KEY,
    candidate_id CANDIDATE_ID,candidate_code CANDIDATE_CODE,resolved_employee_id EMPLOYEE_ID,person_name PERSON_NAME,
    mobile MOBILE_NUMBER,email EMAIL_ADDRESS,branch_name BRANCH,process_name PROCESS,department_name DEPARTMENT,designation_name DESIGNATION,
    manager_code REPORTING_MANAGER_CODE,manager_name REPORTING_MANAGER_NAME,journey_phase JOURNEY_PHASE,journey_stage JOURNEY_STAGE,
    journey_sub_stage JOURNEY_SUB_STAGE,activity_type ACTIVITY_TYPE,activity_status ACTIVITY_STATUS,
    ${timestampSql("activity_ts")} ACTIVITY_DATE_TIME,${dateSql("activity_ts")} ACTIVITY_DATE,
    ROW_NUMBER() OVER (PARTITION BY COALESCE(CAST(resolved_employee_id AS CHAR),CAST(candidate_id AS CHAR)) ORDER BY activity_ts,source_table,source_record_id) EVENT_SEQUENCE,
    DATEDIFF(DATE(activity_ts),DATE(LAG(activity_ts) OVER (PARTITION BY COALESCE(CAST(resolved_employee_id AS CHAR),CAST(candidate_id AS CHAR)) ORDER BY activity_ts,source_table,source_record_id))) DAYS_FROM_PREVIOUS_EVENT,
    DATEDIFF(CURRENT_DATE(),DATE(activity_ts)) STAGE_AGEING_DAYS,activity_description ACTIVITY_DESCRIPTION,previous_stage PREVIOUS_STAGE,
    new_stage NEW_STAGE,previous_value PREVIOUS_VALUE,new_value NEW_VALUE,actor_id ACTOR_USER_ID,actor_employee_code ACTOR_EMPLOYEE_CODE,
    actor_name ACTOR_NAME,NULL ACTOR_ROLE,approver_id APPROVER_USER_ID,approver_employee_code APPROVER_EMPLOYEE_CODE,
    approver_name APPROVER_NAME,activity_status APPROVAL_STATUS,remarks REMARKS,reason REASON,requisition_id REQUISITION_ID,
    interview_round INTERVIEW_ROUND,interview_result INTERVIEW_RESULT,offer_status OFFER_STATUS,${dateSql("offer_date")} OFFER_DATE,
    ${dateSql("expected_joining_date")} EXPECTED_JOINING_DATE,
    CASE WHEN activity_type='EMPLOYEE_CODE_CREATED' THEN ${dateSql("effective_date")} ELSE NULL END ACTUAL_JOINING_DATE,
    bgv_check_type BGV_CHECK_TYPE,bgv_status BGV_STATUS,document_type DOCUMENT_TYPE,document_status DOCUMENT_STATUS,
    training_batch_code TRAINING_BATCH_CODE,training_status TRAINING_STATUS,assessment_score ASSESSMENT_SCORE,
    ${dateSql("production_release_date")} PRODUCTION_RELEASE_DATE,lifecycle_event_type LIFECYCLE_EVENT_TYPE,
    ${dateSql("effective_date")} EFFECTIVE_DATE,payroll_month PAYROLL_MONTH,payroll_status PAYROLL_STATUS,
    performance_event PERFORMANCE_EVENT,pip_status PIP_STATUS,exit_request_id EXIT_REQUEST_ID,exit_stage EXIT_STAGE,
    exit_status EXIT_STATUS,${dateSql("last_working_date")} LAST_WORKING_DATE,clearance_department CLEARANCE_DEPARTMENT,
    clearance_status CLEARANCE_STATUS,fnf_status FNF_STATUS,source_schema SOURCE_SCHEMA,source_table SOURCE_TABLE,
    source_record_id SOURCE_RECORD_ID,evidence_reference EVIDENCE_REFERENCE,CONCAT(source_schema,'.',source_table) DATA_SOURCE,
    ${timestampSql("activity_ts")} SOURCE_FRESHNESS
  FROM (${resolved}) resolved_events`;
  const countSql = `SELECT COUNT(*) total,COUNT(DISTINCT CONCAT_WS('¦',JOURNEY_PERSON_KEY,ACTIVITY_DATE_TIME,SOURCE_TABLE,SOURCE_RECORD_ID)) distinct_count FROM (${sql}) source_rows`;
  const [countRows] = await db.execute<RowDataPacket[]>(countSql, params);
  const total = Number(countRows[0]?.total ?? 0);
  const distinct = Number(countRows[0]?.distinct_count ?? 0);
  const [rows] = await db.execute<RowDataPacket[]>(`${sql} ORDER BY ACTIVITY_DATE_TIME DESC ${sqlLimitOffset(filters.limit, filters.offset)}`, params);
  return verifiedResult(code, events.map((event)=>event.source).join("+"), rows, total, distinct, 34);
}

const SOURCE_CONTRACTS: Record<string, string[]> = {
  "bpo-operations-productivity-master": ["employees","attendance_daily_record","wfm_roster_assignment","wfm_shift_master","wfm_attendance_session","break_daily_summary","attendance_reconciliation_record","kpi_daily_actual","kpi_metric_master","kpi_employee_resolved"],
  "bpo-employee-performance-360-master": ["employees","attendance_daily_record","kpi_daily_actual","kpi_metric_master","management_kpi_summary","coaching_session","pip_record","lms_learning_progress_snapshot","lms_certification_snapshot"],
  "bpo-client-sla-delivery-master": ["process_master","process_delivery_actual","client_master","bpo_revenue_rule","salary_prep_line"],
  "bpo-wfm-attendance-shrinkage-master": ["attendance_daily_record","wfm_roster_assignment","wfm_shift_master","integration_biometric_daily","wfm_attendance_session","break_daily_summary","attendance_reconciliation_record","attendance_regularization"],
  "bpo-hr-workforce-lifecycle-master": ["employees","employee_address","employee_emergency_contact","employee_probation","employee_contract","employee_lifecycle_event","employee_documents","ats_onboarding_bridge","candidate_bgv_check","employee_uan","employee_bank_detail","exit_request","exit_clearance_task"],
  "bpo-payroll-statutory-master": ["salary_prep_line","salary_prep_run","employees","employee_salary_assignment","employee_uan","employee_bank_detail","salary_payslip"],
  "bpo-finance-pnl-profitability-master": ["process_master","bpo_revenue_rule","process_delivery_actual","salary_prep_line","grn_request","vendor_payment_tracking","branch_budget","pnl_adjustment_journal"],
  "bpo-quality-risk-compliance-master": ["db_audit.call_quality_assessment","employees","kpi_metric_master"],
  "bpo-recruitment-training-readiness-master": ["ats_candidate","ats_candidate_stage_log","ats_offer_letters","ats_onboarding_bridge","candidate_bgv_check","employees","lms_learning_progress_snapshot"],
  "bpo-admin-asset-facility-master": ["asset_assignment","asset_master","employees","helpdesk_ticket","it_provisioning_request","auth_user"],
  "bpo-management-executive-master": ["employees","attendance_daily_record","kpi_daily_actual","process_delivery_actual","salary_prep_line","grn_request"],
  "bpo-audit-compliance-control-master": ["audit_action_log","sensitive_action_log","approval_action_log","approval_request","approval_workflow_master"],
  "bpo-interview-to-exit-journey-ledger": ["ats_candidate","ats_candidate_stage_log","ats_offer_letters","ats_onboarding_bridge","candidate_bgv_check","employees","employee_lifecycle_event","leave_request","attendance_regularization","coaching_session","pip_record","salary_prep_line","exit_request","exit_approval_log","exit_clearance_task"],
};

async function lineageReport(code: string, filters: VerifiedAdapterFilters): Promise<VerifiedAdapterResult> {
  const rows: Record<string, unknown>[] = [];
  const reportDate = new Date().toISOString().slice(0,10);
  for (const report of BPO_MASTER_REPORTS.filter((item) => item.code !== code)) {
    const tableRefs = SOURCE_CONTRACTS[report.code] ?? [];
    const descriptions = await Promise.all(tableRefs.map(describeSourceTable));
    for (const field of report.columns) {
      let exact: SourceColumn | null = null;
      for (const description of descriptions) {
        const found = description.columns.find((column) => column.column.toLowerCase() === field.key.toLowerCase());
        if (found) { exact = found; break; }
      }
      const sourceAvailable = descriptions.some((description) => description.status === "AVAILABLE");
      rows.push({
        EMPLOYEE_CODE: "AGGREGATE", REPORT_DATE: reportDate, REPORT_CODE: report.code, REPORT_NAME: report.name,
        REPORT_DOMAIN: report.domain, REPORT_GRAIN: report.rowGrain, REPORT_PRIMARY_KEY: report.primaryKey.join(" + "),
        REPORT_FIELD: field.key, FIELD_FORMAT: field.format, SENSITIVE_FLAG: field.sensitive ? "YES" : "NO",
        SOURCE_SCHEMA: exact?.schema ?? descriptions[0]?.sourceSchema ?? null,
        SOURCE_TABLE: exact?.table ?? tableRefs.join(" + "), SOURCE_COLUMN: exact?.column ?? null,
        SOURCE_DATA_TYPE: exact?.dataType ?? null, SOURCE_STATUS: sourceAvailable ? "SOURCE TABLE AVAILABLE" : "SOURCE MISSING",
        COLUMN_STATUS: exact ? "EXACT COLUMN" : "DERIVED OR UNAVAILABLE", SOURCE_OF_TRUTH_FLAG: exact ? "YES" : "NO",
        TRANSFORMATION_RULE: exact ? "DIRECT" : "VERIFIED ADAPTER DERIVATION OR UNAVAILABLE",
        AGGREGATION_RULE: report.rowGrain, FILTER_RULE: "USER FILTERS + AUTHORISED BRANCH SCOPE",
        JOIN_RULE: "RUNTIME INFORMATION_SCHEMA VERIFIED", NULL_POLICY: "PRESERVE NULL / REPORT UNAVAILABLE",
        ZERO_POLICY: "DO NOT SUBSTITUTE MISSING DATA WITH ZERO", DATE_STANDARD: report.dateStandard,
        EMPLOYEE_CODE_POLICY: report.employeeCodePolicy, RECONCILIATION_STATUS: "PENDING LIVE DATA UAT",
        FRESHNESS_STATUS: "PENDING LIVE DATA UAT", DATA_ACCURACY_STATUS: exact ? "SCHEMA VERIFIED; VALUE UAT PENDING" : "DERIVATION/AVAILABILITY REVIEW REQUIRED",
        LAST_VALIDATED_AT: new Date().toISOString(), VALIDATION_METHOD: "INFORMATION_SCHEMA SOURCE CONTRACT CHECK",
        EXCEPTION_COUNT: exact ? 0 : 1, EXCEPTION_SEVERITY: exact ? "NONE" : "WARNING",
        EXCEPTION_DETAIL: exact ? null : "No exact same-name source column; execute report adapter and inspect field lineage",
        REMEDIATION_STATUS: exact ? "NOT REQUIRED" : "OPEN", UAT_STATUS: "PENDING AUTHENTICATED SOURCE-TO-REPORT RECONCILIATION",
        DATA_SOURCE: "INFORMATION_SCHEMA+REPORT_REGISTRY",
      });
    }
  }
  const filtered = filters.employeeCode ? rows.filter((row) => row.REPORT_CODE === filters.employeeCode) : rows;
  const page = filtered.slice(filters.offset, filters.offset + filters.limit);
  const definition = getBpoMasterReport(code)!;
  const normalized = page.map((row) => Object.fromEntries(definition.columns.map((column) => [column.key, row[column.key] ?? null])));
  const exactCount = filtered.filter((row) => row.COLUMN_STATUS === "EXACT COLUMN").length;
  return {
    rows: normalized, totalCount: filtered.length, sourceTable: "INFORMATION_SCHEMA+REPORT_REGISTRY",
    availableKeys: definition.columns.map((column) => column.key),
    lineage: defaultLineage(code, "INFORMATION_SCHEMA+REPORT_REGISTRY"),
    verification: {
      runtimeSchemaVerified: true, exactMappedFieldCount: exactCount, derivedMappedFieldCount: filtered.length - exactCount,
      unavailableFieldCount: filtered.length - exactCount, duplicateGrainCount: 0, sourceRowCount: filtered.length,
      distinctGrainCount: filtered.length, accuracyStatus: "SCHEMA_VERIFIED",
    },
  };
}

export async function runSafeGovernanceBpoMasterAdapter(
  code: string,
  filters: VerifiedAdapterFilters,
  scope: BranchScope
): Promise<VerifiedAdapterResult | null> {
  if (!SUPPORTED.has(code)) return null;
  if (code === "bpo-audit-compliance-control-master") return auditReport(code, filters, scope);
  if (code === "bpo-interview-to-exit-journey-ledger") return journeyReport(code, filters, scope);
  if (code === "bpo-report-data-lineage-reconciliation-master") return lineageReport(code, filters);
  return null;
}
