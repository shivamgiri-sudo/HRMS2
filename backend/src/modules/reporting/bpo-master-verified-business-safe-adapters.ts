import type { BranchScope } from "./reporting.scope.js";
import {
  addField,
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
import { sourceColumns, sourceTableSql, type SourceColumn } from "./bpo-master-source-registry.js";
import { runVerifiedBusinessAdapter } from "./bpo-master-verified-business-adapters.js";

const NO_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";

function has(columns: Map<string, SourceColumn>, name: string) {
  return columns.has(name.toLowerCase());
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

async function safeRecruitment(
  code: string,
  filters: VerifiedAdapterFilters,
  scope: BranchScope
): Promise<VerifiedAdapterResult | null> {
  const candidateTable = await sourceTableSql("ats_candidate");
  const candidateColumns = await sourceColumns("ats_candidate");
  const candidateId = first(candidateColumns, ["id"]);
  const activityDate = first(candidateColumns, ["created_at", "walk_in_date"]);
  if (!candidateTable || !candidateId || !activityDate) return null;

  const fields = new Map<string, FieldSpec>();
  const joins: string[] = [];
  const joinParams: unknown[] = [];
  addField(fields, "REPORT_DATE", derivedField("mas_hrms", "ats_candidate", activityDate, fmtDate(`c.${quote(activityDate)}`), "APPLICATION/CREATION DATE"));
  addField(fields, "CANDIDATE_ID", directField("c", "ats_candidate", candidateColumns, ["id", "candidate_code"]));
  addField(fields, "CANDIDATE_NAME", directField("c", "ats_candidate", candidateColumns, ["full_name"]));
  addField(fields, "MOBILE_NUMBER", directField("c", "ats_candidate", candidateColumns, ["mobile"]));
  addField(fields, "EMAIL_ADDRESS", directField("c", "ats_candidate", candidateColumns, ["email"]));
  addField(fields, "SOURCE_CHANNEL", directField("c", "ats_candidate", candidateColumns, ["sourcing_channel"]));
  addField(fields, "SOURCE_PARTNER", directField("c", "ats_candidate", candidateColumns, ["source_partner"]));
  addField(fields, "REFERRER_EMPLOYEE_CODE", directField("c", "ats_candidate", candidateColumns, ["referred_by"]));
  addField(fields, "APPLICATION_DATE", derivedField("mas_hrms", "ats_candidate", activityDate, fmtDate(`c.${quote(activityDate)}`), "APPLICATION/CREATION DATE"));
  addField(fields, "CURRENT_STAGE", directField("c", "ats_candidate", candidateColumns, ["current_stage"]));

  const branchTable = await sourceTableSql("branch_master");
  const branchColumns = await sourceColumns("branch_master");
  const candidateBranch = first(candidateColumns, ["applied_for_branch"]);
  const branchName = first(branchColumns, ["branch_name", "name"]);
  if (branchTable && candidateBranch && branchName && has(branchColumns, "id")) {
    joins.push(`LEFT JOIN ${branchTable} candidate_branch ON UPPER(TRIM(candidate_branch.${quote(branchName)}))=UPPER(TRIM(c.${quote(candidateBranch)}))`);
    addField(fields, "BRANCH", derivedField("mas_hrms", "branch_master", branchName, `COALESCE(candidate_branch.${quote(branchName)},c.${quote(candidateBranch)})`, "EXACT BRANCH MASTER NAME MATCH, ELSE RAW ATS VALUE"));
  } else {
    addField(fields, "BRANCH", directField("c", "ats_candidate", candidateColumns, ["applied_for_branch"]));
  }

  const processTable = await sourceTableSql("process_master");
  const processColumns = await sourceColumns("process_master");
  const candidateProcess = first(candidateColumns, ["applied_for_process"]);
  const processName = first(processColumns, ["process_name", "name"]);
  if (processTable && candidateProcess && processName && has(processColumns, "id")) {
    joins.push(`LEFT JOIN ${processTable} candidate_process ON UPPER(TRIM(candidate_process.${quote(processName)}))=UPPER(TRIM(c.${quote(candidateProcess)}))`);
    addField(fields, "PROCESS", derivedField("mas_hrms", "process_master", processName, `COALESCE(candidate_process.${quote(processName)},c.${quote(candidateProcess)})`, "EXACT PROCESS MASTER NAME MATCH, ELSE RAW ATS VALUE"));
  } else {
    addField(fields, "PROCESS", directField("c", "ats_candidate", candidateColumns, ["applied_for_process"]));
  }

  const bridgeTable = await sourceTableSql("ats_onboarding_bridge");
  const bridgeColumns = await sourceColumns("ats_onboarding_bridge");
  const employeeTable = await sourceTableSql("employees");
  const employeeColumns = await sourceColumns("employees");
  if (bridgeTable && has(bridgeColumns, "candidate_id")) {
    joins.push(`LEFT JOIN ${bridgeTable} bridge ON bridge.${quote("candidate_id")}=c.${quote(candidateId)}`);
  }
  if (employeeTable && bridgeTable && has(bridgeColumns, "employee_id") && has(employeeColumns, "id") && has(employeeColumns, "employee_code")) {
    joins.push(`LEFT JOIN ${employeeTable} e ON e.${quote("id")}=bridge.${quote("employee_id")}`);
    addField(fields, "EMPLOYEE_CODE", derivedField("mas_hrms", "employees", "employee_code", `COALESCE(e.${quote("employee_code")},'PENDING EMPLOYEE CODE')`, "BRIDGED EMPLOYEE CODE OR PENDING"));
    if (has(employeeColumns, "date_of_joining")) addField(fields, "ACTUAL_JOINING_DATE", derivedField("mas_hrms", "employees", "date_of_joining", fmtDate(`e.${quote("date_of_joining")}`), "ACTUAL JOINING DATE"));
    const exitColumn = first(employeeColumns, ["date_of_exit", "date_of_leaving"]);
    if (has(employeeColumns, "date_of_joining") && exitColumn) addField(fields, "EARLY_ATTRITION_FLAG", derivedField("mas_hrms", "employees", `date_of_joining,${exitColumn}`, `CASE WHEN DATEDIFF(e.${quote(exitColumn)},e.${quote("date_of_joining")})<=90 THEN 'YES' ELSE 'NO' END`, "EXIT WITHIN 90 DAYS"));
  } else {
    addField(fields, "EMPLOYEE_CODE", constantField("'PENDING EMPLOYEE CODE'", "EMPLOYEE BRIDGE UNAVAILABLE"));
  }

  const stageTable = await sourceTableSql("ats_candidate_stage_log");
  const stageColumns = await sourceColumns("ats_candidate_stage_log");
  if (stageTable && has(stageColumns, "candidate_id") && has(stageColumns, "to_stage") && has(stageColumns, "stage_date")) {
    joins.push(`LEFT JOIN (
      SELECT ${quote("candidate_id")} candidate_id,
        MAX(${quote("stage_date")}) latest_stage_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%screen%' THEN ${quote("stage_date")} END) screening_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%hr%' THEN ${quote("stage_date")} END) hr_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%skill%' THEN ${quote("stage_date")} END) skill_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%ops%' THEN ${quote("stage_date")} END) ops_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) LIKE '%client%' THEN ${quote("stage_date")} END) client_date,
        MAX(CASE WHEN LOWER(${quote("to_stage")}) IN ('selected','selection','final_selected') THEN ${quote("stage_date")} END) selected_date
      FROM ${stageTable}
      GROUP BY ${quote("candidate_id")}
    ) stage ON stage.candidate_id=c.${quote(candidateId)}`);
    addField(fields, "STAGE_ENTRY_DATE", derivedField("mas_hrms", "ats_candidate_stage_log", "stage_date", fmtDate("stage.latest_stage_date"), "LATEST STAGE DATE"));
    addField(fields, "STAGE_AGEING_DAYS", derivedField("mas_hrms", "ats_candidate_stage_log", "stage_date", "DATEDIFF(CURRENT_DATE(),DATE(stage.latest_stage_date))", "CURRENT DATE MINUS LATEST STAGE DATE"));
    addField(fields, "SCREENING_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN stage.screening_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "SCREEN STAGE PRESENCE"));
    addField(fields, "HR_ROUND_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN stage.hr_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "HR STAGE PRESENCE"));
    addField(fields, "SKILL_TEST_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN stage.skill_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "SKILL STAGE PRESENCE"));
    addField(fields, "OPS_ROUND_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN stage.ops_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "OPS STAGE PRESENCE"));
    addField(fields, "CLIENT_ROUND_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN stage.client_date IS NULL THEN 'NOT RECORDED' ELSE 'COMPLETED' END", "CLIENT STAGE PRESENCE"));
    addField(fields, "FINAL_SELECTION_STATUS", derivedField("mas_hrms", "ats_candidate_stage_log", "to_stage", "CASE WHEN stage.selected_date IS NULL THEN 'NOT SELECTED/NOT RECORDED' ELSE 'SELECTED' END", "SELECTION STAGE PRESENCE"));
  }

  const offerTable = await sourceTableSql("ats_offer_letters");
  const offerColumns = await sourceColumns("ats_offer_letters");
  if (offerTable && has(offerColumns, "candidate_id") && has(offerColumns, "created_at")) {
    joins.push(`LEFT JOIN (
      SELECT offer.* FROM ${offerTable} offer
      JOIN (SELECT ${quote("candidate_id")} candidate_id,MAX(${quote("created_at")}) latest_created FROM ${offerTable} GROUP BY ${quote("candidate_id")}) latest
        ON latest.candidate_id=offer.${quote("candidate_id")} AND latest.latest_created=offer.${quote("created_at")}
    ) offer ON offer.${quote("candidate_id")}=c.${quote(candidateId)}`);
    addField(fields, "OFFER_STATUS", directField("offer", "ats_offer_letters", offerColumns, ["status"]));
    const offerDate = first(offerColumns, ["offer_date", "sent_at", "created_at"]);
    if (offerDate) addField(fields, "OFFER_DATE", derivedField("mas_hrms", "ats_offer_letters", offerDate, fmtDate(`offer.${quote(offerDate)}`), "LATEST OFFER DATE"));
    addField(fields, "OFFERED_CTC", directField("offer", "ats_offer_letters", offerColumns, ["salary_ctc"]));
    if (has(offerColumns, "joining_date")) addField(fields, "EXPECTED_JOINING_DATE", derivedField("mas_hrms", "ats_offer_letters", "joining_date", fmtDate(`offer.${quote("joining_date")}`), "OFFER JOINING DATE"));
  }

  const bgvTable = await sourceTableSql("candidate_bgv_check");
  const bgvColumns = await sourceColumns("candidate_bgv_check");
  if (bgvTable && has(bgvColumns, "candidate_id") && has(bgvColumns, "status")) {
    joins.push(`LEFT JOIN (
      SELECT ${quote("candidate_id")} candidate_id,COUNT(*) checks,
        SUM(${quote("status")}='verified') verified,
        SUM(${quote("status")} IN ('mismatch','failed','manual_review')) risks
      FROM ${bgvTable} GROUP BY ${quote("candidate_id")}
    ) bgv ON bgv.candidate_id=c.${quote(candidateId)}`);
    addField(fields, "BGV_STATUS", derivedField("mas_hrms", "candidate_bgv_check", "status", "CASE WHEN bgv.checks IS NULL THEN 'NOT STARTED' WHEN bgv.risks>0 THEN 'REVIEW REQUIRED' WHEN bgv.verified=bgv.checks THEN 'VERIFIED' ELSE 'IN PROGRESS' END", "AGGREGATED BGV CHECK STATUS"));
  }

  const lmsTable = await sourceTableSql("lms_learning_progress_snapshot");
  const lmsColumns = await sourceColumns("lms_learning_progress_snapshot");
  if (lmsTable && employeeTable && has(lmsColumns, "employee_id")) {
    joins.push(`LEFT JOIN (
      SELECT ${quote("employee_id")} employee_id,
        ${has(lmsColumns,"score") ? `AVG(${quote("score")})` : "NULL"} average_score,
        ${has(lmsColumns,"completion_pct") ? `AVG(${quote("completion_pct")})` : "NULL"} completion,
        ${has(lmsColumns,"status") ? `CASE WHEN SUM(${quote("status")}='failed')>0 THEN 'FAILED' WHEN AVG(${has(lmsColumns,"completion_pct") ? quote("completion_pct") : "NULL"})=100 THEN 'COMPLETED' ELSE 'IN PROGRESS' END` : "NULL"} readiness
      FROM ${lmsTable} GROUP BY ${quote("employee_id")}
    ) lms ON lms.employee_id=e.${quote("id")}`);
    addField(fields, "ASSESSMENT_SCORE_PERCENTAGE", derivedField("mas_hrms", "lms_learning_progress_snapshot", "score", "lms.average_score", "AVERAGE LMS SCORE"));
    addField(fields, "ONBOARDING_COMPLETION_PERCENTAGE", derivedField("mas_hrms", "lms_learning_progress_snapshot", "completion_pct", "lms.completion", "AVERAGE LMS COMPLETION"));
    addField(fields, "READINESS_STATUS", derivedField("mas_hrms", "lms_learning_progress_snapshot", "status,completion_pct", "lms.readiness", "LMS COMPLETION/FAILURE STATUS"));
  }
  addField(fields, "DATA_SOURCE", constantField("'ATS+EXACT_BRANCH_PROCESS_MAPPING+OFFER+BGV+LMS'", "GOVERNED SOURCE SET"));

  const bounds = dateBounds(filters);
  const where = [`DATE(c.${quote(activityDate)}) BETWEEN ? AND ?`];
  const params: unknown[] = [bounds.from, bounds.to];
  const resolvedBranch = employeeTable && has(employeeColumns,"branch_id") && branchTable && has(branchColumns,"id")
    ? `COALESCE(e.${quote("branch_id")},candidate_branch.${quote("id")})`
    : branchTable && has(branchColumns,"id") ? `candidate_branch.${quote("id")}` : null;
  if (!scope.isSuperAdmin && scope.branchIds.length) {
    if (scope.branchIds.includes(NO_SCOPE_SENTINEL) || !resolvedBranch) where.push("1=0");
    else { where.push(`${resolvedBranch} IN (${scope.branchIds.map(() => "?").join(",")})`); params.push(...scope.branchIds); }
  }
  if (filters.branchId) {
    if (resolvedBranch) { where.push(`${resolvedBranch}=?`); params.push(filters.branchId); }
    else where.push("1=0");
  }
  if (filters.processId) {
    const resolvedProcess = employeeTable && has(employeeColumns,"process_id") && processTable && has(processColumns,"id")
      ? `COALESCE(e.${quote("process_id")},candidate_process.${quote("id")})`
      : processTable && has(processColumns,"id") ? `candidate_process.${quote("id")}` : null;
    if (resolvedProcess) { where.push(`${resolvedProcess}=?`); params.push(filters.processId); }
    else where.push("1=0");
  }
  if (filters.employeeCode) {
    if (employeeTable) { where.push(`e.${quote("employee_code")}=?`); params.push(filters.employeeCode); }
    else where.push("1=0");
  }

  return executeVerifiedReport({
    code,
    sourceTable: "ATS_CANDIDATE+EXACT_BRANCH_SCOPE+OFFER+BGV+LMS",
    fields,
    fromSql: `${candidateTable} c`,
    joins,
    where,
    params: [...joinParams, ...params],
    orderBy: `${quote("APPLICATION_DATE")} DESC,${quote("CANDIDATE_ID")}`,
    grainKeys: ["CANDIDATE_ID", "REPORT_DATE"],
    filters,
  });
}

export async function runSafeVerifiedBusinessAdapter(
  code: string,
  filters: VerifiedAdapterFilters,
  scope: BranchScope
): Promise<VerifiedAdapterResult | null> {
  if (code === "bpo-recruitment-training-readiness-master") return safeRecruitment(code, filters, scope);
  return runVerifiedBusinessAdapter(code, filters, scope);
}
