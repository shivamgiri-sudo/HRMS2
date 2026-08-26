import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { MANAGEMENT_ROLES } from "../../platform/policy/roles.js";
import { businessActionsService } from "./business-actions.service.js";
import { businessActionSignalSync } from "./business-actions.signal-sync.js";

export const businessActionsRouter = Router();
businessActionsRouter.use(requireAuth);

/**
 * Every route here used to stop at requireAuth, so any authenticated employee could read
 * the whole org-wide action queue, create/assign/escalate/complete anyone's action, and
 * fire the org-wide signal syncs. The only thing keeping them out was the frontend
 * `<Gate pageCode="BUSINESS_ACTION_QUEUE">` on the queue page — UI route gating, which is
 * not a security boundary. Migration 1230's own note puts it plainly: "the backend
 * requireRole guards (the real security boundary in this codebase, not UI route gating)".
 *
 * Roles mirror the live role_page_access grants for BUSINESS_ACTION_QUEUE: super_admin
 * (full) and branch_head (can_view=1, can_create/can_edit/can_delete=0). branch_head
 * therefore reads but does not write. MANAGEMENT_ROLES supplies the admin/ceo/coo tier
 * this management surface is built for; requireRole passes super_admin implicitly.
 *
 * Safe to tighten: business_action_activity_log holds 156 rows and every one has
 * actor_user_id='system' — the cron in cron/business-action-sync.cron.ts, which calls
 * businessActionSignalSync directly rather than over HTTP and so is unaffected. No human
 * has ever driven these endpoints.
 */
const READ_ROLES = [...MANAGEMENT_ROLES, "branch_head"] as string[];
const WRITE_ROLES = [...MANAGEMENT_ROLES] as string[];
const requireRead = requireRole(...READ_ROLES);
const requireWrite = requireRole(...WRITE_ROLES);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

businessActionsRouter.get("/summary", requireRead, h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.summary(req.query as Record<string, unknown>) });
}));

businessActionsRouter.post("/sync-signals", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncAll(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.post("/sync-signals/people-experience", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncPeopleExperience(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.post("/sync-signals/support", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncSupportSla(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.post("/sync-signals/grievance", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncGrievances(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.post("/sync-signals/payroll", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncPayrollReadiness(req.authUser!.id);
  res.json({ success: true, data: { count: data.created, message: `${data.created} payroll actions synced`, details: data } });
}));

businessActionsRouter.post("/sync-signals/attendance", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncAttendanceGaps(req.authUser!.id);
  res.json({ success: true, data: { count: data.created, message: `${data.created} attendance actions synced`, details: data } });
}));

businessActionsRouter.post("/sync-signals/onboarding", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncOnboardingStuck(req.authUser!.id);
  res.json({ success: true, data: { count: data.created, message: `${data.created} onboarding actions synced`, details: data } });
}));

businessActionsRouter.post("/sync-signals/roster", requireWrite, h(async (req, res) => {
  const data = await businessActionSignalSync.syncRosterShortages(req.authUser!.id);
  res.json({ success: true, data: { count: data.created, message: `${data.created} roster actions synced`, details: data } });
}));

businessActionsRouter.get("/", requireRead, h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.list(req.query as Record<string, unknown>) });
}));

businessActionsRouter.get("/:id", requireRead, h(async (req, res) => {
  const data = await businessActionsService.get(req.params.id);
  if (!data) return res.status(404).json({ success: false, message: "Business action not found" });
  res.json({ success: true, data });
}));

businessActionsRouter.post("/", requireWrite, h(async (req, res) => {
  res.status(201).json({ success: true, data: await businessActionsService.create(req.body, req.authUser!.id) });
}));

businessActionsRouter.patch("/:id", requireWrite, h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.update(req.params.id, req.body, req.authUser!.id) });
}));

businessActionsRouter.post("/:id/assign", requireWrite, h(async (req, res) => {
  res.json({
    success: true,
    data: await businessActionsService.assign(
      req.params.id,
      req.body?.owner_user_id ?? null,
      req.body?.owner_role ?? null,
      req.authUser!.id
    ),
  });
}));

businessActionsRouter.post("/:id/escalate", requireWrite, h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.escalate(req.params.id, req.body?.reason ?? null, req.authUser!.id) });
}));

businessActionsRouter.post("/:id/complete", requireWrite, h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.complete(req.params.id, req.body?.closure_note ?? null, req.authUser!.id) });
}));

businessActionsRouter.post("/:id/comments", requireWrite, h(async (req, res) => {
  res.status(201).json({ success: true, data: await businessActionsService.comment(req.params.id, req.authUser!.id, req.body) });
}));
