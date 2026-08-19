import type { RowDataPacket } from "mysql2";
import { sqlLimitOffset } from "../../db/pagination.js";
import { db } from "../../db/mysql.js";
import type { BranchScope } from "./reporting.scope.js";

export interface JourneyAuditFilters {
  from?: string;
  to?: string;
  employeeCode?: string;
  candidateId?: string;
  branchId?: string;
  module?: string;
  limit?: number;
  offset?: number;
}

type SourceSpec = {
  key: string;
  title: string;
  table: string;
  requiredColumns: string[];
  authoritativeFor: string[];
  activityDateColumn: string;
  actorColumn?: string;
  immutable: boolean;
};

const SOURCE_REGISTRY: SourceSpec[] = [
  { key: "ATS_CANDIDATE", title: "ATS CANDIDATE CREATION", table: "ats_candidate", requiredColumns: ["id", "candidate_code", "full_name", "current_stage", "created_at"], authoritativeFor: ["APPLICATION CREATED", "CURRENT ATS STAGE"], activityDateColumn: "created_at", immutable: false },
  { key: "ATS_STAGE_LOG", title: "ATS STAGE HISTORY", table: "ats_candidate_stage_log", requiredColumns: ["id", "candidate_id", "from_stage", "to_stage", "stage_date", "updated_by"], authoritativeFor: ["INTERVIEW STAGE MOVEMENT", "SELECTION/REJECTION MOVEMENT"], activityDateColumn: "stage_date", actorColumn: "updated_by", immutable: true },
  { key: "ONBOARDING_BRIDGE", title: "CANDIDATE TO EMPLOYEE BRIDGE", table: "ats_onboarding_bridge", requiredColumns: ["id", "candidate_id", "employee_id", "bridge_date", "status", "created_at"], authoritativeFor: ["EMPLOYEE CODE LINKAGE", "JOINING BRIDGE"], activityDateColumn: "created_at", actorColumn: "created_by", immutable: true },
  { key: "EMPLOYEE_JOURNEY", title: "EMPLOYEE JOURNEY LOG", table: "employee_journey_log", requiredColumns: ["id", "employee_id", "event_type", "event_date", "description", "created_at"], authoritativeFor: ["EMPLOYEE JOURNEY EVENT"], activityDateColumn: "created_at", actorColumn: "triggered_by", immutable: true },
  { key: "LIFECYCLE_EVENT", title: "EMPLOYEE LIFECYCLE EVENT", table: "employee_lifecycle_event", requiredColumns: ["id", "employee_id", "event_type", "effective_date", "old_value_json", "new_value_json", "created_at"], authoritativeFor: ["CONFIRMATION", "TRANSFER", "PROMOTION", "ROLE/BRANCH/PROCESS CHANGE"], activityDateColumn: "created_at", actorColumn: "initiated_by", immutable: true },
  { key: "JOB_HISTORY", title: "EMPLOYEE JOB HISTORY", table: "employee_job_history", requiredColumns: ["id", "employee_id", "effective_date", "change_type", "created_at"], authoritativeFor: ["POSITION HISTORY", "SALARY/ORG MOVEMENT HISTORY"], activityDateColumn: "created_at", actorColumn: "created_by", immutable: true },
  { key: "COACHING", title: "COACHING SESSION", table: "coaching_session", requiredColumns: ["id", "employee_id", "session_date", "session_type", "status", "created_at"], authoritativeFor: ["COACHING", "DEVELOPMENT DISCUSSION"], activityDateColumn: "created_at", actorColumn: "coach_user_id", immutable: true },
  { key: "PIP", title: "PERFORMANCE IMPROVEMENT PLAN", table: "pip_record", requiredColumns: ["id", "employee_id", "start_date", "end_date", "reason", "status", "created_at"], authoritativeFor: ["PIP START", "PIP STATUS", "PIP OUTCOME"], activityDateColumn: "created_at", actorColumn: "initiated_by", immutable: true },
  { key: "LETTER", title: "GENERATED EMPLOYEE LETTER", table: "generated_letter", requiredColumns: ["id", "employee_id", "letter_type", "issued_date", "created_at"], authoritativeFor: ["OFFER/CONFIRMATION/EXPERIENCE LETTER ISSUANCE"], activityDateColumn: "created_at", actorColumn: "generated_by", immutable: true },
  { key: "ASSET_ASSIGNMENT", title: "ASSET CUSTODY", table: "asset_assignment", requiredColumns: ["id", "asset_id", "employee_id", "assigned_date", "returned_date", "created_at"], authoritativeFor: ["ASSET ISSUE", "ASSET RETURN"], activityDateColumn: "created_at", actorColumn: "assigned_by", immutable: true },
  { key: "EXIT_REQUEST", title: "EXIT REQUEST", table: "exit_request", requiredColumns: ["id", "employee_id", "exit_type", "exit_sub_type", "status", "created_at"], authoritativeFor: ["RESIGNATION/TERMINATION INITIATION", "EXIT STATUS", "LAST WORKING DAY"], activityDateColumn: "created_at", actorColumn: "initiated_by_user_id", immutable: false },
  { key: "EXIT_APPROVAL", title: "EXIT APPROVAL HISTORY", table: "exit_approval_log", requiredColumns: ["id", "exit_request_id", "stage", "action", "action_by", "action_by_role", "created_at"], authoritativeFor: ["EXIT DISCUSSION", "EXIT APPROVAL/REJECTION/REVOCATION"], activityDateColumn: "created_at", actorColumn: "action_by", immutable: true },
  // 2026-08-19: was exit_clearance_checklist (0 live rows, abandoned) — exit_clearance_task
  // is what the exit module writes (24 live rows); department -> clearance_area, assigned_to
  // -> owner_user_id (a real user id — owner_role holds a role string like 'payroll'/'wfm').
  { key: "EXIT_CLEARANCE", title: "EXIT CLEARANCE HISTORY", table: "exit_clearance_task", requiredColumns: ["id", "exit_request_id", "clearance_area", "status", "created_at"], authoritativeFor: ["DEPARTMENT CLEARANCE", "EXIT RECOVERY"], activityDateColumn: "created_at", actorColumn: "owner_user_id", immutable: true },
  { key: "SENSITIVE_ACTION", title: "SENSITIVE ACTION LOG", table: "sensitive_action_log", requiredColumns: ["id", "action_type", "module_key", "created_at"], authoritativeFor: ["SENSITIVE DATA CHANGE", "PRIVILEGED ACTION"], activityDateColumn: "created_at", actorColumn: "actor_user_id", immutable: true },
  { key: "AUDIT_LOG", title: "SYSTEM AUDIT LOG", table: "audit_log", requiredColumns: ["id", "action_type", "module_key", "created_at"], authoritativeFor: ["SYSTEM USER ACTIVITY", "CONTROL EVIDENCE"], activityDateColumn: "created_at", actorColumn: "actor_user_id", immutable: true },
  { key: "ATS_OFFER", title: "OFFER MANAGEMENT", table: "ats_offer", requiredColumns: ["id", "candidate_id", "status", "offer_date", "created_at"], authoritativeFor: ["OFFER CREATED", "OFFER STATUS", "OFFER ACCEPTED/REJECTED"], activityDateColumn: "created_at", actorColumn: "prepared_by", immutable: false },
  { key: "LEAVE_REQUEST", title: "LEAVE REQUEST", table: "leave_request", requiredColumns: ["id", "employee_id", "leave_type_id", "from_date", "to_date", "status", "applied_at"], authoritativeFor: ["LEAVE APPLIED", "LEAVE APPROVED", "LEAVE REJECTED"], activityDateColumn: "applied_at", immutable: false },
  // NOTE: salary_prep_run is a run-level batch record with no employee_id.
  // This entry enables verifySources() schema checking only.
  // Per-employee payroll events require joining through salary_prep_line.
  { key: "SALARY_RUN", title: "PAYROLL RUN RECORD", table: "salary_prep_run", requiredColumns: ["id", "run_month", "status", "created_at"], authoritativeFor: ["PAYROLL RUN CREATED", "PAYROLL RUN APPROVED"], activityDateColumn: "created_at", actorColumn: "created_by", immutable: false },
  { key: "REGULARISATION", title: "ATTENDANCE REGULARISATION", table: "attendance_regularization", requiredColumns: ["id", "employee_id", "session_date", "status", "reason", "reviewed_by", "created_at"], authoritativeFor: ["REGULARISATION REQUEST", "REGULARISATION APPROVED"], activityDateColumn: "created_at", actorColumn: "reviewed_by", immutable: false },
];

