import { Router } from "express";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { TallyImportError, tallyPaymentImport } from "./tally-payment-import.service.js";

/** Payments made in Tally, taken into HRMS. See tally-payment-import.service.ts. */
const ROLES = ["finance_head", "accounts_head", "super_admin"] as const;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const tallyImportRouter = Router();
tallyImportRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);
const fail = (res: any, error: unknown, fallback: string) => {
  const status = error instanceof TallyImportError ? error.status : 500;
  res.status(status).json({ success: false, error: error instanceof Error ? error.message : fallback });
};

tallyImportRouter.post("/payments/preview", requireRole(...ROLES), upload.single("file"), h(async (req, res) => {
  try {
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
    if (!file) throw new TallyImportError("Choose a Tally export file to upload.");
    res.json({ success: true, data: await tallyPaymentImport.preview(file.buffer, file.originalname, String(req.authUser?.id ?? "")) });
  } catch (e) { fail(res, e, "Could not read the file"); }
}));

tallyImportRouter.post("/payments/apply", requireRole(...ROLES), h(async (req, res) => {
  try {
    const batchId = String(req.body?.batchId ?? "");
    if (!batchId) throw new TallyImportError("batchId is required.");
    const choices = req.body?.choices && typeof req.body.choices === "object" ? req.body.choices as Record<string, string> : {};
    res.json({ success: true, data: await tallyPaymentImport.apply(batchId, choices, String(req.authUser?.id ?? ""), String(req.authUser?.role ?? "")) });
  } catch (e) { fail(res, e, "Could not record the payments"); }
}));

tallyImportRouter.get("/batches", requireRole(...ROLES), h(async (_req, res) => {
  res.json({ success: true, data: await tallyPaymentImport.listBatches() });
}));

tallyImportRouter.get("/batches/:id", requireRole(...ROLES), h(async (req, res) => {
  try { res.json({ success: true, data: await tallyPaymentImport.getBatch(req.params.id) }); } catch (e) { fail(res, e, "Not found"); }
}));
