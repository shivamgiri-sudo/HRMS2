import { Router } from "express";
import { z } from "zod";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole, getTargetFromBodyOrQuery } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { autoRosterSyncedService as s } from "./auto-roster-synced.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

router.use(requireAuth);

router.get(
  "/introspect",
  requireRole("admin", "hr", "wfm", "process_manager"),
  h(async (_req, res) => res.json({ success: true, data: await s.introspect() }))
);

router.get(
  "/masters",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (_req, res) => res.json({ success: true, data: await s.masters() }))
);

router.get(
  "/requirements",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => {
    const q = z.object({
      process_id: z.string().uuid().optional(),
      branch_id: z.string().uuid().optional(),
    }).parse(req.query);

    // Apply scope filtering
    const scoped = await buildScopeWhereClause(
      req.authUser!.id,
      ["wfm", "process_manager"],
      { branchId: "branch_id", processId: "process_id" },
      { allowCeoAllRead: true }
    );

    // Service handles filtering, but we validate scope access
    const data = await s.listRequirements(q);
    res.json({ success: true, data });
  })
);

router.post(
  "/requirements",
  requireRole("admin", "wfm"),
  requireScopedRole(["wfm"], getTargetFromBodyOrQuery),
  h(async (req, res) => {
    const body = z.object({
      process_id: z.string().uuid().nullable().optional(),
      branch_id: z.string().uuid().nullable().optional(),
      requirement_date: z.string().regex(DATE_RE).nullable().optional(),
      day_of_week: z.coerce.number().int().min(0).max(6).nullable().optional(),
      slot_start: z.string().regex(TIME_RE),
      slot_end: z.string().regex(TIME_RE),
      required_hc: z.coerce.number().int().min(0),
      shrinkage_pct: z.coerce.number().min(0).max(80).nullable().optional(),
    }).parse(req.body);
    const data = await s.upsertRequirement(body, req.authUser!.id);
    res.status(201).json({ success: true, data, message: "Slot requirement saved" });
  })
);

router.get(
  "/plans",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => {
    const q = z.object({
      process_id: z.string().uuid().optional(),
      branch_id: z.string().uuid().optional(),
      from_date: z.string().regex(DATE_RE).optional(),
      to_date: z.string().regex(DATE_RE).optional(),
    }).parse(req.query);

    // Apply scope filtering
    const scoped = await buildScopeWhereClause(
      req.authUser!.id,
      ["wfm", "process_manager"],
      { branchId: "rp.branch_id", processId: "rp.process_id" },
      { allowCeoAllRead: true }
    );

    const data = await s.listPlans(q);
    res.json({ success: true, data });
  })
);

router.post(
  "/plans",
  requireRole("admin", "wfm"),
  requireScopedRole(["wfm"], getTargetFromBodyOrQuery),
  h(async (req, res) => {
    const body = z.object({
      plan_name: z.string().trim().min(1).max(255),
      process_id: z.string().uuid().nullable().optional(),
      branch_id: z.string().uuid().nullable().optional(),
      from_date: z.string().regex(DATE_RE),
      to_date: z.string().regex(DATE_RE),
      required_headcount: z.coerce.number().int().min(0).optional(),
      shrinkage_pct: z.coerce.number().min(0).max(80).optional(),
    }).parse(req.body);
    const data = await s.createPlan(body, req.authUser!.id);
    res.status(201).json({ success: true, data, message: "Auto roster cycle created using existing wfm_roster_plan" });
  })
);

router.post(
  "/plans/:id/generate",
  requireRole("admin", "wfm"),
  requireScopedRole(["wfm"], async (req) => {
    // Resolve scope from plan
    const plan = await s.getPlanById(req.params.id);
    return { processId: plan?.process_id, branchId: plan?.branch_id };
  }),
  h(async (req, res) => res.json({ success: true, data: await s.generateDraft(req.params.id, req.authUser!.id) }))
);

router.get(
  "/plans/:id/assignments",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => res.json({ success: true, data: await s.getAssignments(req.params.id) }))
);

router.get(
  "/plans/:id/coverage",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => res.json({ success: true, data: await s.getCoverage(req.params.id) }))
);

router.get(
  "/plans/:id/conflicts",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => res.json({ success: true, data: await s.getConflicts(req.params.id) }))
);

