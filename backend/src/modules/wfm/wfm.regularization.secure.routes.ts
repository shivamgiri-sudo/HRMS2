import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, getUserAssignmentScopes, hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { regularizationSchema } from "./wfm.validation.js";
import { wfmService } from "./wfm.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { notifyRegularizationDecision, notifyRegularizationStage2Pending } from "./attendance.notifications.js";
import { resolveEffectiveApprover } from "../../shared/approvalEscalation.js";

export const wfmRegularizationSecureRouter = Router();
wfmRegularizationSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
// team_leader and tl are two distinct, independently assignable roles in
// WORKFORCE_ROLE_CATALOG (team_leader is the canonical one used across the rest of the
// backend — 54 files reference it vs. a handful for tl). This file only recognized tl,
// so live team_leader holders (8 active accounts vs. 1 tl, verified 2026-08-13) fell
// through buildScopeWhereClause to self-only scope: they saw only their own
// regularization requests, never their team's, despite AttendanceRegularization.tsx's
// own APPROVER_ROLES granting them the bulk-approve/per-row approve UI.
const WFM_VIEW_SCOPE_ROLES = ["wfm", "hr", "payroll_hr", "payroll_branch", "branch_head", "manager", "assistant_manager", "tl", "team_leader", "process_manager"];
const WFM_APPROVAL_SCOPE_ROLES = ["wfm"];

/**
 * Who may BULK-approve regularizations, and over which branches.
 *
 * Owner ruling, 2026-08-27: bulk approval is limited to Branch WFM and Branch Payroll
 * HR over their OWN branch only, plus Payroll Head and Super Admin across all branches.
 * One branch must never be able to clear another branch's queue in bulk.
 *
 * This is deliberately NARROWER than the per-row PATCH /regularizations/:id/review
 * path, which is left untouched. A reporting manager still reviews their own team's
 * requests one at a time — that is stage 1 of the workflow and is not a branch-wide
 * action. What is being restricted here is the sweep.
 *
 * Before this, PATCH /regularizations/bulk-review carried NO role gate at all: it
 * looped straight into _performReview per id, so anyone whose row scope happened to
 * cover a request could sweep it, and the frontend's own APPROVER_ROLES list offered
 * the control to ten roles including hr, manager, team_leader, tl, process_manager,
 * branch_head and admin.
 *
 * ALL_BRANCH_BULK_APPROVAL_ROLES are org-wide BY ROLE, not by scope row, because the
 * ruling names them as all-branch authorities. BRANCH_BULK_APPROVAL_ROLES get exactly
 * the branches their active user_assignment_scope rows name and nothing else — a role
 * held with no scope row grants no bulk authority, which is fail-closed by design.
 */
const ALL_BRANCH_BULK_APPROVAL_ROLES = ["super_admin", "payroll_head"];
/**
 * `payroll` is listed alongside `payroll_hr` because that is where the branch scope
 * rows actually live. Verified on mas_hrms 2026-08-27: the two branch payroll HR
 * users — Sheelu Verma (NOIDA-2) and Sandeep Patel (AHMEDABAD-JALDARSHAN) — each hold
 * BOTH role keys, and their scope_type='branch' rows are filed under `payroll`, while
 * their `payroll_hr` grant carries no scope row at all. Checking `payroll_hr` alone
 * would have returned an empty scope set for exactly the people this ruling is meant
 * to enable and refused them with a 403.
 *
 * This widens nothing in practice: `payroll` is held by those same two users and
 * nobody else.
 */
const BRANCH_BULK_APPROVAL_ROLES = ["wfm", "payroll_hr", "payroll"];
const BULK_APPROVAL_ROLES = [...ALL_BRANCH_BULK_APPROVAL_ROLES, ...BRANCH_BULK_APPROVAL_ROLES];

/**
 * Branches this caller may bulk-approve over.
 *
 * Returns "all" for the org-wide roles, a non-empty Set of branch ids for a
 * branch-scoped one, or null when the caller holds no bulk authority at all.
 *
 * Branch identity is taken from employees.branch_id, never attendance_regularization
 * .branch_id: that column is NULL on 131,301 of 131,353 live rows (verified
 * 2026-08-27), so a filter keyed on it would wave nearly every request through the
 * branch check.
 */
async function resolveBulkApprovalBranches(userId: string): Promise<"all" | Set<string> | null> {
  if (await hasAnyRole(userId, ...ALL_BRANCH_BULK_APPROVAL_ROLES)) return "all";
  if (!(await hasAnyRole(userId, ...BRANCH_BULK_APPROVAL_ROLES))) return null;

  const scopes = await getUserAssignmentScopes(userId, BRANCH_BULK_APPROVAL_ROLES);
  // A scope_type='all' row on a branch role still means org-wide — that is what the
  // row says, and narrowing it belongs in the data, not here.
  if (scopes.some((s) => s.scope_type === "all")) return "all";

  const branches = new Set(
    scopes
      .filter((s) => s.scope_type === "branch" || s.scope_type === "branch_process")
      .map((s) => (s.branch_id == null ? "" : String(s.branch_id)))
      .filter(Boolean),
  );
  return branches.size > 0 ? branches : null;
}

async function employeeTarget(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, process_id, lob_id, department_id, reporting_manager_id, manager_id
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] as any | undefined;
}

