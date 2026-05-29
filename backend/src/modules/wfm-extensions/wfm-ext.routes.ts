import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { rosterSwapService, rosterConflictService, coverageService, attritionService } from "./wfm-ext.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Roster Swap ───────────────────────────────────────────────────────────────
// scope-limited: manager access deferred until user_assignment_scope enforcement is available

router.get("/roster/swaps", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr", "wfm")) {
    return res.json({ data: await rosterSwapService.list(req.query as any) });
  }
  // Employee sees their own swaps
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "Forbidden" });
  return res.json({ data: await rosterSwapService.list({ employee_id: emp.id }) });
}));

router.post("/roster/swaps", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const { swap_with_emp_id, swap_date, reason } = req.body;
  if (!swap_with_emp_id || !swap_date) return res.status(400).json({ error: "swap_with_emp_id and swap_date required" });
  res.status(201).json({ data: await rosterSwapService.create({ requester_emp_id: emp.id, swap_with_emp_id, swap_date, reason }) });
}));

router.post("/roster/swaps/:id/review", requireRole("admin", "hr", "wfm", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected" });
  await rosterSwapService.review(req.params.id, status, req.authUser!.id, req);
  res.json({ ok: true });
}));

// ── Roster Conflicts ──────────────────────────────────────────────────────────
// scope-limited: manager access deferred until user_assignment_scope enforcement is available

router.get("/roster/conflicts", requireRole("admin", "hr", "wfm"), h(async (req: AuthenticatedRequest, res: Response) => {
  const resolved = req.query.resolved !== undefined ? req.query.resolved === "true" : undefined;
  res.json({ data: await rosterConflictService.list({ resolved, employee_id: req.query.employee_id as string | undefined }) });
}));

router.post("/roster/conflicts/:id/resolve", requireRole("admin", "hr", "wfm"), h(async (req: AuthenticatedRequest, res: Response) => {
  await rosterConflictService.resolve(req.params.id, req.authUser!.id, req);
  res.json({ ok: true });
}));

// ── Coverage / Shrinkage Snapshots ────────────────────────────────────────────
// scope-limited: manager access deferred until user_assignment_scope enforcement is available

router.get("/coverage", requireRole("admin", "hr", "wfm"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await coverageService.getSnapshots(req.query as any) });
}));

router.post("/coverage/snapshot", requireRole("admin", "wfm"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { snapshot_date, planned_headcount, actual_headcount, absent_count, leave_count } = req.body;
  if (!snapshot_date || planned_headcount === undefined) return res.status(400).json({ error: "snapshot_date and planned_headcount required" });
  await coverageService.upsertSnapshot({ ...req.body, planned_headcount, actual_headcount: actual_headcount ?? 0, absent_count: absent_count ?? 0, leave_count: leave_count ?? 0 }, req.authUser!.id, req);
  res.json({ ok: true });
}));

// ── Attrition ─────────────────────────────────────────────────────────────────
// scope-limited: manager access deferred until user_assignment_scope enforcement is available

router.get("/attrition/summary", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await attritionService.getSummary(req.query as any) });
}));

router.post("/attrition/record", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, exit_date, exit_type } = req.body;
  if (!employee_id || !exit_date || !exit_type) return res.status(400).json({ error: "employee_id, exit_date, exit_type required" });
  const id = await attritionService.recordExit({ ...req.body, recorded_by: req.authUser!.id }, req);
  res.status(201).json({ data: { id } });
}));

export { router as wfmExtRouter };
