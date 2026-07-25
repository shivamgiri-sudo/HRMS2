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
  sourceTableSql,
  type SourceColumn,
} from "./bpo-master-source-registry.js";

const SUPPORTED = new Set([
  "bpo-quality-risk-compliance-master",
  "bpo-recruitment-training-readiness-master",
  "bpo-admin-asset-facility-master",
]);

function has(columns: Map<string, SourceColumn>, column: string) {
  return columns.has(column.toLowerCase());
}

function first(columns: Map<string, SourceColumn>, candidates: string[]) {
  for (const candidate of candidates) {
    const column = columns.get(candidate.toLowerCase());
    if (column) return column.column;
  }
  return null;
}

function fmtDate(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(${expression},'%d-%b-%Y')) END`;
}

function fmtTimeStamp(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE DATE_FORMAT(${expression},'%d-%b-%Y %H:%i:%s') END`;
}

async function employeeOrganisation(alias: string) {
  const employeeSql = await sourceTableSql("employees");
  const employeeColumns = await sourceColumns("employees");
  if (!employeeSql || !has(employeeColumns, "id") || !has(employeeColumns, "employee_code")) return null;
  const fields = new Map<string, FieldSpec>();
  const joins: string[] = [];
  addField(fields, "EMPLOYEE_CODE", directField(alias, "employees", employeeColumns, ["employee_code"]));
  const fullName = first(employeeColumns, ["full_name"]);
  if (fullName) {
    addField(fields, "EMPLOYEE_NAME", directField(alias, "employees", employeeColumns, [fullName]));
  } else if (has(employeeColumns, "first_name")) {
    addField(fields, "EMPLOYEE_NAME", derivedField(
      "mas_hrms", "employees", "first_name,last_name",
      `TRIM(CONCAT(COALESCE(${alias}.${quote("first_name")},''),' ',COALESCE(${has(employeeColumns,"last_name") ? `${alias}.${quote("last_name")}` : "NULL"},'')))`,
      "CONCAT FIRST AND LAST NAME"
    ));
  }
  addField(fields, "EMPLOYMENT_STATUS", directField(alias, "employees", employeeColumns, ["employment_status"]));
  const doj = first(employeeColumns, ["date_of_joining"]);
  if (doj) addField(fields, "DATE_OF_JOINING", derivedField("mas_hrms", "employees", doj, fmtDate(`${alias}.${quote(doj)}`), "FORMAT JOINING DATE"));
  const doe = first(employeeColumns, ["date_of_exit", "date_of_leaving"]);
  if (doe) addField(fields, "DATE_OF_EXIT", derivedField("mas_hrms", "employees", doe, fmtDate(`${alias}.${quote(doe)}`), "FORMAT EXIT DATE"));
  if (doj) addField(fields, "TENURE_DAYS", derivedField("mas_hrms", "employees", `${doj},${doe ?? ""}`, `DATEDIFF(COALESCE(${doe ? `${alias}.${quote(doe)}` : "NULL"},CURRENT_DATE()),${alias}.${quote(doj)})`, "EXIT/AS-OF MINUS JOINING"));
  addField(fields, "EMPLOYMENT_TYPE", directField(alias, "employees", employeeColumns, ["employment_type"]));
  addField(fields, "SHIFT_ROTATION_TYPE", directField(alias, "employees", employeeColumns, ["shift_rotation_type"]));
  const branch = has(employeeColumns, "branch_id") ? `${alias}.${quote("branch_id")}` : null;
  const process = has(employeeColumns, "process_id") ? `${alias}.${quote("process_id")}` : null;
  const employeeCode = `${alias}.${quote("employee_code")}`;

  const org: Array<{ table: string; alias: string; fk: string; key: string; candidates: string[] }> = [
    { table: "branch_master", alias: "b", fk: "branch_id", key: "BRANCH", candidates: ["branch_name", "name"] },
    { table: "department_master", alias: "d", fk: "department_id", key: "DEPARTMENT", candidates: ["dept_name", "department_name", "name"] },
    { table: "designation_master", alias: "des", fk: "designation_id", key: "DESIGNATION", candidates: ["designation_name", "name"] },
    { table: "process_master", alias: "p", fk: "process_id", key: "PROCESS", candidates: ["process_name", "name"] },
    { table: "cost_centre_master", alias: "cc", fk: "cost_centre_id", key: "COST_CENTRE", candidates: ["cost_centre_name", "cost_center_name"] },
    { table: "lob_master", alias: "lob", fk: "lob_id", key: "LOB", candidates: ["lob_name", "name"] },
  ];
  for (const item of org) {
    if (!has(employeeColumns, item.fk)) continue;
    const tableSql = await sourceTableSql(item.table);
    const columns = await sourceColumns(item.table);
    if (!tableSql || !has(columns, "id")) continue;
    joins.push(`LEFT JOIN ${tableSql} ${item.alias} ON ${item.alias}.${quote("id")}=${alias}.${quote(item.fk)}`);
    addField(fields, item.key, directField(item.alias, item.table, columns, item.candidates));
    if (item.table === "process_master") addField(fields, "CLIENT", directField(item.alias, item.table, columns, ["client_name"]));
  }
  const manager = first(employeeColumns, ["reporting_manager_id", "manager_id"]);
  if (manager) {
    joins.push(`LEFT JOIN ${employeeSql} mgr ON mgr.${quote("id")}=${alias}.${quote(manager)}`);
    addField(fields, "REPORTING_MANAGER_CODE", directField("mgr", "employees", employeeColumns, ["employee_code"]));
    if (fullName) addField(fields, "REPORTING_MANAGER_NAME", directField("mgr", "employees", employeeColumns, [fullName]));
  }
  return { employeeSql, employeeColumns, fields, joins, branch, process, employeeCode };
}

