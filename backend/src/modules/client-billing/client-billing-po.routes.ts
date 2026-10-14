// backend/src/modules/client-billing/client-billing-po.routes.ts
/**
 * Client PO master (mounted at /api/client-billing/po-master): governed create / edit with the
 * PO document, the PO report, and one PO's invoices + history. Same roles as Client Billing;
 * callers who are not org-wide see and change only their own branch's POs.
 */
import { existsSync, mkdirSync, unlinkSync } from "fs";
import path from "path";
import { Router, type Response } from "express";
import multer from "multer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { loadBranchPolicy } from "../../shared/branchDecisionScope.js";
import { clientPoMasterService, type PoAttachment } from "./client-billing-po-master.service.js";

const ROLES = ["admin", "finance", "finance_head", "accounts_head"];
const UPLOAD_DIR = "uploads/client-po-documents";
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const DOC_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Boolean(DOC_TYPES[ext]?.includes(file.mimetype)));
  },
});

export const clientPoRouter = Router();
clientPoRouter.use(requireAuth);
clientPoRouter.use(requireRole(...ROLES));

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) =>
    fn(req, res).catch((e) => {
      if (req.file) try { unlinkSync(req.file.path); } catch { /* already gone */ }
      if (e?.statusCode && e.statusCode < 500) return res.status(e.statusCode).json({ success: false, error: e.message, message: e.message });
      next(e);
    });

async function scope(req: AuthenticatedRequest): Promise<string[] | null> {
  const policy = await loadBranchPolicy(req.authUser!.id);
  if (policy.orgWide) return null;
  return policy.ownBranchId ? [policy.ownBranchId] : [];
}

async function assertPoInScope(req: AuthenticatedRequest, id: string) {
  const branchIds = await scope(req);
  const branch = await clientPoMasterService.branchOf(id);
  if (branch === undefined) throw Object.assign(new Error("PO not found"), { statusCode: 404 });
  if (branchIds && !(branch && branchIds.includes(branch))) {
    throw Object.assign(new Error("This PO is outside your branch"), { statusCode: 403 });
  }
}

/** The JSON part of a multipart request ("data"), or the body itself for JSON requests. */
function payload(req: AuthenticatedRequest): Record<string, unknown> {
  const raw = (req.body as { data?: unknown })?.data;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Invalid form data"), { statusCode: 400 }); }
  }
  return (req.body ?? {}) as Record<string, unknown>;
}

function attachment(req: AuthenticatedRequest): PoAttachment | null {
  return req.file ? { path: req.file.path, name: req.file.originalname.slice(0, 255), mime: req.file.mimetype } : null;
}

clientPoRouter.get("/", h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const status = ["active", "expired", "upcoming", "exhausted"].includes(String(q.status)) ? (q.status as "active") : undefined;
  const data = await clientPoMasterService.report({
    costCentreId: q.costCentreId, branchId: q.branchId, companyName: q.companyName, search: q.search, status,
    branchIds: await scope(req),
  });
  res.json({ success: true, data });
}));

clientPoRouter.get("/:id", h(async (req, res) => {
  await assertPoInScope(req, req.params.id);
  res.json({ success: true, data: await clientPoMasterService.detail(req.params.id) });
}));

clientPoRouter.get("/:id/document", h(async (req, res) => {
  await assertPoInScope(req, req.params.id);
  const doc = await clientPoMasterService.attachmentOf(req.params.id);
  if (!doc || !existsSync(doc.path)) return res.status(404).json({ success: false, error: "No PO document on file" });
  res.download(path.resolve(doc.path), doc.name);
}));

clientPoRouter.post("/", upload.single("file"), h(async (req, res) => {
  const body = payload(req);
  const costCentreId = String(body.costCentreId ?? "");
  const branchIds = await scope(req);
  if (branchIds) {
    const [[cc]] = await db.query<RowDataPacket[]>(`SELECT branch_id FROM cost_centre_master WHERE id = ?`, [costCentreId]);
    if (!cc || !branchIds.includes(String(cc.branch_id))) return res.status(403).json({ success: false, error: "This cost centre is outside your branch" });
  }
  const data = await clientPoMasterService.createPo({
    costCentreId,
    poNumber: String(body.poNumber ?? ""),
    periodFrom: String(body.periodFrom ?? ""),
    periodTo: String(body.periodTo ?? ""),
    lines: body.lines as never,
    remarks: (body.remarks as string | null | undefined) ?? null,
    attachment: attachment(req),
    userId: req.authUser!.id,
  });
  res.status(201).json({ success: true, data });
}));

clientPoRouter.post("/:id", upload.single("file"), h(async (req, res) => {
  await assertPoInScope(req, req.params.id);
  const body = payload(req);
  const data = await clientPoMasterService.updatePo({
    id: req.params.id,
    poNumber: body.poNumber as string | undefined,
    periodFrom: body.periodFrom as string | undefined,
    periodTo: body.periodTo as string | undefined,
    lines: body.lines as never,
    remarks: body.remarks as string | null | undefined,
    attachment: attachment(req),
    userId: req.authUser!.id,
  });
  res.json({ success: true, data });
}));