async function canAccessEmployee(userId: string, employeeId: string, allowSelf = true) {
  if (await hasAnyRole(userId, "admin", "hr", "wfm", "ceo")) return true;
  const target = await employeeTarget(employeeId);
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (allowSelf && callerEmp?.id === employeeId) return true;
  return hasScopedAccess(
    userId,
    WFM_VIEW_SCOPE_ROLES,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

/**
 * Rows a reporting manager may see purely by virtue of being someone's manager.
 *
 * This exists because user_assignment_scope cannot express it in practice.
 * buildScopeWhereClause() only emits its managerEmployeeId clause for a row with
 * scope_type='team', and there are ZERO such rows live — verified against mas_hrms
 * on 2026-08-27, where the only active scope types are all (23), branch (24),
 * process (20) and self (1), none carrying manager_employee_id. So every one of the
 * 161 distinct reporting managers fell straight through to listScope()'s `e.id = ?`
 * self-only fallback and saw ONLY THEIR OWN requests — never their team's pending
 * ones. All 10 live pending rows carry a non-null reporting_manager_id, so every
 * one of them was invisible to the person meant to action it.
 *
 * The asymmetry that makes this a bug rather than a policy: regularizationReviewRole()
 * below resolves the approver through resolveEffectiveApprover() and DOES return
 * "manager", so a reporting manager was already AUTHORISED to approve a request that
 * the list endpoint would never show them. They could act on it; they could not find it.
 *
 * Mirrors resolveEffectiveApprover() exactly, both legs:
 *  - direct    — COALESCE(reporting_manager_id, manager_id) is the caller
 *  - skip-level — the direct manager is on approved leave TODAY and their own manager
 *                 is the caller. Without this leg the escalation target would inherit
 *                 the authority to approve and the same inability to see the row.
 * Kept as a live clause rather than backfilled scope_type='team' rows so it tracks
 * employees.reporting_manager_id as reporting lines change, with nothing to maintain.
 */
function reportingManagerScopeSql(): string {
  return `(
      COALESCE(e.reporting_manager_id, e.manager_id) = ?
      OR EXISTS (
           SELECT 1
             FROM employees mgr
            WHERE mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)
              AND COALESCE(mgr.reporting_manager_id, mgr.manager_id) = ?
              AND EXISTS (
                    SELECT 1
                      FROM leave_request lr
                     WHERE lr.employee_id = mgr.id
                       AND lr.status IN ('approved', 'branch_head_approved')
                       AND lr.from_date <= CURDATE()
                       AND lr.to_date   >= CURDATE())
         )
    )`;
}

async function listScope(userId: string) {
  if (await hasAnyRole(userId, "super_admin")) return { sql: "1=1", params: [] as unknown[] };
  const scoped = await buildScopeWhereClause(
    userId,
    WFM_VIEW_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: false, allowCeoAllRead: false },
  );

  const ors: string[] = [];
  const params: unknown[] = [];

  // A scope row and a reporting line are additive, not alternatives. Previously the
  // manager legs were only reachable when buildScopeWhereClause returned "1=0", so a
  // branch-scoped manager got their branch and silently lost any direct report sitting
  // outside it.
  if (scoped.sql !== "1=0") {
    ors.push(`(${scoped.sql})`);
    params.push(...scoped.params);
  }

  const emp = await getEmployeeForUser(userId);
  if (emp?.id) {
    ors.push(reportingManagerScopeSql());
    params.push(emp.id, emp.id);
    ors.push("e.id = ?");
    params.push(emp.id);
  }

  if (ors.length === 0) return { sql: "1=0", params: [] as unknown[] };
  return { sql: ors.join(" OR "), params };
}

/**
 * Roles that may give the FINAL approval on a correction whose month payroll has already
 * frozen. Payroll owns that decision because a post-freeze correction changes a figure they
 * have already signed off on.
 */
const PAYROLL_APPROVAL_ROLES = ["payroll", "payroll_head", "payroll_admin"];

/** Waiting for Payroll's third-stage sign-off. Not terminal. */
const PAYROLL_PENDING_STATUS = "payroll_pending";

/**
 * Has payroll already frozen the month this correction falls in?
 *
 * NOT read from attendance_daily_record.is_locked. That flag means "a correction has already
 * been applied to this day" — verified live 2026-08-16, where all 36 locked ADR rows are
 * exactly the 36 days carrying an approved regularization. Using it as the freeze signal
 * would gate corrections on whether someone had already corrected the day, which is a
 * different question entirely.
 *
 * The real signal is the run for that month: attendance_snapshot_locked, or a closed status.
 * run_month is VARCHAR('YYYY-MM'), so it is matched as a formatted string — comparing it to a
 * DATE silently matches zero rows.
 */
async function isPayrollFrozenForDate(sessionDate: string): Promise<boolean> {
  if (!sessionDate) return false;
  const month = String(sessionDate).slice(0, 7);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS frozen
       FROM salary_prep_run
      WHERE run_month = ?
        AND (attendance_snapshot_locked = 1
             OR LOWER(status) IN ('finalized','locked','disbursed','approved'))
      LIMIT 1`,
    [month],
  );
  return rows.length > 0;
}

/**
 * @param approvalScopeRoles roles that may give the stage-2 sign-off. Defaults to
 *   WFM_APPROVAL_SCOPE_ROLES (Branch WFM alone), which is what the per-row
 *   PATCH /regularizations/:id/review path passes — that path is unchanged.
 *   The bulk path widens it to BRANCH_BULK_APPROVAL_ROLES so Branch Payroll HR can
 *   clear its own branch's queue per the 2026-08-27 ruling. Passed in rather than
 *   added to the shared constant so granting bulk authority cannot silently widen
 *   single-row approval as a side effect.
 */
async function regularizationReviewRole(
  userId: string,
  regularizationId: string,
  approvalScopeRoles: string[] = WFM_APPROVAL_SCOPE_ROLES,
): Promise<"super_admin" | "manager" | "wfm" | "payroll" | null> {
  if (await hasAnyRole(userId, "super_admin")) return "super_admin";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.employee_id,
            ar.status,
            e.branch_id,
            e.process_id,
            e.lob_id,
            e.department_id,
            e.reporting_manager_id,
            e.manager_id
       FROM attendance_regularization ar
       JOIN employees e ON e.id = ar.employee_id
      WHERE ar.id = ?
      LIMIT 1`,
    [regularizationId],
  );
  const target = rows[0] as any;
  if (!target) return null;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id === target.employee_id) return null;

  // Payroll is the third stage and only acts once WFM has handed the request over, so it is
  // resolved by the status rather than competing with the manager/WFM checks below — a user
  // holding both payroll and wfm still reviews as WFM at the WFM stage.
  if (String(target.status ?? "") === PAYROLL_PENDING_STATUS) {
    return (await hasAnyRole(userId, ...PAYROLL_APPROVAL_ROLES)) ? "payroll" : null;
  }
  const { approverId } = await resolveEffectiveApprover(target.employee_id);
  if (callerEmp?.id && approverId !== null && callerEmp.id === approverId) {
    return "manager";
  }
  const wfmScoped = await hasScopedAccess(
    userId,
    approvalScopeRoles,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId: target.employee_id,
    },
    { allowAdminBypass: false, requireScopeForNonAdmin: true },
  );
  return wfmScoped ? "wfm" : null;
}

// Statuses a review can no longer act on. `approved` is terminal for review
// specifically because re-approving rewrites attendance_daily_record a second
// time: the before-state it captures is the ALREADY-corrected row, so
// old_attendance_status and the 1023 snapshot would both be overwritten with
// post-approval values and the original lost for good. Undoing an approval is
// what /api/discard is for. `discarded` is listed for the same reason — a
// discarded request must be raised afresh, not flipped back to approved.
const TERMINAL_REGULARIZATION_STATUSES = ["approved", "rejected", "discarded"];

/**
 * pending -> manager_approved -> approved, with a third stage inserted when the month is
 * already frozen: manager -> WFM -> PAYROLL.
 *
 * Owner decision, 2026-08-16 (Rule 12). Before freeze the flow is unchanged. After freeze,
 * WFM approval no longer reaches `approved` on its own — it parks the request at
 * payroll_pending for Payroll to finish, because a correction to a month payroll has signed
 * off changes a number they own. This replaces the previous handling, where a locked day only
 * added +30 to a risk score and a WFM approver could clear it with `force: true`.
 *
 * Rejection is never deferred: any stage can reject outright, since rejecting changes no
 * payroll figure.
 */
