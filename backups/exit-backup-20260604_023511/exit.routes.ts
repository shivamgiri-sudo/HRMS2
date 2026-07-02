import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { exitController } from "./exit.controller.js";
import { ffService } from "./ff.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";

export const exitRouter = Router();
exitRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// ─── Exit Request Routes ───────────────────────────────────────────────────────

// Stats MUST be defined before /:id to avoid route shadowing
exitRouter.get(
  "/stats",
  requireRole("admin", "hr", "manager"),
  h(exitController.getExitStats.bind(exitController))
);

// GET / — admin/hr/manager can list all exits; ordinary employees cannot
exitRouter.get(
  "/",
  requireRole("admin", "hr", "manager"),
  h(exitController.listExitRequests.bind(exitController))
);

// POST / — any authenticated user; admin/hr/manager can create for any employee;
//           ordinary employee can only create their own exit request
exitRouter.post("/", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, "admin", "hr", "manager");

  if (!isPrivileged) {
    // Ordinary employee: derive employee_id from JWT mapping, ignore body employee_id
    const emp = await getEmployeeForUser(userId);
    if (!emp) {
      return res.status(403).json({ success: false, message: "Forbidden: no employee record linked to your account" });
    }
    req.body = { ...req.body, employee_id: emp.id };
  }

  return exitController.createExitRequest(req, res);
}));

// GET /:id — admin/hr/manager see any; employee sees only their own
exitRouter.get("/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, "admin", "hr", "manager");

  if (!isPrivileged) {
    const emp = await getEmployeeForUser(userId);
    if (!emp) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    // Attach resolved employee so controller can enforce self-access
    (req as any).resolvedEmployeeId = emp.id;
  }

  return exitController.getExitRequest(req, res);
}));

// PATCH /:id/status — admin/hr/manager only; ordinary employees cannot update status
exitRouter.patch(
  "/:id/status",
  requireRole("admin", "hr", "manager"),
  h(exitController.updateExitStatus.bind(exitController))
);

// ─── Full & Final ─────────────────────────────────────────────────────────────

// GET /ff/:exitRequestId — admin/hr/finance/payroll only
exitRouter.get(
  "/ff/:exitRequestId",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await ffService.getFF(req.params.exitRequestId);
    return res.json({ success: true, data });
  })
);

// POST /ff/:exitRequestId — admin/hr/finance/payroll only, audited
exitRouter.post(
  "/ff/:exitRequestId",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await ffService.createFF(
      req.params.exitRequestId,
      req.body,
      req.authUser!.id,
      req
    );
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

// POST /ff/:id/approve — admin only, audited
exitRouter.post(
  "/ff/:id/approve",
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
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
