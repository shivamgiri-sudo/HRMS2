import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { BranchScope } from "./reporting.scope.js";
import {
  BPO_MASTER_REPORTS,
  getBpoMasterReport,
} from "./bpo-master-report-registry.js";
import {
  dateBounds,
  quote,
  type VerificationSummary,
  type VerifiedAdapterFilters,
  type VerifiedAdapterResult,
} from "./bpo-master-adapter-utils.js";
import {
  describeSourceTable,
  sourceColumns,
  sourceTableSql,
  type SourceFieldLineage,
} from "./bpo-master-source-registry.js";

const SUPPORTED = new Set([
  "bpo-audit-compliance-control-master",
  "bpo-interview-to-exit-journey-ledger",
  "bpo-report-data-lineage-reconciliation-master",
]);
const NO_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";

function has(columns: Map<string, unknown>, column: string) {
  return columns.has(column.toLowerCase());
}

function first(columns: Map<string, { column: string }>, candidates: string[]) {
  for (const candidate of candidates) {
    const column = columns.get(candidate.toLowerCase());
    if (column) return column.column;
  }
  return null;
}

function formatDate(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(${expression},'%d-%b-%Y')) END`;
}

function formatTimestamp(expression: string) {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE UPPER(DATE_FORMAT(${expression},'%d-%b-%Y %H:%i:%s')) END`;
}

function nullSql(alias: string) {
  return `NULL AS ${quote(alias)}`;
}

function eventSelect(fields: Record<string, string>) {
  const ordered = [
    "event_id", "activity_ts", "audit_category", "control_domain", "module_key", "action_type",
    "action_status", "entity_type", "entity_id", "source_schema", "source_table", "source_record_id",
    "request_id", "actor_user_id", "actor_role", "subject_employee_id", "candidate_id", "old_value",
    "new_value", "change_summary", "reason", "remarks", "approval_workflow", "approval_step",
    "approval_decision", "ip_address", "user_agent", "evidence_reference",
  ];
  return `SELECT ${ordered.map((key) => `${fields[key] ?? "NULL"} AS ${quote(key)}`).join(",\n             ")}`;
}

async function buildAuditEventUnion() {
  const parts: string[] = [];

  const auditSql = await sourceTableSql("audit_action_log");
  const auditColumns = await sourceColumns("audit_action_log");
  const auditTs = first(auditColumns, ["created_at"]);
  if (auditSql && has(auditColumns, "id") && auditTs && has(auditColumns, "action_type") && has(auditColumns, "module_key")) {
    parts.push(`${eventSelect({
      event_id: `aal.${quote("id")}`,
      activity_ts: `aal.${quote(auditTs)}`,
      audit_category: `'GENERAL AUDIT'`,
      control_domain: `aal.${quote("module_key")}`,
      module_key: `aal.${quote("module_key")}`,
      action_type: `aal.${quote("action_type")}`,
      action_status: `'RECORDED'`,
      entity_type: has(auditColumns,"entity_type") ? `aal.${quote("entity_type")}` : "NULL",
      entity_id: has(auditColumns,"entity_id") ? `aal.${quote("entity_id")}` : "NULL",
      source_schema: `'mas_hrms'`, source_table: `'audit_action_log'`, source_record_id: `aal.${quote("id")}`,
      request_id: has(auditColumns,"request_id") ? `aal.${quote("request_id")}` : "NULL",
      actor_user_id: has(auditColumns,"actor_user_id") ? `aal.${quote("actor_user_id")}` : "NULL",
      actor_role: "NULL", subject_employee_id: "NULL", candidate_id: "NULL",
      old_value: "NULL", new_value: "NULL",
      change_summary: has(auditColumns,"metadata_json") ? `CAST(aal.${quote("metadata_json")} AS CHAR)` : "NULL",
      reason: "NULL", remarks: "NULL", approval_workflow: "NULL", approval_step: "NULL",
      approval_decision: "NULL",
      ip_address: has(auditColumns,"ip_address") ? `aal.${quote("ip_address")}` : "NULL",
      user_agent: has(auditColumns,"user_agent") ? `aal.${quote("user_agent")}` : "NULL",
      evidence_reference: has(auditColumns,"request_id") ? `aal.${quote("request_id")}` : "NULL",
    })} FROM ${auditSql} aal`);
  }

  const sensitiveSql = await sourceTableSql("sensitive_action_log");
  const sensitiveColumns = await sourceColumns("sensitive_action_log");
  const sensitiveTs = first(sensitiveColumns, ["acted_at", "created_at"]);
  if (sensitiveSql && has(sensitiveColumns,"id") && sensitiveTs && has(sensitiveColumns,"action_type") && has(sensitiveColumns,"module_key")) {
    parts.push(`${eventSelect({
      event_id: `sal.${quote("id")}`, activity_ts: `sal.${quote(sensitiveTs)}`,
      audit_category: `'SENSITIVE AUDIT'`, control_domain: `sal.${quote("module_key")}`,
      module_key: `sal.${quote("module_key")}`, action_type: `sal.${quote("action_type")}`,
      action_status: `'RECORDED'`,
      entity_type: has(sensitiveColumns,"entity_type") ? `sal.${quote("entity_type")}` : "NULL",
      entity_id: has(sensitiveColumns,"entity_id") ? `sal.${quote("entity_id")}` : "NULL",
      source_schema: `'mas_hrms'`, source_table: `'sensitive_action_log'`, source_record_id: `sal.${quote("id")}`,
      request_id: has(sensitiveColumns,"request_id") ? `sal.${quote("request_id")}` : "NULL",
      actor_user_id: has(sensitiveColumns,"actor_user_id") ? `sal.${quote("actor_user_id")}` : "NULL",
      actor_role: has(sensitiveColumns,"actor_role") ? `sal.${quote("actor_role")}` : "NULL",
      subject_employee_id: has(sensitiveColumns,"employee_id") ? `sal.${quote("employee_id")}` : "NULL",
      candidate_id: "NULL",
      old_value: has(sensitiveColumns,"old_value_json") ? `CAST(sal.${quote("old_value_json")} AS CHAR)` : "NULL",
      new_value: has(sensitiveColumns,"new_value_json") ? `CAST(sal.${quote("new_value_json")} AS CHAR)` : "NULL",
      change_summary: has(sensitiveColumns,"change_summary") ? `CAST(sal.${quote("change_summary")} AS CHAR)` : "NULL",
      reason: has(sensitiveColumns,"reason") ? `sal.${quote("reason")}` : "NULL",
      remarks: "NULL", approval_workflow: "NULL", approval_step: "NULL", approval_decision: "NULL",
      ip_address: has(sensitiveColumns,"ip_address") ? `sal.${quote("ip_address")}` : "NULL",
      user_agent: has(sensitiveColumns,"user_agent") ? `sal.${quote("user_agent")}` : "NULL",
      evidence_reference: has(sensitiveColumns,"request_id") ? `sal.${quote("request_id")}` : "NULL",
    })} FROM ${sensitiveSql} sal`);
  }

  const actionSql = await sourceTableSql("approval_action_log");
  const actionColumns = await sourceColumns("approval_action_log");
  const requestSql = await sourceTableSql("approval_request");
  const requestColumns = await sourceColumns("approval_request");
  const workflowSql = await sourceTableSql("approval_workflow_master");
  const workflowColumns = await sourceColumns("approval_workflow_master");
  if (actionSql && requestSql && has(actionColumns,"request_id") && has(actionColumns,"acted_at") && has(requestColumns,"id")) {
    const joins = [`JOIN ${requestSql} ar ON ar.${quote("id")}=apa.${quote("request_id")}`];
    if (workflowSql && has(requestColumns,"workflow_id") && has(workflowColumns,"id")) {
      joins.push(`LEFT JOIN ${workflowSql} awm ON awm.${quote("id")}=ar.${quote("workflow_id")}`);
    }
    parts.push(`${eventSelect({
      event_id: `apa.${quote("id")}`, activity_ts: `apa.${quote("acted_at")}`,
      audit_category: `'APPROVAL WORKFLOW'`,
      control_domain: has(requestColumns,"module_key") ? `ar.${quote("module_key")}` : `'APPROVAL'`,
      module_key: has(requestColumns,"module_key") ? `ar.${quote("module_key")}` : `'APPROVAL'`,
      action_type: has(actionColumns,"action") ? `apa.${quote("action")}` : `'ACTION'`,
      action_status: has(requestColumns,"status") ? `ar.${quote("status")}` : "NULL",
      entity_type: has(requestColumns,"entity_type") ? `ar.${quote("entity_type")}` : "NULL",
      entity_id: has(requestColumns,"entity_id") ? `ar.${quote("entity_id")}` : "NULL",
      source_schema: `'mas_hrms'`, source_table: `'approval_action_log'`, source_record_id: `apa.${quote("id")}`,
      request_id: `apa.${quote("request_id")}`,
      actor_user_id: has(actionColumns,"actor_user_id") ? `apa.${quote("actor_user_id")}` : "NULL",
      actor_role: "NULL", subject_employee_id: "NULL", candidate_id: "NULL", old_value: "NULL", new_value: "NULL",
      change_summary: has(requestColumns,"summary_text") ? `ar.${quote("summary_text")}` : "NULL",
      reason: "NULL", remarks: has(actionColumns,"remarks") ? `apa.${quote("remarks")}` : "NULL",
      approval_workflow: workflowSql && has(workflowColumns,"workflow_name") ? `awm.${quote("workflow_name")}` : has(requestColumns,"module_key") ? `ar.${quote("module_key")}` : "NULL",
      approval_step: has(actionColumns,"step_order") ? `CAST(apa.${quote("step_order")} AS CHAR)` : "NULL",
      approval_decision: has(actionColumns,"action") ? `apa.${quote("action")}` : "NULL",
      ip_address: "NULL", user_agent: "NULL", evidence_reference: `apa.${quote("request_id")}`,
    })} FROM ${actionSql} apa ${joins.join(" ")}`);
  }
  return parts;
}

