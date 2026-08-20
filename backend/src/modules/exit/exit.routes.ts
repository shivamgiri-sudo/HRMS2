import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { exitController } from "./exit.controller.js";
import { ffService } from "./ff.service.js";
import { computeFfPreview } from "./ff-compute.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
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

export const exitRouter = Router();
exitRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

exitRouter.get(
  "/command-center",
  requireRole("admin", "hr", "manager", "finance", "payroll", "ceo"),
  h(async (_req, res) => res.json({ success: true, data: await getExitCommandCenter() }))
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

exitRouter.get(
  "/:id/clearance",
  requireRole("admin", "hr", "manager", "finance", "payroll", "wfm"),
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
  requireRole("admin", "hr", "manager", "finance", "payroll", "wfm"),
  h(async (req, res) => {
    const status = String(req.body?.status ?? "cleared");
    const allowed = new Set(["pending", "in_progress", "cleared", "blocked", "waived"]);
    if (!allowed.has(status)) return res.status(400).json({ success: false, message: "Invalid clearance status" });

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

    await db.execute(
      `UPDATE exit_clearance_task
          SET status = ?, remarks = ?, cleared_by = CASE WHEN ? IN ('cleared','waived') THEN ? ELSE cleared_by END,
              cleared_at = CASE WHEN ? IN ('cleared','waived') THEN NOW() ELSE cleared_at END
        WHERE id = ? AND exit_request_id = ?`,
      [status, req.body?.remarks ?? null, status, req.authUser!.id, status, req.params.taskId, req.params.id]
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
  }
  return exitController.getExitRequest(req, res);
}));

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

// ── Resignation Routes (mounted sub-router) ───────────────────────────────────
// All /resignation/* routes are handled by resignation.routes.ts
// URL pattern: /exit/resignation/* → resignationRouter handles /:exitId/... and /my and /
exitRouter.use("/resignation", resignationRouter);
