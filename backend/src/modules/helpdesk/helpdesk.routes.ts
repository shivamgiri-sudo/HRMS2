import { Router } from "express";
import type { Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRoleForRequest } from "../../shared/accessGuard.js";
import { resolveUserBusinessScope, buildProcessScopeCondition } from "../../shared/enterpriseScope.js";
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
  getItDepthAnalysis,
} from "./helpdesk-sla.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { db } from "../../db/mysql.js";
import { registerUpload } from "../document-vault/documentVault.service.js";

// ── Grievance evidence multer setup ───────────────────────────────────────────
const EVIDENCE_UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "grievance-evidence");
const EVIDENCE_ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"]);

const evidenceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(EVIDENCE_UPLOADS_DIR, { recursive: true });
    cb(null, EVIDENCE_UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const evidenceUpload = multer({
  storage: evidenceStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (EVIDENCE_ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Allowed: ${[...EVIDENCE_ALLOWED_EXT].join(", ")}`));
    }
  },
});

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Roles that can manage tickets (IT agents + existing admin/HR)
const HELPDESK_ADMIN_ROLES = ["admin", "hr", "super_admin", "it", "branch_it", "it_admin"] as const;
// The subset of HELPDESK_ADMIN_ROLES that is org-wide by design (unchanged).
const HELPDESK_ORG_WIDE_ROLES = ["admin", "hr", "super_admin"] as const;
// The subset that must be scoped to its own branch/process — previously treated
// identically to org-wide roles, giving company-wide ticket visibility to a role
// named "branch_it" (delta-audit 2026-08-14, P1; same anti-pattern the same-HEAD
// IJP fix closed for job postings).
const HELPDESK_SCOPED_IT_ROLES = ["it", "branch_it", "it_admin"] as const;

/**
 * Row-scope condition for a caller reaching a HELPDESK_ADMIN_ROLES-gated route.
 * "1=1" (unrestricted) for admin/hr/super_admin — unchanged behavior. A real
 * branch/process condition for it/branch_it/it_admin, resolved the same way
 * job-requisition.service.ts and ijp.service.ts already do for their own
 * manager-tier roles: org-wide if the assignment says "all", branch/process-
 * scoped if a real user_assignment_scope row exists, fail-closed (1=0) if the
 * caller has none configured yet — consistent with how every other under-
 * provisioned manager-tier role in this codebase already behaves, not a
 * special case invented here.
 */
async function resolveHelpdeskTicketScope(
  user: AuthenticatedRequest["authUser"]
): Promise<{ sql: string; params: unknown[] }> {
  if (await hasRoleForRequest(user, ...HELPDESK_ORG_WIDE_ROLES)) {
    return { sql: "1=1", params: [] };
  }
  const scope = await resolveUserBusinessScope(user as { id: string });
  return buildProcessScopeCondition(scope, { branchId: "e.branch_id", processId: "e.process_id" });
}

router.use(requireAuth);

// ── Support Command Center APIs ───────────────────────────────────────────────

router.get("/command-center", requireRole("admin", "hr", "super_admin", "manager", "process_manager", "it", "branch_it", "it_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolveHelpdeskTicketScope(req.authUser);
  const data = await getSupportCommandCenter(req.query as any, scope);
  return res.json({ success: true, data });
}));

router.get("/dashboard", requireRole("admin", "hr", "super_admin", "manager", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolveHelpdeskTicketScope(req.authUser);
  const data = await getHelpdeskDashboard(req.query as any, scope);
  return res.json({ success: true, data });
}));

router.get("/sla-summary", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getHelpdeskSlaSummary(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/category-breakdown", requireRole("admin", "hr", "super_admin", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolveHelpdeskTicketScope(req.authUser);
  const data = await getCategoryBreakdown(req.query as any, scope);
  return res.json({ success: true, data });
}));

router.get("/owner-workload", requireRole("admin", "hr", "super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await getOwnerWorkload();
  return res.json({ success: true, data });
}));

router.get("/aging", requireRole("admin", "hr", "super_admin", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolveHelpdeskTicketScope(req.authUser);
  const data = await getAgingBuckets(req.query as any, scope);
  return res.json({ success: true, data });
}));

router.get("/root-causes", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getRootCauses(req.query as any);
  return res.json({ success: true, data });
}));

router.get("/it-analysis", requireRole("admin", "hr", "super_admin", "it", "branch_it", "it_admin", "manager", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await resolveHelpdeskTicketScope(req.authUser);
  const data = await getItDepthAnalysis(req.query as any, scope);
  return res.json({ success: true, data });
}));

// ── Tickets ───────────────────────────────────────────────────────────────────

router.get("/tickets", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRoleForRequest(req.authUser, ...HELPDESK_ADMIN_ROLES)) {
    const scope = await resolveHelpdeskTicketScope(req.authUser);
    return res.json({ data: await helpdeskService.listTickets(req.query as any, scope) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  return res.json({ data: await helpdeskService.listTickets({ employee_id: emp.id }) });
}));

router.post("/tickets", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  let employeeId: string;

  if (await hasRoleForRequest(req.authUser, ...HELPDESK_ADMIN_ROLES)) {
    employeeId = req.body.employee_id;
    if (!employeeId) return res.status(400).json({ error: "employee_id required for admin/IT ticket creation on behalf of employee" });
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
  const isAdminHr = await hasRoleForRequest(req.authUser, ...HELPDESK_ADMIN_ROLES);

  let ticket: (Record<string, unknown> & { employee_id: string; comments?: Record<string, unknown>[] }) | null;
  if (isAdminHr) {
    const scope = await resolveHelpdeskTicketScope(req.authUser);
    ticket = await helpdeskService.getTicket(req.params.id, scope) as typeof ticket;
    // Out-of-scope reads identically to not-found — consistent with the rest of
    // this route (an employee cannot tell "exists elsewhere" from "doesn't exist").
    if (!ticket) return res.status(404).json({ error: "Not found" });
  } else {
    ticket = await helpdeskService.getTicket(req.params.id) as typeof ticket;
    if (!ticket) return res.status(404).json({ error: "Not found" });
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

/** Confirms the ticket exists AND falls within the caller's scope before a mutation. */
async function loadTicketInScope(req: AuthenticatedRequest) {
  const scope = await resolveHelpdeskTicketScope(req.authUser);
  return helpdeskService.getTicket(req.params.id, scope);
}

router.patch("/tickets/:id", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await loadTicketInScope(req))) return res.status(404).json({ error: "Not found" });
  res.json({ data: await helpdeskService.updateTicket(req.params.id, req.body) });
}));

router.post("/tickets/:id/assign", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const { assigned_to } = req.body;
  if (!assigned_to) return res.status(400).json({ error: "assigned_to required" });
  if (!(await loadTicketInScope(req))) return res.status(404).json({ error: "Not found" });
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
  // Fire-and-forget: notify the assignee
  try {
    const ticket = await helpdeskService.getTicket(req.params.id) as any;
    if (ticket) {
      await inboxService.createItem({
        user_id: assigned_to,
        type: "helpdesk_ticket_assigned",
        title: "New ticket assigned to you",
        description: `Ticket ${ticket.ticket_code}: ${ticket.subject}`,
        entity_type: "helpdesk_ticket",
        entity_id: req.params.id,
        action_url: `/helpdesk`,
        priority: "normal",
      });
    }
  } catch (_) { /* fire-and-forget — never block the response */ }
  res.json({ data });
}));

router.post("/tickets/:id/escalate", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const ticket = await loadTicketInScope(req) as any;
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

router.post("/tickets/:id/resolve", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const { resolution_note, root_cause } = req.body;
  if (!resolution_note) return res.status(400).json({ error: "resolution_note required" });
  if (!(await loadTicketInScope(req))) return res.status(404).json({ error: "Not found" });
  const data = await helpdeskService.updateTicket(req.params.id, { status: "resolved", resolution_note, root_cause });
  // Fire-and-forget: notify the ticket reporter
  try {
    const ticket = await helpdeskService.getTicket(req.params.id) as any;
    if (ticket?.employee_id) {
      const [uRows] = await db.execute("SELECT user_id FROM employees WHERE id = ? LIMIT 1", [ticket.employee_id]) as any;
      const reporterUserId = (uRows as any[])[0]?.user_id;
      if (reporterUserId) {
        await inboxService.createItem({
          user_id: reporterUserId,
          type: "helpdesk_ticket_resolved",
          title: "Your helpdesk ticket has been resolved",
          description: `Ticket ${ticket.ticket_code} has been resolved`,
          entity_type: "helpdesk_ticket",
          entity_id: req.params.id,
          action_url: `/helpdesk`,
          priority: "normal",
        });
      }
    }
  } catch (_) { /* fire-and-forget — never block the response */ }
  res.json({ data });
}));

router.post("/tickets/:id/reopen", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRoleForRequest(req.authUser, ...HELPDESK_ADMIN_ROLES);

  let ticket: any;
  if (isAdminHr) {
    ticket = await loadTicketInScope(req);
    if (!ticket) return res.status(404).json({ error: "Not found" });
  } else {
    ticket = await helpdeskService.getTicket(req.params.id) as any;
    if (!ticket) return res.status(404).json({ error: "Not found" });
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== ticket.employee_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  const data = await helpdeskService.reopenTicket(req.params.id, userId);
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
  const isHelpdeskAdmin = await hasRoleForRequest(req.authUser, ...HELPDESK_ADMIN_ROLES);
  if (wantInternal && !isHelpdeskAdmin) {
    return res.status(403).json({ success: false, message: "Only admin/hr/IT can post internal comments" });
  }

  const ticket = isHelpdeskAdmin
    ? await loadTicketInScope(req) as any
    : await helpdeskService.getTicket(req.params.id) as any;
  if (!ticket) return res.status(404).json({ error: "Not found" });
  if (!isHelpdeskAdmin) {
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
  if (await hasRoleForRequest(req.authUser, "admin", "hr")) {
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
  const isAdminHr = await hasRoleForRequest(req.authUser, "admin", "hr");

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

// GET /grievances/:id/timeline — case history for the detail drawer.
//
// NativeGrievanceCommandCenter has always requested this alongside the detail
// call inside a Promise.allSettled, so the missing route produced no error —
// just a drawer with no history. The route-contract gate is what surfaced it.
//
// Access control is deliberately identical to GET /grievances/:id rather than a
// lighter check: a timeline names the people who handled a case that may be
// anonymous, confidentiality-graded and anti-retaliation-flagged, so it must not
// be readable by anyone who cannot read the grievance itself. Equally it is not
// behind a blanket requireRole, which would cut an employee off from the history
// of their own case.
router.get("/grievances/:id/timeline", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRoleForRequest(req.authUser, "admin", "hr");

  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
    const list = await helpdeskService.listGrievances({ employee_id: emp.id });
    const found = (list as any[]).find(g => g.id === req.params.id);
    if (!found) return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const data = await helpdeskService.getGrievanceTimeline(req.params.id);
  res.json({ data });
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

// POST /grievances/:id/status — frontend NativeGrievanceCommandCenter status transitions
router.post("/grievances/:id/status", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body;
  const VALID_STATUSES = ["under_review", "resolved", "submitted", "closed", "escalated"];
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  const grievance = await helpdeskService.getGrievance(req.params.id, ["admin", "hr"]) as any;
  if (!grievance) return res.status(404).json({ error: "Not found" });
  const data = await helpdeskService.updateGrievance(req.params.id, { status });
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_STATUS_CHANGED",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: { status, previous_status: grievance.status },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  // Fire-and-forget: notify the grievance submitter (skip if anonymous)
  try {
    if (!grievance.is_anonymous && grievance.employee_id) {
      const [uRows] = await db.execute("SELECT user_id FROM employees WHERE id = ? LIMIT 1", [grievance.employee_id]) as any;
      const reporterUserId = (uRows as any[])[0]?.user_id;
      if (reporterUserId) {
        await inboxService.createItem({
          user_id: reporterUserId,
          type: "grievance_status_changed",
          title: `Your grievance status has changed to ${status}`,
          description: `Grievance ${grievance.grievance_code}`,
          entity_type: "grievance",
          entity_id: req.params.id,
          action_url: `/helpdesk`,
          priority: "normal",
        });
      }
    }
  } catch (_) { /* fire-and-forget — never block the response */ }
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

router.post(
  "/grievances/:id/evidence",
  requireRole("admin", "hr"),
  (req: any, res: any, next: any) => {
    evidenceUpload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  h(async (req: AuthenticatedRequest, res: Response) => {
    const effectiveName: string =
      (req.body?.file_name as string | undefined) ?? req.file?.originalname ?? "";
    const effectiveType: string | undefined =
      (req.body?.file_type as string | undefined) ?? req.file?.mimetype;
    const description: string | undefined = req.body?.description;

    if (!effectiveName) {
      return res.status(400).json({ error: "file_name required" });
    }

    let file_url: string | undefined;

    if (req.file) {
      const storedFilename = req.file.filename;
      const filePath = req.file.path;
      const fileUrl = `/api/files/grievance-evidence/${storedFilename}`;

      try {
        await registerUpload({
          uploadedByUser: req.authUser!.id,
          category: "grievance-evidence",
          storedFilename,
          originalFilename: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSizeBytes: req.file.size,
          accessLevel: "internal",
        });
        file_url = fileUrl;
      } catch (vaultErr) {
        console.error("[grievance-evidence] vault registration failed:", vaultErr);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        return res.status(500).json({
          error: "Failed to register file in document vault. Upload rolled back.",
          code: "VAULT_REGISTRATION_FAILED",
        });
      }
    }

    const data = await helpdeskService.addEvidenceMetadata(
      req.params.id,
      req.authUser!.id,
      { file_name: effectiveName, file_type: effectiveType, description, file_url },
    );
    res.status(201).json({ data });
  }),
);

// ── Agents list (for assign dropdown) ─────────────────────────────────────────

router.get("/agents", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const { branch_id } = req.query as { branch_id?: string };
  const data = await helpdeskService.listAgents({ branch_id });
  return res.json({ success: true, data });
}));

// ── Self-assign (Take) ────────────────────────────────────────────────────────

router.post("/tickets/:id/take", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const ticket = await loadTicketInScope(req) as any;
  if (!ticket) return res.status(404).json({ error: "Not found" });
  if (ticket.assigned_to && ticket.assigned_to !== userId) {
    return res.status(409).json({ success: false, error: "Ticket already assigned to another agent" });
  }
  const data = await helpdeskService.takeTicket(req.params.id, userId);
  await writeSensitiveAuditLog({
    actorUserId: userId,
    actionType: "TICKET_TAKEN",
    moduleKey: "HELPDESK",
    entityType: "helpdesk_ticket",
    entityId: req.params.id,
    changeSummary: { assigned_to: userId },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  return res.json({ success: true, data });
}));

// ── On-hold ───────────────────────────────────────────────────────────────────

router.post("/tickets/:id/hold", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: "reason required" });
  if (!(await loadTicketInScope(req))) return res.status(404).json({ error: "Not found" });
  const data = await helpdeskService.holdTicket(req.params.id, req.authUser!.id, reason.trim());
  return res.json({ success: true, data });
}));

// ── Knowledge Base ────────────────────────────────────────────────────────────

router.get("/kb", h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await helpdeskService.listKbArticles(req.query as any);
  return res.json({ success: true, data });
}));

router.post("/kb", requireRole(...HELPDESK_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await helpdeskService.createKbArticle({
    ...req.body,
    author_user_id: req.authUser!.id,
  });
  return res.status(201).json({ success: true, data });
}));

router.get("/kb/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await helpdeskService.getKbArticle(req.params.id);
  if (!data) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true, data });
}));

router.post("/kb/:id/helpful", h(async (req: AuthenticatedRequest, res: Response) => {
  const { is_helpful } = req.body;
  if (is_helpful == null) return res.status(400).json({ error: "is_helpful required" });
  await helpdeskService.markKbHelpful(req.params.id, req.authUser!.id, !!is_helpful);
  return res.json({ success: true });
}));

export { router as helpdeskRouter };
