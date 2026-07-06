import { Router, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./sales-upload.service.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Upload endpoints — restricted to upload-privileged roles ──────────────
const canUpload = requireRole("super_admin", "admin", "sales_manager", "process_manager", "operations_manager");

router.post(
  "/upload-bellavita",
  canUpload, upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const uploadedBy = (req as any).authUser?.id ?? "system";
    const result = await svc.uploadBellavitaSales(req.file.buffer, req.file.originalname, uploadedBy);
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/upload-gnc",
  canUpload, upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const uploadedBy = (req as any).authUser?.id ?? "system";
    const result = await svc.uploadGncSales(req.file.buffer, req.file.originalname, uploadedBy);
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/upload-gnc-apr",
  canUpload, upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const uploadedBy = (req as any).authUser?.id ?? "system";
    const result = await svc.uploadGncApr(req.file.buffer, req.file.originalname, uploadedBy);
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/upload-gnc-allocation",
  canUpload, upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const uploadedBy = (req as any).authUser?.id ?? "system";
    const result = await svc.uploadGncAllocation(req.file.buffer, req.file.originalname, uploadedBy);
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/upload-bellavita-apr",
  canUpload, upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const uploadedBy = (req as any).authUser?.id ?? "system";
    const result = await svc.uploadBellavitaApr(req.file.buffer, req.file.originalname, uploadedBy);
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/upload-bellavita-chat",
  canUpload, upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const uploadedBy = (req as any).authUser?.id ?? "system";
    const result = await svc.uploadBellavitaChat(req.file.buffer, req.file.originalname, uploadedBy);
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/upload-bellavita-cart",
  canUpload, upload.single("file"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const uploadedBy = (req as any).authUser?.id ?? "system";
    const result = await svc.uploadBellavitaCart(req.file.buffer, req.file.originalname, uploadedBy);
    res.json({ ok: true, ...result });
  })
);

// ── Read / dashboard endpoints — broader access ────────────────────────────
const canRead = requireRole(
  "super_admin", "admin", "ceo", "sales_manager", "process_manager", "operations_manager", "manager"
);

router.get(
  "/upload-logs",
  canRead,
  h(async (req, res) => {
    const tableName = req.query.table ? String(req.query.table) : undefined;
    res.json({ data: await svc.getUploadLogs(tableName) });
  })
);

router.delete(
  "/upload-log/:batchId",
  canUpload,
  h(async (req, res) => {
    const { table } = req.query as { table: string };
    if (!table) return res.status(400).json({ error: "table query param required" });
    await svc.deleteUploadBatch(req.params.batchId, table);
    res.json({ ok: true });
  })
);

router.get(
  "/bellavita-dashboard",
  canRead,
  h(async (req, res) => {
    const month = req.query.month ? String(req.query.month) : new Date().toISOString().slice(0, 7);
    res.json({ data: await svc.getBellavitaDashboard(month) });
  })
);

router.get(
  "/sales-kpis",
  canRead,
  h(async (req, res) => {
    const now       = new Date();
    const endDate   = req.query.endDate   ? String(req.query.endDate)   : now.toISOString().slice(0, 10);
    const startDate = req.query.startDate ? String(req.query.startDate) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    res.json({ data: await svc.getSalesKPIs({ startDate, endDate }) });
  })
);

router.get(
  "/sales-trend",
  canRead,
  h(async (req, res) => {
    const now       = new Date();
    const endDate   = req.query.endDate   ? String(req.query.endDate)   : now.toISOString().slice(0, 10);
    const startDate = req.query.startDate ? String(req.query.startDate) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    res.json({ data: await svc.getSalesTrend({ startDate, endDate }) });
  })
);

export { router as salesUploadRouter };
