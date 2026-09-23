import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { exitController } from "./exit.controller.js";
import { ffService } from "./ff.service.js";
import { computeFfPreview } from "./ff-compute.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { narrowDashboardScope, resolveDashboardScope } from "../../shared/dashboardScope.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response, NextFunction } from "express";
import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import {
  addRetentionAction,
  createDefaultClearanceTasks,
  createExitHealthSnapshot,
  getExitCommandCenter,
  saveExitInterview,
} from "./exit-intelligence.service.js";
import { resignationRouter } from "./resignation.routes.js";
import { transitionExitStatus } from "./exit.service.js";

export const exitRouter = Router();
exitRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

exitRouter.get(
  "/command-center",
  requireRole("admin", "hr", "manager", "finance", "payroll", "ceo", "super_admin", "payroll_head", "wfm", "branch_head", "process_manager"),
  h(async (req, res) => {
    const actorUserId = req.authUser!.id;
    const actorRoles: string[] = req.authUser!.roles ?? [];
    return res.json({ success: true, data: await getExitCommandCenter({ actorUserId, actorRoles }) });
  })
);

exitRouter.get(
  "/stats",
  requireRole("admin", "hr", "manager"),
  h(exitController.getExitStats.bind(exitController))
);

exitRouter.get(
  "/",
  requireRole("admin", "hr", "manager"),
  h(exitController.listExitRequests.bind(exitController))
);

exitRouter.post("/", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, "admin", "hr", "manager");

  // Who is raising this, recorded from the caller's own roles rather than from the body.
  // A non-privileged caller can only ever raise their own exit (enforced immediately below),
  // so 'employee' is a fact for them. A privileged caller is acting on someone else's record.
  (req as unknown as { exitInitiatedBy?: string }).exitInitiatedBy = !isPrivileged
    ? "employee"
    : (await hasRole(userId, "admin", "hr")) ? "hr" : "manager";

  if (!isPrivileged) {
    const emp = await getEmployeeForUser(userId);
    if (!emp) {
      return res.status(403).json({ success: false, message: "Forbidden: no employee record linked to your account" });
    }
    // employeeCode is stripped, not just overridden. The resolver prefers employeeId, so
    // overriding it alone would already be safe — but that safety would rest on the order of
    // two checks in another file. A self-service caller must not be able to name anyone else.
    req.body = { ...req.body, employeeId: emp.id, employeeCode: undefined, employee_code: undefined };
  }

  return exitController.createExitRequest(req, res);
}));

// Every valid owner_role value createDefaultClearanceTasks() can assign a task to.
// 'it' added 2026-09-15 alongside migration 1772 — "IT access closure" moved from
// owner_role='admin' to 'it', which is a real, distinct role (not automatically covered
// by any of the others below).
// Trainer clearance ("LMS and certification closure") was removed from the exit process
// (owner ruling 2026-09-15) — dropped from this list and from createDefaultClearanceTasks.
const CLEARANCE_OWNER_ROLES = ["manager", "hr", "admin", "wfm", "payroll", "it"] as const;
type ClearanceOwnerRole = typeof CLEARANCE_OWNER_ROLES[number];

