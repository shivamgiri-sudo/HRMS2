import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./sales-upload.service.js";

export const salesUploadRouter = Router();

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

salesUploadRouter.use(requireAuth);
// Read-only dashboard endpoints open to all ops/management roles.
// Upload/delete endpoints keep the tighter guard enforced per-route.
salesUploadRouter.use(
  requireRole(
    "super_admin", "admin", "ceo", "coo", "sales", "hr",
    "manager", "process_manager", "operations_manager", "branch_head"
  )
);

salesUploadRouter.get("/health", h(async (_req, res) => {
  return res.json({
    success: true,
    data: {
      module: "sales-upload",
      status: "available",
      message: "Sales upload routes are registered.",
    },
  });
}));

// ── Dashboard endpoints (read-only) ───────────────────────────────────────────

salesUploadRouter.get("/bellavita-dashboard", h(async (req, res) => {
  try {
    const month = String(req.query.month ?? "").slice(0, 7) ||
      new Date().toISOString().slice(0, 7);
    const data = await svc.getBellavitaDashboard(month);
    return res.json({ success: true, data });
  } catch (err) {
    return res.json({ success: true, _unavailable: true, data: { overall: {}, by_campaign: [] } });
  }
}));

salesUploadRouter.get("/gnc-dashboard", h(async (req, res) => {
  try {
    const month = String(req.query.month ?? "").slice(0, 7) ||
      new Date().toISOString().slice(0, 7);
    const data = await svc.getGncDashboard(month);
    return res.json({ success: true, data });
  } catch (err) {
    return res.json({ success: true, _unavailable: true, data: { summary: {}, by_product: [], apr_summary: {} } });
  }
}));

salesUploadRouter.get("/logs", h(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const data = await svc.getUploadLogs(limit);
    return res.json({ success: true, data });
  } catch {
    return res.json({ success: true, data: [] });
  }
}));