function nextRegularizationStatus(
  role: "super_admin" | "manager" | "wfm" | "payroll",
  currentStatus: string,
  requestedStatus: string,
  payrollFrozen = false,
): string | null {
  if (!["approved", "rejected", "manager_approved"].includes(requestedStatus)) return null;
  if (TERMINAL_REGULARIZATION_STATUSES.includes(currentStatus)) return null;

  if (role === "super_admin") {
    if (requestedStatus === "manager_approved") return "approved";
    // super_admin is not a way around the Payroll stage — an approval into a frozen month
    // still parks for Payroll. Rejection is unaffected.
    if (requestedStatus === "approved" && payrollFrozen && currentStatus !== PAYROLL_PENDING_STATUS) {
      return PAYROLL_PENDING_STATUS;
    }
    return requestedStatus;
  }

  if (role === "manager") {
    if (currentStatus !== "pending") return null;
    return requestedStatus === "rejected" ? "rejected" : "manager_approved";
  }

  if (role === "payroll") {
    if (currentStatus !== PAYROLL_PENDING_STATUS) return null;
    return requestedStatus === "manager_approved" ? null : requestedStatus;
  }

  // wfm
  if (currentStatus !== "manager_approved") return null;
  if (requestedStatus === "manager_approved") return null;
  if (requestedStatus === "approved" && payrollFrozen) return PAYROLL_PENDING_STATUS;
  return requestedStatus;
}

function formatPreviewTime(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(11, 16);
}