// GET /api/exit/clearance/queue — cross-employee clearance queue for the caller's own
// role(s) (or, for admin/hr/super_admin, any role via ?owner_role=). Registered BEFORE
// /:id/clearance below so Express does not try to match "clearance" as an :id.
exitRouter.get(
  "/clearance/queue",
  requireRole("admin", "hr", "manager", "finance", "payroll", "wfm", "it"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const isPrivileged = await hasRole(userId, "admin", "hr", "super_admin");

    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
      [userId],
    );
    const callerRoles = roleRows.map((r) => String(r.role_key));

    let ownerRoles: ClearanceOwnerRole[];
    const requestedOwnerRole = typeof req.query.owner_role === "string" ? req.query.owner_role : undefined;
    if (isPrivileged) {
      // Admin/hr/super_admin may look at any single queue, or — with none supplied —
      // every queue at once, matching their existing unrestricted canViewEmployee bypass.
      ownerRoles = requestedOwnerRole && (CLEARANCE_OWNER_ROLES as readonly string[]).includes(requestedOwnerRole)
        ? [requestedOwnerRole as ClearanceOwnerRole]
        : [...CLEARANCE_OWNER_ROLES];
    } else {
      // Non-privileged callers are forced to their own held role(s) — an owner_role param
      // cannot be used to look at another role's queue. An empty intersection (a role
      // combination that owns none of the 9 areas) returns an empty page, not a 403: the
      // requireRole gate above already vouches for platform-level access to this endpoint.
      ownerRoles = CLEARANCE_OWNER_ROLES.filter((r) => callerRoles.includes(r));
    }
    if (ownerRoles.length === 0) {
      return res.json({ success: true, data: [], pagination: { page: 1, limit: 50, total: 0 } });
    }

    const statusParam = typeof req.query.status === "string" && req.query.status.trim()
      ? req.query.status.split(",").map((s) => s.trim()).filter(Boolean)
      : ["pending", "in_progress", "blocked"];
    const allowedStatuses = new Set(["pending", "in_progress", "cleared", "blocked", "waived"]);
    const statuses = statusParam.filter((s) => allowedStatuses.has(s));
    if (statuses.length === 0) statuses.push("pending", "in_progress", "blocked");

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const conds: string[] = [
      `t.owner_role IN (${ownerRoles.map(() => "?").join(",")})`,
      `t.status IN (${statuses.map(() => "?").join(",")})`,
    ];
    const params: unknown[] = [...ownerRoles, ...statuses];

    if (typeof req.query.clearance_area === "string" && req.query.clearance_area.trim()) {
      conds.push("t.clearance_area = ?");
      params.push(req.query.clearance_area.trim());
    }

    if (!isPrivileged) {
      // Branch/process row-scope, same helper the IT-provisioning queue already uses —
      // avoids an N+1 canViewEmployee call per row on what is now a cross-employee list.
      const roleContext = await getUserRoleContext(userId);
      const baseScope = await resolveDashboardScope(userId, roleContext.primaryRole);
      const scoped = await narrowDashboardScope(baseScope, "", "");
      if (scoped.branchIds.length) {
        conds.push(`e.branch_id IN (${scoped.branchIds.map(() => "?").join(",")})`);
        params.push(...scoped.branchIds);
      }
    }

    const where = conds.join(" AND ");
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM exit_clearance_task t
         JOIN exit_request er ON er.id = t.exit_request_id
         JOIN employees e ON e.id = t.employee_id
        WHERE ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.id, t.exit_request_id, t.employee_id, t.clearance_area, t.task_title,
              t.task_description, t.owner_role, t.due_date, t.status, t.remarks,
              t.attachment_url, t.cleared_by, t.cleared_at, t.created_at, t.updated_at,
              e.full_name AS employee_name, e.employee_code,
              b.branch_name, p.process_name,
              er.status AS exit_status, er.last_working_day_confirmed, er.last_working_day_proposed,
              nc.status AS noc_case_status
         FROM exit_clearance_task t
         JOIN exit_request er ON er.id = t.exit_request_id
         JOIN employees e ON e.id = t.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN (
           SELECT exit_request_id, status,
                  ROW_NUMBER() OVER (PARTITION BY exit_request_id ORDER BY created_at DESC) AS rn
             FROM noc_case
         ) nc ON nc.exit_request_id = er.id AND nc.rn = 1
        WHERE ${where}
        ORDER BY FIELD(t.status,'blocked','pending','in_progress','cleared','waived'), t.due_date
        LIMIT ${limit} OFFSET ${offset}`,
      // LIMIT/OFFSET interpolated, not bound: this mysql2 version rejects a bound "LIMIT ?"
      // with "Incorrect arguments to mysqld_stmt_execute" (same class of bug already hit in
      // roster-audit and getTeamWorkItems above). Safe here — both are clamped integers
      // (Math.min/Math.max above), never request-controlled strings.
      params,
    );

    return res.json({ success: true, data: rows, pagination: { page, limit, total } });
  })
);

exitRouter.get(
  "/:id/clearance",
  // "it" added 2026-09-15 alongside migration 1772 (IT access closure retargeted admin ->
  // it). "trainer" removed same day — trainer clearance dropped from the exit process.
  requireRole("admin", "hr", "manager", "finance", "payroll", "wfm", "it"),
  h(async (req, res) => {
    // manager/finance/payroll/wfm previously had no scope check at all here and could list
    // clearance tasks for any exit request in any branch/process just by supplying its :id
    // (delta-audit 2026-08-14, P1). admin/hr stay unrestricted (canViewEmployee's own
    // admin/hr/super_admin/ceo bypass). Verified live: 16 clearance-task rows exist, all
    // still 'pending' — no clearance has ever been recorded, so this changes no completed
    // outcome. POST /:id/clearance/generate below is already admin/hr-only and needs no
    // equivalent change.
    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM exit_request WHERE id = ?`,
      [req.params.id]
    );
    const employeeId = (exitRows[0] as any)?.employee_id;
    if (!employeeId) return res.status(404).json({ success: false, message: "Exit request not found" });
    if (!(await canViewEmployee(req.authUser!.id, String(employeeId)))) {
      return res.status(403).json({ success: false, message: "This exit request is outside your assigned scope" });
    }

    const [rows] = await db.execute(
      `SELECT * FROM exit_clearance_task WHERE exit_request_id = ? ORDER BY FIELD(status,'blocked','pending','in_progress','cleared','waived'), clearance_area`,
      [req.params.id]
    );
    return res.json({ success: true, data: rows });
  })
);