async function schemaColumns() {
  const tables = SOURCE_REGISTRY.map((source) => source.table);
  const placeholders = tables.map(() => "?").join(",");
  // Alias to lowercase explicitly — information_schema hands back UPPERCASE keys.
  //
  // MySQL 8 returns TABLE_NAME / COLUMN_NAME as the result-set labels no matter how
  // the SELECT is written, so `row.table_name` was undefined and this map ended up
  // with a single key, the string "undefined". Every columns.get(source.table) then
  // missed, so every source scored TABLE_MISSING and the has() gate below never
  // opened: the report claimed all 14 sources were absent AND returned no rows,
  // against tables that are present and populated. Verified on live 8.0.42 — an
  // explicit alias is what restores the lowercase key, and legacy-analyzer.service.ts
  // already reads it this way.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders})`,
    tables,
  );
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = String(row.table_name);
    if (!map.has(table)) map.set(table, new Set());
    map.get(table)!.add(String(row.column_name));
  }
  return map;
}

function has(columns: Map<string, Set<string>>, table: string, required: string[]) {
  const actual = columns.get(table);
  return Boolean(actual && required.every((column) => actual.has(column)));
}

function branchPredicate(scope: BranchScope, alias = "e") {
  if (scope.isSuperAdmin || scope.branchIds.length === 0) return { sql: "1=1", params: [] as unknown[] };
  return {
    sql: `${alias}.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`,
    params: [...scope.branchIds],
  };
}