async function quality(code: string, filters: VerifiedAdapterFilters, scope: BranchScope): Promise<VerifiedAdapterResult | null> {
  const sourceRef = "db_audit.call_quality_assessment";
  const qualitySql = await sourceTableSql(sourceRef);
  const qualityColumns = await sourceColumns(sourceRef);
  const employee = await employeeOrganisation("e");
  const userColumn = first(qualityColumns, ["User", "user", "employee_code", "agent_code"]);
  const idColumn = first(qualityColumns, ["id", "audit_id"]);
  const dateColumn = first(qualityColumns, ["CallDate", "call_date", "audit_date", "created_at"]);
  const scoreColumn = first(qualityColumns, ["quality_percentage", "quality_score"]);
  if (!qualitySql || !employee || !userColumn || !idColumn || !dateColumn || !scoreColumn) return null;

  const fields = new Map(employee.fields);
  const joins = [...employee.joins];
  fields.set("EMPLOYEE_CODE", derivedField("db_audit", "call_quality_assessment", userColumn, `cqa.${quote(userColumn)}`, "QUALITY USER MAPPED TO EMPLOYEE CODE"));
  addField(fields, "REPORT_DATE", derivedField("db_audit", "call_quality_assessment", dateColumn, fmtDate(`cqa.${quote(dateColumn)}`), "AUDIT DATE"));
  addField(fields, "AUDIT_ID", directField("cqa", sourceRef, qualityColumns, [idColumn]));
  addField(fields, "AUDIT_DATE", derivedField("db_audit", "call_quality_assessment", dateColumn, fmtDate(`cqa.${quote(dateColumn)}`), "AUDIT DATE"));
  addField(fields, "TRANSACTION_ID", directField("cqa", sourceRef, qualityColumns, ["lead_id", "transaction_id", "call_id"]));
  addField(fields, "CASE_ID", directField("cqa", sourceRef, qualityColumns, ["case_id", "lead_id", idColumn]));
  addField(fields, "QUEUE", directField("cqa", sourceRef, qualityColumns, ["Campaign", "campaign", "queue"]));
  addField(fields, "WORK_TYPE", directField("cqa", sourceRef, qualityColumns, ["scenario", "work_type"]));
  addField(fields, "AUDIT_TYPE", constantField("'CALL QUALITY AUDIT'", "AUTHORITATIVE QUALITY SOURCE TYPE"));
  addField(fields, "AUDIT_SAMPLE_TYPE", directField("cqa", sourceRef, qualityColumns, ["sample_type", "audit_sample_type"]));
  addField(fields, "AUDITOR_CODE", directField("cqa", sourceRef, qualityColumns, ["auditor_code", "auditor_id", "qa_code"]));
  addField(fields, "AUDITOR_NAME", directField("cqa", sourceRef, qualityColumns, ["auditor_name", "qa_name"]));
  addField(fields, "AUDIT_FORM_VERSION", directField("cqa", sourceRef, qualityColumns, ["form_version", "audit_form_version"]));
  addField(fields, "QUALITY_SCORE_PERCENTAGE", directField("cqa", sourceRef, qualityColumns, [scoreColumn]));
  addField(fields, "QUALITY_TARGET_PERCENTAGE", constantField("90", "CURRENT QUALITY DASHBOARD TARGET"));
  addField(fields, "QUALITY_VARIANCE_PERCENTAGE", derivedField("db_audit", "call_quality_assessment", scoreColumn, `cqa.${quote(scoreColumn)}-90`, "QUALITY SCORE MINUS TARGET"));

  const checkpointCandidates = [
    "call_answered_within_5_seconds", "professionalism_maintained", "active_listening",
    "enthusiasm_and_no_fumbling", "proper_hold_procedure", "dead_air_under_10_seconds",
    "accurate_issue_probing", "proper_grammar", "proper_call_closure", "further_assistance_offered",
  ].filter((column) => has(qualityColumns, column));
  if (checkpointCandidates.length) {
    const total = checkpointCandidates.length;
    const passed = checkpointCandidates.map((column) => `COALESCE(cqa.${quote(column)},0)`).join("+");
    addField(fields, "TOTAL_CHECKPOINTS", constantField(String(total), "COUNT VERIFIED BOOLEAN QUALITY CHECKPOINT COLUMNS"));
    addField(fields, "PASSED_CHECKPOINTS", derivedField("db_audit", "call_quality_assessment", checkpointCandidates.join(","), `(${passed})`, "SUM BOOLEAN CHECKPOINTS"));
    addField(fields, "FAILED_CHECKPOINTS", derivedField("db_audit", "call_quality_assessment", checkpointCandidates.join(","), `${total}-(${passed})`, "TOTAL MINUS PASSED"));
  }

  const professionalism = first(qualityColumns, ["professionalism_maintained"]);
  const listening = first(qualityColumns, ["active_listening"]);
  if (professionalism && listening) {
    const fatal = `CASE WHEN cqa.${quote(scoreColumn)}<50 AND (COALESCE(cqa.${quote(professionalism)},0)=0 OR COALESCE(cqa.${quote(listening)},0)=0) THEN 1 ELSE 0 END`;
    addField(fields, "FATAL_ERROR_FLAG", derivedField("db_audit", "call_quality_assessment", `${scoreColumn},${professionalism},${listening}`, fatal, "CQ<50 AND PROFESSIONALISM/ACTIVE LISTENING FAILURE"));
    addField(fields, "FATAL_ERROR_TYPE", derivedField("db_audit", "call_quality_assessment", `${professionalism},${listening}`, `CASE WHEN ${fatal}=1 THEN CONCAT_WS(' + ',CASE WHEN COALESCE(cqa.${quote(professionalism)},0)=0 THEN 'PROFESSIONALISM' END,CASE WHEN COALESCE(cqa.${quote(listening)},0)=0 THEN 'ACTIVE LISTENING' END) END`, "IDENTIFY FATAL FAILED DIMENSION"));
    addField(fields, "ERROR_SEVERITY", derivedField("db_audit", "call_quality_assessment", `${scoreColumn},${professionalism},${listening}`, `CASE WHEN ${fatal}=1 THEN 'FATAL' WHEN cqa.${quote(scoreColumn)}<70 THEN 'MAJOR' WHEN cqa.${quote(scoreColumn)}<90 THEN 'MINOR' ELSE 'NONE' END`, "QUALITY SCORE/FATAL SEVERITY"));
    addField(fields, "QUALITY_RAG", derivedField("db_audit", "call_quality_assessment", scoreColumn, `CASE WHEN ${fatal}=1 OR cqa.${quote(scoreColumn)}<70 THEN 'RED' WHEN cqa.${quote(scoreColumn)}<90 THEN 'AMBER' ELSE 'GREEN' END`, "FATAL AND QUALITY TARGET BANDS"));
  }
  addField(fields, "ERROR_CATEGORY", directField("cqa", sourceRef, qualityColumns, ["error_category", "scenario"]));
  addField(fields, "ERROR_SUBCATEGORY", directField("cqa", sourceRef, qualityColumns, ["error_subcategory"]));
  addField(fields, "ERROR_FIELD", directField("cqa", sourceRef, qualityColumns, ["error_field"]));
  addField(fields, "ERROR_DESCRIPTION", directField("cqa", sourceRef, qualityColumns, ["feedback", "fatal_reason", "remarks"]));
  addField(fields, "CUSTOMER_IMPACT_FLAG", directField("cqa", sourceRef, qualityColumns, ["customer_impact_flag"]));
  addField(fields, "COMPLIANCE_BREACH_FLAG", directField("cqa", sourceRef, qualityColumns, ["compliance_breach_flag"]));
  addField(fields, "DATA_PRIVACY_BREACH_FLAG", directField("cqa", sourceRef, qualityColumns, ["data_privacy_breach_flag"]));
  addField(fields, "FINANCIAL_IMPACT_AMOUNT", directField("cqa", sourceRef, qualityColumns, ["financial_impact_amount"]));
  addField(fields, "REWORK_REQUIRED_FLAG", directField("cqa", sourceRef, qualityColumns, ["rework_required", "rework_flag"]));
  addField(fields, "ROOT_CAUSE_CATEGORY", directField("cqa", sourceRef, qualityColumns, ["root_cause_category"]));
  addField(fields, "ROOT_CAUSE_DETAIL", directField("cqa", sourceRef, qualityColumns, ["root_cause_detail"]));
  addField(fields, "CORRECTIVE_ACTION", directField("cqa", sourceRef, qualityColumns, ["corrective_action"]));
  addField(fields, "PREVENTIVE_ACTION", directField("cqa", sourceRef, qualityColumns, ["preventive_action"]));
  addField(fields, "ACTION_OWNER", directField("cqa", sourceRef, qualityColumns, ["action_owner"]));
  const actionDue = first(qualityColumns, ["action_due_date"]);
  if (actionDue) addField(fields, "ACTION_DUE_DATE", derivedField("db_audit", "call_quality_assessment", actionDue, fmtDate(`cqa.${quote(actionDue)}`), "FORMAT ACTION DUE DATE"));
  addField(fields, "ACTION_STATUS", directField("cqa", sourceRef, qualityColumns, ["action_status"]));
  addField(fields, "AUDIT_EVIDENCE_STATUS", directField("cqa", sourceRef, qualityColumns, ["evidence_status", "recording_url"]));
  addField(fields, "DATA_SOURCE", constantField("'DB_AUDIT.CALL_QUALITY_ASSESSMENT'", "AUTHORITATIVE QUALITY SOURCE"));

  const scoped = branchScopeWhere(scope, filters, {
    branch: employee.branch,
    process: employee.process,
    employeeCode: `cqa.${quote(userColumn)}`,
  });
  const bounds = dateBounds(filters);
  return executeVerifiedReport({
    code,
    sourceTable: "DB_AUDIT.CALL_QUALITY_ASSESSMENT",
    fields,
    fromSql: `${qualitySql} cqa LEFT JOIN ${employee.employeeSql} e ON UPPER(TRIM(e.${quote("employee_code")}))=UPPER(TRIM(cqa.${quote(userColumn)}))`,
    joins,
    where: [`DATE(cqa.${quote(dateColumn)}) BETWEEN ? AND ?`, ...scoped.clauses],
    params: [bounds.from, bounds.to, ...scoped.params],
    orderBy: `${quote("AUDIT_DATE")} DESC,${quote("AUDIT_ID")}`,
    grainKeys: ["EMPLOYEE_CODE", "AUDIT_ID"],
    filters,
  });
}