function normalizePreviewStatus(status: unknown, totalPunches: number): string {
  const raw = String(status ?? "").trim().toLowerCase();
  const mapped: Record<string, string> = {
    present: "Present",
    absent: "Absent",
    half_day: "Half Day",
    "half day": "Half Day",
    missing_punch: "Missing Punch",
    "missing punch": "Missing Punch",
    late_in: "Late In",
    "late in": "Late In",
    early_out: "Early Out",
    "early out": "Early Out",
  };
  if (mapped[raw]) return mapped[raw];
  if (!raw) {
    if (totalPunches === 0) return "Absent";
    if (totalPunches === 1) return "Missing Punch";
    return "Present";
  }
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function buildRegularizationDecisionSupport(row: RowDataPacket) {
  const sessionDate = String(row.session_date ?? "").slice(0, 10);
  const employeeId = String(row.employee_id ?? "");
  const flags: string[] = [];
  let riskScore = 0;

  if (sessionDate > new Date().toISOString().slice(0, 10)) {
    flags.push("Future attendance date");
    riskScore += 30;
  }

  if (Number(row.same_day_request_count ?? 0) > 1) {
    flags.push("Duplicate request for same date");
    riskScore += 35;
  }

  if (Number(row.recent_request_count ?? 0) >= 3) {
    flags.push("Repeated regularizations in last 30 days");
    riskScore += 20;
  }

  if (Number(row.attendance_locked ?? 0) === 1) {
    flags.push("Attendance already locked by prior correction");
    riskScore += 30;
  }

  if (String(row.current_attendance_status ?? "") === String(row.requested_status ?? "")) {
    flags.push("Requested status already matches attendance");
    riskScore += 25;
  }

  if (["present", "half_day"].includes(String(row.requested_status ?? "")) && Number(row.total_punches ?? 0) === 0) {
    flags.push("No biometric punch evidence for payable attendance");
    riskScore += 45;
  }

  if (String(row.roster_status ?? "").toLowerCase().includes("week") && String(row.requested_status ?? "") === "present") {
    flags.push("Requested present on rostered week off");
    riskScore += 20;
  }

  if (!employeeId || !sessionDate) {
    flags.push("Missing employee/date evidence");
    riskScore += 50;
  }

  // FIX: Check for APR vs Biometric mismatch
  if (Number(row.mismatch_flag ?? 0) === 1) {
    const bioStatus = String(row.biometric_status ?? "unknown");
    const aprStatus = String(row.apr_status ?? "unknown");
    flags.push(`Source mismatch: Biometric=${bioStatus}, APR=${aprStatus}`);
    riskScore += 15;
  }

  const riskLevel = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";
  return {
    riskScore,
    riskLevel,
    flags,
    canBulkApprove: riskLevel === "low" && String(row.status ?? "") === "manager_approved",
    evidence: {
      currentAttendanceStatus: row.current_attendance_status ?? null,
      currentLwp: row.current_lwp ?? null,
      firstPunch: row.first_punch ?? null,
      lastPunch: row.last_punch ?? null,
      totalPunches: Number(row.total_punches ?? 0),
      biometricMinutes: row.biometric_minutes ?? null,
      rawMinutes: row.raw_minutes ?? null,
      rosterStatus: row.roster_status ?? null,
      rosterShiftStart: row.shift_start_time ?? null,
      rosterShiftEnd: row.shift_end_time ?? null,
      duplicateRequests: Number(row.same_day_request_count ?? 0),
      recentRequests: Number(row.recent_request_count ?? 0),
      mismatchFlag: Number(row.mismatch_flag ?? 0),
      biometricStatus: row.biometric_status ?? null,
      aprStatus: row.apr_status ?? null,
    },
  };
}

async function enrichRegularizationRows(rows: RowDataPacket[]) {
  return Promise.all(rows.map(async (row) => ({
    ...row,
    decision_support: await buildRegularizationDecisionSupport(row),
  })));
}

interface ReviewResult {
  httpStatus: number;
  payload: Record<string, unknown>;
}

async function _performReview(
  req: any,
  regularizationId: string,
  approvalScopeRoles: string[] = WFM_APPROVAL_SCOPE_ROLES,
): Promise<ReviewResult> {
  const reviewRole = await regularizationReviewRole(req.authUser.id, regularizationId, approvalScopeRoles);
  if (!reviewRole) {
    return { httpStatus: 403, payload: { success: false, message: "Forbidden: regularization is outside your approval scope" } };
  }
  const requestedReviewStatus = String(req.body.status ?? "");

  const [preRows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.status AS reg_status,
            ar.status,
            ar.requested_status,
            ar.employee_id,
            ar.session_date,
            ar.old_status, ar.new_status, ar.dispute_type,
            adr.attendance_status AS current_attendance_status,
            adr.lwp_value AS current_lwp,
            adr.is_locked AS attendance_locked,
            adr.clock_in_time AS first_punch,
            adr.clock_out_time AS last_punch,
            adr.biometric_minutes,
            adr.raw_minutes,
            adr.mismatch_flag,
            adr.biometric_status,
            adr.apr_status,
            COALESCE(ibd.total_punches, CASE WHEN adr.clock_in_time IS NULL THEN 0 WHEN adr.clock_out_time IS NULL THEN 1 ELSE 2 END) AS total_punches,
            wra.roster_status,
            wra.shift_start_time,
            wra.shift_end_time,
            (SELECT COUNT(*)
               FROM attendance_regularization dup
              WHERE dup.employee_id = ar.employee_id
                AND dup.session_date = ar.session_date
                AND dup.id <> ar.id
                AND dup.status <> 'rejected') AS same_day_request_count,
            (SELECT COUNT(*)
               FROM attendance_regularization recent
              WHERE recent.employee_id = ar.employee_id
                AND recent.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND recent.id <> ar.id) AS recent_request_count
       FROM attendance_regularization ar
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
       LEFT JOIN integration_biometric_daily ibd
              ON ibd.employee_code = (SELECT e2.employee_code FROM employees e2 WHERE e2.id = ar.employee_id LIMIT 1)
             AND ibd.activity_date = ar.session_date
       LEFT JOIN wfm_roster_assignment wra
              ON wra.employee_id = ar.employee_id AND wra.roster_date = ar.session_date
      WHERE ar.id = ? LIMIT 1`,
    [regularizationId]
  );
  const pre = (preRows as RowDataPacket[])[0] as any;
  if (!pre) return { httpStatus: 404, payload: { success: false, message: "Regularization not found" } };

  const payrollFrozen = await isPayrollFrozenForDate(String(pre.session_date ?? "").slice(0, 10));
  const status = nextRegularizationStatus(reviewRole, String(pre.reg_status ?? ""), requestedReviewStatus, payrollFrozen);
  if (!status) {
    return { httpStatus: 400, payload: { success: false, message: "Invalid approval step for current regularization status" } };
  }

  const decisionSupport = await buildRegularizationDecisionSupport(pre);
  if (
    status === "approved" &&
    reviewRole === "wfm" &&
    decisionSupport.riskLevel !== "low" &&
    req.body.force !== true
  ) {
    return {
      httpStatus: 409,
      payload: {
        success: false,
        message: "Risky regularization requires manual review before final WFM approval",
        decision_support: decisionSupport,
      },
    };
  }

  const reviewerNote = req.body.reviewerNote ?? req.body.remarks ?? null;
  // Owner ruling, 2026-08-27: remarks are mandatory on a REJECTION, optional on an
  // approval — same rule as leave review. Previously inverted, which forced filler text
  // on every approval (including the bulk path) and let a rejection carry no reason at
  // all, leaving the employee with a refused attendance correction and no explanation.
  if (status === "rejected" && !reviewerNote?.trim()) {
    return { httpStatus: 400, payload: { success: false, message: "Remarks are required to reject a regularization request" } };
  }
  const data = await wfmService.reviewRegularization(regularizationId, {
    status: status as any,
    reviewerNote,
  }, req.authUser.id);

  const actionType = status === "approved"
    ? "REGULARIZATION_APPROVED"
    : status === "manager_approved"
      ? "REGULARIZATION_MANAGER_APPROVED"
      : status === PAYROLL_PENDING_STATUS
        ? "REGULARIZATION_PAYROLL_APPROVAL_PENDING"
        : "REGULARIZATION_REJECTED";

  // Email notification (fire-and-forget), alongside the audit log below. A final
  // decision tells the employee; manager_approved tells the WFM chain. Shadow.
  setImmediate(() => {
    if (status === "approved" || status === "rejected") {
      void notifyRegularizationDecision(regularizationId, status, reviewerNote);
    } else if (status === "manager_approved") {
      void notifyRegularizationStage2Pending(regularizationId);
    }
    // payroll_pending deliberately sends no employee-facing mail: nothing has been decided
    // yet, and telling the employee "approved" here would be the same false-success this
    // stage exists to prevent. The queue is what Payroll works from.
  });

  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role: reviewRole,
    action_type: actionType,
    module_key: "attendance",
    entity_type: "attendance_regularization",
    entity_id: regularizationId,
    employee_id: pre.employee_id ?? null,
    reason: reviewerNote ?? undefined,
    old_value_json: {
      reg_status: pre.reg_status ?? null,
      attendance_status: pre.current_attendance_status ?? null,
      lwp_value: pre.current_lwp ?? null,
    },
    new_value_json: {
      reg_status: status,
      attendance_status: status === "approved" ? (pre.requested_status ?? null) : pre.current_attendance_status ?? null,
      lwp_value: status === "approved"
        ? ({ present: 0, half_day: 0.5, absent: 1.0 }[pre.requested_status as string] ?? null)
        : pre.current_lwp ?? null,
      reviewer_note: reviewerNote,
      session_date: pre.session_date ?? null,
      dispute_type: pre.dispute_type ?? null,
    },
    req,
  });

  if (status === "approved" && pre.requested_status) {
    void logSensitiveAction({
      actor_user_id: req.authUser.id,
      actor_role: reviewRole,
      action_type: "ATTENDANCE_RECORD_CORRECTED",
      module_key: "attendance",
      entity_type: "attendance_daily_record",
      entity_id: `${pre.employee_id}:${pre.session_date}`,
      employee_id: pre.employee_id,
      reason: `Regularization approved: ${reviewerNote ?? ""}`,
      old_value_json: {
        attendance_status: pre.current_attendance_status ?? null,
        lwp_value: pre.current_lwp ?? null,
      },
      new_value_json: {
        attendance_status: pre.requested_status,
        lwp_value: { present: 0, half_day: 0.5, absent: 1.0 }[pre.requested_status as string] ?? 0,
        corrected_by: req.authUser.id,
        regularization_id: regularizationId,
      },
      req,
    });

  }

  return { httpStatus: 200, payload: { success: true, data: { ...data, decision_support: decisionSupport }, message: `Regularization ${status}` } };
}

function reviewRegularizationRequest(req: any, res: any, regularizationId: string) {
  return _performReview(req, regularizationId).then(r => res.status(r.httpStatus).json(r.payload));
}

wfmRegularizationSecureRouter.post("/regularizations", h(async (req: any, res: any) => {
  const input = regularizationSchema.parse(req.body);
  const callerEmp = await getEmployeeForUser(req.authUser.id);
  const requestedEmployeeId = String(req.body.employeeId ?? callerEmp?.id ?? "");
  if (!requestedEmployeeId) return res.status(403).json({ success: false, message: "No employee record" });

  if (!(await canAccessEmployee(req.authUser.id, requestedEmployeeId, true))) {
    return res.status(403).json({ success: false, error: "Forbidden: employee is outside your WFM scope" });
  }

  const isPrivileged = await hasAnyRole(req.authUser.id, "admin", "hr", "wfm", "manager", "assistant_manager", "tl", "team_leader", "branch_head", "process_manager", "ceo");
  const requestedByType = isPrivileged && callerEmp?.id !== requestedEmployeeId ? "manager" : "employee";
  const data = await wfmService.submitRegularization(
    { ...input, employeeId: requestedEmployeeId, requestedByType } as any,
    req.authUser.id,
  );

  // Audit: regularization submitted
  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role: requestedByType,
    action_type: "REGULARIZATION_SUBMITTED",
    module_key: "attendance",
    entity_type: "attendance_regularization",
    entity_id: data.id,
    employee_id: requestedEmployeeId,
    reason: input.reason,
    new_value_json: {
      session_date: input.sessionDate,
      requested_status: (input as any).requestedStatus ?? null,
      reason_code: input.reasonCode ?? null,
      dispute_type: (input as any).disputeType ?? null,
      old_status: (input as any).oldStatus ?? null,
      new_status: (input as any).newStatus ?? null,
      old_punch_in: (input as any).oldPunchIn ?? null,
      old_punch_out: (input as any).oldPunchOut ?? null,
      new_punch_in: (input as any).newPunchIn ?? null,
      new_punch_out: (input as any).newPunchOut ?? null,
    },
    req,
  });

  return res.status(201).json({ success: true, data, message: "Regularization submitted" });
}));

wfmRegularizationSecureRouter.get("/regularizations/attendance-preview", h(async (req: any, res: any) => {
  const date = String(req.query.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD" });
  }

  const callerEmp = await getEmployeeForUser(req.authUser.id);
  const requestedEmployeeId = String(req.query.employeeId ?? callerEmp?.id ?? "").trim();
  if (!requestedEmployeeId) {
    return res.status(403).json({ success: false, message: "No employee record" });
  }

  if (!(await canAccessEmployee(req.authUser.id, requestedEmployeeId, true))) {
    return res.status(403).json({ success: false, message: "Forbidden: employee is outside your WFM scope" });
  }

  const [[attendanceRows], [punchRows]] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT e.id,
              e.employee_code,
              COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
              e.working_hours_start,
              e.working_hours_end,
              adr.attendance_status,
              adr.clock_in_time,
              adr.clock_out_time,
              adr.biometric_minutes,
              adr.dialler_minutes,
              adr.raw_minutes,
              adr.attendance_source,
              adr.apr_status,
              adr.biometric_status,
              adr.mismatch_flag,
              adr.lwp_value,
              ROUND(COALESCE(apr_src.apr_seconds, 0) / 60) AS apr_minutes,
              COALESCE(ibd.total_punches, CASE
                WHEN adr.clock_in_time IS NULL AND adr.clock_out_time IS NULL THEN 0
                WHEN adr.clock_in_time IS NOT NULL AND adr.clock_out_time IS NULL THEN 1
                WHEN adr.clock_in_time IS NULL AND adr.clock_out_time IS NOT NULL THEN 1
                ELSE 2
              END) AS total_punches
         FROM employees e
         LEFT JOIN attendance_daily_record adr
                ON adr.employee_id = e.id AND adr.record_date = ?
         LEFT JOIN integration_biometric_daily ibd
                ON ibd.employee_code = e.employee_code AND ibd.activity_date = ?
         LEFT JOIN (
               SELECT UserID, ReportDate, SUM(TIME_TO_SEC(Net_Login)) AS apr_seconds
                 FROM apr
                WHERE ReportDate = ?
                GROUP BY UserID, ReportDate
         ) apr_src ON apr_src.UserID = e.employee_code AND apr_src.ReportDate = ?
        WHERE e.id = ?
        LIMIT 1`,
      [date, date, date, date, requestedEmployeeId],
    ),
    // Use biometric_attendance_log (mas_hrms native table) instead of cosec_punch_sync
    // to avoid cross-DB collation issues and vicidial-sync lock contention.
    db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(bal.first_punch_in, '%Y-%m-%d %H:%i:%s') AS punch_time,
              1 AS io_type, 'In' AS io_label, NULL AS device_id
         FROM biometric_attendance_log bal
        WHERE bal.employee_id = ? AND bal.punch_date = ?
          AND bal.first_punch_in IS NOT NULL
       UNION ALL
       SELECT DATE_FORMAT(bal.last_punch_out, '%Y-%m-%d %H:%i:%s') AS punch_time,
              2 AS io_type, 'Out' AS io_label, NULL AS device_id
         FROM biometric_attendance_log bal
        WHERE bal.employee_id = ? AND bal.punch_date = ?
          AND bal.last_punch_out IS NOT NULL
        ORDER BY punch_time ASC`,
      [requestedEmployeeId, date, requestedEmployeeId, date],
    ),
  ]);

  const row = attendanceRows[0] as RowDataPacket | undefined;
  if (!row) {
    return res.status(404).json({ success: false, message: "Employee not found" });
  }

  const punches = (punchRows as RowDataPacket[]).map((punch) => ({
    punchTime: String(punch.punch_time ?? ""),
    ioLabel: String(punch.io_label ?? ""),
    deviceId: punch.device_id ? String(punch.device_id) : null,
  }));
  const totalPunches = Math.max(Number(row.total_punches ?? 0), punches.length);
  const firstPunchTime = formatPreviewTime(row.clock_in_time ?? punches[0]?.punchTime ?? null);
  const lastPunchTime = formatPreviewTime(
    row.clock_out_time ?? (punches.length > 1 ? punches[punches.length - 1]?.punchTime : null),
  );

  return res.json({
    success: true,
    data: {
      employeeId: String(row.id),
      employeeCode: row.employee_code ? String(row.employee_code) : null,
      employeeName: row.employee_name ? String(row.employee_name) : null,
      attendanceDate: date,
      currentStatus: normalizePreviewStatus(row.attendance_status, totalPunches),
      currentLoginTime: firstPunchTime,
      currentLogoutTime: lastPunchTime,
      suggestedLoginTime: formatPreviewTime(row.working_hours_start),
      suggestedLogoutTime: formatPreviewTime(row.working_hours_end),
      attendanceSource: row.attendance_source ? String(row.attendance_source) : "attendance_daily_record",
      aprMinutes: Number(row.apr_minutes ?? row.dialler_minutes ?? 0),
      aprStatus: row.apr_status ? String(row.apr_status) : null,
      biometricStatus: row.biometric_status ? String(row.biometric_status) : null,
      mismatchFlag: Number(row.mismatch_flag ?? 0) === 1 || (
        Number(row.apr_minutes ?? 0) > 0 &&
        Number(row.biometric_minutes ?? 0) > 0 &&
        Math.abs(Number(row.apr_minutes ?? 0) - Number(row.biometric_minutes ?? 0)) > 60
      ),
      biometricMinutes: Number(row.biometric_minutes ?? 0),
      rawMinutes: Number(row.raw_minutes ?? 0),
      lwpValue: Number(row.lwp_value ?? 0),
      totalPunches,
      punches,
    },
  });
}));

// ── Date-range attendance scan (for batch mode) ───────────────────────────
wfmRegularizationSecureRouter.get("/regularizations/date-range-preview", h(async (req: any, res: any) => {
  const fromDate = String(req.query.fromDate ?? "").trim();
  const toDate   = String(req.query.toDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return res.status(400).json({ success: false, message: "fromDate and toDate must be YYYY-MM-DD" });
  }
  if (fromDate > toDate) {
    return res.status(400).json({ success: false, message: "fromDate must be <= toDate" });
  }
  // Guard: max 31 days in a single scan
  const diffDays = Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000);
  if (diffDays > 30) {
    return res.status(400).json({ success: false, message: "Range cannot exceed 31 days" });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (toDate > today) {
    return res.status(400).json({ success: false, message: "toDate cannot be a future date" });
  }

  const callerEmp = await getEmployeeForUser(req.authUser.id);
  const requestedEmployeeId = String(req.query.employeeId ?? callerEmp?.id ?? "").trim();
  if (!requestedEmployeeId) return res.status(403).json({ success: false, message: "No employee record" });
  if (!(await canAccessEmployee(req.authUser.id, requestedEmployeeId, true))) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  // Fetch all ADR rows for the range in one query
  const [adrRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date,
            attendance_status,
            clock_in_time,
            clock_out_time,
            lwp_value
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND record_date BETWEEN ? AND ?
      ORDER BY record_date ASC`,
    [requestedEmployeeId, fromDate, toDate]
  );

  // Fetch existing pending/approved regularizations in this range to avoid duplicates
  const [existingRegs] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date, status
       FROM attendance_regularization
      WHERE employee_id = ?
        AND session_date BETWEEN ? AND ?
        AND status NOT IN ('rejected', 'cancelled', 'discarded')`,
    [requestedEmployeeId, fromDate, toDate]
  );
  const alreadyRequested = new Set((existingRegs as RowDataPacket[]).map((r: any) => r.session_date));

  // Build a map keyed by date
  const adrMap = new Map<string, any>();
  for (const r of adrRows as any[]) {
    adrMap.set(r.record_date, r);
  }

  // Enumerate every calendar date in the range
  const days: {
    date: string;
    currentStatus: string;
    loginTime: string | null;
    logoutTime: string | null;
    lwpValue: number;
    hasRecord: boolean;
    alreadyRequested: boolean;
    selectable: boolean;
  }[] = [];

  const cur = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  while (cur <= end) {
    const d = cur.toISOString().slice(0, 10);
    const adr = adrMap.get(d);
    const status = adr ? normalizePreviewStatus(adr.attendance_status, adr.clock_in_time ? 1 : 0) : "No Record";
    days.push({
      date: d,
      currentStatus: status,
      loginTime: adr?.clock_in_time ? formatPreviewTime(adr.clock_in_time) : null,
      logoutTime: adr?.clock_out_time ? formatPreviewTime(adr.clock_out_time) : null,
      lwpValue: Number(adr?.lwp_value ?? 0),
      hasRecord: !!adr,
      alreadyRequested: alreadyRequested.has(d),
      // Selectable = has a record that can be corrected and no pending request exists
      selectable: !!adr && !alreadyRequested.has(d),
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return res.json({ success: true, data: { employeeId: requestedEmployeeId, fromDate, toDate, days } });
}));

// ── Batch regularization submit ───────────────────────────────────────────
wfmRegularizationSecureRouter.post("/regularizations/batch", h(async (req: any, res: any) => {
  const sessionDates: string[] = Array.isArray(req.body.sessionDates)
    ? req.body.sessionDates.map(String).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  if (!sessionDates.length) {
    return res.status(400).json({ success: false, message: "sessionDates array is required" });
  }
  if (sessionDates.length > 31) {
    return res.status(400).json({ success: false, message: "Cannot batch submit more than 31 dates at once" });
  }

  const callerEmp = await getEmployeeForUser(req.authUser.id);
  const requestedEmployeeId = String(req.body.employeeId ?? callerEmp?.id ?? "");
  if (!requestedEmployeeId) return res.status(403).json({ success: false, message: "No employee record" });
  if (!(await canAccessEmployee(req.authUser.id, requestedEmployeeId, true))) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }

  const isPrivileged = await hasAnyRole(req.authUser.id, "admin", "hr", "wfm", "manager", "assistant_manager", "tl", "team_leader", "branch_head", "process_manager", "ceo");
  const requestedByType = isPrivileged && callerEmp?.id !== requestedEmployeeId ? "manager" : "employee";

  const commonFields = {
    requestedStatus: req.body.requestedStatus ?? null,
    disputeType:     req.body.disputeType ?? null,
    reason:          String(req.body.reason ?? "Batch attendance correction").trim() || "Batch attendance correction",
    supportingNote:  req.body.supportingNote ?? null,
    oldPunchIn:      req.body.oldPunchIn ?? null,
    oldPunchOut:     req.body.oldPunchOut ?? null,
    newPunchIn:      req.body.newPunchIn ?? null,
    newPunchOut:     req.body.newPunchOut ?? null,
    latitude:        req.body.latitude ?? null,
    longitude:       req.body.longitude ?? null,
    requestedByType,
    employeeId:      requestedEmployeeId,
  };

  const results: Array<{ date: string; success: boolean; id?: string; message?: string }> = [];
  for (const sessionDate of sessionDates) {
    try {
      const data = await wfmService.submitRegularization(
        { ...commonFields, sessionDate, reasonCode: req.body.reasonCode ?? undefined } as any,
        req.authUser.id,
      );
      void logSensitiveAction({
        actor_user_id: req.authUser.id,
        actor_role: requestedByType,
        action_type: "REGULARIZATION_SUBMITTED",
        module_key: "attendance",
        entity_type: "attendance_regularization",
        entity_id: data.id,
        employee_id: requestedEmployeeId,
        reason: commonFields.reason,
        new_value_json: { session_date: sessionDate, ...commonFields },
        req,
      });
      results.push({ date: sessionDate, success: true, id: data.id });
    } catch (err: any) {
      results.push({ date: sessionDate, success: false, message: err?.message ?? String(err) });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  return res.status(201).json({
    success: failed === 0,
    succeeded,
    failed,
    data: results,
    message: failed > 0
      ? `${succeeded} submitted, ${failed} skipped — see data for details`
      : `${succeeded} regularization request(s) submitted`,
  });
}));

// ── Multi-employee bulk regularization submit ─────────────────────────────
//
// WHY THIS EXISTS
//   /regularizations/batch covers one employee across up to 31 dates. That is the right shape
//   for an individual who forgot to punch, and the wrong shape for a systemic failure. When a
//   branch's biometric feed breaks, the correction is a rectangle: many employees x many dates.
//   Measured live 2026-08-17, Delhi Office ran 612 attendance rows for August of which 100% were
//   missing_punch across 51 employees; org-wide, 30% of August rows are missing_punch with 4,255
//   unresolved blocker-severity reconciliation issues. Raising those one employee at a time is
//   51 submissions for one branch for one month.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   It does not write attendance. Every pair goes through wfmService.submitRegularization, the
//   same call /batch uses, so each one lands as a PENDING request carrying the existing risk
//   scoring, duplicate detection and the manager -> WFM -> (frozen months) Payroll approval
//   chain. This is an origination tool, not an approval bypass — a bulk correction that wrote
//   straight to attendance_daily_record would let one person move payable days unreviewed.
//   Approval remains a separate act, via /regularizations/bulk-review.
//
//   Scope is enforced per employee, not once for the request: canAccessEmployee is called for
//   every target, so a branch-scoped WFM user cannot widen their reach by naming employees from
//   another branch in the payload.
wfmRegularizationSecureRouter.post("/regularizations/bulk-multi-employee", h(async (req: any, res: any) => {
  /** Per-employee dates, so each employee can carry their own missing days. */
  const rawTargets = Array.isArray(req.body.targets) ? req.body.targets : [];
  if (!rawTargets.length) {
    return res.status(400).json({ success: false, message: "targets array is required: [{ employeeId, sessionDates: [] }]" });
  }

  const targets: Array<{ employeeId: string; sessionDates: string[] }> = [];
  for (const t of rawTargets) {
    const employeeId = String(t?.employeeId ?? "").trim();
    const sessionDates: string[] = Array.isArray(t?.sessionDates)
      ? t.sessionDates.map(String).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      : [];
    if (employeeId && sessionDates.length) targets.push({ employeeId, sessionDates });
  }
  if (!targets.length) {
    return res.status(400).json({ success: false, message: "No valid targets — each needs employeeId and at least one YYYY-MM-DD sessionDate" });
  }

  // Bounded because every pair runs the full submit path (risk scoring, duplicate checks). A
  // whole branch-month exceeds this deliberately: the caller pages rather than the server
  // holding one very long request open and timing out mid-write with no usable result.
  const MAX_PAIRS = 500;
  const totalPairs = targets.reduce((n, t) => n + t.sessionDates.length, 0);
  if (totalPairs > MAX_PAIRS) {
    return res.status(400).json({
      success: false,
      message: `${totalPairs} employee-date pairs requested; the limit is ${MAX_PAIRS} per call. Split the date range or the employee list and submit again.`,
    });
  }

  const reason = String(req.body.reason ?? "").trim();
  if (reason.length < 10) {
    return res.status(400).json({ success: false, message: "reason is mandatory and must be at least 10 characters — it is the audit record for a bulk correction" });
  }

  const callerEmp = await getEmployeeForUser(req.authUser.id);
  const isPrivileged = await hasAnyRole(req.authUser.id, "admin", "hr", "wfm", "manager", "assistant_manager", "tl", "team_leader", "branch_head", "process_manager", "ceo");
  if (!isPrivileged) {
    return res.status(403).json({ success: false, message: "Bulk correction across employees requires a WFM, HR, branch or management role" });
  }

  const results: Array<{ employeeId: string; date: string; success: boolean; id?: string; message?: string }> = [];
  let denied = 0;

  for (const target of targets) {
    // Per-employee scope check. Denials are reported rather than aborting the run, so one
    // out-of-scope id in a long list does not discard the corrections that were valid.
    if (!(await canAccessEmployee(req.authUser.id, target.employeeId, true))) {
      denied += target.sessionDates.length;
      for (const d of target.sessionDates) {
        results.push({ employeeId: target.employeeId, date: d, success: false, message: "Forbidden — employee outside your scope" });
      }
      continue;
    }

    const requestedByType = callerEmp?.id === target.employeeId ? "employee" : "manager";
    const commonFields = {
      requestedStatus: req.body.requestedStatus ?? null,
      disputeType:     req.body.disputeType ?? null,
      reason,
      supportingNote:  req.body.supportingNote ?? null,
      oldPunchIn:      null,
      oldPunchOut:     null,
      newPunchIn:      req.body.newPunchIn ?? null,
      newPunchOut:     req.body.newPunchOut ?? null,
      latitude:        null,
      longitude:       null,
      requestedByType,
      employeeId:      target.employeeId,
    };

    for (const sessionDate of target.sessionDates) {
      try {
        const data = await wfmService.submitRegularization(
          { ...commonFields, sessionDate, reasonCode: req.body.reasonCode ?? undefined } as any,
          req.authUser.id,
        );
        void logSensitiveAction({
          actor_user_id: req.authUser.id,
          actor_role: requestedByType,
          action_type: "REGULARIZATION_SUBMITTED",
          module_key: "attendance",
          entity_type: "attendance_regularization",
          entity_id: data.id,
          employee_id: target.employeeId,
          reason,
          new_value_json: { session_date: sessionDate, bulk_multi_employee: true, ...commonFields },
          req,
        });
        results.push({ employeeId: target.employeeId, date: sessionDate, success: true, id: data.id });
      } catch (err: any) {
        results.push({ employeeId: target.employeeId, date: sessionDate, success: false, message: err?.message ?? String(err) });
      }
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  return res.status(201).json({
    success: failed === 0,
    employees: targets.length,
    succeeded,
    failed,
    denied,
    data: results,
    message: failed > 0
      ? `${succeeded} raised, ${failed} skipped (${denied} out of scope) — see data for details`
      : `${succeeded} regularization request(s) raised across ${targets.length} employee(s), pending approval`,
  });
}));

wfmRegularizationSecureRouter.get("/regularizations/mine", h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await wfmService.listRegularizations({ employeeId: emp.id });
  return res.json({ success: true, data });
}));

/**
 * Hard ceiling on one page. The endpoint used to return the WHOLE table: no status
 * filter, no date window and no LIMIT, and AttendanceRegularization.tsx called it with
 * no query parameters at all, then filtered and paged the result in the browser at 20
 * rows a page.
 *
 * Measured against live mas_hrms on 2026-08-27, 131,353 rows of which 131,336 are
 * already `approved` and 10 are pending:
 *
 *   as the page sent it (unfiltered)   did not return within 120 s
 *   same query, LIMIT 200              3,494 ms   316 KB
 *   same query, status='pending'          292 ms    15 KB
 *
 * Seven LEFT JOINs and two correlated subqueries per row, then a decision_support
 * object built in JS per row and serialised — for a super_admin, across all 131k.
 * The endpoint is now always bounded, so no caller can ask for that again.
 */
const REGULARIZATION_PAGE_LIMIT_DEFAULT = 100;
const REGULARIZATION_PAGE_LIMIT_MAX = 500;

wfmRegularizationSecureRouter.get("/regularizations", h(async (req: any, res: any) => {
  const scope = await listScope(req.authUser.id);
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.employeeId) { conds.push("ar.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.status) {
    // Comma-separated, e.g. "pending,manager_approved,payroll_pending" — the approval
    // queue needs every open status in one call. A plain `=` matched zero rows for any
    // multi-status filter, the same defect already fixed in leave.secure.routes.ts.
    const statuses = String(req.query.status).split(",").map((s: string) => s.trim()).filter(Boolean);
    if (statuses.length > 0) {
      conds.push(`ar.status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
  }
  if (req.query.fromDate) { conds.push("ar.session_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { conds.push("ar.session_date <= ?"); params.push(String(req.query.toDate)); }

  const limit = Math.min(
    Math.max(1, Number(req.query.limit) || REGULARIZATION_PAGE_LIMIT_DEFAULT),
    REGULARIZATION_PAGE_LIMIT_MAX,
  );
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = Number(req.query.offset) >= 0 && req.query.offset !== undefined
    ? Math.max(0, Number(req.query.offset))
    : (page - 1) * limit;

  const where = `WHERE ${conds.join(" AND ")}`;

  // Counted over ar + employees only. `employees` is required because the scope
  // predicate is written against e.*; none of the other six joins narrow the row set,
  // so pulling them into the count would pay for them twice.
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       ${where}`,
    params,
  );
  const total = Number((countRows[0] as any)?.total ?? 0);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.*,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name,
            arm.label AS reason_label,
            adr.attendance_status AS current_attendance_status,
            adr.lwp_value AS current_lwp,
            adr.is_locked AS attendance_locked,
            adr.clock_in_time AS first_punch,
            adr.clock_out_time AS last_punch,
            adr.biometric_minutes,
            adr.raw_minutes,
            COALESCE(ibd.total_punches, CASE WHEN adr.clock_in_time IS NULL THEN 0 WHEN adr.clock_out_time IS NULL THEN 1 ELSE 2 END) AS total_punches,
            wra.roster_status,
            wra.shift_start_time,
            wra.shift_end_time,
            (SELECT COUNT(*)
               FROM attendance_regularization dup
              WHERE dup.employee_id = ar.employee_id
                AND dup.session_date = ar.session_date
                AND dup.id <> ar.id
                AND dup.status <> 'rejected') AS same_day_request_count,
            (SELECT COUNT(*)
               FROM attendance_regularization recent
              WHERE recent.employee_id = ar.employee_id
                AND recent.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND recent.id <> ar.id) AS recent_request_count
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN branch_master b ON b.id = COALESCE(ar.branch_id, e.branch_id)
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
       LEFT JOIN integration_biometric_daily ibd
              ON ibd.employee_code = e.employee_code AND ibd.activity_date = ar.session_date
       LEFT JOIN wfm_roster_assignment wra
              ON wra.employee_id = ar.employee_id AND wra.roster_date = ar.session_date
       ${where}
      ORDER BY ar.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const data = await enrichRegularizationRows(rows);
  // `data` keeps its existing shape so every current caller is unaffected; the paging
  // fields are additive.
  return res.json({ success: true, data, total, page, limit, hasMore: offset + rows.length < total });
}));

wfmRegularizationSecureRouter.patch("/regularizations/bulk-review", h(async (req: any, res: any) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

  // ── Branch RBAC (owner ruling, 2026-08-27) ─────────────────────────────────
  // Bulk approval is Branch WFM / Branch Payroll HR over their own branch, plus
  // Payroll Head and Super Admin across all branches. Enforced here rather than
  // left to per-row scope alone, so one branch can never sweep another's queue.
  const allowedBranches = await resolveBulkApprovalBranches(req.authUser.id);
  if (allowedBranches === null) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: bulk approval is limited to Branch WFM, Branch Payroll HR, Payroll Head and Super Admin",
    });
  }

  // Resolve every target's branch in ONE query rather than per id. employees.branch_id
  // is the source: attendance_regularization.branch_id is NULL on 131,301 of 131,353
  // live rows, so keying the branch check on it would pass nearly everything.
  const branchById = new Map<string, string | null>();
  if (allowedBranches !== "all") {
    const [branchRows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.id, COALESCE(ar.branch_id, e.branch_id) AS branch_id
         FROM attendance_regularization ar
         LEFT JOIN employees e ON e.id = ar.employee_id
        WHERE ar.id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const row of branchRows) {
      branchById.set(String((row as any).id), (row as any).branch_id == null ? null : String((row as any).branch_id));
    }
  }

  const results: Array<{ id: string; success: boolean; httpStatus: number; message?: string }> = [];
  for (const id of ids) {
    if (allowedBranches !== "all") {
      const branchId = branchById.get(id);
      // An unresolvable branch is refused, not waved through — a request whose
      // employee row is missing or carries no branch cannot be proven in-scope.
      if (!branchId || !allowedBranches.has(branchId)) {
        results.push({
          id,
          success: false,
          httpStatus: 403,
          message: "Forbidden: request belongs to another branch",
        });
        continue;
      }
    }
    try {
      const r = await _performReview(req, id, BRANCH_BULK_APPROVAL_ROLES);
      results.push({
        id,
        success: r.httpStatus >= 200 && r.httpStatus < 300 && (r.payload as any)?.success !== false,
        httpStatus: r.httpStatus,
        message: (r.payload as any)?.message,
      });
    } catch (err: any) {
      results.push({ id, success: false, httpStatus: 500, message: err?.message ?? String(err) });
    }
  }

  const succeededCount = results.filter(r => r.success).length;
  const failedCount    = results.length - succeededCount;
  const httpStatus     = failedCount === 0 ? 200 : succeededCount === 0 ? results[0]?.httpStatus ?? 400 : 207;
  return res.status(httpStatus).json({
    success: failedCount === 0,
    succeeded: succeededCount,
    failed: failedCount,
    data: results,
    message: failedCount > 0
      ? `${succeededCount} approved, ${failedCount} failed — see data for details`
      : `${succeededCount} approved successfully`,
  });
}));

wfmRegularizationSecureRouter.patch("/regularizations/:id/review", h(async (req: any, res: any) => {
  return reviewRegularizationRequest(req, res, req.params.id);
}));

// ── Reason codes ──────────────────────────────────────────────────────────
wfmRegularizationSecureRouter.get("/regularizations/reasons", h(async (req: any, res: any) => {
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const isManager = await checkRole(req.authUser.id, 'admin', 'hr', 'wfm', 'manager', 'assistant_manager', 'tl', 'team_leader', 'branch_head', 'process_manager');
  const data = await wfmService.listReasons(isManager ? undefined : 'employee');
  return res.json({ success: true, data });
}));
