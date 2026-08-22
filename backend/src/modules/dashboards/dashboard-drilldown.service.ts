import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { type DashboardScope, buildScopeWhere, buildScopeWhereEmployees } from "../../shared/dashboardScope.js";
import { LATEST_COMPLETE_ATTENDANCE_DATE_SQL } from "../../shared/attendanceStatus.js";

export interface DrilldownResult {
  metricCode: string;
  records: unknown[];
  note?: string;
  /**
   * Rows returned, NOT the size of the underlying population.
   *
   * Every drilldown below caps its query (25, 50, 100 or 200 rows). When the cap is hit
   * this equals the cap, so it must never be read as "there are N of these" — use `note`,
   * which says so explicitly.
   */
  totalCount?: number;
}

/**
 * Says out loud that a drilldown was truncated.
 *
 * Each drilldown is capped, and 12 of the 13 reported `totalCount: rows.length` with no
 * note. On a capped result that reports exactly the cap, which reads as a complete count:
 * a queue of 4,000 open items and a queue of exactly 100 look identical in the drawer.
 * One handler already did this properly (the document-compliance one); this makes the
 * rest match it rather than leaving the disclosure to whoever remembered.
 */
function capNote(returned: number, cap: number, noun: string): string | undefined {
  return returned >= cap
    ? `Showing the first ${cap} ${noun}. More exist — open the full report for the complete list.`
    : undefined;
}

/**
 * Metric drilldowns ("click a tile to see who").
 *
 * Two defects made every one of these unusable:
 *
 *  1. The switch keyed on an older metric-code generation (ONBOARDING_PENDING,
 *     TAT_BREACHED, INCENTIVE_PENDING, RESIGNATION_PENDING) while the metric catalog
 *     emits ONBOARDING / TAT / INCENTIVE / RESIGNATION. The route gate validates against
 *     the catalog, so the old names 404 and the new names fell through to the
 *     "not yet implemented" default.
 *  2. The handlers that did run referenced columns and tables that do not exist
 *     (`branches`, `employees.status`, `bridge_status`, `nm.match_status`,
 *     `ats_candidate.first_name`, `b.batch_status`, `er.exit_status`, …).
 *
 * Every column below is verified against the live schema. Legacy code names are kept
 * as aliases so any caller that hardcoded them keeps working.
 */
export async function getDrilldown(
  metricCode: string,
  scope: DashboardScope,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  switch (metricCode) {
    case "HEADCOUNT":
      return drillHeadcount(scope);
    case "ONBOARDING":
    case "ONBOARDING_PENDING":
      return drillOnboarding(scope, filters);
    case "ATTENDANCE":
      return drillAttendance(scope);
    case "PAYROLL_READINESS":
      return drillPayrollReadiness(scope);
    case "TAT":
    case "TAT_BREACHED":
      return drillTat(scope);
    case "NAME_MISMATCH":
      return drillNameMismatch(scope);
    case "INCENTIVE":
    case "INCENTIVE_PENDING":
      return drillIncentive(scope);
    case "RESIGNATION":
    case "RESIGNATION_PENDING":
      return drillResignation(scope);
    case "BGV":
      return drillBgv(scope);
    case "DPDP":
    case "DPDP_WITHDRAWAL":
      return drillDpdp(scope);
    case "APPOINTMENT_ESIGN":
      return drillAppointmentEsign(scope);
    case "JOINING_DOC_ESIGN":
      return drillJoiningDocEsign(scope);
    case "ATTENDANCE_EXCEPTIONS":
      return drillAttendanceExceptions(scope);
    case "DOC_COMPLIANCE":
      return drillDocCompliance(scope);
    case "BIOMETRIC_ACTIVITY":
      return drillBiometricActivity(scope);
    case "SALARY_COMPONENTS":
      return drillSalaryComponents(scope);
    case "RECRUITER_ACTIVITY":
      return drillRecruiterActivity(scope);
    case "TRAINING_PROGRESS":
      return drillTrainingProgress(scope);
    case "LEAVE_APPROVALS":
      return drillLeaveApprovals(scope);
    case "RECRUITER_PIPELINE":
      return drillRecruiterPipeline(scope, filters);
    default:
      return {
        metricCode,
        records: [],
        note: `Drilldown not yet implemented for ${metricCode}`,
      };
  }
}