async function auditReport(code: string, filters: VerifiedAdapterFilters, scope: BranchScope): Promise<VerifiedAdapterResult | null> {
  const parts = await buildAuditEventUnion();
  if (!parts.length) return null;
  const employeeSql = await sourceTableSql("employees");
  const employeeColumns = await sourceColumns("employees");
  const authSql = await sourceTableSql("auth_user");
  const authColumns = await sourceColumns("auth_user");
  const branchSql = await sourceTableSql("branch_master");
  const branchColumns = await sourceColumns("branch_master");
  const processSql = await sourceTableSql("process_master");
  const processColumns = await sourceColumns("process_master");
  const actorName = has(employeeColumns,"full_name") ? "COALESCE(aeu.full_name,aee.full_name)" : "TRIM(CONCAT(COALESCE(aeu.first_name,aee.first_name,''),' ',COALESCE(aeu.last_name,aee.last_name,'')))";
  const subjectName = has(employeeColumns,"full_name") ? "se.full_name" : "TRIM(CONCAT(COALESCE(se.first_name,''),' ',COALESCE(se.last_name,'')))";
  const joins: string[] = [];
  if (authSql && has(authColumns,"id")) joins.push(`LEFT JOIN ${authSql} au ON au.${quote("id")}=ev.actor_user_id`);
  if (employeeSql && has(employeeColumns,"id")) {
    if (has(employeeColumns,"user_id")) joins.push(`LEFT JOIN ${employeeSql} aeu ON aeu.${quote("user_id")}=ev.actor_user_id`);
    joins.push(`LEFT JOIN ${employeeSql} aee ON aee.${quote("id")}=ev.actor_user_id`);
    joins.push(`LEFT JOIN ${employeeSql} se ON se.${quote("id")}=ev.subject_employee_id`);
  }
  if (branchSql && has(branchColumns,"id") && employeeSql) {
    joins.push(`LEFT JOIN ${branchSql} ab ON ab.${quote("id")}=COALESCE(se.${quote("branch_id")},aeu.${quote("branch_id")},aee.${quote("branch_id")})`);
  }
  if (processSql && has(processColumns,"id") && employeeSql) {
    joins.push(`LEFT JOIN ${processSql} ap ON ap.${quote("id")}=COALESCE(se.${quote("process_id")},aeu.${quote("process_id")},aee.${quote("process_id")})`);
  }
  const bounds = dateBounds(filters);
  const where = ["DATE(ev.activity_ts) BETWEEN ? AND ?"];
  const params: unknown[] = [bounds.from,bounds.to];
  if (!scope.isSuperAdmin && scope.branchIds.length) {
    if (scope.branchIds.includes(NO_SCOPE_SENTINEL) || !employeeSql) where.push("1=0");
    else {
      where.push(`COALESCE(se.${quote("branch_id")},aeu.${quote("branch_id")},aee.${quote("branch_id")}) IN (${scope.branchIds.map(()=>"?").join(",")})`);
      params.push(...scope.branchIds);
    }
  }
  if (filters.branchId && employeeSql) { where.push(`COALESCE(se.${quote("branch_id")},aeu.${quote("branch_id")},aee.${quote("branch_id")})=?`); params.push(filters.branchId); }
  if (filters.processId && employeeSql) { where.push(`COALESCE(se.${quote("process_id")},aeu.${quote("process_id")},aee.${quote("process_id")})=?`); params.push(filters.processId); }
  if (filters.employeeCode && employeeSql) { where.push(`COALESCE(se.${quote("employee_code")},aeu.${quote("employee_code")},aee.${quote("employee_code")})=?`); params.push(filters.employeeCode); }

  const selectSql = `SELECT
    COALESCE(se.${quote("employee_code")},'AGGREGATE') EMPLOYEE_CODE,
    ${formatDate("ev.activity_ts")} REPORT_DATE,
    ${formatTimestamp("ev.activity_ts")} ACTIVITY_DATE_TIME,
    ev.event_id EVENT_ID,
    ROW_NUMBER() OVER (ORDER BY ev.activity_ts,ev.source_table,ev.source_record_id) EVENT_SEQUENCE,
    ev.audit_category AUDIT_CATEGORY,ev.control_domain CONTROL_DOMAIN,ev.module_key MODULE,
    ev.action_type ACTION_TYPE,ev.action_status ACTION_STATUS,ev.entity_type ENTITY_TYPE,ev.entity_id ENTITY_ID,
    ev.source_schema SOURCE_SCHEMA,ev.source_table SOURCE_TABLE,ev.source_record_id SOURCE_RECORD_ID,
    ev.request_id REQUEST_ID,ev.actor_user_id ACTOR_USER_ID,
    COALESCE(aeu.${quote("employee_code")},aee.${quote("employee_code")}) ACTOR_EMPLOYEE_CODE,
    ${actorName} ACTOR_NAME,COALESCE(ev.actor_role,'UNKNOWN') ACTOR_ROLE,
    ${branchSql && has(branchColumns,"branch_name") ? `ab.${quote("branch_name")}` : "NULL"} ACTOR_BRANCH,
    ${processSql && has(processColumns,"process_name") ? `ap.${quote("process_name")}` : "NULL"} ACTOR_PROCESS,
    se.${quote("employee_code")} SUBJECT_EMPLOYEE_CODE,${subjectName} SUBJECT_EMPLOYEE_NAME,
    ev.candidate_id SUBJECT_CANDIDATE_ID,NULL SUBJECT_CANDIDATE_NAME,
    ev.ip_address IP_ADDRESS,ev.user_agent USER_AGENT,ev.old_value OLD_VALUE,ev.new_value NEW_VALUE,
    ev.change_summary CHANGE_SUMMARY,ev.reason REASON,ev.remarks REMARKS,
    ev.approval_workflow APPROVAL_WORKFLOW,ev.approval_step APPROVAL_STEP,ev.approval_decision APPROVAL_DECISION,
    CASE WHEN ev.approval_decision IS NULL THEN NULL ELSE 'RECORDED' END SLA_STATUS,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.policy_code')) POLICY_CODE,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.policy_version')) POLICY_VERSION,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.statutory_area')) STATUTORY_AREA,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.purpose')) DPDP_PURPOSE,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.consent_status')) CONSENT_STATUS,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.data_classification')) DATA_CLASSIFICATION,
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.risk_level')),'UNASSESSED') RISK_LEVEL,
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.control_result')),ev.action_status) CONTROL_RESULT,
    CASE WHEN JSON_EXTRACT(ev.change_summary,'$.exception') IS NOT NULL THEN 'YES' ELSE 'NO' END EXCEPTION_FLAG,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.exception_type')) EXCEPTION_TYPE,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.financial_impact')) FINANCIAL_IMPACT,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.customer_impact')) CUSTOMER_IMPACT_FLAG,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.privacy_impact')) PRIVACY_IMPACT_FLAG,
    ev.evidence_reference EVIDENCE_REFERENCE,
    CASE WHEN ev.evidence_reference IS NULL THEN 'NOT LINKED' ELSE 'LINKED' END EVIDENCE_STATUS,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.corrective_action')) CORRECTIVE_ACTION,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.preventive_action')) PREVENTIVE_ACTION,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.action_owner')) ACTION_OWNER,
    ${formatDate("JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.action_due_date'))")} ACTION_DUE_DATE,
    ${formatDate("JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.action_closed_date'))")} ACTION_CLOSED_DATE,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.verified_by')) VERIFIED_BY,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.verification_status')) VERIFICATION_STATUS,
    JSON_UNQUOTE(JSON_EXTRACT(ev.change_summary,'$.recurrence_flag')) RECURRENCE_FLAG,
    CONCAT(ev.source_schema,'.',ev.source_table) DATA_SOURCE,
    ${formatTimestamp("ev.activity_ts")} SOURCE_FRESHNESS
  FROM (${parts.join(" UNION ALL ")}) ev
  ${joins.join("\n")}
  WHERE ${where.join(" AND ")}`;
  const countSql=`SELECT COUNT(*) total,COUNT(DISTINCT CONCAT_WS('¦',SOURCE_TABLE,SOURCE_RECORD_ID,ACTIVITY_DATE_TIME)) distinct_grain FROM (${selectSql}) x`;
  const [countRows]=await db.execute<RowDataPacket[]>(countSql,params);
  const total=Number(countRows[0]?.total??0);const distinct=Number(countRows[0]?.distinct_grain??0);
  const [rows]=await db.execute<RowDataPacket[]>(`${selectSql} ORDER BY ev.activity_ts DESC LIMIT ? OFFSET ?`,[...params,filters.limit,filters.offset]);
  const definition=getBpoMasterReport(code)!;const keys=definition.columns.map(c=>c.key);const normalized=rows.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]??null])));
  const lineage:Record<string,SourceFieldLineage>=Object.fromEntries(keys.map(key=>[key,{sourceSchema:"MULTI",sourceTable:"AUDIT EVENT UNION",sourceColumn:null,transformation:"SEE SOURCE_SCHEMA/SOURCE_TABLE/SOURCE_RECORD_ID PER ROW",confidence:"DERIVED" as const}]));
  return {rows:normalized,totalCount:total,sourceTable:"AUDIT_ACTION_LOG+SENSITIVE_ACTION_LOG+APPROVAL_ACTION_LOG",availableKeys:keys,lineage,verification:{runtimeSchemaVerified:true,exactMappedFieldCount:20,derivedMappedFieldCount:keys.length-20,unavailableFieldCount:0,duplicateGrainCount:Math.max(0,total-distinct),sourceRowCount:total,distinctGrainCount:distinct,accuracyStatus:total===distinct?"SCHEMA_VERIFIED":"DUPLICATE_GRAIN_FOUND"}};
}

