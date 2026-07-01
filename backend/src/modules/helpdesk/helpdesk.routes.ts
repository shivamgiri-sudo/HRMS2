import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { helpdeskService, writeSensitiveAuditLog } from "./helpdesk.service.js";
import {
  getHelpdeskDashboard,
  getHelpdeskSlaSummary,
  getCategoryBreakdown,
  getOwnerWorkload,
  getAgingBuckets,
  getRootCauses,
  getGrievanceDashboard,
  getGrievanceCommandCenter,
  getSupportCommandCenter,
  refreshSlaBreachFlags,
} from "./helpdesk-sla.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Support Command Center APIs ───────────────────────────────────────────────

router.get("/command-center", requireRole("admin", "hr", "super_admin", "manager", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getSupportCommandCenter(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/dashboard", requireRole("admin", "hr", "super_admin", "manager", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  await refreshSlaBreachFlags();
  const data = await getHelpdeskDashboard(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/sla-summary", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getHelpdeskSlaSummary(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/category-breakdown", requireRole("admin", "hr", "super_admin", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getCategoryBreakdown(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/owner-workload", requireRole("admin", "hr", "super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await getOwnerWorkload();
  return res.json({ success: true, data });
}));

router.get("/aging", requireRole("admin", "hr", "super_admin", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getAgingBuckets(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/root-causes", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getRootCauses(req.query as any);
  return res.json({ success: true, data });
}));

// ── Tickets ───────────────────────────────────────────────────────────────────

router.get("/tickets", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr")) {
    return res.json({ data: await helpdeskService.listTickets(req.query as any) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  return res.json({ data: await helpdeskService.listTickets({ employee_id: emp.id }) });
}));

router.post("/tickets", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  let employeeId: string;

  if (await hasRole(userId, "admin", "hr")) {
    employeeId = req.body.employee_id;
    if (!employeeId) return res.status(400).json({ error: "employee_id required for admin/hr ticket creation" });
  } else {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, message: "No employee record linked to your account" });
    employeeId = emp.id;
  }

  const ticket = await helpdeskService.createTicket({ ...req.body, employee_id: employeeId });
  res.status(201).json({ data: ticket });
}));

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

  const data = isAdminHr
    ? ticket
    : { ...ticket, comments: (ticket.comments ?? []).filter((c) => !c["is_internal"]) };

  res.json({ data });
}));

router.patch("/tickets/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await helpdeskService.updateTicket(req.params.id, req.body) });
}));

router.post("/tickets/:id/assign", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { assigned_to } = req.body;
  if (!assigned_to) return res.status(400).json({ error: "assigned_to required" });
  const data = await helpdeskService.updateTicket(req.params.id, req.body);
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "TICKET_ASSIGNED",
    moduleKey: "HELPDESK",
    entityType: "helpdesk_ticket",
    entityId: req.params.id,
    changeSummary: { assigned_to },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/tickets/:id/escalate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const ticket = await helpdeskService.getTicket(req.params.id) as any;
  if (!ticket) return res.status(404).json({ error: "Not found" });
  const newLevel = Number(ticket.escalation_level ?? 0) + 1;
  const data = await helpdeskService.updateTicket(req.params.id, { escalation_level: newLevel, status: "in_progress" } as any);
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "TICKET_ESCALATED",
    moduleKey: "HELPDESK",
    entityType: "helpdesk_ticket",
    entityId: req.params.id,
    changeSummary: { escalation_level: newLevel },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/tickets/:id/resolve", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { resolution_note, root_cause } = req.body;
  if (!resolution_note) return res.status(400).json({ error: "resolution_note required" });
  const data = await helpdeskService.updateTicket(req.params.id, { status: "resolved", resolution_note, root_cause });
  res.json({ data });
}));

router.post("/tickets/:id/reopen", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const ticket = await helpdeskService.getTicket(req.params.id) as any;
  if (!ticket) return res.status(404).json({ error: "Not found" });

  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== ticket.employee_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  const data = await helpdeskService.reopenTicket(req.params.id, userId);
  res.json({ data });
}));

router.post("/tickets/:id/rate", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const { rating } = req.body;
  if (!rating) return res.status(400).json({ error: "rating required" });
  const data = await helpdeskService.rateTicket(req.params.id, Number(rating), emp.id);
  res.json({ data });
}));