function normaliseFilters(input: JourneyAuditFilters) {
  return {
    from: input.from ?? "1900-01-01",
    to: input.to ?? "2999-12-31",
    employeeCode: input.employeeCode?.trim() || undefined,
    candidateId: input.candidateId?.trim() || undefined,
    branchId: input.branchId?.trim() || undefined,
    module: input.module?.trim().toUpperCase() || undefined,
    limit: Math.min(5000, Math.max(1, Number(input.limit ?? 200))),
    offset: Math.max(0, Number(input.offset ?? 0)),
  };
}

function commonActorJoins(actorExpression: string) {
  return `LEFT JOIN employees actor_employee ON actor_employee.id = ${actorExpression}
          LEFT JOIN employees actor_user_employee ON actor_user_employee.user_id = ${actorExpression}`;
}

export const journeyAuditReportService = {
  async verifySources() {
    const columns = await schemaColumns();
    return SOURCE_REGISTRY.map((source) => {
      const actual = columns.get(source.table) ?? new Set<string>();
      const missingColumns = source.requiredColumns.filter((column) => !actual.has(column));
      return {
        SOURCE_KEY: source.key,
        SOURCE_TITLE: source.title,
        SOURCE_TABLE: source.table,
        SOURCE_STATUS: missingColumns.length === 0 ? "VERIFIED" : actual.size ? "COLUMN_GAP" : "TABLE_MISSING",
        AUTHORITATIVE_FOR: source.authoritativeFor.join(" | "),
        ACTIVITY_DATE_COLUMN: source.activityDateColumn,
        ACTOR_COLUMN: source.actorColumn ?? "SYSTEM/NOT RECORDED",
        IMMUTABLE_EVENT_SOURCE: source.immutable ? "YES" : "NO",
        REQUIRED_COLUMNS: source.requiredColumns.join(" | "),
        MISSING_COLUMNS: missingColumns.join(" | "),
        VERIFIED_AT: new Date().toISOString(),
      };
    });
  },

  async journey(filtersInput: JourneyAuditFilters, scope: BranchScope) {
    const filters = normaliseFilters(filtersInput);
    const columns = await schemaColumns();
    const parts: string[] = [];
    const params: unknown[] = [];
    const branch = branchPredicate(scope);

    if (has(columns, "ats_candidate", ["id", "candidate_code", "full_name", "current_stage", "created_at"])) {
      parts.push(`SELECT
        COALESCE(e.employee_code, 'PENDING EMPLOYEE CODE') AS EMPLOYEE_CODE,
        DATE_FORMAT(c.created_at, '%d-%b-%Y') AS REPORT_DATE,
        c.id AS CANDIDATE_ID, c.candidate_code AS CANDIDATE_CODE, c.full_name AS PERSON_NAME,
        'RECRUITMENT' AS JOURNEY_PHASE, 'APPLICATION CREATED' AS ACTIVITY_TYPE,
        c.current_stage AS ACTIVITY_STATUS, c.created_at AS ACTIVITY_DATETIME,
        NULL AS EFFECTIVE_DATE, 'SYSTEM' AS ACTOR_CODE, 'SYSTEM' AS ACTOR_NAME, 'SYSTEM' AS ACTOR_ROLE,
        c.id AS SOURCE_RECORD_ID, 'ats_candidate' AS SOURCE_TABLE, 'ats_candidate.created_at' AS SOURCE_FIELD,
        'AUTHORITATIVE' AS SOURCE_CONFIDENCE, NULL AS OLD_VALUE, c.current_stage AS NEW_VALUE,
        c.sourcing_channel AS ACTIVITY_DETAIL, c.remarks AS REMARKS,
        b.branch_name AS BRANCH, p.process_name AS PROCESS, d.dept_name AS DEPARTMENT
       FROM ats_candidate c
       LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
       LEFT JOIN employees e ON e.id = ob.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master d ON d.id = e.department_id
       WHERE c.created_at BETWEEN ? AND ? AND (${branch.sql})`);
      params.push(filters.from, `${filters.to} 23:59:59`, ...branch.params);
    }

    if (has(columns, "ats_candidate_stage_log", ["id", "candidate_id", "from_stage", "to_stage", "stage_date", "updated_by"])) {
      parts.push(`SELECT
        COALESCE(e.employee_code, 'PENDING EMPLOYEE CODE') AS EMPLOYEE_CODE,
        DATE_FORMAT(l.stage_date, '%d-%b-%Y') AS REPORT_DATE,
        c.id AS CANDIDATE_ID, c.candidate_code AS CANDIDATE_CODE, c.full_name AS PERSON_NAME,
        'INTERVIEW / SELECTION' AS JOURNEY_PHASE, 'ATS STAGE MOVEMENT' AS ACTIVITY_TYPE,
        l.to_stage AS ACTIVITY_STATUS, l.stage_date AS ACTIVITY_DATETIME,
        DATE(l.stage_date) AS EFFECTIVE_DATE,
        COALESCE(actor_employee.employee_code, actor_user_employee.employee_code, CAST(l.updated_by AS CHAR), 'SYSTEM') AS ACTOR_CODE,
        COALESCE(actor_employee.full_name, actor_user_employee.full_name, 'SYSTEM') AS ACTOR_NAME,
        'ATS USER' AS ACTOR_ROLE,
        l.id AS SOURCE_RECORD_ID, 'ats_candidate_stage_log' AS SOURCE_TABLE, 'ats_candidate_stage_log.stage_date' AS SOURCE_FIELD,
        'AUTHORITATIVE' AS SOURCE_CONFIDENCE, l.from_stage AS OLD_VALUE, l.to_stage AS NEW_VALUE,
        l.remarks AS ACTIVITY_DETAIL, l.remarks AS REMARKS,
        b.branch_name AS BRANCH, p.process_name AS PROCESS, d.dept_name AS DEPARTMENT
       FROM ats_candidate_stage_log l
       JOIN ats_candidate c ON c.id = l.candidate_id
       LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
       LEFT JOIN employees e ON e.id = ob.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master d ON d.id = e.department_id
       ${commonActorJoins("l.updated_by")}
       WHERE l.stage_date BETWEEN ? AND ? AND (${branch.sql})`);
      params.push(filters.from, `${filters.to} 23:59:59`, ...branch.params);
    }

    if (has(columns, "employee_journey_log", ["id", "employee_id", "event_type", "event_date", "description", "created_at"])) {
      parts.push(`SELECT e.employee_code AS EMPLOYEE_CODE, DATE_FORMAT(j.created_at, '%d-%b-%Y') AS REPORT_DATE,
        NULL AS CANDIDATE_ID, NULL AS CANDIDATE_CODE, e.full_name AS PERSON_NAME,
        COALESCE(j.module, 'EMPLOYEE LIFECYCLE') AS JOURNEY_PHASE, j.event_type AS ACTIVITY_TYPE,
        j.event_type AS ACTIVITY_STATUS, j.created_at AS ACTIVITY_DATETIME, j.event_date AS EFFECTIVE_DATE,
        COALESCE(actor_employee.employee_code, actor_user_employee.employee_code, CAST(j.triggered_by AS CHAR), 'SYSTEM') AS ACTOR_CODE,
        COALESCE(actor_employee.full_name, actor_user_employee.full_name, 'SYSTEM') AS ACTOR_NAME, 'HRMS USER' AS ACTOR_ROLE,
        j.id AS SOURCE_RECORD_ID, 'employee_journey_log' AS SOURCE_TABLE, 'employee_journey_log.created_at' AS SOURCE_FIELD,
        'AUTHORITATIVE' AS SOURCE_CONFIDENCE, j.old_value AS OLD_VALUE, j.new_value AS NEW_VALUE,
        j.description AS ACTIVITY_DETAIL, j.description AS REMARKS,
        b.branch_name AS BRANCH, p.process_name AS PROCESS, d.dept_name AS DEPARTMENT
       FROM employee_journey_log j JOIN employees e ON e.id = j.employee_id
       LEFT JOIN branch_master b ON b.id=e.branch_id LEFT JOIN process_master p ON p.id=e.process_id LEFT JOIN department_master d ON d.id=e.department_id
       ${commonActorJoins("j.triggered_by")}
       WHERE j.created_at BETWEEN ? AND ? AND (${branch.sql})`);
      params.push(filters.from, `${filters.to} 23:59:59`, ...branch.params);
    }

    if (has(columns, "employee_lifecycle_event", ["id", "employee_id", "event_type", "effective_date", "old_value_json", "new_value_json", "created_at"])) {
      parts.push(`SELECT e.employee_code, DATE_FORMAT(le.created_at,'%d-%b-%Y'), NULL,NULL,e.full_name,
        'EMPLOYMENT LIFECYCLE', le.event_type, COALESCE(CAST(le.approved_by AS CHAR),'RECORDED'), le.created_at, le.effective_date,
        COALESCE(actor_employee.employee_code,actor_user_employee.employee_code,CAST(le.initiated_by AS CHAR),'SYSTEM'),
        COALESCE(actor_employee.full_name,actor_user_employee.full_name,'SYSTEM'),'HR/LIFECYCLE USER',
        le.id,'employee_lifecycle_event','employee_lifecycle_event.created_at','AUTHORITATIVE',
        CAST(le.old_value_json AS CHAR),CAST(le.new_value_json AS CHAR),le.remarks,le.remarks,
        b.branch_name,p.process_name,d.department_name
       FROM employee_lifecycle_event le JOIN employees e ON e.id=le.employee_id
       LEFT JOIN branch_master b ON b.id=e.branch_id LEFT JOIN process_master p ON p.id=e.process_id LEFT JOIN department_master d ON d.id=e.department_id
       ${commonActorJoins("le.initiated_by")}
       WHERE le.created_at BETWEEN ? AND ? AND (${branch.sql})`);
      params.push(filters.from, `${filters.to} 23:59:59`, ...branch.params);
    }

    if (has(columns, "employee_job_history", ["id", "employee_id", "effective_date", "change_type", "created_at"])) {
      parts.push(`SELECT e.employee_code,DATE_FORMAT(jh.created_at,'%d-%b-%Y'),NULL,NULL,e.full_name,
        'JOB HISTORY',jh.change_type,jh.change_type,jh.created_at,jh.effective_date,
        COALESCE(actor_employee.employee_code,actor_user_employee.employee_code,CAST(jh.created_by AS CHAR),'SYSTEM'),
        COALESCE(actor_employee.full_name,actor_user_employee.full_name,'SYSTEM'),'HR USER',
        jh.id,'employee_job_history','employee_job_history.created_at','AUTHORITATIVE',
        CONCAT_WS('|',jh.from_branch_id,jh.from_process_id,jh.from_designation_id,jh.from_manager_id),
        CONCAT_WS('|',jh.to_branch_id,jh.to_process_id,jh.to_designation_id,jh.to_manager_id),jh.reason,jh.reason,
        b.branch_name,p.process_name,d.department_name
       FROM employee_job_history jh JOIN employees e ON e.id=jh.employee_id
       LEFT JOIN branch_master b ON b.id=e.branch_id LEFT JOIN process_master p ON p.id=e.process_id LEFT JOIN department_master d ON d.id=e.department_id
       ${commonActorJoins("jh.created_by")}
       WHERE jh.created_at BETWEEN ? AND ? AND (${branch.sql})`);
      params.push(filters.from, `${filters.to} 23:59:59`, ...branch.params);
    }

    if (has(columns, "exit_approval_log", ["id", "exit_request_id", "stage", "action", "action_by", "action_by_role", "created_at"])) {
      parts.push(`SELECT e.employee_code,DATE_FORMAT(xl.created_at,'%d-%b-%Y'),NULL,NULL,e.full_name,
        'EXIT',xl.stage,xl.action,xl.created_at,DATE(xl.created_at),
        COALESCE(actor_employee.employee_code,actor_user_employee.employee_code,CAST(xl.action_by AS CHAR)),
        COALESCE(actor_employee.full_name,actor_user_employee.full_name,'UNKNOWN USER'),xl.action_by_role,
        xl.id,'exit_approval_log','exit_approval_log.created_at','AUTHORITATIVE',NULL,xl.action,
        xl.discussion_remarks,CONCAT_WS(' | ',xl.discussion_remarks,xl.internal_notes),
        b.branch_name,p.process_name,d.department_name
       FROM exit_approval_log xl JOIN exit_request xr ON xr.id=xl.exit_request_id JOIN employees e ON e.id=xr.employee_id
       LEFT JOIN branch_master b ON b.id=e.branch_id LEFT JOIN process_master p ON p.id=e.process_id LEFT JOIN department_master d ON d.id=e.department_id
       ${commonActorJoins("xl.action_by")}
       WHERE xl.created_at BETWEEN ? AND ? AND (${branch.sql})`);
      params.push(filters.from, `${filters.to} 23:59:59`, ...branch.params);
    }

    // 2026-08-19: was exit_clearance_checklist (0 live rows) — exit_clearance_task is what
    // the exit module writes (24 live rows). department -> clearance_area, assigned_to ->
    // owner_user_id (a real user id, unlike owner_role which holds a role string).
    if (has(columns, "exit_clearance_task", ["id", "exit_request_id", "clearance_area", "status", "created_at"])) {
      parts.push(`SELECT e.employee_code,DATE_FORMAT(COALESCE(ec.cleared_at,ec.created_at),'%d-%b-%Y'),NULL,NULL,e.full_name,
        'EXIT CLEARANCE',ec.clearance_area,ec.status,COALESCE(ec.cleared_at,ec.created_at),DATE(COALESCE(ec.cleared_at,ec.created_at)),
        COALESCE(actor_employee.employee_code,actor_user_employee.employee_code,CAST(ec.owner_user_id AS CHAR),'SYSTEM'),
        COALESCE(actor_employee.full_name,actor_user_employee.full_name,'SYSTEM'),ec.clearance_area,
        ec.id,'exit_clearance_task',IF(ec.cleared_at IS NULL,'exit_clearance_task.created_at','exit_clearance_task.cleared_at'),'AUTHORITATIVE',NULL,ec.status,
        ec.remarks,ec.remarks,b.branch_name,p.process_name,d.department_name
       FROM exit_clearance_task ec JOIN exit_request xr ON xr.id=ec.exit_request_id JOIN employees e ON e.id=xr.employee_id
       LEFT JOIN branch_master b ON b.id=e.branch_id LEFT JOIN process_master p ON p.id=e.process_id LEFT JOIN department_master d ON d.id=e.department_id
       ${commonActorJoins("ec.owner_user_id")}
       WHERE COALESCE(ec.cleared_at,ec.created_at) BETWEEN ? AND ? AND (${branch.sql})`);
      params.push(filters.from, `${filters.to} 23:59:59`, ...branch.params);
    }

    if (parts.length === 0) return { rows: [], totalCount: 0, sources: [], message: "No verified lifecycle source is available." };
    let sql = parts.join("\nUNION ALL\n");
    const outer: string[] = [];
    if (filters.employeeCode) { outer.push("EMPLOYEE_CODE = ?"); params.push(filters.employeeCode); }
    if (filters.candidateId) { outer.push("CANDIDATE_ID = ?"); params.push(filters.candidateId); }
    if (filters.module) { outer.push("UPPER(JOURNEY_PHASE) LIKE ?"); params.push(`%${filters.module}%`); }
    sql = `SELECT * FROM (${sql}) journey${outer.length ? ` WHERE ${outer.join(" AND ")}` : ""}`;
    const countSql = `SELECT COUNT(*) AS total FROM (${sql}) counted`;
    const [countRows] = await db.execute<RowDataPacket[]>(countSql, params);
    const [rows] = await db.execute<RowDataPacket[]>(`${sql} ORDER BY ACTIVITY_DATETIME ASC, SOURCE_TABLE, SOURCE_RECORD_ID ${sqlLimitOffset(filters.limit, filters.offset)}`, params);

    // Compute DAYS_FROM_PREVIOUS_EVENT per person key
    const lastEventDateByPerson = new Map<string, Date>();
    for (const row of rows as Record<string, unknown>[]) {
      const empCode = String(row["EMPLOYEE_CODE"] ?? "");
      const personKey = (empCode && empCode !== "PENDING EMPLOYEE CODE")
        ? empCode
        : String(row["CANDIDATE_ID"] ?? "UNKNOWN");
      const activityDateRaw = row["ACTIVITY_DATETIME"];
      if (activityDateRaw) {
        const activityDate = new Date(String(activityDateRaw));
        const lastDate = lastEventDateByPerson.get(personKey);
        if (lastDate && !Number.isNaN(activityDate.getTime())) {
          const diffMs = activityDate.getTime() - lastDate.getTime();
          row["DAYS_FROM_PREVIOUS_EVENT"] = Math.round(diffMs / (1000 * 60 * 60 * 24));
        } else {
          row["DAYS_FROM_PREVIOUS_EVENT"] = null;
        }
        if (!Number.isNaN(activityDate.getTime())) {
          lastEventDateByPerson.set(personKey, activityDate);
        }
      } else {
        row["DAYS_FROM_PREVIOUS_EVENT"] = null;
      }
    }

    return { rows, totalCount: Number(countRows[0]?.total ?? 0), sources: SOURCE_REGISTRY.filter((s) => has(columns, s.table, s.requiredColumns)).map((s) => s.table), message: null };
  },

  async compliance(filtersInput: JourneyAuditFilters, scope: BranchScope) {
    const journey = await this.journey(filtersInput, scope);
    const rows = journey.rows as RowDataPacket[];
    const controlRows = rows.map((row) => ({
      EMPLOYEE_CODE: row.EMPLOYEE_CODE,
      REPORT_DATE: row.REPORT_DATE,
      CONTROL_DOMAIN: row.JOURNEY_PHASE,
      CONTROL_ACTIVITY: row.ACTIVITY_TYPE,
      CONTROL_STATUS: row.ACTIVITY_STATUS,
      ACTIVITY_DATETIME: row.ACTIVITY_DATETIME,
      ACTOR_CODE: row.ACTOR_CODE,
      ACTOR_EMPLOYEE_CODE: row.ACTOR_CODE,
      ACTOR_NAME: row.ACTOR_NAME,
      ACTOR_ROLE: row.ACTOR_ROLE,
      APPROVER: row.ACTOR_CODE,
      APPROVAL_STATUS: row.ACTIVITY_STATUS,
      SOURCE_TABLE: row.SOURCE_TABLE,
      SOURCE_RECORD_ID: row.SOURCE_RECORD_ID,
      SOURCE_FIELD: row.SOURCE_FIELD,
      SOURCE_CONFIDENCE: row.SOURCE_CONFIDENCE,
      EVIDENCE_COMPLETE_FLAG: row.ACTIVITY_DATETIME && row.SOURCE_RECORD_ID && row.ACTOR_CODE ? "YES" : "NO",
      OLD_VALUE: row.OLD_VALUE,
      NEW_VALUE: row.NEW_VALUE,
      REMARKS: row.REMARKS,
      BRANCH: row.BRANCH,
      PROCESS: row.PROCESS,
    }));
    return { ...journey, rows: controlRows };
  },
};