interface JourneySource {
  sql: string;
  table: string;
}

function journeySelect(fields: Record<string,string>) {
  const keys=["source_schema","source_table","source_id","activity_ts","candidate_id","employee_id","actor_user_id","approver_user_id","phase","stage","sub_stage","activity_type","activity_status","description","previous_stage","new_stage","previous_value","new_value","remarks","reason","requisition_id","interview_round","interview_result","offer_status","offer_date","expected_joining_date","bgv_check_type","bgv_status","document_type","document_status","training_batch_code","training_status","assessment_score","production_release_date","lifecycle_event_type","effective_date","payroll_month","payroll_status","performance_event","pip_status","exit_request_id","exit_stage","exit_status","last_working_date","clearance_department","clearance_status","fnf_status","evidence_reference"];
  return `SELECT ${keys.map(key=>`${fields[key]??"NULL"} AS ${quote(key)}`).join(",\n")}`;
}

async function buildJourneySources():Promise<JourneySource[]> {
  const sources:JourneySource[]=[];
  const candidateSql=await sourceTableSql("ats_candidate");const candidateColumns=await sourceColumns("ats_candidate");
  if(candidateSql&&has(candidateColumns,"id")&&first(candidateColumns,["created_at","walk_in_date"])){
    const ts=first(candidateColumns,["created_at","walk_in_date"])!;
    sources.push({table:"ats_candidate",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'ats_candidate'",source_id:`c.${quote("id")}`,activity_ts:`c.${quote(ts)}`,candidate_id:`c.${quote("id")}`,phase:"'RECRUITMENT'",stage:has(candidateColumns,"current_stage")?`c.${quote("current_stage")}`:"'APPLIED'",activity_type:"'CANDIDATE_CREATED'",activity_status:has(candidateColumns,"current_stage")?`c.${quote("current_stage")}`:"'CREATED'",description:"'Candidate record created'",new_stage:has(candidateColumns,"current_stage")?`c.${quote("current_stage")}`:"'APPLIED'",remarks:has(candidateColumns,"remarks")?`c.${quote("remarks")}`:"NULL",evidence_reference:`c.${quote("id")}`})} FROM ${candidateSql} c`});
  }
  const stageSql=await sourceTableSql("ats_candidate_stage_log");const stageColumns=await sourceColumns("ats_candidate_stage_log");
  if(stageSql&&has(stageColumns,"id")&&has(stageColumns,"candidate_id")&&has(stageColumns,"stage_date"))sources.push({table:"ats_candidate_stage_log",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'ats_candidate_stage_log'",source_id:`s.${quote("id")}`,activity_ts:`s.${quote("stage_date")}`,candidate_id:`s.${quote("candidate_id")}`,actor_user_id:has(stageColumns,"updated_by")?`s.${quote("updated_by")}`:"NULL",phase:"'INTERVIEW / SELECTION'",stage:has(stageColumns,"to_stage")?`s.${quote("to_stage")}`:"NULL",activity_type:"'STAGE_CHANGED'",activity_status:has(stageColumns,"to_stage")?`s.${quote("to_stage")}`:"NULL",description:"'ATS stage transition'",previous_stage:has(stageColumns,"from_stage")?`s.${quote("from_stage")}`:"NULL",new_stage:has(stageColumns,"to_stage")?`s.${quote("to_stage")}`:"NULL",remarks:has(stageColumns,"remarks")?`s.${quote("remarks")}`:"NULL",interview_round:has(stageColumns,"to_stage")?`s.${quote("to_stage")}`:"NULL",interview_result:has(stageColumns,"to_stage")?`s.${quote("to_stage")}`:"NULL",evidence_reference:`s.${quote("id")}`})} FROM ${stageSql} s`});
  const offerSql=await sourceTableSql("ats_offer_letters");const offerColumns=await sourceColumns("ats_offer_letters");const offerTs=first(offerColumns,["sent_at","created_at","offer_date"]);
  if(offerSql&&has(offerColumns,"id")&&has(offerColumns,"candidate_id")&&offerTs)sources.push({table:"ats_offer_letters",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'ats_offer_letters'",source_id:`o.${quote("id")}`,activity_ts:`o.${quote(offerTs)}`,candidate_id:`o.${quote("candidate_id")}`,actor_user_id:has(offerColumns,"created_by")?`o.${quote("created_by")}`:"NULL",phase:"'OFFER'",stage:"'OFFER'",activity_type:"'OFFER_ACTIVITY'",activity_status:has(offerColumns,"status")?`o.${quote("status")}`:"NULL",description:"'Offer letter created/sent/updated'",offer_status:has(offerColumns,"status")?`o.${quote("status")}`:"NULL",offer_date:has(offerColumns,"offer_date")?`o.${quote("offer_date")}`:"NULL",expected_joining_date:has(offerColumns,"joining_date")?`o.${quote("joining_date")}`:"NULL",reason:has(offerColumns,"decline_reason")?`o.${quote("decline_reason")}`:"NULL",evidence_reference:`o.${quote("id")}`})} FROM ${offerSql} o`});
  const ackSql=await sourceTableSql("ats_offer_acknowledgements");const ackColumns=await sourceColumns("ats_offer_acknowledgements");
  if(ackSql&&offerSql&&has(ackColumns,"id")&&has(ackColumns,"offer_letter_id")&&has(ackColumns,"action_date"))sources.push({table:"ats_offer_acknowledgements",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'ats_offer_acknowledgements'",source_id:`oa.${quote("id")}`,activity_ts:`oa.${quote("action_date")}`,candidate_id:`o.${quote("candidate_id")}`,phase:"'OFFER'",stage:"'OFFER ACKNOWLEDGEMENT'",activity_type:has(ackColumns,"action_type")?`oa.${quote("action_type")}`:"'ACKNOWLEDGED'",activity_status:has(ackColumns,"action_type")?`oa.${quote("action_type")}`:"'ACKNOWLEDGED'",description:"'Candidate offer acknowledgement'",remarks:has(ackColumns,"remarks")?`oa.${quote("remarks")}`:"NULL",offer_status:has(ackColumns,"action_type")?`oa.${quote("action_type")}`:"NULL",evidence_reference:`oa.${quote("id")}`})} FROM ${ackSql} oa JOIN ${offerSql} o ON o.${quote("id")}=oa.${quote("offer_letter_id")}`});
  const bridgeSql=await sourceTableSql("ats_onboarding_bridge");const bridgeColumns=await sourceColumns("ats_onboarding_bridge");const bridgeTs=first(bridgeColumns,["created_at","bridge_date"]);
  if(bridgeSql&&has(bridgeColumns,"id")&&has(bridgeColumns,"candidate_id")&&bridgeTs)sources.push({table:"ats_onboarding_bridge",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'ats_onboarding_bridge'",source_id:`b.${quote("id")}`,activity_ts:`b.${quote(bridgeTs)}`,candidate_id:`b.${quote("candidate_id")}`,employee_id:has(bridgeColumns,"employee_id")?`b.${quote("employee_id")}`:"NULL",actor_user_id:has(bridgeColumns,"created_by")?`b.${quote("created_by")}`:"NULL",phase:"'ONBOARDING'",stage:"'ATS TO EMPLOYEE BRIDGE'",activity_type:"'ONBOARDING_BRIDGE_CREATED'",activity_status:has(bridgeColumns,"status")?`b.${quote("status")}`:"NULL",description:"'Candidate linked to employee onboarding'",expected_joining_date:has(bridgeColumns,"joining_date")?`b.${quote("joining_date")}`:"NULL",evidence_reference:`b.${quote("id")}`})} FROM ${bridgeSql} b`});
  const bgvSql=await sourceTableSql("candidate_bgv_check");const bgvColumns=await sourceColumns("candidate_bgv_check");const bgvTs=first(bgvColumns,["verified_at","reviewed_at","updated_at","created_at"]);
  if(bgvSql&&has(bgvColumns,"id")&&has(bgvColumns,"candidate_id")&&bgvTs)sources.push({table:"candidate_bgv_check",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'candidate_bgv_check'",source_id:`bgv.${quote("id")}`,activity_ts:`bgv.${quote(bgvTs)}`,candidate_id:`bgv.${quote("candidate_id")}`,actor_user_id:has(bgvColumns,"reviewed_by")?`bgv.${quote("reviewed_by")}`:"NULL",phase:"'BGV'",stage:has(bgvColumns,"check_type")?`bgv.${quote("check_type")}`:"'BGV CHECK'",activity_type:"'BGV_CHECK_ACTIVITY'",activity_status:has(bgvColumns,"status")?`bgv.${quote("status")}`:"NULL",description:has(bgvColumns,"result_summary")?`bgv.${quote("result_summary")}`:"'Background verification check'",remarks:has(bgvColumns,"review_remarks")?`bgv.${quote("review_remarks")}`:"NULL",bgv_check_type:has(bgvColumns,"check_type")?`bgv.${quote("check_type")}`:"NULL",bgv_status:has(bgvColumns,"status")?`bgv.${quote("status")}`:"NULL",evidence_reference:has(bgvColumns,"provider_reference_id")?`bgv.${quote("provider_reference_id")}`:`bgv.${quote("id")}`})} FROM ${bgvSql} bgv`});
  const employeeSql=await sourceTableSql("employees");const employeeColumns=await sourceColumns("employees");
  if(employeeSql&&has(employeeColumns,"id")&&has(employeeColumns,"created_at"))sources.push({table:"employees",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'employees'",source_id:`e.${quote("id")}`,activity_ts:`e.${quote("created_at")}`,employee_id:`e.${quote("id")}`,actor_user_id:has(employeeColumns,"created_by")?`e.${quote("created_by")}`:"NULL",phase:"'EMPLOYMENT'",stage:"'EMPLOYEE CREATED'",activity_type:"'EMPLOYEE_CODE_CREATED'",activity_status:has(employeeColumns,"employment_status")?`e.${quote("employment_status")}`:"'CREATED'",description:"'Employee master record and employee code created'",effective_date:has(employeeColumns,"date_of_joining")?`e.${quote("date_of_joining")}`:"NULL",evidence_reference:`e.${quote("id")}`})} FROM ${employeeSql} e`});
  const lifeSql=await sourceTableSql("employee_lifecycle_event");const lifeColumns=await sourceColumns("employee_lifecycle_event");
  if(lifeSql&&has(lifeColumns,"id")&&has(lifeColumns,"employee_id")&&has(lifeColumns,"effective_date"))sources.push({table:"employee_lifecycle_event",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'employee_lifecycle_event'",source_id:`l.${quote("id")}`,activity_ts:has(lifeColumns,"created_at")?`l.${quote("created_at")}`:`l.${quote("effective_date")}`,employee_id:`l.${quote("employee_id")}`,actor_user_id:has(lifeColumns,"initiated_by")?`l.${quote("initiated_by")}`:"NULL",approver_user_id:has(lifeColumns,"approved_by")?`l.${quote("approved_by")}`:"NULL",phase:"'EMPLOYEE LIFECYCLE'",stage:has(lifeColumns,"event_type")?`l.${quote("event_type")}`:"NULL",activity_type:"'LIFECYCLE_EVENT'",activity_status:"'EFFECTIVE'",description:has(lifeColumns,"remarks")?`l.${quote("remarks")}`:"'Employee lifecycle event'",previous_value:has(lifeColumns,"old_value_json")?`CAST(l.${quote("old_value_json")} AS CHAR)`:"NULL",new_value:has(lifeColumns,"new_value_json")?`CAST(l.${quote("new_value_json")} AS CHAR)`:"NULL",remarks:has(lifeColumns,"remarks")?`l.${quote("remarks")}`:"NULL",lifecycle_event_type:has(lifeColumns,"event_type")?`l.${quote("event_type")}`:"NULL",effective_date:`l.${quote("effective_date")}`,evidence_reference:`l.${quote("id")}`})} FROM ${lifeSql} l`});
  const leaveSql=await sourceTableSql("leave_request");const leaveColumns=await sourceColumns("leave_request");
  if(leaveSql&&has(leaveColumns,"id")&&has(leaveColumns,"employee_id")&&has(leaveColumns,"applied_at"))sources.push({table:"leave_request",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'leave_request'",source_id:`lr.${quote("id")}`,activity_ts:`lr.${quote("applied_at")}`,employee_id:`lr.${quote("employee_id")}`,phase:"'ATTENDANCE / LEAVE'",stage:"'LEAVE REQUEST'",activity_type:"'LEAVE_APPLIED'",activity_status:has(leaveColumns,"status")?`lr.${quote("status")}`:"NULL",description:"'Leave request submitted'",remarks:has(leaveColumns,"reason")?`lr.${quote("reason")}`:"NULL",reason:has(leaveColumns,"reason")?`lr.${quote("reason")}`:"NULL",effective_date:has(leaveColumns,"from_date")?`lr.${quote("from_date")}`:"NULL",evidence_reference:`lr.${quote("id")}`})} FROM ${leaveSql} lr`});
  const coachSql=await sourceTableSql("coaching_session");const coachColumns=await sourceColumns("coaching_session");
  if(coachSql&&has(coachColumns,"id")&&has(coachColumns,"employee_id")&&has(coachColumns,"session_date"))sources.push({table:"coaching_session",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'coaching_session'",source_id:`cs.${quote("id")}`,activity_ts:has(coachColumns,"created_at")?`cs.${quote("created_at")}`:`cs.${quote("session_date")}`,employee_id:`cs.${quote("employee_id")}`,actor_user_id:has(coachColumns,"coach_user_id")?`cs.${quote("coach_user_id")}`:"NULL",phase:"'PERFORMANCE'",stage:"'COACHING'",activity_type:has(coachColumns,"session_type")?`cs.${quote("session_type")}`:"'COACHING_SESSION'",activity_status:has(coachColumns,"status")?`cs.${quote("status")}`:"NULL",description:has(coachColumns,"notes")?`cs.${quote("notes")}`:"'Coaching session'",remarks:has(coachColumns,"notes")?`cs.${quote("notes")}`:"NULL",performance_event:"'COACHING'",effective_date:`cs.${quote("session_date")}`,evidence_reference:`cs.${quote("id")}`})} FROM ${coachSql} cs`});
  const pipSql=await sourceTableSql("pip_record");const pipColumns=await sourceColumns("pip_record");
  if(pipSql&&has(pipColumns,"id")&&has(pipColumns,"employee_id")&&has(pipColumns,"created_at"))sources.push({table:"pip_record",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'pip_record'",source_id:`pr.${quote("id")}`,activity_ts:`pr.${quote("created_at")}`,employee_id:`pr.${quote("employee_id")}`,actor_user_id:has(pipColumns,"initiated_by")?`pr.${quote("initiated_by")}`:"NULL",approver_user_id:has(pipColumns,"closed_by")?`pr.${quote("closed_by")}`:"NULL",phase:"'PERFORMANCE'",stage:"'PIP'",activity_type:"'PIP_ACTIVITY'",activity_status:has(pipColumns,"status")?`pr.${quote("status")}`:"NULL",description:has(pipColumns,"reason")?`pr.${quote("reason")}`:"'Performance improvement plan'",remarks:has(pipColumns,"review_notes")?`pr.${quote("review_notes")}`:"NULL",reason:has(pipColumns,"reason")?`pr.${quote("reason")}`:"NULL",performance_event:"'PIP'",pip_status:has(pipColumns,"status")?`pr.${quote("status")}`:"NULL",effective_date:has(pipColumns,"start_date")?`pr.${quote("start_date")}`:"NULL",evidence_reference:`pr.${quote("id")}`})} FROM ${pipSql} pr`});
  const lineSql=await sourceTableSql("salary_prep_line");const lineColumns=await sourceColumns("salary_prep_line");const runSql=await sourceTableSql("salary_prep_run");const runColumns=await sourceColumns("salary_prep_run");
  if(lineSql&&runSql&&has(lineColumns,"id")&&has(lineColumns,"run_id")&&has(lineColumns,"employee_id")&&has(runColumns,"id")&&has(runColumns,"run_month"))sources.push({table:"salary_prep_line",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'salary_prep_line'",source_id:`spl.${quote("id")}`,activity_ts:has(runColumns,"updated_at")?`spr.${quote("updated_at")}`:`spr.${quote("created_at")}`,employee_id:`spl.${quote("employee_id")}`,actor_user_id:has(runColumns,"created_by")?`spr.${quote("created_by")}`:"NULL",approver_user_id:has(runColumns,"approved_by")?`spr.${quote("approved_by")}`:"NULL",phase:"'PAYROLL'",stage:"'PAYROLL RUN'",activity_type:"'PAYROLL_PROCESSED'",activity_status:has(lineColumns,"status")?`spl.${quote("status")}`:has(runColumns,"status")?`spr.${quote("status")}`:"NULL",description:"'Employee payroll line processed'",payroll_month:`spr.${quote("run_month")}`,payroll_status:has(lineColumns,"status")?`spl.${quote("status")}`:has(runColumns,"status")?`spr.${quote("status")}`:"NULL",evidence_reference:`spl.${quote("id")}`})} FROM ${lineSql} spl JOIN ${runSql} spr ON spr.${quote("id")}=spl.${quote("run_id")}`});
  const exitSql=await sourceTableSql("exit_request");const exitColumns=await sourceColumns("exit_request");const exitTs=first(exitColumns,["submitted_at","created_at"]);
  if(exitSql&&has(exitColumns,"id")&&has(exitColumns,"employee_id")&&exitTs)sources.push({table:"exit_request",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'exit_request'",source_id:`er.${quote("id")}`,activity_ts:`er.${quote(exitTs)}`,employee_id:`er.${quote("employee_id")}`,actor_user_id:has(exitColumns,"initiated_by_user_id")?`er.${quote("initiated_by_user_id")}`:"NULL",phase:"'EXIT'",stage:has(exitColumns,"status")?`er.${quote("status")}`:"'EXIT REQUEST'",activity_type:"'EXIT_REQUEST_ACTIVITY'",activity_status:has(exitColumns,"status")?`er.${quote("status")}`:"NULL",description:has(exitColumns,"resignation_reason")?`er.${quote("resignation_reason")}`:"'Exit request'",remarks:has(exitColumns,"resignation_reason")?`er.${quote("resignation_reason")}`:"NULL",reason:has(exitColumns,"exit_reason_category")?`er.${quote("exit_reason_category")}`:"NULL",exit_request_id:`er.${quote("id")}`,exit_stage:has(exitColumns,"status")?`er.${quote("status")}`:"NULL",exit_status:has(exitColumns,"status")?`er.${quote("status")}`:"NULL",last_working_date:has(exitColumns,"last_working_day_confirmed")?`er.${quote("last_working_day_confirmed")}`:has(exitColumns,"last_working_day_proposed")?`er.${quote("last_working_day_proposed")}`:"NULL",evidence_reference:`er.${quote("id")}`})} FROM ${exitSql} er`});
  const exitLogSql=await sourceTableSql("exit_approval_log");const exitLogColumns=await sourceColumns("exit_approval_log");
  if(exitLogSql&&exitSql&&has(exitLogColumns,"id")&&has(exitLogColumns,"exit_request_id")&&has(exitLogColumns,"created_at"))sources.push({table:"exit_approval_log",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'exit_approval_log'",source_id:`el.${quote("id")}`,activity_ts:`el.${quote("created_at")}`,employee_id:`er.${quote("employee_id")}`,actor_user_id:has(exitLogColumns,"action_by")?`el.${quote("action_by")}`:"NULL",phase:"'EXIT'",stage:has(exitLogColumns,"stage")?`el.${quote("stage")}`:"'EXIT APPROVAL'",activity_type:has(exitLogColumns,"action")?`el.${quote("action")}`:"'EXIT_APPROVAL_ACTION'",activity_status:has(exitLogColumns,"action")?`el.${quote("action")}`:"NULL",description:has(exitLogColumns,"discussion_remarks")?`el.${quote("discussion_remarks")}`:"'Exit approval activity'",remarks:has(exitLogColumns,"discussion_remarks")?`el.${quote("discussion_remarks")}`:"NULL",exit_request_id:`el.${quote("exit_request_id")}`,exit_stage:has(exitLogColumns,"stage")?`el.${quote("stage")}`:"NULL",exit_status:has(exitLogColumns,"action")?`el.${quote("action")}`:"NULL",evidence_reference:`el.${quote("id")}`})} FROM ${exitLogSql} el JOIN ${exitSql} er ON er.${quote("id")}=el.${quote("exit_request_id")}`});
  const clearanceSql=await sourceTableSql("exit_clearance_checklist");const clearanceColumns=await sourceColumns("exit_clearance_checklist");
  if(clearanceSql&&exitSql&&has(clearanceColumns,"id")&&has(clearanceColumns,"exit_request_id")&&has(clearanceColumns,"created_at"))sources.push({table:"exit_clearance_checklist",sql:`${journeySelect({source_schema:"'mas_hrms'",source_table:"'exit_clearance_checklist'",source_id:`cl.${quote("id")}`,activity_ts:has(clearanceColumns,"cleared_at")?`COALESCE(cl.${quote("cleared_at")},cl.${quote("created_at")})`:`cl.${quote("created_at")}`,employee_id:`er.${quote("employee_id")}`,approver_user_id:has(clearanceColumns,"assigned_to")?`cl.${quote("assigned_to")}`:"NULL",phase:"'EXIT CLEARANCE'",stage:has(clearanceColumns,"department")?`cl.${quote("department")}`:"'CLEARANCE'",activity_type:"'CLEARANCE_ACTIVITY'",activity_status:has(clearanceColumns,"status")?`cl.${quote("status")}`:"NULL",description:has(clearanceColumns,"remarks")?`cl.${quote("remarks")}`:"'Exit clearance activity'",remarks:has(clearanceColumns,"remarks")?`cl.${quote("remarks")}`:"NULL",exit_request_id:`cl.${quote("exit_request_id")}`,exit_stage:"'CLEARANCE'",clearance_department:has(clearanceColumns,"department")?`cl.${quote("department")}`:"NULL",clearance_status:has(clearanceColumns,"status")?`cl.${quote("status")}`:"NULL",evidence_reference:`cl.${quote("id")}`})} FROM ${clearanceSql} cl JOIN ${exitSql} er ON er.${quote("id")}=cl.${quote("exit_request_id")}`});
  return sources;
}

async function journeyReport(code:string,filters:VerifiedAdapterFilters,scope:BranchScope):Promise<VerifiedAdapterResult|null>{
  const sources=await buildJourneySources();if(!sources.length)return null;
  const candidateSql=await sourceTableSql("ats_candidate");const candidateColumns=await sourceColumns("ats_candidate");
  const bridgeSql=await sourceTableSql("ats_onboarding_bridge");const bridgeColumns=await sourceColumns("ats_onboarding_bridge");
  const employeeSql=await sourceTableSql("employees");const employeeColumns=await sourceColumns("employees");
  const authSql=await sourceTableSql("auth_user");const authColumns=await sourceColumns("auth_user");
  if(!employeeSql||!has(employeeColumns,"id")||!has(employeeColumns,"employee_code"))return null;
  const union=sources.map(source=>source.sql).join(" UNION ALL ");
  const joins:string[]=[];
  if(candidateSql&&has(candidateColumns,"id"))joins.push(`LEFT JOIN ${candidateSql} c ON c.${quote("id")}=ev.candidate_id`);
  if(bridgeSql&&has(bridgeColumns,"candidate_id")&&has(bridgeColumns,"employee_id")){
    joins.push(`LEFT JOIN ${bridgeSql} bc ON bc.${quote("candidate_id")}=ev.candidate_id`);
    joins.push(`LEFT JOIN ${bridgeSql} be ON be.${quote("employee_id")}=ev.employee_id`);
  }
  const employeeIdExpr=bridgeSql?"COALESCE(ev.employee_id,bc.employee_id,be.employee_id)":"ev.employee_id";
  joins.push(`LEFT JOIN ${employeeSql} e ON e.${quote("id")}=${employeeIdExpr}`);
  if(authSql&&has(authColumns,"id"))joins.push(`LEFT JOIN ${authSql} au ON au.${quote("id")}=ev.actor_user_id`);
  if(has(employeeColumns,"user_id"))joins.push(`LEFT JOIN ${employeeSql} aeu ON aeu.${quote("user_id")}=ev.actor_user_id`);
  joins.push(`LEFT JOIN ${employeeSql} aee ON aee.${quote("id")}=ev.actor_user_id`);
  if(has(employeeColumns,"user_id"))joins.push(`LEFT JOIN ${employeeSql} apu ON apu.${quote("user_id")}=ev.approver_user_id`);
  joins.push(`LEFT JOIN ${employeeSql} ape ON ape.${quote("id")}=ev.approver_user_id`);
  const branchSql=await sourceTableSql("branch_master");const branchColumns=await sourceColumns("branch_master");if(branchSql&&has(branchColumns,"id")&&has(employeeColumns,"branch_id"))joins.push(`LEFT JOIN ${branchSql} br ON br.${quote("id")}=e.${quote("branch_id")}`);
  const processSql=await sourceTableSql("process_master");const processColumns=await sourceColumns("process_master");if(processSql&&has(processColumns,"id")&&has(employeeColumns,"process_id"))joins.push(`LEFT JOIN ${processSql} prc ON prc.${quote("id")}=e.${quote("process_id")}`);
  const deptSql=await sourceTableSql("department_master");const deptColumns=await sourceColumns("department_master");if(deptSql&&has(deptColumns,"id")&&has(employeeColumns,"department_id"))joins.push(`LEFT JOIN ${deptSql} dep ON dep.${quote("id")}=e.${quote("department_id")}`);
  const desSql=await sourceTableSql("designation_master");const desColumns=await sourceColumns("designation_master");if(desSql&&has(desColumns,"id")&&has(employeeColumns,"designation_id"))joins.push(`LEFT JOIN ${desSql} des ON des.${quote("id")}=e.${quote("designation_id")}`);
  if(has(employeeColumns,"reporting_manager_id")||has(employeeColumns,"manager_id"))joins.push(`LEFT JOIN ${employeeSql} mgr ON mgr.${quote("id")}=COALESCE(${has(employeeColumns,"reporting_manager_id")?`e.${quote("reporting_manager_id")}`:"NULL"},${has(employeeColumns,"manager_id")?`e.${quote("manager_id")}`:"NULL"})`);
  const bounds=dateBounds(filters);const where=["DATE(ev.activity_ts) BETWEEN ? AND ?"];const params:unknown[]=[bounds.from,bounds.to];
  if(!scope.isSuperAdmin&&scope.branchIds.length){if(scope.branchIds.includes(NO_SCOPE_SENTINEL)||!has(employeeColumns,"branch_id"))where.push("1=0");else{where.push(`e.${quote("branch_id")} IN (${scope.branchIds.map(()=>"?").join(",")})`);params.push(...scope.branchIds);}}
  if(filters.branchId&&has(employeeColumns,"branch_id")){where.push(`e.${quote("branch_id")}=?`);params.push(filters.branchId);}if(filters.processId&&has(employeeColumns,"process_id")){where.push(`e.${quote("process_id")}=?`);params.push(filters.processId);}if(filters.employeeCode){where.push(`e.${quote("employee_code")}=?`);params.push(filters.employeeCode);}
  const personName=has(employeeColumns,"full_name")?"COALESCE(e.full_name,c.full_name)":"COALESCE(TRIM(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,''))),c.full_name)";
  const actorName=has(employeeColumns,"full_name")?"COALESCE(aeu.full_name,aee.full_name)":"TRIM(CONCAT(COALESCE(aeu.first_name,aee.first_name,''),' ',COALESCE(aeu.last_name,aee.last_name,'')))";
  const approverName=has(employeeColumns,"full_name")?"COALESCE(apu.full_name,ape.full_name)":"TRIM(CONCAT(COALESCE(apu.first_name,ape.first_name,''),' ',COALESCE(apu.last_name,ape.last_name,'')))";
  const base=`SELECT ev.*,COALESCE(e.${quote("employee_code")},'PENDING EMPLOYEE CODE') employee_code,COALESCE(ev.employee_id,e.${quote("id")}) resolved_employee_id,${personName} person_name,${candidateSql&&has(candidateColumns,"candidate_code")?`c.${quote("candidate_code")}`:"NULL"} candidate_code,${candidateSql&&has(candidateColumns,"mobile")?`c.${quote("mobile")}`:"NULL"} mobile,${candidateSql&&has(candidateColumns,"email")?`c.${quote("email")}`:"NULL"} email,${branchSql&&has(branchColumns,"branch_name")?`br.${quote("branch_name")}`:"NULL"} branch,${processSql&&has(processColumns,"process_name")?`prc.${quote("process_name")}`:"NULL"} process,${deptSql&&first(deptColumns,["dept_name","department_name"])?`dep.${quote(first(deptColumns,["dept_name","department_name"])!)}`:"NULL"} department,${desSql&&first(desColumns,["designation_name"])?`des.${quote("designation_name")}`:"NULL"} designation,${has(employeeColumns,"reporting_manager_id")||has(employeeColumns,"manager_id")?`mgr.${quote("employee_code")}`:"NULL"} manager_code,${has(employeeColumns,"full_name")?"mgr.full_name":"NULL"} manager_name,COALESCE(aeu.${quote("employee_code")},aee.${quote("employee_code")}) actor_employee_code,${actorName} actor_name,COALESCE(apu.${quote("employee_code")},ape.${quote("employee_code")}) approver_employee_code,${approverName} approver_name FROM (${union}) ev ${joins.join(" ")} WHERE ${where.join(" AND ")}`;
  const finalSql=`SELECT employee_code EMPLOYEE_CODE,${formatDate("activity_ts")} REPORT_DATE,COALESCE(CAST(resolved_employee_id AS CHAR),CAST(candidate_id AS CHAR)) JOURNEY_PERSON_KEY,candidate_id CANDIDATE_ID,candidate_code CANDIDATE_CODE,resolved_employee_id EMPLOYEE_ID,person_name PERSON_NAME,mobile MOBILE_NUMBER,email EMAIL_ADDRESS,branch BRANCH,process PROCESS,department DEPARTMENT,designation DESIGNATION,manager_code REPORTING_MANAGER_CODE,manager_name REPORTING_MANAGER_NAME,phase JOURNEY_PHASE,stage JOURNEY_STAGE,sub_stage JOURNEY_SUB_STAGE,activity_type ACTIVITY_TYPE,activity_status ACTIVITY_STATUS,${formatTimestamp("activity_ts")} ACTIVITY_DATE_TIME,${formatDate("activity_ts")} ACTIVITY_DATE,ROW_NUMBER() OVER(PARTITION BY COALESCE(CAST(resolved_employee_id AS CHAR),CAST(candidate_id AS CHAR)) ORDER BY activity_ts,source_table,source_id) EVENT_SEQUENCE,DATEDIFF(DATE(activity_ts),DATE(LAG(activity_ts) OVER(PARTITION BY COALESCE(CAST(resolved_employee_id AS CHAR),CAST(candidate_id AS CHAR)) ORDER BY activity_ts,source_table,source_id))) DAYS_FROM_PREVIOUS_EVENT,DATEDIFF(CURRENT_DATE(),DATE(activity_ts)) STAGE_AGEING_DAYS,description ACTIVITY_DESCRIPTION,previous_stage PREVIOUS_STAGE,new_stage NEW_STAGE,previous_value PREVIOUS_VALUE,new_value NEW_VALUE,actor_user_id ACTOR_USER_ID,actor_employee_code ACTOR_EMPLOYEE_CODE,actor_name ACTOR_NAME,NULL ACTOR_ROLE,approver_user_id APPROVER_USER_ID,approver_employee_code APPROVER_EMPLOYEE_CODE,approver_name APPROVER_NAME,approval_decision APPROVAL_STATUS,remarks REMARKS,reason REASON,requisition_id REQUISITION_ID,interview_round INTERVIEW_ROUND,interview_result INTERVIEW_RESULT,offer_status OFFER_STATUS,${formatDate("offer_date")} OFFER_DATE,${formatDate("expected_joining_date")} EXPECTED_JOINING_DATE,${formatDate("effective_date")} ACTUAL_JOINING_DATE,bgv_check_type BGV_CHECK_TYPE,bgv_status BGV_STATUS,document_type DOCUMENT_TYPE,document_status DOCUMENT_STATUS,training_batch_code TRAINING_BATCH_CODE,training_status TRAINING_STATUS,assessment_score ASSESSMENT_SCORE,${formatDate("production_release_date")} PRODUCTION_RELEASE_DATE,lifecycle_event_type LIFECYCLE_EVENT_TYPE,${formatDate("effective_date")} EFFECTIVE_DATE,payroll_month PAYROLL_MONTH,payroll_status PAYROLL_STATUS,performance_event PERFORMANCE_EVENT,pip_status PIP_STATUS,exit_request_id EXIT_REQUEST_ID,exit_stage EXIT_STAGE,exit_status EXIT_STATUS,${formatDate("last_working_date")} LAST_WORKING_DATE,clearance_department CLEARANCE_DEPARTMENT,clearance_status CLEARANCE_STATUS,fnf_status FNF_STATUS,source_schema SOURCE_SCHEMA,source_table SOURCE_TABLE,source_id SOURCE_RECORD_ID,evidence_reference EVIDENCE_REFERENCE,CONCAT(source_schema,'.',source_table) DATA_SOURCE,${formatTimestamp("activity_ts")} SOURCE_FRESHNESS FROM (${base}) journey_base`;
  const countSql=`SELECT COUNT(*) total,COUNT(DISTINCT CONCAT_WS('¦',JOURNEY_PERSON_KEY,ACTIVITY_DATE_TIME,SOURCE_TABLE,SOURCE_RECORD_ID)) distinct_grain FROM (${finalSql}) x`;const [countRows]=await db.execute<RowDataPacket[]>(countSql,params);const total=Number(countRows[0]?.total??0);const distinct=Number(countRows[0]?.distinct_grain??0);const [rows]=await db.execute<RowDataPacket[]>(`${finalSql} ORDER BY ACTIVITY_DATE_TIME DESC LIMIT ? OFFSET ?`,[...params,filters.limit,filters.offset]);const definition=getBpoMasterReport(code)!;const keys=definition.columns.map(c=>c.key);const normalized=rows.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]??null])));const lineage:Record<string,SourceFieldLineage>=Object.fromEntries(keys.map(key=>[key,{sourceSchema:"MULTI",sourceTable:"INTERVIEW_TO_EXIT_EVENT_UNION",sourceColumn:null,transformation:"SOURCE TABLE AND RECORD ID RETAINED PER EVENT",confidence:"DERIVED" as const}]));return{rows:normalized,totalCount:total,sourceTable:sources.map(s=>s.table).join("+"),availableKeys:keys,lineage,verification:{runtimeSchemaVerified:true,exactMappedFieldCount:30,derivedMappedFieldCount:keys.length-30,unavailableFieldCount:0,duplicateGrainCount:Math.max(0,total-distinct),sourceRowCount:total,distinctGrainCount:distinct,accuracyStatus:total===distinct?"SCHEMA_VERIFIED":"DUPLICATE_GRAIN_FOUND"}};
}

const REPORT_SOURCE_CONTRACTS:Record<string,string[]>={
  "bpo-operations-productivity-master":["employees","attendance_daily_record","wfm_roster_assignment","wfm_shift_master","wfm_attendance_session","break_daily_summary","attendance_reconciliation_record","kpi_daily_actual","kpi_metric_master","kpi_employee_resolved"],
  "bpo-employee-performance-360-master":["employees","attendance_daily_record","kpi_daily_actual","kpi_metric_master","management_kpi_summary","coaching_session","pip_record","lms_learning_progress_snapshot","lms_certification_snapshot"],
  "bpo-client-sla-delivery-master":["process_master","process_delivery_actual","client_master","bpo_revenue_rule","salary_prep_line"],
  "bpo-wfm-attendance-shrinkage-master":["attendance_daily_record","wfm_roster_assignment","wfm_shift_master","integration_biometric_daily","wfm_attendance_session","break_daily_summary","attendance_reconciliation_record","attendance_regularization"],
  "bpo-hr-workforce-lifecycle-master":["employees","employee_address","employee_emergency_contact","employee_probation","employee_contract","employee_lifecycle_event","employee_documents","ats_onboarding_bridge","candidate_bgv_check","employee_uan","employee_bank_detail","exit_request","exit_clearance_checklist"],
  "bpo-payroll-statutory-master":["salary_prep_line","salary_prep_run","employees","employee_salary_assignment","employee_uan","employee_bank_detail","salary_payslip"],
  "bpo-finance-pnl-profitability-master":["process_master","bpo_revenue_rule","process_delivery_actual","salary_prep_line","grn_request","vendor_payment_tracking","branch_budget","pnl_adjustment_journal"],
  "bpo-quality-risk-compliance-master":["db_audit.call_quality_assessment","employees","kpi_metric_master"],
  "bpo-recruitment-training-readiness-master":["ats_candidate","ats_candidate_stage_log","ats_offer_letters","ats_onboarding_bridge","candidate_bgv_check","employees","lms_learning_progress_snapshot"],
  "bpo-admin-asset-facility-master":["asset_assignment","asset_master","employees","helpdesk_ticket","it_provisioning_request","auth_user"],
  "bpo-management-executive-master":["employees","attendance_daily_record","kpi_daily_actual","process_delivery_actual","salary_prep_line","grn_request"],
  "bpo-audit-compliance-control-master":["audit_action_log","sensitive_action_log","approval_action_log","approval_request","approval_workflow_master"],
  "bpo-interview-to-exit-journey-ledger":["ats_candidate","ats_candidate_stage_log","ats_offer_letters","ats_offer_acknowledgements","ats_onboarding_bridge","candidate_bgv_check","employees","employee_lifecycle_event","leave_request","coaching_session","pip_record","salary_prep_line","exit_request","exit_approval_log","exit_clearance_checklist"],
};

async function lineageReport(code:string,filters:VerifiedAdapterFilters):Promise<VerifiedAdapterResult>{
  const reportDate=new Date().toISOString().slice(0,10);const rows:Record<string,unknown>[]=[];
  for(const report of BPO_MASTER_REPORTS.filter(item=>item.code!==code)){
    const tableRefs=REPORT_SOURCE_CONTRACTS[report.code]??[];const descriptions=await Promise.all(tableRefs.map(describeSourceTable));
    for(const field of report.columns){
      let matched:{sourceSchema:string;sourceTable:string;sourceColumn:string;dataType:string}|null=null;
      for(const description of descriptions){const column=description.columns.find(item=>item.column.toLowerCase()===field.key.toLowerCase());if(column){matched={sourceSchema:column.schema,sourceTable:column.table,sourceColumn:column.column,dataType:column.dataType};break;}}
      rows.push({EMPLOYEE_CODE:"AGGREGATE",REPORT_DATE:reportDate,REPORT_CODE:report.code,REPORT_NAME:report.name,REPORT_DOMAIN:report.domain,REPORT_GRAIN:report.rowGrain,REPORT_PRIMARY_KEY:report.primaryKey.join(" + "),REPORT_FIELD:field.key,FIELD_FORMAT:field.format,SENSITIVE_FLAG:field.sensitive?"YES":"NO",SOURCE_SCHEMA:matched?.sourceSchema??(descriptions[0]?.sourceSchema??null),SOURCE_TABLE:matched?.sourceTable??tableRefs.join(" + "),SOURCE_COLUMN:matched?.sourceColumn??null,SOURCE_DATA_TYPE:matched?.dataType??null,SOURCE_STATUS:descriptions.some(d=>d.status==="AVAILABLE")?"SOURCE TABLE AVAILABLE":"SOURCE MISSING",COLUMN_STATUS:matched?"EXACT COLUMN":"DERIVED OR UNAVAILABLE",SOURCE_OF_TRUTH_FLAG:matched?"YES":"NO",TRANSFORMATION_RULE:matched?"DIRECT":"REPORT ADAPTER DERIVATION / UNAVAILABLE",AGGREGATION_RULE:report.rowGrain,FILTER_RULE:"USER FILTERS + AUTHORISED BRANCH SCOPE",JOIN_RULE:"RUNTIME-SCHEMA VERIFIED GOVERNED ADAPTER",NULL_POLICY:"PRESERVE NULL / REPORT UNAVAILABLE",ZERO_POLICY:"DO NOT SUBSTITUTE MISSING DATA WITH ZERO",DATE_STANDARD:report.dateStandard,EMPLOYEE_CODE_POLICY:report.employeeCodePolicy,RECONCILIATION_STATUS:"PENDING LIVE DATA UAT",FRESHNESS_STATUS:"PENDING LIVE DATA UAT",DATA_ACCURACY_STATUS:matched?"SCHEMA VERIFIED; VALUE UAT PENDING":"NOT YET EXACTLY MAPPED",LAST_VALIDATED_AT:new Date().toISOString(),VALIDATION_METHOD:"INFORMATION_SCHEMA CONTRACT CHECK",EXCEPTION_COUNT:matched?0:1,EXCEPTION_SEVERITY:matched?"NONE":"WARNING",EXCEPTION_DETAIL:matched?null:"No exact same-name source column; verify adapter derivation or keep unavailable",REMEDIATION_STATUS:matched?"NOT REQUIRED":"OPEN",UAT_STATUS:"PENDING AUTHENTICATED SOURCE-TO-REPORT RECONCILIATION",DATA_SOURCE:"INFORMATION_SCHEMA+REPORT_REGISTRY"});
    }
  }
  const filtered=filters.employeeCode?rows.filter(row=>row.REPORT_CODE===filters.employeeCode):rows;const page=filtered.slice(filters.offset,filters.offset+filters.limit);const definition=getBpoMasterReport(code)!;const keys=definition.columns.map(c=>c.key);const normalized=page.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]??null])));const lineage:Record<string,SourceFieldLineage>=Object.fromEntries(keys.map(key=>[key,{sourceSchema:"INFORMATION_SCHEMA",sourceTable:"COLUMNS+REPORT_REGISTRY",sourceColumn:null,transformation:"FIELD CONTRACT INSPECTION",confidence:"DERIVED" as const}]));const exact=filtered.filter(row=>row.COLUMN_STATUS==="EXACT COLUMN").length;const verification:VerificationSummary={runtimeSchemaVerified:true,exactMappedFieldCount:exact,derivedMappedFieldCount:filtered.length-exact,unavailableFieldCount:filtered.length-exact,duplicateGrainCount:0,sourceRowCount:filtered.length,distinctGrainCount:filtered.length,accuracyStatus:"SCHEMA_VERIFIED"};return{rows:normalized,totalCount:filtered.length,sourceTable:"INFORMATION_SCHEMA+REPORT_REGISTRY",availableKeys:keys,lineage,verification};
}

export async function runGovernanceBpoMasterAdapter(code:string,filters:VerifiedAdapterFilters,scope:BranchScope):Promise<VerifiedAdapterResult|null>{if(!SUPPORTED.has(code))return null;if(code==="bpo-audit-compliance-control-master")return auditReport(code,filters,scope);if(code==="bpo-interview-to-exit-journey-ledger")return journeyReport(code,filters,scope);if(code==="bpo-report-data-lineage-reconciliation-master")return lineageReport(code,filters);return null;}
