import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { managementService } from "./management.service.js";

// SCOPE NOTE: Manager access to team-wide management data (team-kpi, alerts, dashboard,
// coaching list-all) is deferred until user_assignment_scope enforcement is implemented.
// Managers currently see only their own coaching (employee self-service path).
// Re-enable per endpoint when scope mapping supports it.

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

router.get("/team-kpi", requireRole("admin","hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.getTeamKpiSummary(req.query as any) });
}));

router.get("/coaching", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin","hr")) {
    return res.json({ data: await managementService.listCoachingSessions(req.query as any) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  return res.json({ data: await managementService.listCoachingSessions({ employee_id: emp.id }) });
}));

router.post("/coaching", requireRole("admin","hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, session_date, session_type } = req.body;
  if (!employee_id || !session_date || !session_type)
    return res.status(400).json({ error: "employee_id, session_date, session_type required" });
  res.status(201).json({ data: await managementService.createCoachingSession(req.body, req.authUser!.id, req) });
}));

router.get("/alerts", requireRole("admin","hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const acknowledged = req.query.acknowledged !== undefined ? req.query.acknowledged === "true" : undefined;
  res.json({ data: await managementService.listAlerts({ ...req.query as any, acknowledged }) });
}));

router.post("/alerts/:id/acknowledge", requireRole("admin","hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await managementService.acknowledgeAlert(req.params.id, req.authUser!.id, req);
  res.json({ ok: true });
}));

router.get("/dashboard", requireRole("admin","hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.getDashboardSummary(req.query.process_id as string | undefined) });
}));

// ─── TNI (Training Needs Identification) ─────────────────────────────────────

router.get("/tni", requireRole("admin", "hr", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.listTni(req.query as { employee_id?: string; status?: string }) });
}));

router.post("/tni", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, metric_id, need_type, description, priority, coaching_session_id } = req.body as {
    employee_id: string;
    metric_id?: string;
    need_type: string;
    description?: string;
    priority?: string;
    coaching_session_id?: string;
  };
  if (!employee_id || !need_type) {
    return res.status(400).json({ error: "employee_id and need_type required" });
  }
  const data = await managementService.createTni(
    { employee_id, metric_id, need_type, description, priority, coaching_session_id },
    req.authUser!.id
  );
  res.status(201).json({ data });
}));

router.patch("/tni/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body as { status: string };
  if (!status) return res.status(400).json({ error: "status required" });
  const data = await managementService.updateTniStatus(req.params.id, status);
  res.json({ data });
}));

router.post("/coaching/:coachingId/create-tni", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { need_type, description, priority, metric_id } = req.body as {
    need_type?: string;
    description?: string;
    priority?: string;
    metric_id?: string;
  };
  const data = await managementService.createTniFromCoaching(
    req.params.coachingId,
    { need_type: need_type ?? "soft_skills", description, priority, metric_id },
    req.authUser!.id
  );
  res.status(201).json({ data });
}));

export { router as managementRouter };
