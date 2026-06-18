import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { helpdeskService } from "./helpdesk.service.js";
import { resolvePeopleExperienceScope } from "../people-experience/people-experience.scope.js";
import { getPeopleExperienceCommandCenter } from "../people-experience/people-experience.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Tickets ──────────────────────────────────────────────────────────────────

router.get("/dashboard", h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolvePeopleExperienceScope(req);
  const data = await getPeopleExperienceCommandCenter(scope, req.query as Record<string, string | undefined>);
  res.json({ success: true, data: data.support_health });
}));

router.get("/sla-summary", h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolvePeopleExperienceScope(req);
  const data = await getPeopleExperienceCommandCenter(scope, req.query as Record<string, string | undefined>);
  res.json({
    success: true,
    data: {
      total_open: data.support_health.total_open,
      sla_breached: data.support_health.sla_breached,
      generated_at: data.generated_at,
      scope: data.scope,
    },
  });
}));

router.get("/category-breakdown", h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolvePeopleExperienceScope(req);
  const data = await getPeopleExperienceCommandCenter(scope, req.query as Record<string, string | undefined>);
  res.json({ success: true, data: data.support_health.by_category });
}));

router.get("/owner-workload", requireRole("admin", "hr", "manager", "process_manager", "team_leader", "tl"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await helpdeskService.ownerWorkload(req.query as any) });
}));

router.get("/aging", requireRole("admin", "hr", "manager", "process_manager", "team_leader", "tl"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await helpdeskService.aging(req.query as any) });
}));

router.get("/root-causes", requireRole("admin", "hr", "manager", "process_manager", "team_leader", "tl"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await helpdeskService.rootCauses(req.query as any) });
}));

// Admin/HR see all; employee sees only own
router.get("/tickets", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr")) {
    return res.json({ data: await helpdeskService.listTickets(req.query as any) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  return res.json({ data: await helpdeskService.listTickets({ employee_id: emp.id }) });
}));

// Ticket creation: derive employee_id from authenticated user — ignore body employee_id
router.post("/tickets", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  let employeeId: string;

  if (await hasRole(userId, "admin", "hr")) {
    // Admin/HR can create on behalf of any employee but must supply valid employee_id
    employeeId = req.body.employee_id;
    if (!employeeId) return res.status(400).json({ error: "employee_id required for admin/hr ticket creation" });
  } else {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, message: "No employee record linked to your account" });
    employeeId = emp.id; // server-derived; body employee_id ignored
  }

  res.status(201).json({ data: await helpdeskService.createTicket({ ...req.body, employee_id: employeeId }) });
}));

// Ticket detail: admin/hr see any; employee sees own only
router.get("/tickets/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const ticket = await helpdeskService.getTicket(req.params.id) as (Record<string, unknown> & { employee_id: string; comments?: Record<string, unknown>[] }) | null;
  if (!ticket) return res.status(404).json({ error: "Not found" });

  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== ticket.employee_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }

  // Strip internal comments from non-admin/hr responses
  const data = isAdminHr
    ? ticket
    : { ...ticket, comments: (ticket.comments ?? []).filter((c) => !c["is_internal"]) };

  res.json({ data });
}));

router.patch("/tickets/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await helpdeskService.updateTicket(req.params.id, req.body) });
}));

router.post("/tickets/:id/assign", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body?.assigned_to) return res.status(400).json({ success: false, error: "assigned_to required" });
  res.json({ success: true, data: await helpdeskService.updateTicket(req.params.id, { assigned_to: req.body.assigned_to, status: "in_progress" }) });
}));

router.post("/tickets/:id/escalate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await helpdeskService.escalateTicket(req.params.id, req.body?.reason ?? null) });
}));

router.post("/tickets/:id/resolve", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body?.resolution_note) return res.status(400).json({ success: false, error: "resolution_note required" });
  res.json({ success: true, data: await helpdeskService.updateTicket(req.params.id, { status: "resolved", resolution_note: req.body.resolution_note }) });
}));

