import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole } from "../../shared/scopeAccess.js";
import { leaveService } from "./leave.service.js";
import { resolveEffectiveApprover } from "../../shared/approvalEscalation.js";
import { leavePolicyService } from "./leave-policy.service.js";

export const leaveSecureRouter = Router();
leaveSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
// team_leader and tl are two distinct, independently assignable roles in
// workforce_role_catalog (54 files reference team_leader vs. a handful for tl) — this
// array only recognized tl. hasAnyRole/buildScopeWhereClause do a literal string match
// with no alias expansion, so a team_leader-only caller fell through to "1=0" here and
// leaveListScope's fallback then restricted them to their own single employee record —
// never their team's requests — even though 6 of the 8 live team_leader accounts
// (verified 2026-08-13) hold a user_assignment_scope row granting them exactly this
// visibility, and TeamLeaveTab.tsx (MyTeamPage's Leave tab, whose own gate already
// admits team_leader) calls this endpoint expecting it to work.
const LEAVE_VIEW_SCOPE_ROLES = ["manager", "assistant_manager", "tl", "team_leader", "branch_head", "process_manager", "hr", "payroll_hr", "payroll_branch", "wfm"];

async function leaveListScope(userId: string): Promise<{ sql: string; params: unknown[] }> {
  // payroll_head reads org-wide. It is not in LEAVE_VIEW_SCOPE_ROLES below because that
  // path needs a user_assignment_scope row to widen from, and the live payroll_head
  // holders have none — they would have fallen through to the self-only fallback and seen
  // their own leave and nobody else's, which is not a scope restriction so much as a
  // broken screen (Attendance Lookup's Leave tab shows one employee at a time and would
  // have been permanently empty for them). Payroll signs off every branch's salary.
  if (await hasAnyRole(userId, "super_admin", "payroll_head")) return { sql: "1=1", params: [] };
  const scoped = await buildScopeWhereClause(userId, LEAVE_VIEW_SCOPE_ROLES, { branchId: "e.branch_id", processId: "e.process_id", departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id", employeeId: "e.id" }, { allowAdminBypass: false, allowCeoAllRead: false });
  if (scoped.sql !== "1=0") return scoped;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id) return { sql: "e.id = ?", params: [callerEmp.id] };
  return { sql: "1=0", params: [] };
}

// Exported for the Work Inbox derived-item approve/reject dispatcher (modules/inbox), which
// needs the exact same row-scope + self-approval rule this route enforces — not a looser
// or reimplemented copy of it.
export async function canReviewLeave(userId: string, requestId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT lr.employee_id, lr.status, lr.leave_type_id, e.branch_id, e.process_id, e.lob_id, e.department_id, e.reporting_manager_id, e.manager_id FROM leave_request lr JOIN employees e ON e.id = lr.employee_id WHERE lr.id = ? LIMIT 1`, [requestId]);
  const target = rows[0] as any;
  if (!target) return false;

  // Self-approval block applies before any role check, including the
  // privileged HR/admin bypass below — an HR/admin employee submitting their
  // own leave must not be able to approve/reject it themselves. (2026-08-20
  // audit: the privileged branch used to short-circuit before this check ran
  // at all, so it never applied to HR/admin, only to the ordinary
  // reporting-manager path further down.)
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id && callerEmp.id === target.employee_id) return false;

  if (await hasAnyRole(userId, "super_admin", "admin", "hr", "hr_admin", "payroll_hr")) return true;

  // Branch Head escalation tier requires the configured escalation role — not
  // just "is this the caller's ordinary reporting manager", which is what the
  // fallthrough below checks and which every request used to go through
  // identically regardless of status.
  if (["pending_branch_head", "branch_head_approved", "branch_head_rejected"].includes(String(target.status))) {
    const requiredRole = await leavePolicyService.getExceptionApproverRole(target.leave_type_id ?? null);
    return hasAnyRole(userId, requiredRole);
  }

  const { approverId } = await resolveEffectiveApprover(target.employee_id);
  return Boolean(callerEmp?.id && approverId !== null && callerEmp.id === approverId);
}

leaveSecureRouter.get("/requests", h(async (req: any, res: any) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 100) || 100), 500);
  const offset = (page - 1) * limit;
  const scope = await leaveListScope(req.authUser!.id);
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
  if (req.query.activeOn) { conds.push("lr.from_date <= ?"); conds.push("lr.to_date >= ?"); params.push(String(req.query.activeOn), String(req.query.activeOn)); }
  if (req.query.year) { conds.push("YEAR(lr.from_date) = ?"); params.push(Number(req.query.year)); }
  const where = `WHERE ${conds.join(" AND ")}`;
  const fromSql = `FROM leave_request lr LEFT JOIN employees e ON e.id = lr.employee_id LEFT JOIN department_master dept ON dept.id = e.department_id LEFT JOIN branch_master bm ON bm.id = e.branch_id LEFT JOIN process_master pm ON pm.id = e.process_id LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id LEFT JOIN leave_approval_log approval ON approval.id = (SELECT latest.id FROM leave_approval_log latest WHERE latest.leave_request_id = lr.id ORDER BY latest.action_at DESC LIMIT 1) LEFT JOIN employees rev ON rev.user_id = approval.action_by`;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT lr.*, COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name, e.first_name, e.last_name, e.employee_code, e.avatar_url, dept.dept_name AS department_name, bm.branch_name, pm.process_name, lt.leave_name AS leave_type_name, lt.leave_code, COALESCE(NULLIF(TRIM(rev.full_name), ''), TRIM(CONCAT(rev.first_name, ' ', COALESCE(rev.last_name, '')))) AS reviewer_name, approval.action_at AS reviewed_at, approval.remarks AS review_notes ${fromSql} ${where} ORDER BY lr.applied_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
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
  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

leaveSecureRouter.patch("/requests/:id/review", h(async (req: any, res: any) => {
  if (!(await canReviewLeave(req.authUser!.id, req.params.id))) return res.status(403).json({ success: false, message: "Forbidden: leave request is outside your approval scope" });
  const status = String(req.body.status ?? "");
  const allowed = ["approved", "rejected", "branch_head_approved", "branch_head_rejected"];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: "Invalid leave review status" });
  const remarks = req.body.remarks ?? req.body.reviewNotes ?? null;
  // Owner ruling, 2026-08-27: remarks are mandatory on a REJECTION, optional on an
  // approval. A refusal the employee cannot see a reason for is the case that needs a
  // written record; an approval carries its own meaning. This was previously inverted —
  // approvers were forced to type filler text to approve, and could reject in silence.
  if ((status === "rejected" || status === "branch_head_rejected") && !remarks?.trim()) {
    return res.status(400).json({ success: false, message: "Remarks are required to reject a leave request" });
  }
  const data = await leaveService.reviewRequest(req.params.id, { status: status as any, remarks: remarks ?? null }, req.authUser!.id);
  return res.json({ success: true, data, message: `Leave ${status}` });
}));

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
  if (!["pending", "approved", "pending_branch_head"].includes(request.status)) {
    return res.status(400).json({ success: false, message: `Cannot cancel a leave with status '${request.status}'` });
  }
  const data = await leaveService.reviewRequest(req.params.id, { status: "cancelled", remarks: req.body.reason ?? null }, req.authUser!.id);
  return res.json({ success: true, data, message: "Leave cancelled" });
}));
