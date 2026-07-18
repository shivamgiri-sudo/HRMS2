import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { exitController } from "./exit.controller.js";
import { ffService } from "./ff.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
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
    req.body = { ...req.body, employeeId: emp.id };
  }

  return exitController.createExitRequest(req, res);
}));

exitRouter.get(
  "/:id/clearance",
  requireRole("admin", "hr", "manager", "finance", "payroll", "wfm"),
  h(async (req, res) => {
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

const updateExitStatus = [
  requireRole("admin", "hr", "manager"),
  h(exitController.updateExitStatus.bind(exitController)),
] as const;

exitRouter.patch("/:id/status", ...updateExitStatus);
// Compatibility for the original Exit Management screen and older clients.
exitRouter.post("/:id/status", ...updateExitStatus);

// POST endpoint for frontend compatibility
exitRouter.post(
  "/:id/status",
  requireRole("admin", "hr", "manager"),
  h(exitController.updateExitStatus.bind(exitController))
);

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

exitRouter.post(
  "/ff/:id/approve",
  requireRole("admin"),
  h(async (req, res) => {
    const data = await ffService.approveFF(req.params.id, req.authUser!.id, req);
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FF_APPROVE",
      module_key: "exit",
      entity_type: "exit_request",
      entity_id: req.params.id,
      req,
    });
    return res.json({ success: true, data, message: "F&F approved" });
  })
);

exitRouter.post(
  "/ff/:id/verify",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req, res) => {
    const data = await ffService.setProvisionalFalse(req.params.id, req.authUser!.id, req);
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FF_PROVISIONAL_CLEARED",
      module_key: "exit",
      entity_type: "full_final_calculation",
      entity_id: req.params.id,
      req,
    });
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

// ── Resignation Routes (mounted sub-router) ───────────────────────────────────
// All /resignation/* routes are handled by resignation.routes.ts
// URL pattern: /exit/resignation/* → resignationRouter handles /:exitId/... and /my and /
exitRouter.use("/resignation", resignationRouter);
