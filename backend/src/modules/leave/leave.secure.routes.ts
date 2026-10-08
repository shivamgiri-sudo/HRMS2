import { reportingSpanClause } from "../../shared/reportingSpan.js";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole, isOrgWideUser } from "../../shared/scopeAccess.js";
import { resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { rowInScope, getScope, canAccessEmployee, OUT_OF_SCOPE_MSG } from "../wfm/branch-scope.js";
import { leaveService } from "./leave.service.js";
import { resolveEffectiveApprover } from "../../shared/approvalEscalation.js";
import { leavePolicyService } from "./leave-policy.service.js";

export const leaveSecureRouter = Router();
leaveSecureRouter.use(requireAuth);

const h =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);
// team_leader and tl are two distinct, independently assignable roles in
// workforce_role_catalog (54 files reference team_leader vs. a handful for tl) — this
// array only recognized tl. hasAnyRole/buildScopeWhereClause do a literal string match
// with no alias expansion, so a team_leader-only caller fell through to "1=0" here and
// leaveListScope's fallback then restricted them to their own single employee record —
// never their team's requests — even though 6 of the 8 live team_leader accounts
// (verified 2026-08-13) hold a user_assignment_scope row granting them exactly this
// visibility, and TeamLeaveTab.tsx (MyTeamPage's Leave tab, whose own gate already
// admits team_leader) calls this endpoint expecting it to work.
const LEAVE_VIEW_SCOPE_ROLES = [
  "manager",
  "assistant_manager",
  "tl",
  "team_leader",
  "branch_head",
  "process_manager",
  "hr",
  "payroll_hr",
  "payroll_branch",
  "wfm",
];

