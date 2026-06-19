import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { revenueRiskService } from "./revenue-risk.service.js";

export const revenueRiskRouter = Router();
revenueRiskRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

revenueRiskRouter.get("/contracts", h(async (_req, res) => {
  res.json({ success: true, data: await revenueRiskService.listContracts() });
}));

revenueRiskRouter.post("/contracts", h(async (req, res) => {
  res.status(201).json({ success: true, data: await revenueRiskService.createContract(req.body, req.authUser!.id) });
}));

revenueRiskRouter.get("/snapshot", h(async (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  res.json({ success: true, data: await revenueRiskService.snapshot(date) });
}));

revenueRiskRouter.post("/calculate", h(async (req, res) => {
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  const persist = Boolean(req.body?.persist);
  res.json({ success: true, data: await revenueRiskService.calculate(date, persist) });
}));

revenueRiskRouter.post("/generate-daily", h(async (req, res) => {
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  res.json({ success: true, data: await revenueRiskService.calculate(date, true) });
}));
