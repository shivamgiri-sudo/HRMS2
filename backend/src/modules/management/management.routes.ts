import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { managementService } from "./management.service.js";
import { db } from "../../db/mysql.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

/**
 * Resolve scoped employee ID list for non-admin/hr roles.
 * Admins, HR, CEO see everyone. Managers/TLs see only their direct reports.
 * Returns null if the caller has no employee record (block the request).
 * Returns [] if the manager has no reports yet (no data returned).
 */
async function resolveTeamScope(userId: string): Promise<{ employeeIds: string[] | null; isWide: boolean }> {
  if (await hasRole(userId, "admin", "hr", "ceo", "qa")) {
    return { employeeIds: null, isWide: true };
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return { employeeIds: null, isWide: false };
  const ids = await managementService.getDirectReportIds(emp.id);
  // Include the manager's own employee ID for completeness (e.g. their own alerts)
  if (!ids.includes(emp.id)) ids.push(emp.id);
  return { employeeIds: ids, isWide: false };
}

router.get("/team-kpi", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
  if (!isWide && employeeIds !== null && employeeIds.length === 0) {
    return res.json({ data: [] });
  }
  const filters: Record<string, unknown> = { ...req.query };
  if (!isWide && employeeIds) filters.employee_ids = employeeIds;
  res.json({ data: await managementService.getTeamKpiSummary(filters as any) });
}));

router.get("/coaching", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr", "qa")) {
    return res.json({ data: await managementService.listCoachingSessions(req.query as any) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  // Managers see sessions for all their direct reports
  const directIds = await managementService.getDirectReportIds(emp.id);
  if (directIds.length > 0) {
    return res.json({ data: await managementService.listCoachingSessions({ employee_ids: directIds }) });
  }
  // Fallback: show own sessions if no direct reports
  return res.json({ data: await managementService.listCoachingSessions({ employee_id: emp.id }) });
}));

router.post("/coaching", requireRole("admin", "hr", "qa", "manager", "branch_head", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, session_date, session_type } = req.body;
  if (!employee_id || !session_date || !session_type)
    return res.status(400).json({ error: "employee_id, session_date, session_type required" });
  res.status(201).json({ data: await managementService.createCoachingSession(req.body, req.authUser!.id, req) });
}));

router.get("/alerts", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const acknowledged = req.query.acknowledged !== undefined ? req.query.acknowledged === "true" : undefined;
  const { employeeIds, isWide } = await resolveTeamScope(userId);
  if (!isWide && employeeIds !== null && employeeIds.length === 0) {
    return res.json({ data: [] });
  }
  const filters: Record<string, unknown> = { ...(req.query as any), acknowledged };
  if (!isWide && employeeIds) filters.employee_ids = employeeIds;
  res.json({ data: await managementService.listAlerts(filters as any) });
}));

router.post("/alerts/:id/acknowledge", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  await managementService.acknowledgeAlert(req.params.id, req.authUser!.id, req);
  res.json({ ok: true });
}));

router.get("/dashboard", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
  const processId = req.query.process_id as string | undefined;
  res.json({ data: await managementService.getDashboardSummary(
    isWide ? processId : undefined,
    (!isWide && employeeIds) ? employeeIds : undefined
  ) });
}));

router.get("/workforce-dashboard", requireRole("admin", "hr", "ceo"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.getWorkforceDashboard() });
}));

router.get("/system-dashboard", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.getSystemDashboard() });
}));

// ─── TNI (Training Needs Identification) ─────────────────────────────────────

// Returns the calling manager's direct reports (for coaching modal dropdowns, etc.)
router.get("/team-members", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr", "ceo")) {
    // Wide roles: return a small employee list (name + id only) filtered by process if provided
    const processId = req.query.process_id as string | undefined;
    const conds = ["e.active_status = 1"];
    const params: unknown[] = [];
    if (processId) { conds.push("e.process_id = ?"); params.push(processId); }
    const [rows] = await db.execute(
      `SELECT e.id, e.employee_code, e.full_name FROM employees e WHERE ${conds.join(" AND ")} ORDER BY e.full_name LIMIT 500`,
      params
    );
    return res.json({ data: rows });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const ids = await managementService.getDirectReportIds(emp.id);
  if (ids.length === 0) return res.json({ data: [] });
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db.execute(
    `SELECT e.id, e.employee_code, e.full_name FROM employees e WHERE e.id IN (${placeholders}) AND e.active_status = 1 ORDER BY e.full_name`,
    ids
  );
  return res.json({ data: rows });
}));

router.get("/tni", requireRole("admin", "hr", "manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.listTni(req.query as { employee_id?: string; status?: string }) });
}));

router.post("/tni", requireRole("admin", "hr", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
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

router.patch("/tni/:id", requireRole("admin", "hr", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
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

router.get("/ceo-metrics", requireRole("admin", "hr", "ceo", "finance"), h(async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await managementService.getCeoMetrics();
    res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load CEO metrics";
    console.error("[ceo-metrics]", msg);
    // Return partial data or fallback to avoid complete failure
    res.status(500).json({ success: false, error: "CEO metrics temporarily unavailable", _details: msg });
  }
}));

export { router as managementRouter };