router.post("/tickets/:id/rating", h(async (req: AuthenticatedRequest, res: Response) => {
  const rating = Number(req.body?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: "rating must be 1-5" });
  }

  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });

  const data = await helpdeskService.rateTicket(req.params.id, rating, emp.id);
  res.json({ success: true, data });
}));

router.post("/tickets/:id/comments", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { text, is_internal } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const wantInternal = !!is_internal;
  if (wantInternal && !(await hasRole(userId, "admin", "hr"))) {
    return res.status(403).json({ success: false, message: "Only admin/hr can post internal comments" });
  }

  const ticket = await helpdeskService.getTicket(req.params.id) as any;
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

// ── Grievances ─────────────────────────────────────────────────────────────────

router.get("/grievances/command-center", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getGrievanceCommandCenter(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/grievances/dashboard", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getGrievanceDashboard(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/grievances", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr")) {
    return res.json({ data: await helpdeskService.listGrievances(req.query as any) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  return res.json({ data: await helpdeskService.listGrievances({ employee_id: emp.id }) });
}));

router.post("/grievances", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record linked to your account" });

  res.status(201).json({
    data: await helpdeskService.createGrievance({
      ...req.body,
      employee_id: emp.id,
    }),
  });
}));

// Grievance detail — every privileged access is audit logged
router.get("/grievances/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");

  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
    const list = await helpdeskService.listGrievances({ employee_id: emp.id });
    const found = (list as any[]).find(g => g.id === req.params.id);
    if (!found) return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const roles = isAdminHr ? ["admin", "hr"] : ["employee"];
  const grievance = await helpdeskService.getGrievance(req.params.id, roles);
  if (!grievance) return res.status(404).json({ error: "Not found" });

  if (isAdminHr) {
    await writeSensitiveAuditLog({
      actorUserId: userId,
      actionType: "GRIEVANCE_VIEWED",
      moduleKey: "PEOPLE_EXPERIENCE",
      entityType: "grievance",
      entityId: req.params.id,
      changeSummary: {
        viewer_roles: roles,
        is_anonymous: Boolean(grievance.is_anonymous),
        is_privileged: isAdminHr,
        confidentiality_level: grievance.confidentiality_level,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  res.json({ data: grievance });
}));

router.patch("/grievances/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await helpdeskService.updateGrievance(req.params.id, req.body);
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_UPDATED",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: req.body,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/grievances/:id/assign", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { assigned_to, assigned_committee } = req.body;
  if (!assigned_to && !assigned_committee) return res.status(400).json({ error: "assigned_to or assigned_committee required" });
  const data = await helpdeskService.updateGrievance(req.params.id, { assigned_to, assigned_committee });
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_ASSIGNED",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: { assigned_to, assigned_committee },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/grievances/:id/escalate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const grievance = await helpdeskService.getGrievance(req.params.id, ["admin"]);
  if (!grievance) return res.status(404).json({ error: "Not found" });
  const newLevel = Number((grievance as any).escalation_level ?? 0) + 1;
  const data = await helpdeskService.updateGrievance(req.params.id, { escalation_level: newLevel, status: "escalated" });
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_ESCALATED",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: { escalation_level: newLevel, reason: req.body.reason },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/grievances/:id/investigation-note", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { note } = req.body;
  if (!note) return res.status(400).json({ error: "note required" });
  const data = await helpdeskService.updateGrievance(req.params.id, { investigation_notes: note, status: "under_review" });
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_INVESTIGATION_NOTE",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: { note_length: note.length },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/grievances/:id/close", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { resolution_note } = req.body;
  if (!resolution_note) return res.status(400).json({ error: "resolution_note required for closing a grievance" });
  const data = await helpdeskService.updateGrievance(req.params.id, { status: "closed", resolution_note });
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_CLOSED",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: { resolution_note_length: resolution_note.length },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/grievances/:id/reopen", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await helpdeskService.updateGrievance(req.params.id, { status: "submitted" });
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_REOPENED",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: { reason: req.body.reason ?? null },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));

router.post("/grievances/:id/evidence", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { file_name, file_type, description } = req.body;
  if (!file_name) return res.status(400).json({ error: "file_name required" });
  const data = await helpdeskService.addEvidenceMetadata(req.params.id, req.authUser!.id, { file_name, file_type, description });
  res.status(201).json({ data });
}));

export { router as helpdeskRouter };