router.post("/tickets/:id/reopen", h(async (req: AuthenticatedRequest, res: Response) => {
  const ticket = await helpdeskService.getTicket(req.params.id) as any;
  if (!ticket) return res.status(404).json({ error: "Not found" });
  const isAdminHr = await hasRole(req.authUser!.id, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp || emp.id !== ticket.employee_id) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json({ success: true, data: await helpdeskService.reopenTicket(req.params.id, req.body?.reason ?? null) });
}));

router.post("/tickets/:id/rating", h(async (req: AuthenticatedRequest, res: Response) => {
  const rating = Number(req.body?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, error: "rating must be 1-5" });
  res.json({ success: true, data: await helpdeskService.rateTicket(req.params.id, rating) });
}));

// Comments: internal flag only allowed for admin/hr
router.post("/tickets/:id/comments", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { text, is_internal } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  // Only admin/hr can post internal comments
  const wantInternal = !!is_internal;
  if (wantInternal && !(await hasRole(userId, "admin", "hr"))) {
    return res.status(403).json({ success: false, message: "Only admin/hr can post internal comments" });
  }

  // Verify caller has access to this ticket
  const ticket = await helpdeskService.getTicket(req.params.id) as (Record<string, unknown> & { employee_id: string; comments?: Record<string, unknown>[] }) | null;
  if (!ticket) return res.status(404).json({ error: "Not found" });
  if (!(await hasRole(userId, "admin", "hr"))) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== ticket.employee_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }

  const id = await helpdeskService.addComment(req.params.id, userId, text, wantInternal);
  res.status(201).json({ data: { id } });
}));

// ── Grievances ────────────────────────────────────────────────────────────────

router.get("/grievances", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr")) {
    // Admin/HR see all grievances
    return res.json({ data: await helpdeskService.listGrievances(req.query as any) });
  }
  // Regular employees see only their own (anonymous ones are privacy-protected — employee_id hidden)
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  return res.json({
    data: await helpdeskService.listGrievances({ employee_id: emp.id })
  });
}));

router.get("/grievances/dashboard", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolvePeopleExperienceScope(req);
  const data = await getPeopleExperienceCommandCenter(scope, req.query as Record<string, string | undefined>);
  res.json({ success: true, data: data.grievance_health });
}));

router.get("/grievances/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const grievance = await helpdeskService.getGrievance(req.params.id, req.authUser!.id);
  if (!grievance) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, data: grievance });
}));

// Grievance creation: employee_id always derived server-side; body employee_id ignored
router.post("/grievances", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record linked to your account" });

  // employee_id is always the caller's own record — cannot impersonate
  res.status(201).json({
    data: await helpdeskService.createGrievance({
      ...req.body,
      employee_id: emp.id, // server-enforced; body employee_id discarded
    }),
  });
}));

router.patch("/grievances/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await helpdeskService.updateGrievance(req.params.id, req.body) });
}));

router.post("/grievances/:id/assign", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body?.assigned_to) return res.status(400).json({ success: false, error: "assigned_to required" });
  res.json({ success: true, data: await helpdeskService.updateGrievance(req.params.id, { assigned_to: req.body.assigned_to, status: "under_review" }) });
}));

router.post("/grievances/:id/escalate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await helpdeskService.escalateGrievance(req.params.id, req.body?.reason ?? null) });
}));

router.post("/grievances/:id/investigation-note", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body?.note) return res.status(400).json({ success: false, error: "note required" });
  res.json({ success: true, data: await helpdeskService.addGrievanceInvestigationNote(req.params.id, req.authUser!.id, req.body.note) });
}));

router.post("/grievances/:id/close", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body?.resolution_note) return res.status(400).json({ success: false, error: "resolution_note required" });
  res.json({ success: true, data: await helpdeskService.updateGrievance(req.params.id, { status: "closed", resolution_note: req.body.resolution_note }) });
}));

router.post("/grievances/:id/reopen", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await helpdeskService.updateGrievance(req.params.id, { status: "reopened" }) });
}));

router.post("/grievances/:id/evidence", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.status(201).json({ success: true, data: await helpdeskService.addGrievanceEvidence(req.params.id, req.body ?? {}) });
}));

export { router as helpdeskRouter };