exitRouter.post(
  "/:id/clearance/generate",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const exitReq = await import("./exit.service.js").then((m) => m.exitService.getExitRequest(req.params.id));
    const data = await createDefaultClearanceTasks(req.params.id, (exitReq as any).employee_id);
    return res.json({ success: true, data });
  })
);

exitRouter.patch(
  "/:id/clearance/:taskId",
  // "it" added 2026-09-15 alongside migration 1772. "trainer" removed same day.
  requireRole("admin", "hr", "manager", "finance", "payroll", "wfm", "it"),
  h(async (req, res) => {
    // When only attachment_url is sent (no status in body), treat as an attachment-only
    // update — do not change status, remarks, cleared_by or cleared_at. Bug 1+2 fix:
    // the old default of "cleared" silently auto-cleared the task on every upload.
    const statusProvided = req.body?.status != null;
    const status = statusProvided ? String(req.body.status) : null;
    const allowed = new Set(["pending", "in_progress", "cleared", "blocked", "waived"]);
    if (status !== null && !allowed.has(status)) return res.status(400).json({ success: false, message: "Invalid clearance status" });

    // Same gap as GET /:id/clearance above, on the actual mutating/approval action this
    // time: manager/finance/payroll/wfm could clear or waive any exit's clearance task in
    // any branch/process (delta-audit 2026-08-14, P1). This does not gate on the task's own
    // owner_role (e.g. an hr user clearing a wfm-owned task) — whether cross-functional
    // clearance should be allowed is a business-policy question, out of scope for a row-scope
    // fix; only the branch/process boundary is enforced here.
    const [taskRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM exit_clearance_task WHERE id = ? AND exit_request_id = ?`,
      [req.params.taskId, req.params.id]
    );
    const employeeId = (taskRows[0] as any)?.employee_id;
    if (!employeeId) return res.status(404).json({ success: false, message: "Clearance task not found" });
    if (!(await canViewEmployee(req.authUser!.id, String(employeeId)))) {
      return res.status(403).json({ success: false, message: "This exit request is outside your assigned scope" });
    }

    const attachmentUrl = req.body?.attachment_url != null ? String(req.body.attachment_url) : undefined;
    await db.execute(
      `UPDATE exit_clearance_task
          SET status      = COALESCE(?, status),
              remarks     = COALESCE(?, remarks),
              attachment_url = COALESCE(?, attachment_url),
              cleared_by  = CASE WHEN COALESCE(?, status) IN ('cleared','waived') THEN ? ELSE cleared_by END,
              cleared_at  = CASE WHEN COALESCE(?, status) IN ('cleared','waived') THEN NOW() ELSE cleared_at END
        WHERE id = ? AND exit_request_id = ?`,
      [
        status,                          // COALESCE(?, status)  — null keeps existing
        req.body?.remarks ?? null,        // COALESCE(?, remarks) — null keeps existing
        attachmentUrl ?? null,            // COALESCE(?, attachment_url)
        status, req.authUser!.id,         // cleared_by CASE
        status,                           // cleared_at CASE
        req.params.taskId, req.params.id,
      ]
    );
    return res.json({ success: true, message: "Clearance updated" });
  })
);

exitRouter.get(
  "/:id/health",
  requireRole("admin", "hr", "manager"),
  h(async (req, res) => res.json({ success: true, data: await createExitHealthSnapshot(req.params.id) }))
);

exitRouter.post(
  "/:id/retention",
  requireRole("admin", "hr", "manager"),
  h(async (req, res) => {
    const exitReq = await import("./exit.service.js").then((m) => m.exitService.getExitRequest(req.params.id));
    const data = await addRetentionAction({
      exitRequestId: req.params.id,
      employeeId: (exitReq as any).employee_id,
      actionType: req.body?.actionType ?? "manager_discussion",
      actionSummary: String(req.body?.actionSummary ?? "Retention discussion completed"),
      outcome: req.body?.outcome ?? "pending",
      outcomeRemarks: req.body?.outcomeRemarks ?? null,
      userId: req.authUser!.id,
    });
    return res.status(201).json({ success: true, data });
  })
);

exitRouter.post(
  "/:id/interview",
  requireRole("admin", "hr", "manager"),
  h(async (req, res) => {
    const exitReq = await import("./exit.service.js").then((m) => m.exitService.getExitRequest(req.params.id));
    const data = await saveExitInterview({
      exitRequestId: req.params.id,
      employeeId: (exitReq as any).employee_id,
      primaryReason: req.body?.primaryReason ?? null,
      secondaryReason: req.body?.secondaryReason ?? null,
      managerFeedbackScore: req.body?.managerFeedbackScore ?? null,
      processFeedbackScore: req.body?.processFeedbackScore ?? null,
      salaryFeedbackScore: req.body?.salaryFeedbackScore ?? null,
      workLifeScore: req.body?.workLifeScore ?? null,
      wouldRejoin: req.body?.wouldRejoin ?? null,
      rehireEligible: req.body?.rehireEligible ?? null,
      comments: req.body?.comments ?? null,
      userId: req.authUser!.id,
    });
    return res.status(201).json({ success: true, data });
  })
);

// PATCH/POST /:id/status used to be defined here (three times over, in fact — two identical
// POST registrations back to back). All were dead code: exitSecureRouter is mounted before
// exitRouter in app.ts, and Express dispatches to the first matching handler, so
// exitSecureRouter's version — now the single, properly-guarded implementation — is the only
// one that ever ran. Removed rather than left as unreachable duplicates. See
// exit.secure.routes.ts's handleExitStatusUpdate for the consolidated logic.

exitRouter.get(
  "/ff/:exitRequestId",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req, res) => res.json({ success: true, data: await ffService.getFF(req.params.exitRequestId) }))
);

exitRouter.post(
  "/ff/:exitRequestId",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req, res) => {
    const data = await ffService.createFF(req.params.exitRequestId, req.body, req.authUser!.id, req);
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FF_CREATE",
      module_key: "exit",
      entity_type: "exit_request",
      entity_id: req.params.exitRequestId,
      change_summary: { body: req.body },
      req,
    });
    return res.status(201).json({ success: true, data, message: "F&F calculation created" });
  })
);

// POST /ff/:id/approve: handled by ff-approval-guard.compat.routes.ts (mounted first at
// /api/exit — see app.ts). Removed here (delta-audit 2026-08-14, Stage 7, item 1) — this
// was dead code shadowed by the identically-pathed handler there, and not merely
// redundant: this version called ffService.approveFF directly with no check for open
// clearance tasks or is_ff_provisional, unlike the guarded version that actually runs.
// Confirm any future F&F-approval change lands in ff-approval-guard.compat.routes.ts.

/**
 * POST /ff/:id/paid — record that an approved settlement has actually been disbursed.
 *
 * Completes the lifecycle that stopped at 'approved'. Until migration 1220 and
 * ffService.markFfPaid, 'paid' was both unreachable and unrecordable, which left
 * FF_PAID_BUT_EMPLOYEE_ACTIVE (a P0 check) unable to fail and the "already paid" re-approval
 * guards as dead branches.
 *
 * Role list is NOT a new policy: it is the same admin/finance/payroll set that already gates
 * F&F approval (ff-approval-guard.compat.routes.ts) and /ff/:id/verify directly below. `hr` is
 * deliberately absent — HR verifies and approves, but recording a disbursement is a
 * finance/payroll act, and the approval route this mirrors excludes hr for the same reason.
 *
 * The real separation of duty is enforced in the service, not here: markFfPaid refuses when
 * the payer is the same person who approved, so holding both roles still cannot collapse the
 * two controls into one.
 */
exitRouter.post(
  "/ff/:id/paid",
  requireRole("admin", "finance", "payroll"),
  h(async (req, res) => {
    const paymentReference = String(req.body?.paymentReference ?? req.body?.payment_reference ?? "").trim();
    if (!paymentReference) {
      return res.status(400).json({
        success: false,
        message: "paymentReference is required — a settlement cannot be recorded paid without the bank/UTR/cheque reference",
      });
    }
    const data = await ffService.markFfPaid(req.params.id, req.authUser!.id, paymentReference, req);
    // markFfPaid writes its own FULL_FINAL_PAID sensitive-action entry carrying the amount and
    // reference, so this route deliberately does not log a second, thinner one.
    return res.json({ success: true, data, message: "F&F recorded as paid" });
  })
);

exitRouter.post(
  "/ff/:id/verify",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req, res) => {
    // Reason is mandatory (CLAUDE.md: the provisional override "requires ... an audit
    // reason"). setProvisionalFalse now writes the single sensitive-action entry itself
    // (with the reason attached) — this route used to log a second, thinner duplicate
    // entry right after; removed rather than kept alongside the service's own log.
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: "reason is required to clear a provisional F&F calculation" });
    }
    const data = await ffService.setProvisionalFalse(req.params.id, req.authUser!.id, reason, req);
    return res.json({ success: true, data, message: "F&F marked as verified (provisional cleared)" });
  })
);

exitRouter.get("/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, "admin", "hr", "manager", "finance", "payroll");
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, message: "Forbidden" });
    (req as any).resolvedEmployeeId = emp.id;
  } else {
    // The privileged branch had no row-level scope check at all — unlike GET
    // /:id/clearance and PATCH /:id/clearance/:taskId in this same file (delta-audit
    // 2026-08-14, P1), any user holding manager/finance/payroll (not just that
    // employee's own manager) could pull exit detail for any employee company-wide by
    // enumerating exit-request IDs. admin/hr keep canViewEmployee's own bypass. Fixed
    // 2026-09-01.
    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM exit_request WHERE id = ?`,
      [req.params.id]
    );
    const employeeId = (exitRows[0] as any)?.employee_id;
    if (!employeeId) return res.status(404).json({ success: false, message: "Exit request not found" });
    if (!(await canViewEmployee(userId, String(employeeId)))) {
      return res.status(403).json({ success: false, message: "This exit request is outside your assigned scope" });
    }
  }
  return exitController.getExitRequest(req, res);
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id/full  — full exit record for drill-down drawer
// Returns exit_request + employee + manager name + approval timeline with
// manager/HR feedback from exit_approval_log + clearance task summary.
// ─────────────────────────────────────────────────────────────────────────────
exitRouter.get(
  "/:id/full",
  // "wfm" added — the new per-role clearance pages/sections all open this same drawer for
  // their row-level drill-down (Drill-Down Mandate), and it owns real clearance tasks
  // (roster/client-ID deactivation). "it" added 2026-09-15 alongside migration 1772 (IT
  // access closure retargeted admin -> it). "trainer" removed same day.
  requireRole("admin", "hr", "manager", "finance", "payroll", "wfm", "it"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    // Same gap as GET /:id above: requireRole only, no row-level scope check — any
    // manager/finance/payroll user could pull full exit detail (reason, notice dates,
    // approval timeline) for any employee company-wide. Fixed 2026-09-01.
    const [scopeRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM exit_request WHERE id = ?`,
      [id]
    );
    const scopeEmployeeId = (scopeRows[0] as any)?.employee_id;
    if (!scopeEmployeeId) return res.status(404).json({ success: false, message: "Exit request not found" });
    if (!(await canViewEmployee(req.authUser!.id, String(scopeEmployeeId)))) {
      return res.status(403).json({ success: false, message: "This exit request is outside your assigned scope" });
    }

    // Full exit record with employee, manager, branch, process, department
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT er.*,
              e.employee_code,
              CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
              e.date_of_joining,
              b.branch_name,
              p.process_name,
              d.dept_name AS department_name,
              des.designation_name,
              CONCAT_WS(' ', mgr.first_name, mgr.last_name) AS manager_name,
              mgr.employee_code AS manager_code
         FROM exit_request er
         LEFT JOIN employees e ON e.id = er.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
         -- department_master / designation_master. Same defect, same cause as the
         -- notice-period query in manpower-risk.routes.ts: the tables named
         -- "departments" and "designations" do not exist in mas_hrms and never have,
         -- so this whole statement raised ER_NO_SUCH_TABLE and GET /:id/full returned
         -- 500. That is the only endpoint NoticePeriodDrawer.tsx calls, so the
         -- drill-down drawer never rendered for any exit. The SELECT list already used
         -- the _master column names (dept_name / designation_name).
         LEFT JOIN department_master d ON d.id = e.department_id
         LEFT JOIN designation_master des ON des.id = e.designation_id
         LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
        WHERE er.id = ?
        LIMIT 1`,
      [id]
    );
    if (!(rows as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: "Exit request not found" });
    }
    const record = (rows as RowDataPacket[])[0];

    // Approval timeline with discussion remarks and internal notes
    const [logRows] = await db.execute<RowDataPacket[]>(
      `SELECT al.id, al.stage, al.action, al.action_by_role,
              al.discussion_remarks, al.internal_notes, al.created_at,
              CONCAT_WS(' ', au_emp.first_name, au_emp.last_name) AS actioned_by_name,
              au.email AS actioned_by_email
         FROM exit_approval_log al
         LEFT JOIN auth_user au ON au.id = al.action_by
         LEFT JOIN employees au_emp ON au_emp.user_id = au.id
        WHERE al.exit_request_id = ?
        ORDER BY al.created_at ASC`,
      [id]
    );

    // Clearance tasks. "id" and "owner_role" were previously omitted from this SELECT —
    // the drawer rendered each task read-only with no way to identify which row a
    // Clear/Waive action should PATCH, which is exactly why that action never existed here.
    const [clearanceRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, clearance_area, owner_role, task_title, status, due_date, remarks, attachment_url, cleared_at
         FROM exit_clearance_task
        WHERE exit_request_id = ?
        ORDER BY clearance_area, created_at`,
      [id]
    );

    // NOC case status — read-only display, latest case for this exit (see A6: a plain
    // LEFT JOIN would fan out on the one live exit with more than one noc_case row).
    const [nocRows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM noc_case WHERE exit_request_id = ? ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    const noc_case_status = (nocRows[0] as RowDataPacket | undefined)?.status ?? null;

    // Notice days served / remaining (only meaningful in accepted/notice_serving)
    let notice_days_served: number | null = null;
    let notice_days_remaining: number | null = null;
    if (record.notice_start_date && record.notice_period_days > 0) {
      const start = new Date(record.notice_start_date);
      const today = new Date();
      const end = record.notice_end_date ? new Date(record.notice_end_date) : null;
      const served = Math.floor((today.getTime() - start.getTime()) / 86400000);
      notice_days_served = Math.max(0, Math.min(served, record.notice_period_days));
      notice_days_remaining = end
        ? Math.max(0, Math.floor((end.getTime() - today.getTime()) / 86400000))
        : Math.max(0, record.notice_period_days - notice_days_served);
    }

    return res.json({
      success: true,
      data: {
        ...record,
        notice_days_served,
        notice_days_remaining,
        timeline: logRows,
        clearance_tasks: clearanceRows,
        noc_case_status,
      },
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ff/:exitRequestId/outstanding-advances
// Returns outstanding (not fully recovered) salary advances for the employee
// linked to the given exit request. Used by F&F panel to pre-fill advances
// recovery field (requires HR/Finance to explicitly click to accept).
// ─────────────────────────────────────────────────────────────────────────────
exitRouter.get(
  "/ff/:exitRequestId/outstanding-advances",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { exitRequestId } = req.params;

    // Look up employee_id from exit_request
    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM exit_request WHERE id = ? LIMIT 1`,
      [exitRequestId],
    );
    const exitRow = (exitRows as RowDataPacket[])[0];
    if (!exitRow) {
      return res.status(404).json({ success: false, message: "Exit request not found" });
    }
    const employeeId: string = exitRow.employee_id;

    // Fetch active advances with remaining balance
    const [advRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, advance_date, amount, recovered_amount,
              ROUND(amount - recovered_amount, 2) AS remaining,
              notes
         FROM salary_advance_log
        WHERE employee_id = ?
          AND status = 'active'
          AND recovered_amount < amount
        ORDER BY advance_date ASC`,
      [employeeId],
    );

    const advances = (advRows as RowDataPacket[]).map((r) => ({
      id:               String(r.id),
      advance_date:     r.advance_date,
      amount:           Number(r.amount),
      recovered_amount: Number(r.recovered_amount),
      remaining:        Number(r.remaining),
      notes:            r.notes ?? null,
    }));

    const outstanding_amount = advances.reduce((sum, a) => sum + a.remaining, 0);

    return res.json({
      success: true,
      data: {
        outstanding_amount: Math.round(outstanding_amount * 100) / 100,
        advances,
      },
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ff/:exitRequestId/compute
// Phase 1 F&F compute/preview engine (ff-compute.service.ts). Derives notice-pay
// shortfall, leave encashment, gratuity and full advances/loan payoff from real
// data — read-only, writes nothing. createFF remains the only write path; this
// exists so its caller can prefill a real F&F draft instead of a blank form.
// ─────────────────────────────────────────────────────────────────────────────
exitRouter.get(
  "/ff/:exitRequestId/compute",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await computeFfPreview(req.params.exitRequestId);
    return res.json({ success: true, data });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// FSM transition routes — dedicated endpoints for the new 4-state flow
// ─────────────────────────────────────────────────────────────────────────────

// Manager approves voluntary resignation → notice_active
exitRouter.patch(
  '/:id/approve',
  requireRole('manager', 'assistant_manager', 'process_manager', 'branch_head', 'admin', 'hr', 'super_admin'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const actor = { userId: req.authUser!.id, userRole: (req.authUser!.roles ?? ['manager'])[0] };
    await transitionExitStatus(id, 'notice_active', actor, {
      lwdOverride: req.body.lwd_override,
      lwdOverrideReason: req.body.lwd_override_reason,
    });
    return res.json({ success: true });
  })
);

// Manager returns (push-back) with reason
exitRouter.patch(
  '/:id/return',
  requireRole('manager', 'assistant_manager', 'process_manager', 'branch_head', 'admin', 'hr', 'super_admin'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (!req.body.reason?.trim()) return res.status(400).json({ success: false, message: 'reason is required' });
    const actor = { userId: req.authUser!.id, userRole: (req.authUser!.roles ?? ['manager'])[0] };
    await transitionExitStatus(id, 'returned', actor, { reason: req.body.reason });
    return res.json({ success: true });
  })
);

// Employee revokes own resignation (also callable by admin/hr on behalf)
exitRouter.patch(
  '/:id/revoke',
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>('SELECT employee_id FROM exit_request WHERE id = ? LIMIT 1', [id]);
    const rec = rows[0] as any;
    if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
    const callerEmployee = await getEmployeeForUser(req.authUser!.id);
    const callerRoles: string[] = req.authUser!.roles ?? [];
    const isPrivileged = callerRoles.some(r => ['admin', 'hr', 'super_admin'].includes(r));
    if (!isPrivileged && (!callerEmployee || callerEmployee.id !== rec.employee_id)) {
      return res.status(403).json({ success: false, message: 'You can only revoke your own resignation.' });
    }
    const actor = { userId: req.authUser!.id, userRole: callerRoles[0] ?? 'employee' };
    await transitionExitStatus(id, 'revoked', actor, { reason: req.body.reason });
    return res.json({ success: true });
  })
);

// ── Resignation Routes (mounted sub-router) ───────────────────────────────────
// All /resignation/* routes are handled by resignation.routes.ts
// URL pattern: /exit/resignation/* → resignationRouter handles /:exitId/... and /my and /
exitRouter.use("/resignation", resignationRouter);
