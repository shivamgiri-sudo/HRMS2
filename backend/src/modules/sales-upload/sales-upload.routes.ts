import { Router, type NextFunction, type Response } from "express";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./sales-upload.service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

// ── Neemans Dashboard (read-only) ─────────────────────────────────────────────

salesUploadRouter.get("/neemans-dashboard", h(async (req, res) => {
  const month = String(req.query.month ?? "").slice(0, 7) || new Date().toISOString().slice(0, 7);
  try {
    return res.json({ success: true, data: await svc.getNeemansDashboard(month) });
  } catch {
    return res.json({ success: true, _unavailable: true, data: { kpis: {}, daily_trend: [], agents: [] } });
  }
}));

salesUploadRouter.get("/neemans-apr-dashboard", h(async (req, res) => {
  const month = String(req.query.month ?? "").slice(0, 7) || new Date().toISOString().slice(0, 7);
  try {
    return res.json({ success: true, data: await svc.getNeemansAprDashboard(month) });
  } catch {
    return res.json({ success: true, _unavailable: true, data: { kpis: {}, agents: [] } });
  }
}));

salesUploadRouter.get("/neemans-abc-cart-snap", h(async (req, res) => {
  const month = String(req.query.month ?? "").slice(0, 7) || new Date().toISOString().slice(0, 7);
  try {
    return res.json({ success: true, data: await svc.getNeemansAbcCartSnap(month) });
  } catch {
    return res.json({ success: true, _unavailable: true, data: [] });
  }
}));

salesUploadRouter.get("/neemans-targets", h(async (req, res) => {
  const month = String(req.query.month ?? "");
  return res.json({ success: true, data: await svc.getNeemansTargets(month) });
}));

salesUploadRouter.post(
  "/neemans-targets",
  requireRole("super_admin", "admin", "operations_manager"),
  h(async (req, res) => {
    const { month, daily_target, total_target } = req.body as { month: string; daily_target: number; total_target: number };
    if (!month) return res.status(400).json({ success: false, error: "month required" });
    await svc.setNeemansTarget(month, Number(daily_target), Number(total_target));
    return res.json({ success: true });
  })
);

// ── Neemans Agent Detail Master ────────────────────────────────────────────────

salesUploadRouter.get("/nms-agent-details", h(async (_req, res) => {
  return res.json({ success: true, data: await svc.getNeemansAgentDetails() });
}));

salesUploadRouter.post(
  "/nms-agent-details",
  requireRole("super_admin", "admin", "operations_manager"),
  h(async (req, res) => {
    await svc.addNeemansAgentDetail(req.body as Record<string, unknown>);
    return res.json({ success: true });
  })
);

salesUploadRouter.put(
  "/nms-agent-details/:id",
  requireRole("super_admin", "admin", "operations_manager"),
  h(async (req, res) => {
    await svc.updateNeemansAgentDetail(Number(req.params.id), req.body as Record<string, unknown>);
    return res.json({ success: true });
  })
);

salesUploadRouter.delete(
  "/nms-agent-details/:id",
  requireRole("super_admin", "admin"),
  h(async (req, res) => {
    await svc.deleteNeemansAgentDetail(Number(req.params.id));
    return res.json({ success: true });
  })
);

// ── Neemans Upload Routes ─────────────────────────────────────────────────────

salesUploadRouter.post(
  "/upload-neemans-sale-raw",
  requireRole("super_admin", "admin", "sales", "operations_manager"),
  upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const result = await svc.uploadNeemansSaleRaw(req.file.buffer, req.authUser?.email ?? "system");
    return res.json({ success: true, data: result });
  })
);

salesUploadRouter.post(
  "/upload-neemans-allocation",
  requireRole("super_admin", "admin", "sales", "operations_manager"),
  upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const result = await svc.uploadNeemansAllocation(req.file.buffer, req.authUser?.email ?? "system");
    return res.json({ success: true, data: result });
  })
);

salesUploadRouter.post(
  "/upload-neemans-apr",
  requireRole("super_admin", "admin", "sales", "operations_manager"),
  upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const result = await svc.uploadNeemansApr(req.file.buffer, req.authUser?.email ?? "system");
    return res.json({ success: true, data: result });
  })
);