/**
 * Candidate-keyed tables carry no branch/process columns. The only route to scope is
 * via the candidate's applied_for_* fields, which hold branch/process NAMES rather than
 * FK ids — hence the join on *_master name rather than id.
 */
const CANDIDATE_SCOPE_JOIN = `
  LEFT JOIN ats_candidate cand ON cand.id = %CANDIDATE_ID%
  LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
  LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process`;

const candidateScopeJoin = (candidateIdExpr: string) =>
  CANDIDATE_SCOPE_JOIN.replace("%CANDIDATE_ID%", candidateIdExpr);

function sourceUnavailable(err: unknown): never {
  throw Object.assign(err as Error, { errorCode: "SOURCE_UNAVAILABLE" });
}

// ─── HEADCOUNT: grouped by branch ────────────────────────────────────────────
async function drillHeadcount(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // buildScopeWhere has no case for TEAM_ONLY/SELF_ONLY and falls back to 1=0 for both —
    // correct for tables it can't otherwise scope, but wrong here: employees carries an id
    // this scope already resolves team/self membership by. A manager's own "Team Members"
    // tile (which does use buildScopeWhereEmployees and shows the real count) previously
    // opened a drilldown that always reported 0 regardless of team size.
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    // `branches` does not exist (the table is branch_master) and employees has no
    // `status` column — the old query threw on both.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.branch_name AS branchName,
              p.process_name AS processName,
              COUNT(*) AS count
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
        -- Matches getHeadcountMetrics exactly: active_status alone (never
        -- employment_status — see that function's comment) plus date_of_joining, so
        -- the drilldown always explains the tile it opens from rather than a
        -- differently-defined "headcount".
        WHERE e.active_status = 1
          AND e.date_of_joining <= CURDATE()
          AND ${scopeSql}
        GROUP BY e.branch_id, b.branch_name, e.process_id, p.process_name
        ORDER BY count DESC`,
      params,
    );
    return {
      metricCode: "HEADCOUNT",
      records: (rows as any[]).map((r) => ({
        branchName: r.branchName ?? "Unassigned",
        processName: r.processName ?? "—",
        count: Number(r.count),
      })),
      totalCount: (rows as any[]).reduce((a, r) => a + Number(r.count), 0),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────
/**
 * Status sets behind each ONBOARDING tile, matching getOnboardingMetrics' own buckets
 * exactly. "Onboarding Pending" and "Onboarding Stuck" both used to open this same
 * drilldown with no filter, so either tile showed an identical breakdown of every
 * status — a click on "Stuck" (2 candidates) opened the same drawer as a click on
 * "Pending" (40 candidates), with no indication which one you'd asked for.
 */
const ONBOARDING_BUCKET_STATUSES: Record<string, readonly string[]> = {
  pending: ["pending", "initiated"],
  stuck: ["stuck"],
};

async function drillOnboarding(
  scope: DashboardScope,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhere(scope, "bm.id", "pm.id");
    const join = candidateScopeJoin("b.candidate_id");

    const bucket = typeof filters?.bucket === "string" ? filters.bucket : null;
    const bucketStatuses = bucket ? ONBOARDING_BUCKET_STATUSES[bucket] : null;
    const bucketSql = bucketStatuses
      ? ` AND b.status IN (${bucketStatuses.map(() => "?").join(",")})`
      : "";
    const bucketParams = bucketStatuses ?? [];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cand.full_name AS candidateName,
              cand.candidate_code AS candidateCode,
              pm.process_name AS appliedProcess,
              bm.branch_name AS appliedBranch,
              b.status AS status,
              b.created_at AS createdAt
         FROM ats_onboarding_bridge b ${join}
        WHERE ${scopeSql}${bucketSql}
        ORDER BY b.created_at ASC
        LIMIT 200`,
      [...params, ...bucketParams],
    );

    const totalCount = rows.length;
    return {
      metricCode: "ONBOARDING",
      records: (rows as any[]).map((r) => ({
        candidateCode: r.candidateCode ?? "—",
        candidateName: r.candidateName ?? "—",
        appliedProcess: r.appliedProcess ?? "—",
        appliedBranch: r.appliedBranch ?? "—",
        status: r.status,
        createdOn: r.createdAt,
      })),
      totalCount,
      note: capNote(totalCount, 200, "candidates"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── ATTENDANCE: today's exceptions ──────────────────────────────────────────
async function drillAttendance(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // Same TEAM_ONLY/SELF_ONLY gap as drillHeadcount above — use the employee-aware builder.
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");

    // Anchor on the latest day that actually carries records. Production attendance
    // trails by a day or two, so CURDATE() routinely selects a near-empty day.
    const [dayRows] = await db.execute<RowDataPacket[]>(
      `SELECT ${LATEST_COMPLETE_ATTENDANCE_DATE_SQL} AS record_date`,
    );
    const day = (dayRows as any[])[0]?.record_date;
    if (!day) {
      return { metricCode: "ATTENDANCE", records: [], note: "No attendance day has usable records" };
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code AS employeeCode,
              COALESCE(e.full_name, CONCAT_WS(' ', e.first_name, e.last_name)) AS employeeName,
              b.branch_name AS branchName,
              a.attendance_status AS attendanceStatus,
              a.late_mark AS lateMark
         FROM attendance_daily_record a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE a.record_date = ?
          AND (a.attendance_status IN ('absent','missing_punch','half_day') OR a.late_mark = 1)
          AND ${scopeSql}
        ORDER BY FIELD(a.attendance_status,'missing_punch','absent','half_day'), e.employee_code
        LIMIT 200`,
      [day, ...params],
    );

    return {
      metricCode: "ATTENDANCE",
      records: (rows as any[]).map((r) => ({
        employeeCode: r.employeeCode,
        employeeName: r.employeeName ?? "—",
        branchName: r.branchName ?? "Unassigned",
        attendanceStatus: r.attendanceStatus,
        lateMark: Boolean(r.lateMark),
        shiftName: null,
      })),
      totalCount: rows.length,
      note: `Exceptions for ${String(day)} (latest day with attendance records)`,
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── PAYROLL_READINESS ───────────────────────────────────────────────────────
async function drillPayrollReadiness(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    // Counts only, never per-employee bank/PAN/UAN values: this drilldown is reachable
    // from dashboards whose viewers are not payroll roles.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.branch_name AS branchName,
              COUNT(*) AS total,
              SUM(CASE WHEN COALESCE(TRIM(e.pan_number),'') = '' THEN 1 ELSE 0 END) AS missingPan,
              SUM(CASE WHEN COALESCE(TRIM(e.uan_number),'') = '' THEN 1 ELSE 0 END) AS missingUan,
              SUM(CASE WHEN COALESCE(TRIM(e.bank_account_number),'') = '' THEN 1 ELSE 0 END) AS missingBank
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE e.active_status = 1 AND ${scopeSql}
        GROUP BY e.branch_id, b.branch_name
        ORDER BY missingPan DESC`,
      params,
    );
    return {
      metricCode: "PAYROLL_READINESS",
      records: (rows as any[]).map((r) => ({
        branchName: r.branchName ?? "Unassigned",
        total: Number(r.total),
        missingPan: Number(r.missingPan),
        missingUan: Number(r.missingUan),
        missingBank: Number(r.missingBank),
      })),
      totalCount: (rows as any[]).reduce((a, r) => a + Number(r.total), 0),
      note: "Aggregated counts only — individual payroll identifiers are not exposed here",
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── TAT ─────────────────────────────────────────────────────────────────────
async function drillTat(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // task_tat_instance has branch_id but no process_id, so process-level narrowing is
    // not expressible here; branch scope still applies.
    const { sql: scopeSql, params } = buildScopeWhere(scope, "t.branch_id", "t.branch_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.id AS taskId,
              t.task_type AS taskType,
              t.task_title AS taskTitle,
              t.entity_id AS entityId,
              t.due_at AS dueAt,
              TIMESTAMPDIFF(HOUR, t.due_at, NOW()) AS ageHours,
              t.owner_role AS ownerRole,
              t.status AS status
         FROM task_tat_instance t
        WHERE t.status NOT IN ('completed','cancelled')
          AND t.due_at IS NOT NULL AND t.due_at < NOW()
          AND ${scopeSql}
        ORDER BY t.due_at ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "TAT",
      records: (rows as any[]).map((r) => ({
        taskId: r.taskId,
        taskType: r.taskType,
        taskTitle: r.taskTitle,
        entityId: r.entityId,
        dueAt: r.dueAt,
        ageHours: Number(r.ageHours ?? 0),
        ownerRole: r.ownerRole,
        status: r.status,
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "overdue tasks"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── NAME_MISMATCH ───────────────────────────────────────────────────────────
async function drillNameMismatch(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhere(scope, "bm.id", "pm.id");
    // Real columns: overall_match_status, blocks_employee_code, mismatch_sources,
    // last_calculated_at. The old query used match_status / is_blocking /
    // mismatch_fields / created_at, none of which exist.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cand.full_name AS name,
              nm.mismatch_sources AS mismatches,
              nm.blocks_employee_code AS blocking,
              nm.overall_match_status AS matchStatus,
              nm.last_calculated_at AS detectedAt
         FROM candidate_name_match_summary nm
         ${candidateScopeJoin("nm.candidate_id")}
        WHERE nm.overall_match_status IN ('mismatch','partial','pending')
          AND ${scopeSql}
        ORDER BY nm.blocks_employee_code DESC, nm.last_calculated_at ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "NAME_MISMATCH",
      records: (rows as any[]).map((r) => ({
        name: r.name ?? "—",
        mismatches: r.mismatches,
        blocking: Boolean(r.blocking),
        matchStatus: r.matchStatus,
        detectedAt: r.detectedAt,
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "mismatches"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── INCENTIVE ───────────────────────────────────────────────────────────────
async function drillIncentive(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhere(scope, "b.branch_id", "b.process_id");
    // batch_ref (not batch_name), status (not batch_status); the approval step table
    // uses status/step_number and has no step_name.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.id AS batchId,
              b.batch_ref AS batchRef,
              b.total_amount AS amount,
              b.status AS batchStatus,
              s.step_number AS currentStep,
              s.required_role AS pendingRole,
              b.created_at AS createdAt
         FROM incentive_upload_batch b
         LEFT JOIN incentive_approval_step s
           ON s.batch_id = b.id AND s.status = 'pending'
        WHERE b.status = 'pending' AND ${scopeSql}
        ORDER BY b.created_at ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "INCENTIVE",
      records: (rows as any[]).map((r) => ({
        batchId: r.batchId,
        batchRef: r.batchRef ?? `Batch ${r.batchId}`,
        amount: Number(r.amount ?? 0),
        batchStatus: r.batchStatus,
        currentStep: r.currentStep ?? null,
        pendingRole: r.pendingRole ?? null,
        createdAt: r.createdAt,
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "incentive batches"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── RESIGNATION ─────────────────────────────────────────────────────────────
async function drillResignation(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // exit_request has no branch_id/process_id — scope through the employee.
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(e.full_name, CONCAT_WS(' ', e.first_name, e.last_name)) AS employeeName,
              e.employee_code AS employeeCode,
              er.submitted_at AS submittedAt,
              DATEDIFF(NOW(), er.submitted_at) AS daysPending,
              er.status AS exitStatus,
              er.exit_reason_category AS exitReason,
              er.last_working_day_proposed AS lastWorkingDay,
              er.notice_period_days AS noticePeriodDays
         FROM exit_request er
         LEFT JOIN employees e ON e.id = er.employee_id
        WHERE er.status NOT IN ('completed','cancelled','revoked')
          AND ${scopeSql}
        ORDER BY er.submitted_at ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "RESIGNATION",
      records: (rows as any[]).map((r) => ({
        employeeName: r.employeeName ?? "—",
        employeeCode: r.employeeCode,
        submittedAt: r.submittedAt,
        daysPending: Number(r.daysPending ?? 0),
        exitStatus: r.exitStatus,
        exitReason: r.exitReason,
        lastWorkingDay: r.lastWorkingDay,
        noticePeriodDays: r.noticePeriodDays,
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "resignations"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── BGV ─────────────────────────────────────────────────────────────────────
async function drillBgv(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhere(scope, "bm.id", "pm.id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cand.full_name AS name,
              bgv.check_type AS checkType,
              bgv.status AS status,
              bgv.match_score AS matchScore,
              bgv.created_at AS createdAt,
              DATEDIFF(NOW(), bgv.created_at) AS ageDays
         FROM candidate_bgv_check bgv
         ${candidateScopeJoin("bgv.candidate_id")}
        -- Matches getBgvMetrics's own "pending" bucket exactly (including NULL treated
        -- as pending). The previous NOT IN ('verified','passed','completed') was a
        -- superset that also admitted rows the tile itself buckets as cleared,
        -- flagged or breached — the drawer behind "BGV Pending" could legitimately
        -- return more rows than the tile's own pending count.
        WHERE COALESCE(bgv.status,'pending') IN ('pending','not_started','queued','manual_review','in_progress')
          AND ${scopeSql}
        ORDER BY bgv.created_at ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "BGV",
      records: (rows as any[]).map((r) => ({
        name: r.name ?? "—",
        checkType: r.checkType,
        status: r.status ?? "pending",
        matchScore: r.matchScore === null ? null : Number(r.matchScore),
        createdAt: r.createdAt,
        ageDays: Number(r.ageDays ?? 0),
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "BGV checks"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── DPDP ────────────────────────────────────────────────────────────────────
async function drillDpdp(_scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // dpdp_consent_withdrawal carries no branch/process/employee FK, so it cannot be
    // row-scoped. Returning it unscoped would leak across branches, so expose counts
    // by status only.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS count,
              SUM(CASE WHEN sla_due_at IS NOT NULL AND sla_due_at < NOW() THEN 1 ELSE 0 END) AS overdue
         FROM dpdp_consent_withdrawal
        GROUP BY status
        ORDER BY count DESC`,
    );
    return {
      metricCode: "DPDP",
      records: (rows as any[]).map((r) => ({
        status: r.status,
        count: Number(r.count),
        overdue: Number(r.overdue ?? 0),
      })),
      totalCount: (rows as any[]).reduce((a, r) => a + Number(r.count), 0),
      note: "Aggregate only — DPDP requests carry no branch/process link to scope by",
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── APPOINTMENT_ESIGN ───────────────────────────────────────────────────────
async function drillAppointmentEsign(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhere(scope, "bm.id", "pm.id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cand.full_name AS name,
              alr.status AS status,
              alr.candidate_esign_status AS candidateEsignStatus,
              alr.company_sign_status AS companySignStatus,
              alr.created_at AS createdAt
         FROM appointment_letter_request alr
         ${candidateScopeJoin("alr.candidate_id")}
        WHERE COALESCE(alr.status,'pending') NOT IN ('completed','cancelled')
          AND ${scopeSql}
        ORDER BY alr.created_at ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "APPOINTMENT_ESIGN",
      records: (rows as any[]).map((r) => ({
        name: r.name ?? "—",
        status: r.status,
        candidateEsignStatus: r.candidateEsignStatus,
        companySignStatus: r.companySignStatus,
        createdAt: r.createdAt,
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "pending e-signatures"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── JOINING_DOC_ESIGN ───────────────────────────────────────────────────────
async function drillJoiningDocEsign(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // Rows key on employee_id when the joiner has converted, candidate_id before that.
    // Scope through the employee, which is the only reliable branch/process link.
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(e.full_name, CONCAT_WS(' ', e.first_name, e.last_name)) AS employeeName,
              jd.document_name AS documentName,
              jd.status AS status,
              jd.verification_status AS verificationStatus,
              jd.due_at AS dueAt,
              CASE WHEN jd.due_at IS NOT NULL AND jd.due_at < NOW() THEN 1 ELSE 0 END AS overdue
         FROM employee_joining_document_checklist jd
         LEFT JOIN employees e ON e.id = jd.employee_id
        WHERE COALESCE(jd.status,'pending') NOT IN ('completed','verified')
          AND ${scopeSql}
        ORDER BY jd.due_at IS NULL, jd.due_at ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "JOINING_DOC_ESIGN",
      records: (rows as any[]).map((r) => ({
        employeeName: r.employeeName ?? "—",
        documentName: r.documentName,
        status: r.status,
        verificationStatus: r.verificationStatus,
        dueAt: r.dueAt,
        overdue: Boolean(r.overdue),
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "joining documents"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── ATTENDANCE_EXCEPTIONS: open reconciliation issues by type ───────────────
async function drillAttendanceExceptions(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // Date column is issue_date; open-ness is resolved_at IS NULL. There is no
    // created_at and no status column on this table.
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "emp");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ari.issue_type AS issueType,
              ari.severity AS severity,
              COUNT(*) AS count,
              SUM(CASE WHEN ari.auto_fix_status = 'failed' THEN 1 ELSE 0 END) AS autoFixFailed,
              MIN(ari.issue_date) AS oldestIssueDate,
              DATEDIFF(CURDATE(), MIN(ari.issue_date)) AS oldestAgeDays
         FROM attendance_reconciliation_issue ari
         LEFT JOIN employees emp ON emp.id = ari.employee_id
        WHERE ari.resolved_at IS NULL
          AND ari.issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          AND ${scopeSql}
        GROUP BY ari.issue_type, ari.severity
        -- severity ENUM is ('blocker','warning') only; the 'info' that used to sit here
        -- matched nothing. Ordering is unchanged, the phantom value is just gone.
        ORDER BY FIELD(ari.severity,'blocker','warning'), count DESC`,
      params,
    );
    return {
      metricCode: "ATTENDANCE_EXCEPTIONS",
      records: (rows as any[]).map((r) => ({
        issueType: r.issueType,
        severity: r.severity,
        count: Number(r.count),
        autoFixFailed: Number(r.autoFixFailed),
        oldestIssueDate: r.oldestIssueDate,
        oldestAgeDays: Number(r.oldestAgeDays ?? 0),
      })),
      totalCount: (rows as any[]).reduce((a, r) => a + Number(r.count), 0),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── DOC_COMPLIANCE: active employees with the weakest document coverage ────
async function drillDocCompliance(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    // Ordered so employees with nothing on file surface first — those are the
    // actionable ones. `verified` is a tinyint; there is no verification_status column.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code AS employeeCode,
              e.full_name AS employeeName,
              b.branch_name AS branchName,
              COALESCE(d.doc_count, 0) AS documentCount,
              COALESCE(d.verified_count, 0) AS verifiedCount
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN (
           SELECT employee_id,
                  COUNT(*) AS doc_count,
                  SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified_count
             FROM employee_documents
            GROUP BY employee_id
         ) d ON d.employee_id = e.id
        WHERE e.active_status = 1
          AND COALESCE(d.verified_count, 0) = 0
          AND ${scopeSql}
        ORDER BY documentCount ASC, e.employee_code ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "DOC_COMPLIANCE",
      records: (rows as any[]).map((r) => ({
        employeeCode: r.employeeCode,
        employeeName: r.employeeName ?? "—",
        branchName: r.branchName ?? "Unassigned",
        documentCount: Number(r.documentCount),
        verifiedCount: Number(r.verifiedCount),
      })),
      totalCount: rows.length,
      note: rows.length === 100 ? "Showing the first 100 employees with no verified document" : undefined,
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── BIOMETRIC_ACTIVITY: punch coverage on the latest complete day ──────────
async function drillBiometricActivity(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    // Anchored strictly before today: today's partial day would read as mass early
    // departure. Single-punch rows are listed first because they become attendance
    // exceptions downstream.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code AS employeeCode,
              e.full_name AS employeeName,
              br.branch_name AS branchName,
              b.activity_date AS activityDate,
              b.first_punch AS firstPunch,
              b.last_punch AS lastPunch,
              b.total_punches AS totalPunches,
              ROUND(b.biometric_minutes / 60, 2) AS hours
         FROM integration_biometric_daily b
         JOIN employees e ON e.employee_code = b.employee_code
         LEFT JOIN branch_master br ON br.id = e.branch_id
        WHERE b.activity_date = (
                SELECT MAX(activity_date) FROM integration_biometric_daily
                 WHERE activity_date < CURDATE()
              )
          AND e.active_status = 1
          AND ${scopeSql}
        ORDER BY b.total_punches ASC, b.biometric_minutes ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "BIOMETRIC_ACTIVITY",
      records: (rows as any[]).map((r) => ({
        employeeCode: r.employeeCode,
        employeeName: r.employeeName ?? "—",
        branchName: r.branchName ?? "Unassigned",
        activityDate: r.activityDate,
        firstPunch: r.firstPunch,
        lastPunch: r.lastPunch,
        totalPunches: Number(r.totalPunches ?? 0),
        hours: r.hours === null ? null : Number(r.hours),
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "records"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── SALARY_COMPONENTS: component split of the latest run ───────────────────
async function drillSalaryComponents(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.component_code AS componentCode,
              MIN(c.component_name) AS componentName,
              c.component_type AS componentType,
              MAX(c.taxable) AS taxable,
              COUNT(*) AS lineCount,
              COUNT(DISTINCT c.employee_id) AS employees,
              ROUND(SUM(c.amount), 2) AS totalAmount,
              ROUND(AVG(c.amount), 2) AS avgAmount
         FROM salary_prep_line_component c
         -- Anchor on the parent line — see the matching note in
         -- dashboard-metric.service.ts. Without it this drilldown counts orphaned
         -- component rows whose payroll line was deleted, which no longer represent
         -- anything payable.
         JOIN salary_prep_line l ON l.id = c.line_id
         JOIN employees e ON e.id = c.employee_id
        WHERE c.run_id = (
                SELECT id FROM salary_prep_run ORDER BY run_month DESC, created_at DESC LIMIT 1
              )
          AND ${scopeSql}
        GROUP BY c.component_code, c.component_type
        ORDER BY c.component_type, totalAmount DESC`,
      params,
    );
    return {
      metricCode: "SALARY_COMPONENTS",
      records: (rows as any[]).map((r) => ({
        componentCode: r.componentCode,
        componentName: r.componentName,
        componentType: r.componentType,
        taxable: Boolean(r.taxable),
        lineCount: Number(r.lineCount),
        employees: Number(r.employees),
        totalAmount: Number(r.totalAmount ?? 0),
        avgAmount: Number(r.avgAmount ?? 0),
      })),
      totalCount: rows.length,
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── RECRUITER_ACTIVITY: funnel per recruiter, last 30 days ─────────────────
async function drillRecruiterActivity(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // Grouped by recruiter_name_snapshot, the only recruiter identifier populated on
    // more than 10 of 16,857 rows. It is a denormalised name, not an FK, so it can
    // identify a recruiter but cannot be used for row scoping — scope routes through
    // branch_name / process_name joined to the masters by name.
    const { sql: scopeSql, params } = buildScopeWhere(scope, "bm.id", "pm.id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.recruiter_name_snapshot AS recruiterName,
              COUNT(*) AS leads,
              SUM(CASE WHEN r.contacted_flag = 1 THEN 1 ELSE 0 END) AS contacted,
              SUM(CASE WHEN r.walkin_flag = 1 THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN r.hr_interview_status IS NOT NULL AND r.hr_interview_status <> '' THEN 1 ELSE 0 END) AS hrScreened,
              SUM(CASE WHEN r.final_selection_flag = 1 THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN r.joined_flag = 1 THEN 1 ELSE 0 END) AS joined,
              MAX(r.activity_date) AS latestActivity
         FROM ats_recruiter_hiring_activity r
         LEFT JOIN branch_master bm ON bm.branch_name = r.branch_name
         LEFT JOIN process_master pm ON pm.process_name = r.process_name
        WHERE r.activity_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          AND ${scopeSql}
        GROUP BY r.recruiter_name_snapshot
        ORDER BY leads DESC
        LIMIT 50`,
      params,
    );
    return {
      metricCode: "RECRUITER_ACTIVITY",
      records: (rows as any[]).map((r) => ({
        recruiterName: r.recruiterName ?? "—",
        leads: Number(r.leads),
        contacted: Number(r.contacted),
        walkins: Number(r.walkins),
        hrScreened: Number(r.hrScreened),
        selected: Number(r.selected),
        joined: Number(r.joined),
        latestActivity: r.latestActivity,
      })),
      totalCount: (rows as any[]).reduce((a, r) => a + Number(r.leads), 0),
      note: "Recruiter identified by name snapshot — the activity table carries no usable recruiter foreign key",
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── TRAINING_PROGRESS: course completion from the synced LMS snapshot ──────
async function drillTrainingProgress(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    // Reads the snapshot inside mas_hrms, never the deployed LMS (CLAUDE.md boundary).
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.course_name AS courseName,
              COUNT(*) AS assignments,
              COUNT(DISTINCT s.employee_id) AS learners,
              SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN s.status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
              SUM(CASE WHEN s.status = 'not_started' THEN 1 ELSE 0 END) AS notStarted,
              ROUND(AVG(s.completion_pct), 1) AS avgCompletionPct,
              MAX(s.synced_at) AS syncedAt
         FROM lms_learning_progress_snapshot s
         JOIN employees e ON e.id = s.employee_id AND e.active_status = 1
        WHERE ${scopeSql}
        GROUP BY s.course_name
        ORDER BY notStarted DESC, assignments DESC
        LIMIT 50`,
      params,
    );
    return {
      metricCode: "TRAINING_PROGRESS",
      records: (rows as any[]).map((r) => ({
        courseName: r.courseName ?? "—",
        assignments: Number(r.assignments),
        learners: Number(r.learners),
        completed: Number(r.completed),
        inProgress: Number(r.inProgress),
        notStarted: Number(r.notStarted),
        avgCompletionPct: r.avgCompletionPct === null ? null : Number(r.avgCompletionPct),
        syncedAt: r.syncedAt,
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 50, "records"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── RECRUITER_PIPELINE: live candidate pipeline per recruiter scope ─────────
async function drillRecruiterPipeline(
  scope: DashboardScope,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhere(scope, "bm.id", "pm.id");
    const join = candidateScopeJoin("c.id");
    const statusFilter = typeof filters?.status === "string" ? filters.status : null;
    const statusSql = statusFilter ? ` AND c.status = ?` : "";
    const statusParams = statusFilter ? [statusFilter] : [];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.candidate_code AS candidateCode,
              c.full_name AS candidateName,
              pm.process_name AS appliedProcess,
              bm.branch_name AS appliedBranch,
              c.current_stage AS currentStage,
              c.status AS currentStatus,
              c.recruiter_name AS recruiterName,
              c.created_at AS appliedOn
         FROM ats_candidate c
         LEFT JOIN branch_master bm ON bm.branch_name = c.applied_for_branch
         LEFT JOIN process_master pm ON pm.process_name = c.applied_for_process
        WHERE ${scopeSql}${statusSql}
        ORDER BY c.created_at DESC
        LIMIT 200`,
      [...params, ...statusParams],
    );

    return {
      metricCode: "RECRUITER_PIPELINE",
      records: (rows as any[]).map((r) => ({
        candidateCode: r.candidateCode ?? "—",
        candidateName: r.candidateName ?? "—",
        appliedProcess: r.appliedProcess ?? "—",
        appliedBranch: r.appliedBranch ?? "—",
        currentStage: r.currentStage ?? "—",
        currentStatus: r.currentStatus ?? "—",
        recruiterName: r.recruiterName ?? "—",
        appliedOn: r.appliedOn,
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 200, "candidates"),
    };
  } catch (err) { sourceUnavailable(err); }
}

// ─── LEAVE_APPROVALS: pending requests awaiting a decision ──────────────────
async function drillLeaveApprovals(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code AS employeeCode,
              e.full_name AS employeeName,
              b.branch_name AS branchName,
              lt.leave_code AS leaveTypeCode,
              lt.leave_name AS leaveTypeName,
              lr.from_date AS fromDate,
              lr.to_date AS toDate,
              lr.total_days AS totalDays,
              lr.applied_at AS appliedAt,
              CASE WHEN lr.from_date < CURDATE() THEN 1 ELSE 0 END AS alreadyStarted,
              DATEDIFF(CURDATE(), lr.from_date) AS ageDays,
              lr.requires_branch_head_approval AS needsBranchHead
         FROM leave_request lr
         JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        WHERE lr.status = 'pending'
          AND ${scopeSql}
        ORDER BY lr.from_date ASC
        LIMIT 100`,
      params,
    );
    return {
      metricCode: "LEAVE_APPROVALS",
      records: (rows as any[]).map((r) => ({
        employeeCode: r.employeeCode,
        employeeName: r.employeeName ?? "—",
        branchName: r.branchName ?? "Unassigned",
        leaveTypeCode: r.leaveTypeCode,
        leaveTypeName: r.leaveTypeName,
        fromDate: r.fromDate,
        toDate: r.toDate,
        totalDays: r.totalDays === null ? null : Number(r.totalDays),
        appliedAt: r.appliedAt,
        alreadyStarted: Boolean(r.alreadyStarted),
        ageDays: Number(r.ageDays ?? 0),
        needsBranchHead: Boolean(r.needsBranchHead),
      })),
      totalCount: rows.length,
      note: capNote(rows.length, 100, "leave requests"),
    };
  } catch (err) { sourceUnavailable(err); }
}
