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

// ── Bellavita / GNC upload + batch delete ────────────────────────────────────
//
// NativeSalesDashboard has always POSTed to /upload/:type and DELETEd /batch/:id, and the
// seven handlers below have always existed in sales-upload.service.ts — only the routes were
// missing, so every upload and every batch deletion failed. The neemans uploads further down
// are the same shape; these are the Bellavita and GNC halves that were never wired.
//
// A Map, not an object literal: the key comes straight from the URL, and an object lookup
// would happily resolve "constructor" or "__proto__" to something callable.
const UPLOAD_HANDLERS = new Map<string, (buffer: Buffer, uploadedBy: string) => Promise<{ rowsInserted: number }>>([
  ["bellavita-sales", svc.uploadBellavitaSales],
  ["bellavita-apr",   svc.uploadBellavitaApr],
  ["bellavita-chat",  svc.uploadBellavitaChat],
  ["bellavita-cart",  svc.uploadBellavitaCart],
  ["gnc-sales",       svc.uploadGncSales],
  ["gnc-apr",         svc.uploadGncApr],
  ["gnc-allocation",  svc.uploadGncAllocation],
]);

salesUploadRouter.post(
  "/upload/:type",
  requireRole("super_admin", "admin", "sales", "operations_manager"),
  upload.single("file"),
  h(async (req, res) => {
    const handler = UPLOAD_HANDLERS.get(String(req.params.type));
    if (!handler) {
      // Named explicitly rather than falling through to a generic failure: an unknown type is
      // a caller bug, and the list is short enough to just say what is accepted.
      return res.status(400).json({
        success: false,
        error: `Unknown upload type "${req.params.type}". Expected one of: ${[...UPLOAD_HANDLERS.keys()].join(", ")}`,
      });
    }
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });

    const result = await handler(req.file.buffer, req.authUser?.email ?? "system");
    // rowsInserted is repeated at the top level because hrmsApi.requestForm returns the raw
    // payload — it does not unwrap `data` — and the page reads res.rowsInserted. `data` stays
    // for consistency with every other route in this module.
    return res.json({ success: true, rowsInserted: result.rowsInserted, data: result });
  })
);

salesUploadRouter.delete(
  "/batch/:batchId",
  // Tighter than the uploads on purpose: deleteUploadBatch removes rows from seven tables
  // plus the upload log, and it cannot be undone from the UI.
  requireRole("super_admin", "admin", "operations_manager"),
  h(async (req, res) => {
    const batchId = String(req.params.batchId ?? "").trim();
    if (!batchId) return res.status(400).json({ success: false, error: "batchId is required" });
    await svc.deleteUploadBatch(batchId);
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