async function leaveListScope(
  userId: string,
): Promise<{ sql: string; params: unknown[] }> {
  // payroll_head reads org-wide. It is not in LEAVE_VIEW_SCOPE_ROLES below because that
  // path needs a user_assignment_scope row to widen from, and the live payroll_head
  // holders have none — they would have fallen through to the self-only fallback and seen
  // their own leave and nobody else's, which is not a scope restriction so much as a
  // broken screen (Attendance Lookup's Leave tab shows one employee at a time and would
  // have been permanently empty for them). Payroll signs off every branch's salary.
  if (await hasAnyRole(userId, "super_admin", "payroll_head")) return { sql: "1=1", params: [] };
  const scoped = await buildScopeWhereClause(userId, LEAVE_VIEW_SCOPE_ROLES, { branchId: "e.branch_id", processId: "e.process_id", departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id", employeeId: "e.id" }, { allowAdminBypass: false, allowCeoAllRead: false, blockOrgWideForRoles: ["hr", "hr_admin"] });
  // View-only skip level: an AM also sees the leave of the people under each TL (UAT 2026-09-25).
  // canReviewLeave below is untouched, so approval stays with the effective approver.
  const span = await reportingSpanClause(userId);
  if (scoped.sql !== "1=0") {
    return span
      ? {
          sql: `(${scoped.sql}) OR ${span.sql}`,
          params: [...scoped.params, ...span.params],
        }
      : scoped;
  }
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id) {
    return span
      ? {
          sql: `e.id = ? OR ${span.sql}`,
          params: [callerEmp.id, ...span.params],
        }
      : { sql: "e.id = ?", params: [callerEmp.id] };
  }
  return { sql: "1=0", params: [] };
}

export interface LeaveReviewTarget {
  employee_id: string;
  status: string;
  leave_type_id?: string | null;
  branch_id?: unknown;
  process_id?: unknown;
  reporting_manager_id?: unknown;
}

/**
 * The single definition of "may this caller review this leave request".
 *
 * Built once per caller so a list of rows does not repeat the caller lookups (employee,
 * roles, reviewer scope) per row, and caches the per-leave-type exception role and the
 * per-employee effective approver. canReviewLeave() (one request, used by the review route and
 * the Work Inbox dispatcher) and the list's can_review flag both go through this, so the page
 * can only ever offer a button the server will accept.
 */
export async function makeLeaveReviewChecker(userId: string): Promise<(target: LeaveReviewTarget) => Promise<boolean>> {
  const callerEmp = await getEmployeeForUser(userId);
  const isSuper = await hasAnyRole(userId, "super_admin");
  // admin / hr / hr_admin / payroll_hr review leave only inside their own branch / assigned scope
  // (owner ruling 2026-10-01: admin is branch-scoped like hr; org-wide roles pass inside rowInScope).
  const isScopedReviewer = !isSuper && (await hasAnyRole(userId, "admin", "hr", "hr_admin", "payroll_hr"));
  const reviewerScope = isScopedReviewer ? await resolveUserBusinessScope(userId) : null;
  const exceptionRoleByType = new Map<string, Promise<boolean>>();
  const approverByEmployee = new Map<string, Promise<string | null>>();

  return async (target) => {
    // Self-approval block applies before any role check, including the privileged HR/admin
    // bypass — an HR/admin employee submitting their own leave must not approve it themselves.
    // (2026-08-20 audit: the privileged branch used to short-circuit before this check ran.)
    if (callerEmp?.id && callerEmp.id === target.employee_id) return false;
    if (isSuper) return true;
    if (reviewerScope && rowInScope(reviewerScope, { id: target.employee_id, branch_id: target.branch_id, process_id: target.process_id, reporting_manager_id: target.reporting_manager_id } as any)) return true;

    // Branch Head escalation tier requires the configured escalation role — not just "is this
    // the caller's ordinary reporting manager", which the fallthrough below checks.
    if (["pending_branch_head", "branch_head_approved", "branch_head_rejected"].includes(String(target.status))) {
      const typeKey = String(target.leave_type_id ?? "");
      let allowed = exceptionRoleByType.get(typeKey);
      if (!allowed) {
        allowed = leavePolicyService
          .getExceptionApproverRole(target.leave_type_id ?? null)
          .then((role) => hasAnyRole(userId, role));
        exceptionRoleByType.set(typeKey, allowed);
      }
      return allowed;
    }

    let approver = approverByEmployee.get(target.employee_id);
    if (!approver) {
      approver = resolveEffectiveApprover(target.employee_id).then((r) => r.approverId ?? null);
      approverByEmployee.set(target.employee_id, approver);
    }
    const approverId = await approver;
    return Boolean(callerEmp?.id && approverId !== null && callerEmp.id === approverId);
  };
}

// Exported for the Work Inbox derived-item approve/reject dispatcher (modules/inbox), which
// needs the exact same row-scope + self-approval rule this route enforces — not a looser
// or reimplemented copy of it.
export async function canReviewLeave(
  userId: string,
  requestId: string,
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lr.employee_id, lr.status, lr.leave_type_id, e.branch_id, e.process_id, e.lob_id, e.department_id, e.reporting_manager_id, e.manager_id FROM leave_request lr JOIN employees e ON e.id = lr.employee_id WHERE lr.id = ? LIMIT 1`,
    [requestId],
  );
  const target = rows[0] as any;
  if (!target) return false;
  return (await makeLeaveReviewChecker(userId))(target);
}

/** Statuses a reviewer can act on from the list. Everything else is history. */
const REVIEWABLE_STATUSES = new Set(["pending", "pending_branch_head"]);

/**
 * Adds `can_review` to each listed row. Only open requests are checked; the checker is created
 * lazily so a list with nothing to review costs nothing extra. Lookups run in small batches.
 */
export async function annotateCanReview(userId: string, rows: any[]): Promise<void> {
  const open = rows.filter((r) => REVIEWABLE_STATUSES.has(String(r.status)));
  for (const r of rows) r.can_review = false;
  if (open.length === 0) return;
  const check = await makeLeaveReviewChecker(userId);
  const BATCH = 10;
  for (let i = 0; i < open.length; i += BATCH) {
    await Promise.all(
      open.slice(i, i + BATCH).map(async (r) => {
        r.can_review = await check({
          employee_id: r.employee_id,
          status: r.status,
          leave_type_id: r.leave_type_id,
          branch_id: r.emp_branch_id,
          process_id: r.emp_process_id,
          reporting_manager_id: r.emp_reporting_manager_id,
        });
      }),
    );
  }
}

leaveSecureRouter.get("/requests", h(async (req: any, res: any) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 100) || 100), 500);
  const offset = (page - 1) * limit;
  // ?mine=1 is "my own leave", whatever my role: the scope is pinned to the caller's own employee
  // row instead of widening with the role. The My Leave tab needs this because a manager's team
  // scope does not necessarily include the manager.
  let scope: { sql: string; params: unknown[] };
  if (String(req.query.mine ?? "") === "1") {
    const me = await getEmployeeForUser(req.authUser!.id);
    scope = me?.id ? { sql: "e.id = ?", params: [me.id] } : { sql: "1=0", params: [] };
  } else {
    scope = await leaveListScope(req.authUser!.id);
  }
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.employeeId) { conds.push("lr.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.leaveTypeId) { conds.push("lr.leave_type_id = ?"); params.push(String(req.query.leaveTypeId)); }
  if (req.query.status) {
    // Comma-separated list, e.g. "pending,pending_branch_head" — a plain `=`
    // silently matched zero rows for any multi-status filter (every existing
    // caller that passed a comma list, e.g. TeamLeaveTab's history toggle,
    // got an empty result with no error). (2026-08-21 audit)
    const statuses = String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 0) {
      conds.push(`lr.status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
  }
  if (req.query.fromDate) { conds.push("lr.from_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { conds.push("lr.to_date <= ?"); params.push(String(req.query.toDate)); }
  // Overlap, not containment: a leave that starts before or ends after the span still counts as "applied for" it.
  if (req.query.overlapFrom && req.query.overlapTo) {
    conds.push("lr.from_date <= ?");
    conds.push("lr.to_date >= ?");
    params.push(String(req.query.overlapTo), String(req.query.overlapFrom));
  }
  if (req.query.activeOn) { conds.push("lr.from_date <= ?"); conds.push("lr.to_date >= ?"); params.push(String(req.query.activeOn), String(req.query.activeOn)); }
  if (req.query.year) { conds.push("YEAR(lr.from_date) = ?"); params.push(Number(req.query.year)); }
  const where = `WHERE ${conds.join(" AND ")}`;
  const fromSql = `FROM leave_request lr LEFT JOIN employees e ON e.id = lr.employee_id LEFT JOIN department_master dept ON dept.id = e.department_id LEFT JOIN branch_master bm ON bm.id = e.branch_id LEFT JOIN process_master pm ON pm.id = e.process_id LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id LEFT JOIN leave_approval_log approval ON approval.id = (SELECT latest.id FROM leave_approval_log latest WHERE latest.leave_request_id = lr.id ORDER BY latest.action_at DESC LIMIT 1) LEFT JOIN employees rev ON rev.user_id = approval.action_by`;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT lr.*, COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name, e.first_name, e.last_name, e.employee_code, e.avatar_url, e.branch_id AS emp_branch_id, e.process_id AS emp_process_id, e.reporting_manager_id AS emp_reporting_manager_id, dept.dept_name AS department_name, bm.branch_name, pm.process_name, lt.leave_name AS leave_type_name, lt.leave_code, COALESCE(NULLIF(TRIM(rev.full_name), ''), TRIM(CONCAT(rev.first_name, ' ', COALESCE(rev.last_name, '')))) AS reviewer_name, approval.action_at AS reviewed_at, approval.remarks AS review_notes ${fromSql} ${where} ORDER BY lr.applied_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  // The count only needs the two tables the WHERE can reference: lr (every filter above)
  // and e (every branch of leaveListScope). The display joins — department, branch,
  // process, leave type, latest-approval and reviewer — cannot change how many leave
  // requests match, so running them for a COUNT is pure cost.
  //
  // It was 8.6x the cost: the full join counted 8,084 rows for one branch in 11.7s where
  // lr+e counted the same 8,084 in 1.4s, because `approval` joins through a correlated
  // ORDER BY … LIMIT 1 subquery evaluated per candidate row. This endpoint 500s in
  // production after ~70s, and the Manager dashboard rendered that failure as "0 pending,
  // 0 approved" — see ManagerLayout.
  //
  // It was also a latent correctness bug. `rev` joins employees on user_id, which is NOT
  // unique — 7 user_ids map to more than one employee row — so a reviewer with a duplicate
  // employee record would multiply that request's rows and inflate `total` above the number
  // of requests that exist. It does not happen on today's data (verified: 29,887 org-wide
  // both ways) but it is one duplicate reviewer away from doing so.
  const countFromSql = `FROM leave_request lr LEFT JOIN employees e ON e.id = lr.employee_id`;
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${countFromSql} ${where}`, params);
  await annotateCanReview(req.authUser!.id, rows as any[]);
  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

leaveSecureRouter.patch(
  "/requests/:id/review",
  h(async (req: any, res: any) => {
    if (!(await canReviewLeave(req.authUser!.id, req.params.id)))
      return res
        .status(403)
        .json({
          success: false,
          message: "Forbidden: leave request is outside your approval scope",
        });
    const status = String(req.body.status ?? "");
    const allowed = [
      "approved",
      "rejected",
      "branch_head_approved",
      "branch_head_rejected",
    ];
    if (!allowed.includes(status))
      return res
        .status(400)
        .json({ success: false, message: "Invalid leave review status" });
    const remarks = req.body.remarks ?? req.body.reviewNotes ?? null;
    // Owner ruling, 2026-08-27: remarks are mandatory on a REJECTION, optional on an
    // approval. A refusal the employee cannot see a reason for is the case that needs a
    // written record; an approval carries its own meaning. This was previously inverted —
    // approvers were forced to type filler text to approve, and could reject in silence.
    if (
      (status === "rejected" || status === "branch_head_rejected") &&
      !remarks?.trim()
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Remarks are required to reject a leave request",
        });
    }
    const data = await leaveService.reviewRequest(
      req.params.id,
      { status: status as any, remarks: remarks ?? null },
      req.authUser!.id,
    );
    return res.json({ success: true, data, message: `Leave ${status}` });
  }),
);

// PATCH /requests/:id/cancel — employee cancels their own leave (pending or approved)
leaveSecureRouter.patch("/requests/:id/cancel", h(async (req: any, res: any) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT employee_id, status FROM leave_request WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const request = rows[0] as any;
  if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });
  // Allow employee to cancel their own; admin/hr can cancel anyone's
  const isOwn = callerEmp?.id === request.employee_id;
  const isPrivileged = await hasAnyRole(req.authUser!.id, "admin", "hr");
  if (!isOwn && !isPrivileged) return res.status(403).json({ success: false, message: "Forbidden" });
  if (!isOwn) {
    // hr may cancel only inside its own branch / scope; admin / super_admin are org-wide.
    const cancelScope = await getScope(req);
    if (!cancelScope || !(await canAccessEmployee(cancelScope, request.employee_id))) {
      return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
    }
  }
  if (!["pending", "approved", "pending_branch_head"].includes(request.status)) {
    return res.status(400).json({ success: false, message: `Cannot cancel a leave with status '${request.status}'` });
  }
  const data = await leaveService.reviewRequest(req.params.id, { status: "cancelled", remarks: req.body.reason ?? null }, req.authUser!.id);
  return res.json({ success: true, data, message: "Leave cancelled" });
}));
