import { Router, type NextFunction, type Response } from "express";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as ho from "./housing-owner-dashboard.service.js";
import * as hp from "./housing-premium-dashboard.service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const housingDashboardsRouter = Router();

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

housingDashboardsRouter.use(requireAuth);
housingDashboardsRouter.use(
  requireRole("super_admin", "admin", "ceo", "coo", "process_manager", "operations_manager", "branch_head", "hr", "manager"),
);

function parseFilters(req: AuthenticatedRequest) {
  return {
    startDate: (req.query.startDate as string) || undefined,
    endDate: (req.query.endDate as string) || undefined,
    tlName: (req.query.tlName as string) || undefined,
    agentName: (req.query.agentName as string) || undefined,
  };
}

// ── Housing Owner ────────────────────────────────────────────────────────────

housingDashboardsRouter.post("/housing-owner/upload/sale-raw", upload.single("file"), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
  const data = await ho.uploadSaleRaw(req.file.buffer, req.authUser?.id ?? "system");
  return res.json({ success: true, data });
}));

housingDashboardsRouter.post("/housing-owner/upload/cdr-raw", upload.single("file"), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
  const data = await ho.uploadCdrRaw(req.file.buffer, req.authUser?.id ?? "system");
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-owner/overview", h(async (req, res) => {
  const data = await ho.getOverview(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-owner/agent-performance", h(async (req, res) => {
  const data = await ho.getAgentPerformance(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-owner/daily-trend", h(async (req, res) => {
  const data = await ho.getDailyTrend(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-owner/filter-options", h(async (_req, res) => {
  const data = await ho.getFilterOptions();
  return res.json({ success: true, data });
}));

// ── Housing Premium ──────────────────────────────────────────────────────────

housingDashboardsRouter.post("/housing-premium/upload/sale-raw", upload.single("file"), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
  const data = await hp.uploadSaleRaw(req.file.buffer, req.authUser?.id ?? "system");
  return res.json({ success: true, data });
}));

housingDashboardsRouter.post("/housing-premium/upload/cdr-raw", upload.single("file"), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
  const data = await hp.uploadCdrRaw(req.file.buffer, req.authUser?.id ?? "system");
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-premium/overview", h(async (req, res) => {
  const data = await hp.getOverview(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-premium/agent-performance", h(async (req, res) => {
  const data = await hp.getAgentPerformance(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-premium/daily-trend", h(async (req, res) => {
  const data = await hp.getDailyTrend(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-premium/hourly-analysis", h(async (req, res) => {
  const data = await hp.getHourlyAnalysis(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-premium/target-achievement", h(async (req, res) => {
  const data = await hp.getTargetAchievement(parseFilters(req));
  return res.json({ success: true, data });
}));

housingDashboardsRouter.get("/housing-premium/filter-options", h(async (_req, res) => {
  const data = await hp.getFilterOptions();
  return res.json({ success: true, data });
}));