async function recruitment(code: string, filters: VerifiedAdapterFilters, scope: BranchScope): Promise<VerifiedAdapterResult | null> {
  const candidateSql = await sourceTableSql("ats_candidate");
  const candidateColumns = await sourceColumns("ats_candidate");
  const id = first(candidateColumns, ["id"]);
  const created = first(candidateColumns, ["created_at", "walk_in_date"]);
  if (!candidateSql || !id || !created) return null;
  const fields = new Map<string, FieldSpec>();
  const joins: string[] = [];
  const params: unknown[] = [];
  addField(fields, "REPORT_DATE", derivedField("mas_hrms", "ats_candidate", created, fmtDate(`c.${quote(created)}`), "CANDIDATE APPLICATION/CREATION DATE"));
  addField(fields, "CANDIDATE_ID", directField("c", "ats_candidate", candidateColumns, ["id", "candidate_code"]));
  addField(fields, "CANDIDATE_NAME", directField("c", "ats_candidate", candidateColumns, ["full_name"]));
  addField(fields, "MOBILE_NUMBER", directField("c", "ats_candidate", candidateColumns, ["mobile"]));
  addField(fields, "EMAIL_ADDRESS", directField("c", "ats_candidate", candidateColumns, ["email"]));
  addField(fields, "BRANCH", directField("c", "ats_candidate", candidateColumns, ["applied_for_branch"]));
  addField(fields, "PROCESS", directField("c", "ats_candidate", candidateColumns, ["applied_for_process"]));
  addField(fields, "SOURCE_CHANNEL", directField("c", "ats_candidate", candidateColumns, ["sourcing_channel"]));
  addField(fields, "SOURCE_PARTNER", directField("c", "ats_candidate", candidateColumns, ["source_partner"]));
  addField(fields, "REFERRER_EMPLOYEE_CODE", directField("c", "ats_candidate", candidateColumns, ["referred_by"]));
  addField(fields, "APPLICATION_DATE", derivedField("mas_hrms", "ats_candidate", created, fmtDate(`c.${quote(created)}`), "CANDIDATE CREATION/APPLICATION DATE"));
  addField(fields, "CURRENT_STAGE", directField("c", "ats_candidate", candidateColumns, ["current_stage"]));

  const bridgeSql = await sourceTableSql("ats_onboarding_bridge");
  const bridgeColumns = await sourceColumns("ats_onboarding_bridge");
  const employeeSql = await sourceTableSql("employees");
  const employeeColumns = await sourceColumns("employees");
  if (bridgeSql && has(bridgeColumns, "candidate_id")) {
    joins.push(`LEFT JOIN ${bridgeSql} bridge ON bridge.${quote("candidate_id")}=c.${quote(id)}`);
    const bridgeDate = first(bridgeColumns, ["bridge_date", "joining_date", "created_at"]);
    if (bridgeDate) addField(fields, "EMPLOYEE_CODE_CREATED_FLAG", derivedField("mas_hrms", "ats_onboarding_bridge", bridgeDate, `CASE WHEN bridge.${quote(first(bridgeColumns,["employee_id"]) ?? "employee_id")} IS NOT NULL THEN 'YES' ELSE 'NO' END`, "EMPLOYEE BRIDGE PRESENCE"));
    if (employeeSql && has(bridgeColumns, "employee_id") && has(employeeColumns, "id") && has(employeeColumns, "employee_code")) {
      joins.push(`LEFT JOIN ${employeeSql} e ON e.${quote("id")}=bridge.${quote("employee_id")}`);
      addField(fields, "EMPLOYEE_CODE", derivedField("mas_hrms", "employees", "employee_code", `COALESCE(e.${quote("employee_code")},'PENDING EMPLOYEE CODE')`, "BRIDGED EMPLOYEE CODE OR PENDING"));
      addField(fields, "ACTUAL_JOINING_DATE", has(employeeColumns,"date_of_joining") ? derivedField("mas_hrms", "employees", "date_of_joining", fmtDate(`e.${quote("date_of_joining")}`), "ACTUAL EMPLOYEE JOINING DATE") : null);
      addField(fields, "EARLY_ATTRITION_FLAG", has(employeeColumns,"date_of_joining") && first(employeeColumns,["date_of_exit","date_of_leaving"])
        ? derivedField("mas_hrms", "employees", "date_of_joining,date_of_exit", `CASE WHEN DATEDIFF(e.${quote(first(employeeColumns,["date_of_exit","date_of_leaving"])!)},e.${quote("date_of_joining")})<=90 THEN 'YES' ELSE 'NO' END`, "EXIT WITHIN 90 DAYS") : null);
    }
  }
  if (!fields.has("EMPLOYEE_CODE")) addField(fields, "EMPLOYEE_CODE", constantField("'PENDING EMPLOYEE CODE'", "NO EMPLOYEE BRIDGE SOURCE"));

  const stageSql = await sourceTableSql("ats_candidate_stage_log");
  const stageColumns = await sourceColumns("ats_candidate_stage_log");
  if (stageSql && has(stageColumns, "candidate_id") && has(stageColumns, "to_stage") && has(stageColumns, "stage_date")) {
    joins.push(`LEFT JOIN (
      SELECT ${quote("candidate_id")} candidate_id,
        MAX(${quote("stage_date")}) latest_stage_date,
        SUBSTRING_INDEX(GROUP_CONCAT(${quote("to_stage")} ORDER BY ${quote("stage_date")} DESC SEPARATOR '¦'),'¦',1) latest_stage,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%screen%' THEN ${quote("stage_date")} END) screening_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%hr%' THEN ${quote("stage_date")} END) hr_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%skill%' THEN ${quote("stage_date")} END) skill_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%ops%' THEN ${quote("stage_date")} END) ops_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%client%' THEN ${quote("stage_date")} END) client_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) IN ('selected','selection','final_selected') THEN ${quote("stage_date")} END) selected_date
      FROM ${stageSql} GROUP BY ${quote("candidate_id")}
    ) st ON st.candidate_id=c.${quote(id)}`);
    addField(fields, "STAGE_ENTRY_DATE", derivedField("mas_hrms", "ats_candidate_stage_log", "stage_date", fmtDate("st.latest_stage_date"), "LATEST STAGE DATE"));
    addField(fields, "STAGE_AGEING_DAYS", derivedField("mas_hrms", "ats_candidate_stage_log", "stage_date", "DATEDIFF(CURRENT_DATE(),DATE(st.latest_stage_date))", "CURRENT DATE - LATEST STAGE DATE"));
    addField(fields, "SCREENING_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN st.screening_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "SCREEN STAGE EVENT PRESENCE"));
    addField(fields, "HR_ROUND_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN st.hr_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "HR STAGE EVENT PRESENCE"));
    addField(fields, "SKILL_TEST_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN st.skill_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "SKILL STAGE EVENT PRESENCE"));
    addField(fields, "OPS_ROUND_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN st.ops_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "OPS STAGE EVENT PRESENCE"));
    addField(fields, "CLIENT_ROUND_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN st.client_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "CLIENT STAGE EVENT PRESENCE"));
    addField(fields, "FINAL_SELECTION_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN st.selected_date IS NULL THEN 'NOT SELECTED/NOT RECORDED' ELSE 'SELECTED' END", "SELECTION STAGE EVENT PRESENCE"));
  }

  const offerSql = await sourceTableSql("ats_offer_letters");
  const offerColumns = await sourceColumns("ats_offer_letters");
  if (offerSql && has(offerColumns, "candidate_id") && has(offerColumns, "created_at")) {
    joins.push(`LEFT JOIN (SELECT o.* FROM ${offerSql} o JOIN (SELECT ${quote("candidate_id")} candidate_id,MAX(${quote("created_at")}) max_created FROM ${offerSql} GROUP BY ${quote("candidate_id")}) x ON x.candidate_id=o.${quote("candidate_id")} AND x.max_created=o.${quote("created_at")}) offe ON offe.${quote("candidate_id")}=c.${quote(id)}`);
    addField(fields, "OFFER_STATUS", directField("offe", "ats_offer_letters", offerColumns, ["status"]));
    const offerDate = first(offerColumns, ["offer_date", "sent_at", "created_at"]);
    if (offerDate) addField(fields, "OFFER_DATE", derivedField("mas_hrms", "ats_offer_letters", offerDate, fmtDate(`offe.${quote(offerDate)}`), "LATEST OFFER DATE"));
    addField(fields, "OFFERED_CTC", directField("offe", "ats_offer_letters", offerColumns, ["salary_ctc"]));
    const joining = first(offerColumns, ["joining_date"]);
    if (joining) addField(fields, "EXPECTED_JOINING_DATE", derivedField("mas_hrms", "ats_offer_letters", joining, fmtDate(`offe.${quote(joining)}`), "OFFER JOINING DATE"));
  }

  const bgvSql = await sourceTableSql("candidate_bgv_check");
  const bgvColumns = await sourceColumns("candidate_bgv_check");
  if (bgvSql && has(bgvColumns, "candidate_id") && has(bgvColumns, "status")) {
    joins.push(`LEFT JOIN (SELECT ${quote("candidate_id")} candidate_id,COUNT(*) checks,SUM(${quote("status")}='verified') verified,SUM(${quote("status")} IN ('mismatch','failed','manual_review')) risks FROM ${bgvSql} GROUP BY ${quote("candidate_id")}) bgv ON bgv.candidate_id=c.${quote(id)}`);
    addField(fields, "BGV_STATUS", derivedField("mas_hrms", "candidate_bgv_check", "status", "CASE WHEN bgv.checks IS NULL THEN 'NOT STARTED' WHEN bgv.risks>0 THEN 'REVIEW REQUIRED' WHEN bgv.verified=bgv.checks THEN 'VERIFIED' ELSE 'IN PROGRESS' END", "AGGREGATE BGV CHECK STATUS"));
  }

  const lmsSql = await sourceTableSql("lms_learning_progress_snapshot");
  const lmsColumns = await sourceColumns("lms_learning_progress_snapshot");
  if (lmsSql && fields.has("EMPLOYEE_CODE") && has(lmsColumns, "employee_id") && employeeSql) {
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,MIN(${quote(first(lmsColumns,["synced_at","last_accessed"]) ?? "synced_at")}) training_start,MAX(${quote(first(lmsColumns,["synced_at","last_accessed"]) ?? "synced_at")}) training_end,AVG(${has(lmsColumns,"score") ? quote("score") : "NULL"}) avg_score,AVG(${has(lmsColumns,"completion_pct") ? quote("completion_pct") : "NULL"}) completion_pct,CASE WHEN SUM(${has(lmsColumns,"status") ? `${quote("status")}='failed'` : "0"})>0 THEN 'FAILED' WHEN AVG(${has(lmsColumns,"completion_pct") ? quote("completion_pct") : "NULL"})=100 THEN 'COMPLETED' ELSE 'IN PROGRESS' END training_status FROM ${lmsSql} GROUP BY ${quote("employee_id")}) lms ON lms.employee_id=e.${quote("id")}`);
    addField(fields, "TRAINING_START_DATE", derivedField("mas_hrms", "lms_learning_progress_snapshot", "synced_at/last_accessed", fmtDate("lms.training_start"), "EARLIEST LMS ACTIVITY"));
    addField(fields, "TRAINING_END_DATE", derivedField("mas_hrms", "lms_learning_progress_snapshot", "synced_at/last_accessed", fmtDate("lms.training_end"), "LATEST LMS ACTIVITY"));
    addField(fields, "ASSESSMENT_SCORE_PERCENTAGE", derivedField("mas_hrms", "lms_learning_progress_snapshot", "score", "lms.avg_score", "AVERAGE LMS SCORE"));
    addField(fields, "ONBOARDING_COMPLETION_PERCENTAGE", derivedField("mas_hrms", "lms_learning_progress_snapshot", "completion_pct", "lms.completion_pct", "AVERAGE LMS COMPLETION"));
    addField(fields, "READINESS_STATUS", derivedField("mas_hrms", "lms_learning_progress_snapshot", "status,completion_pct", "lms.training_status", "LMS COMPLETION/FAILURE STATUS"));
  }
  addField(fields, "DATA_SOURCE", constantField("'ATS_CANDIDATE+STAGE_LOG+OFFER+ONBOARDING_BRIDGE+BGV+LMS'", "EXPLICIT GOVERNED SOURCE SET"));

  const bounds = dateBounds(filters);
  const where = [`DATE(c.${quote(created)}) BETWEEN ? AND ?`];
  const whereParams: unknown[] = [bounds.from, bounds.to];
  if (filters.employeeCode && employeeSql) {
    where.push(`e.${quote("employee_code") }=?`);
    whereParams.push(filters.employeeCode);
  }
  if (filters.processId && has(candidateColumns, "process_id")) {
    where.push(`c.${quote("process_id")}=?`);
    whereParams.push(filters.processId);
  }
  if (!scope.isSuperAdmin && scope.branchIds.includes("__NO_BRANCH_SCOPE__")) where.push("1=0");
  return executeVerifiedReport({
    code,
    sourceTable: "ATS_CANDIDATE+STAGE+OFFER+BGV+LMS",
    fields,
    fromSql: `${candidateSql} c`,
    joins,
    where,
    params: [...params, ...whereParams],
    orderBy: `${quote("APPLICATION_DATE")} DESC,${quote("CANDIDATE_ID")}`,
    grainKeys: ["CANDIDATE_ID", "REQUISITION_ID"],
    filters,
  });
}

async function adminAsset(code: string, filters: VerifiedAdapterFilters, scope: BranchScope): Promise<VerifiedAdapterResult | null> {
  const assignmentSql = await sourceTableSql("asset_assignment");
  const assignmentColumns = await sourceColumns("asset_assignment");
  const assetSql = await sourceTableSql("asset_master");
  const assetColumns = await sourceColumns("asset_master");
  const employee = await employeeOrganisation("e");
  if (!assignmentSql || !assetSql || !employee || !has(assignmentColumns, "employee_id") || !has(assignmentColumns, "asset_id") || !has(assetColumns, "id")) return null;
  const fields = new Map(employee.fields);
  const joins = [...employee.joins];
  const asOf = filters.to ?? new Date().toISOString().slice(0, 10);
  addField(fields, "REPORT_DATE", constantField(fmtDate(`'${asOf}'`), "AS-OF DATE"));
  addField(fields, "ITEM_TYPE", constantField("'ASSET'", "ASSET ASSIGNMENT GRAIN"));
  addField(fields, "ITEM_ID", directField("aa", "asset_assignment", assignmentColumns, ["id"]));
  addField(fields, "ASSET_CATEGORY", directField("am", "asset_master", assetColumns, ["asset_category"]));
  addField(fields, "ASSET_TAG", directField("am", "asset_master", assetColumns, ["asset_code"]));
  addField(fields, "SERIAL_NUMBER", directField("am", "asset_master", assetColumns, ["serial_number"]));
  addField(fields, "MAKE_MODEL", directField("am", "asset_master", assetColumns, ["asset_name", "asset_type"]));
  addField(fields, "ASSET_STATUS", directField("am", "asset_master", assetColumns, ["status"]));
  const assigned = first(assignmentColumns, ["assigned_date"]);
  if (assigned) addField(fields, "ASSIGNMENT_DATE", derivedField("mas_hrms", "asset_assignment", assigned, fmtDate(`aa.${quote(assigned)}`), "ASSIGNMENT DATE"));
  const returned = first(assignmentColumns, ["returned_date"]);
  if (returned) addField(fields, "ACTUAL_RETURN_DATE", derivedField("mas_hrms", "asset_assignment", returned, fmtDate(`aa.${quote(returned)}`), "RETURN DATE"));
  addField(fields, "CUSTODY_STATUS", returned
    ? derivedField("mas_hrms", "asset_assignment", returned, `CASE WHEN aa.${quote(returned)} IS NULL THEN 'IN CUSTODY' ELSE 'RETURNED' END`, "RETURN DATE PRESENCE")
    : constantField("'IN CUSTODY'", "NO RETURN DATE COLUMN"));
  addField(fields, "RETURN_CONDITION", directField("aa", "asset_assignment", assignmentColumns, ["return_condition"]));
  const warranty = first(assetColumns, ["warranty_expiry"]);
  if (warranty) addField(fields, "WARRANTY_EXPIRY_DATE", derivedField("mas_hrms", "asset_master", warranty, fmtDate(`am.${quote(warranty)}`), "WARRANTY EXPIRY"));
  addField(fields, "VENDOR_NAME", directField("am", "asset_master", assetColumns, ["vendor"]));

  const helpdeskSql = await sourceTableSql("helpdesk_ticket");
  const helpdeskColumns = await sourceColumns("helpdesk_ticket");
  if (helpdeskSql && has(helpdeskColumns, "employee_id")) {
    const created = first(helpdeskColumns, ["created_at"]);
    const status = first(helpdeskColumns, ["status"]);
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(CASE WHEN ${status ? `LOWER(${quote(status)}) NOT IN ('resolved','closed','cancelled')` : "1=1"} THEN 1 END) open_count,COUNT(CASE WHEN ${has(helpdeskColumns,"sla_due_at") && status ? `${quote("sla_due_at")}<NOW() AND LOWER(${quote(status)}) NOT IN ('resolved','closed','cancelled')` : "FALSE"} THEN 1 END) overdue_count,${created ? `MAX(${quote(created)})` : "NULL"} last_ticket FROM ${helpdeskSql} GROUP BY ${quote("employee_id")}) hd ON hd.employee_id=e.${quote("id")}`);
    addField(fields, "HELPDESK_OPEN_TICKET_COUNT", derivedField("mas_hrms", "helpdesk_ticket", "status", "hd.open_count", "COUNT OPEN TICKETS"));
    addField(fields, "HELPDESK_OVERDUE_TICKET_COUNT", derivedField("mas_hrms", "helpdesk_ticket", "sla_due_at,status", "hd.overdue_count", "OPEN AND PAST SLA"));
    addField(fields, "LAST_HELPDESK_TICKET_DATE", derivedField("mas_hrms", "helpdesk_ticket", created, fmtDate("hd.last_ticket"), "LATEST TICKET DATE"));
  }

  const provisioningSql = await sourceTableSql("it_provisioning_request");
  const provisioningColumns = await sourceColumns("it_provisioning_request");
  if (provisioningSql && has(provisioningColumns, "employee_id")) {
    joins.push(`LEFT JOIN (SELECT ${quote("employee_id")} employee_id,COUNT(*) tasks, SUM(${has(provisioningColumns,"status") ? `${quote("status")} IN ('actioned','confirmed','waived')` : "0"}) completed,MAX(${has(provisioningColumns,"actioned_at") ? quote("actioned_at") : quote("requested_at")}) last_action FROM ${provisioningSql} GROUP BY ${quote("employee_id")}) itp ON itp.employee_id=e.${quote("id")}`);
    addField(fields, "IT_PROVISIONING_STATUS", derivedField("mas_hrms", "it_provisioning_request", "status", "CASE WHEN itp.tasks IS NULL THEN 'NOT REQUESTED' WHEN itp.tasks=itp.completed THEN 'COMPLETED' ELSE 'PENDING' END", "ALL PROVISIONING TASKS COMPLETED"));
    addField(fields, "APPLICATION_ACCESS_STATUS", derivedField("mas_hrms", "it_provisioning_request", "status", "CASE WHEN itp.completed>0 THEN 'PROVISIONED' ELSE 'PENDING' END", "PROVISIONING COMPLETION"));
  }
  const authSql = await sourceTableSql("auth_user");
  const authColumns = await sourceColumns("auth_user");
  if (authSql && has(employee.employeeColumns, "user_id") && has(authColumns, "id")) {
    joins.push(`LEFT JOIN ${authSql} au ON au.${quote("id")}=e.${quote("user_id")}`);
    addField(fields, "SYSTEM_USER_ID", directField("au", "auth_user", authColumns, ["id"]));
    addField(fields, "OFFICIAL_EMAIL_CREATED_FLAG", has(authColumns,"email") ? derivedField("mas_hrms", "auth_user", "email", "CASE WHEN au.email IS NULL OR au.email='' THEN 'NO' ELSE 'YES' END", "AUTH EMAIL PRESENCE") : null);
    addField(fields, "APPLICATION_ACCESS_STATUS", has(authColumns,"is_blocked") ? derivedField("mas_hrms", "auth_user", "is_blocked", "CASE WHEN au.id IS NULL THEN 'NOT CREATED' WHEN au.is_blocked=1 THEN 'BLOCKED' ELSE 'ACTIVE' END", "AUTH USER STATUS") : null);
  }
  addField(fields, "EXIT_RECOVERY_STATUS", returned
    ? derivedField("mas_hrms", "asset_assignment", returned, `CASE WHEN e.${quote(first(employee.employeeColumns,["date_of_exit","date_of_leaving"]) ?? "id")} IS NOT NULL AND aa.${quote(returned)} IS NULL THEN 'PENDING RECOVERY' WHEN aa.${quote(returned)} IS NOT NULL THEN 'RECOVERED' ELSE 'NOT APPLICABLE' END`, "EXIT AND ASSET RETURN EVIDENCE")
    : null);
  addField(fields, "DATA_SOURCE", constantField("'ASSET_MASTER+ASSIGNMENT+HELPDESK+IT_PROVISIONING+AUTH_USER'", "EXPLICIT GOVERNED SOURCE SET"));

  const scoped = branchScopeWhere(scope, filters, {
    branch: employee.branch,
    process: employee.process,
    employeeCode: employee.employeeCode,
  });
  return executeVerifiedReport({
    code,
    sourceTable: "ASSET_ASSIGNMENT+IT_PROVISIONING_VERIFIED",
    fields,
    fromSql: `${assignmentSql} aa JOIN ${assetSql} am ON am.${quote("id")}=aa.${quote("asset_id")} JOIN ${employee.employeeSql} e ON e.${quote("id")}=aa.${quote("employee_id")}`,
    joins,
    where: scoped.clauses,
    params: scoped.params,
    orderBy: `${quote("EMPLOYEE_CODE")},${quote("ITEM_ID")}`,
    grainKeys: ["EMPLOYEE_CODE", "ITEM_TYPE", "ITEM_ID", "REPORT_DATE"],
    filters,
  });
}

export async function runVerifiedBusinessAdapter(
  code: string,
  filters: VerifiedAdapterFilters,
  scope: BranchScope
): Promise<VerifiedAdapterResult | null> {
  if (!SUPPORTED.has(code)) return null;
  if (code === "bpo-quality-risk-compliance-master") return quality(code, filters, scope);
  if (code === "bpo-recruitment-training-readiness-master") return recruitment(code, filters, scope);
  if (code === "bpo-admin-asset-facility-master") return adminAsset(code, filters, scope);
  return null;
}
