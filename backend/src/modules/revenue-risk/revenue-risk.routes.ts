import { Router } from "express";
import type { Response, NextFunction } from "express";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { revenueRiskService } from "./revenue-risk.service.js";
import { resolveProcessScope } from "../dashboards/process-scope-guards.js";

/** null for org-wide callers; otherwise the processes inside the caller's branch / assigned scope. */
async function allowedProcesses(req: AuthenticatedRequest): Promise<ReadonlySet<string> | null> {
  const scope = await resolveProcessScope(req.authUser!.id);
  return scope.orgWide ? null : scope.processIds;
}

export const revenueRiskRouter = Router();
revenueRiskRouter.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

revenueRiskRouter.get("/contracts", h(async (req, res) => {
  const allowed = await allowedProcesses(req);
  res.json({ success: true, data: allowed ? await revenueRiskService.listContracts(allowed) : await revenueRiskService.listContracts() });
}));

revenueRiskRouter.post("/contracts", h(async (req, res) => {
  // A scoped caller may only file a contract for a process inside their own scope; an org-level contract
  // (no process) needs an org-wide role.
  const allowed = await allowedProcesses(req);
  if (allowed && !(req.body?.process_id && allowed.has(String(req.body.process_id)))) {
    return res.status(403).json({ success: false, message: "Forbidden: this process is outside your branch / assigned scope" });
  }
  res.status(201).json({ success: true, data: await revenueRiskService.createContract(req.body, req.authUser!.id) });
}));

revenueRiskRouter.get("/snapshot", h(async (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const allowed = await allowedProcesses(req);
  res.json({ success: true, data: allowed ? await revenueRiskService.snapshot(date, allowed) : await revenueRiskService.snapshot(date) });
}));

revenueRiskRouter.post("/calculate", h(async (req, res) => {
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  const allowed = await allowedProcesses(req);
  // Persisting rewrites the company-wide daily table, so only org-wide callers may; others get the scoped figures unsaved.
  const persist = Boolean(req.body?.persist) && !allowed;
  res.json({ success: true, data: allowed ? await revenueRiskService.calculate(date, persist, allowed) : await revenueRiskService.calculate(date, persist) });
}));

revenueRiskRouter.post("/generate-daily", h(async (req, res) => {
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  const allowed = await allowedProcesses(req);
  res.json({ success: true, data: allowed ? await revenueRiskService.calculate(date, false, allowed) : await revenueRiskService.calculate(date, true) });
}));
