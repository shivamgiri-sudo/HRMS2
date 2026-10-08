import { Router, type NextFunction, type Response } from "express";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireProcessCodesInScope } from "../dashboards/process-scope-guards.js";
import * as svc from "./bla-bli-blu-dashboard.service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const blaBliBluDashboardRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };

const VIEWER_ROLES = ["super_admin", "admin", "ceo", "coo", "management", "manager", "process_manager", "operations_manager", "branch_head", "sales", "qa", "quality_analyst", "tq_head"];
const UPLOAD_ROLES = ["super_admin", "admin", "sales", "operations_manager"];
const TARGET_ROLES = ["super_admin", "admin", "ceo", "coo", "management"];

/** For actions whose failures are the user's to read ("that upload was not found"): a 400 with the sentence, not a 500. */
const hu = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      if (msg && !/^ER_|sql|syntax|connect/i.test(msg)) return res.status(400).json({ success: false, message: msg });
      return next(e);
    });
  };

blaBliBluDashboardRouter.use(requireAuth);
// Owner ruling 2026-10-01: dashboard data only for callers whose scope includes the process (org-wide roles pass).
// BLA BLI BLU is its own process (BLA_BLI_BLU, NOIDA-2), not Bellavita (BELLA_VITA, NOIDA): checking Bellavita
// refused the BLA BLI BLU process managers themselves (Bhavesh Dayal, 2026-10-06).
blaBliBluDashboardRouter.use(requireProcessCodesInScope(["BLA_BLI_BLU"]));

const q = (req: AuthenticatedRequest, k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : undefined);

blaBliBluDashboardRouter.get("/overview", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await svc.getDashboard(q(req, "from"), q(req, "to")) });
}));

blaBliBluDashboardRouter.get("/product-wise", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await svc.getProductWise(q(req, "from"), q(req, "to")) });
}));

blaBliBluDashboardRouter.get("/analytics", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const { getBlaAnalytics } = await import("./bla-analytics.service.js");
  res.json({ success: true, data: await getBlaAnalytics(q(req, "from"), q(req, "to")) });
}));

blaBliBluDashboardRouter.get("/targets", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  res.json({ success: true, data: await svc.getTargets() });
}));

const ratio = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

blaBliBluDashboardRouter.put("/targets", requireRole(...TARGET_ROLES), h(async (req, res) => {
  const b = req.body ?? {};
  const lob = typeof b.lob === "string" ? b.lob.trim() : "";
  if (!lob || lob.length > 64) return res.status(400).json({ success: false, error: "lob is required" });
  if (!ratio(b.requiredPerDay, 0, 1e7) || !ratio(b.capPct, 0, 10) || !ratio(b.conversionTarget, 0, 1) ||
      !ratio(b.prepaidTarget, 0, 1) || !ratio(b.rtoTarget, 0, 1) || !ratio(b.targetAov, 0, 1e6)) {
    return res.status(400).json({ success: false, error: "Invalid target values (ratios must be between 0 and 1)" });
  }
  await svc.saveTarget({ lob, requiredPerDay: b.requiredPerDay, capPct: b.capPct, conversionTarget: b.conversionTarget, prepaidTarget: b.prepaidTarget, rtoTarget: b.rtoTarget, targetAov: b.targetAov }, req.authUser?.id ?? "system");
  return res.json({ success: true, data: await svc.getTargets() });
}));

// ── Uploaded files: see what was loaded, and remove a wrong upload as a whole ──
blaBliBluDashboardRouter.get("/uploads", requireRole(...UPLOAD_ROLES), h(async (_req, res) => {
  const { listUploadBatches } = await import("./bbb-uploads.service.js");
  res.json({ success: true, data: await listUploadBatches() });
}));
blaBliBluDashboardRouter.post("/uploads/received/:batchId/trash", requireRole(...UPLOAD_ROLES), hu(async (req, res) => {
  const { trashReceivedBatch } = await import("./bbb-uploads.service.js");
  res.json({ success: true, data: await trashReceivedBatch(String(req.params.batchId), req.authUser?.id ?? null) });
}));
blaBliBluDashboardRouter.post("/uploads/received/:batchId/restore", requireRole(...UPLOAD_ROLES), hu(async (req, res) => {
  const { restoreReceivedBatch } = await import("./bbb-uploads.service.js");
  res.json({ success: true, data: await restoreReceivedBatch(String(req.params.batchId)) });
}));
blaBliBluDashboardRouter.delete("/uploads/sales/:batchId", requireRole(...UPLOAD_ROLES), hu(async (req, res) => {
  const { deleteSalesBatch } = await import("./bbb-uploads.service.js");
  res.json({ success: true, data: await deleteSalesBatch(String(req.params.batchId), req.authUser?.id ?? null) });
}));

blaBliBluDashboardRouter.post("/upload/received-data", requireRole(...UPLOAD_ROLES), upload.single("file"), hu(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
  return res.json({ success: true, data: await svc.uploadReceivedData(req.file.buffer, req.authUser?.id ?? "system") });
}));