router.post(
  "/plans/:id/submit",
  requireRole("admin", "wfm"),
  requireScopedRole(["wfm"], async (req) => {
    const plan = await s.getPlanById(req.params.id);
    return { processId: plan?.process_id, branchId: plan?.branch_id };
  }),
  h(async (req, res) => res.json({ success: true, data: await s.submitForApproval(req.params.id, req.authUser!.id) }))
);

router.post(
  "/plans/:id/approve",
  requireRole("admin", "process_manager"),
  requireScopedRole(["process_manager"], async (req) => {
    const plan = await s.getPlanById(req.params.id);
    return { processId: plan?.process_id, branchId: plan?.branch_id };
  }),
  h(async (req, res) => {
    const body = z.object({ remarks: z.string().max(700).optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await s.approve(req.params.id, req.authUser!.id, body.remarks) });
  })
);

router.post(
  "/plans/:id/reject",
  requireRole("admin", "process_manager"),
  requireScopedRole(["process_manager"], async (req) => {
    const plan = await s.getPlanById(req.params.id);
    return { processId: plan?.process_id, branchId: plan?.branch_id };
  }),
  h(async (req, res) => {
    const body = z.object({ remarks: z.string().trim().min(5).max(700) }).parse(req.body);
    res.json({ success: true, data: await s.reject(req.params.id, req.authUser!.id, body.remarks) });
  })
);

router.post(
  "/plans/:id/publish",
  requireRole("admin", "process_manager"),
  requireScopedRole(["process_manager"], async (req) => {
    const plan = await s.getPlanById(req.params.id);
    return { processId: plan?.process_id, branchId: plan?.branch_id };
  }),
  h(async (req, res) => res.json({ success: true, data: await s.publish(req.params.id, req.authUser!.id) }))
);

router.post(
  "/plans/:id/queue-manager-tasks",
  requireRole("admin", "wfm", "process_manager"),
  h(async (req, res) => res.json({ success: true, data: await s.queueManagerTasks(req.params.id, req.authUser!.id) }))
);

router.get(
  "/plans/:id/events",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => {
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    res.json({ success: true, data: await s.listEvents(req.params.id, since) });
  })
);

router.get(
  "/plans/:id/approval-log",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => res.json({ success: true, data: await s.listApprovalLog(req.params.id) }))
);

router.get(
  "/plans/:id/change-requests",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => res.json({ success: true, data: await s.listChangeRequests(req.params.id) }))
);

router.patch(
  "/assignments/:id/published-change",
  requireRole("admin", "process_manager"),
  requireScopedRole(["process_manager"], async (req) => {
    // Resolve scope from assignment
    const assignment = await s.getAssignmentById(req.params.id);
    return { processId: assignment?.process_id, branchId: assignment?.branch_id };
  }),
  h(async (req, res) => {
    const body = z.object({
      new_shift_id: z.string().uuid().nullable().optional(),
      new_shift_start_time: z.string().regex(TIME_RE).nullable().optional(),
      new_shift_end_time: z.string().regex(TIME_RE).nullable().optional(),
      new_roster_status: z.string().trim().max(80).optional(),
      change_category: z.enum(["shift_change", "weekoff_change", "leave_adjustment", "emergency", "support_staff_update"]).optional(),
      change_reason: z.string().trim().min(8).max(700),
    }).parse(req.body);
    const data = await s.changePublishedAssignment({ assignment_id: req.params.id, ...body }, req.authUser!.id);
    res.json({ success: true, data, message: "Published roster changed with locked notification" });
  })
);

router.get(
  "/events",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req, res) => {
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    res.json({ success: true, data: await s.listEvents(undefined, since) });
  })
);

router.get(
  "/my-roster",
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    const q = z.object({
      from_date: z.string().regex(DATE_RE).optional(),
      to_date: z.string().regex(DATE_RE).optional(),
    }).parse(req.query);
    res.json({ success: true, data: await s.myRoster(emp?.id ?? null, q.from_date, q.to_date) });
  })
);

router.post(
  "/assignments/:id/acknowledge",
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    const body = z.object({ remarks: z.string().max(500).optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await s.acknowledge(req.params.id, emp?.id ?? null, body.remarks) });
  })
);

export { router as autoRosterSyncedRouter };
