/**
 * NOC (No Objection Certificate) workflow routes.
 * Branch Payroll uploads NOC → Head Payroll validates/rejects → salary/FNF unblocked.
 * NOC is only required for inactive employees with pending salary or FNF.
 */

import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import * as nocService from "./noc.service.js";
import type { Response } from "express";

export const nocRouter = Router();

// Ensure upload directory exists
const NOC_UPLOAD_DIR = "uploads/noc";
if (!fs.existsSync(NOC_UPLOAD_DIR)) fs.mkdirSync(NOC_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, NOC_UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Only PDF/JPG/PNG allowed"));
  },
});

// GET /api/payroll/noc
nocRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_head", "payroll_branch", "payroll", "super_admin", "admin"))) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  const { employeeId, uploadStatus, nocType, runMonth } = req.query as Record<string, string>;
  const nocs = await nocService.listNocs({ employeeId, uploadStatus, nocType, runMonth });
  return res.json({ success: true, data: nocs });
});

// GET /api/payroll/noc/required/:employeeId
nocRouter.get("/required/:employeeId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_head", "payroll_branch", "payroll", "super_admin", "admin", "hr"))) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  const result = await nocService.nocRequired(req.params.employeeId);
  return res.json({ success: true, data: result });
});

// GET /api/payroll/noc/:id/document — view/download the uploaded NOC file.
// The record has always stored doc_path/doc_original_name, but no route ever served the
// file back — Head Payroll had to Validate/Reject an exit-blocking NOC without being able
// to see the document itself. Added 2026-09-01.
nocRouter.get("/:id/document", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_head", "payroll_branch", "payroll", "super_admin", "admin"))) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  const noc = await nocService.getNoc(req.params.id);
  if (!noc || !noc.doc_path) return res.status(404).json({ success: false, message: "NOC document not found" });

  // doc_path is req.file.path from multer, always under NOC_UPLOAD_DIR — resolve and
  // confirm it stays there before serving, rather than trusting the stored value blindly.
  const resolved = path.resolve(noc.doc_path);
  const uploadRoot = path.resolve(NOC_UPLOAD_DIR);
  if (!resolved.startsWith(uploadRoot + path.sep) && resolved !== uploadRoot) {
    return res.status(400).json({ success: false, message: "Invalid document path" });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ success: false, message: "NOC document file is missing on disk" });
  }
  return res.sendFile(resolved, {
    headers: { "Content-Disposition": `inline; filename="${noc.doc_original_name ?? "noc-document"}"` },
  });
});

// POST /api/payroll/noc — Branch Payroll uploads NOC
nocRouter.post("/", requireAuth, upload.single("noc_document"), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_branch", "payroll", "super_admin", "admin"))) {
    return res.status(403).json({ success: false, message: "Only Branch Payroll can upload NOC" });
  }
  if (!req.file) return res.status(400).json({ success: false, message: "NOC document required" });

  const { employee_id, noc_type, run_month, ff_calculation_id } = req.body as Record<string, string>;
  if (!employee_id || !noc_type) {
    return res.status(400).json({ success: false, message: "employee_id and noc_type are required" });
  }

  const { required, reason } = await nocService.nocRequired(employee_id);
  if (!required) {
    return res.status(400).json({ success: false, message: "NOC is not required for this employee — no pending salary or FNF" });
  }

  const noc = await nocService.createNoc({
    employeeId: employee_id,
    runMonth: run_month,
    ffCalculationId: ff_calculation_id,
    nocType: noc_type as "salary" | "fnf",
    uploadedBy: userId,
    docPath: req.file.path,
    docOriginalName: req.file.originalname,
  });

  void logSensitiveAction({
    actor_user_id: userId,
    actor_role: req.authUser!.role,
    action_type: "noc_uploaded",
    module_key: "payroll_noc",
    entity_type: "payroll_noc",
    entity_id: noc?.id,
    new_value_json: { employee_id, noc_type, reason } as Record<string, unknown>,
    req,
  });

  return res.status(201).json({ success: true, data: noc });
});

// PATCH /api/payroll/noc/:id/validate — Head Payroll validates
nocRouter.patch("/:id/validate", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_head", "super_admin"))) {
    return res.status(403).json({ success: false, message: "Only Head Payroll can validate NOC" });
  }
  const { note } = req.body as { note?: string };
  const noc = await nocService.getNoc(req.params.id);
  if (!noc) return res.status(404).json({ success: false, message: "NOC not found" });
  if (noc.upload_status !== "uploaded") {
    return res.status(400).json({ success: false, message: `Cannot validate a NOC in '${noc.upload_status}' status` });
  }

  await nocService.validateNoc(req.params.id, userId, note);

  void logSensitiveAction({
    actor_user_id: userId,
    actor_role: req.authUser!.role,
    action_type: "noc_validated",
    module_key: "payroll_noc",
    entity_type: "payroll_noc",
    entity_id: req.params.id,
    old_value_json: { upload_status: "uploaded" } as Record<string, unknown>,
    new_value_json: { upload_status: "validated", note } as Record<string, unknown>,
    req,
  });

  return res.json({ success: true, message: "NOC validated. Salary/FNF processing unblocked." });
});

// PATCH /api/payroll/noc/:id/reject — Head Payroll rejects
nocRouter.patch("/:id/reject", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_head", "super_admin"))) {
    return res.status(403).json({ success: false, message: "Only Head Payroll can reject NOC" });
  }
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return res.status(400).json({ success: false, message: "Rejection reason required" });

  const noc = await nocService.getNoc(req.params.id);
  if (!noc) return res.status(404).json({ success: false, message: "NOC not found" });
  if (noc.upload_status !== "uploaded") {
    return res.status(400).json({ success: false, message: `Cannot reject a NOC in '${noc.upload_status}' status` });
  }

  await nocService.rejectNoc(req.params.id, userId, reason);

  void logSensitiveAction({
    actor_user_id: userId,
    actor_role: req.authUser!.role,
    action_type: "noc_rejected",
    module_key: "payroll_noc",
    entity_type: "payroll_noc",
    entity_id: req.params.id,
    old_value_json: { upload_status: "uploaded" } as Record<string, unknown>,
    new_value_json: { upload_status: "rejected", reason } as Record<string, unknown>,
    req,
  });

  return res.json({ success: true, message: "NOC rejected. Branch Payroll must re-upload." });
});
