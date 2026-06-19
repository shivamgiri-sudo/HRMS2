import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { businessCommandService } from "./business-command.service.js";
import { revenueRiskService } from "../revenue-risk/revenue-risk.service.js";

export const businessCommandRouter = Router();
businessCommandRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

businessCommandRouter.get("/overview", h(async (_req, res) => {
  res.json({ success: true, data: await businessCommandService.overview() });
}));

businessCommandRouter.get("/revenue-risk/contracts", h(async (_req, res) => {
  res.json({ success: true, data: await revenueRiskService.listContracts() });
}));

businessCommandRouter.post("/revenue-risk/contracts", h(async (req, res) => {
  res.status(201).json({ success: true, data: await revenueRiskService.createContract(req.body, req.authUser!.id) });
}));

businessCommandRouter.get("/revenue-risk/snapshot", h(async (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  res.json({ success: true, data: await revenueRiskService.snapshot(date) });
}));

businessCommandRouter.post("/revenue-risk/generate-daily", h(async (req, res) => {
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  res.json({ success: true, data: await revenueRiskService.calculate(date, true) });
}));
