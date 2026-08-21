import { Router } from "express";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { createHash } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { selfOrAdminHr } from "../../shared/accessGuard.js";
import { registerUpload } from "../document-vault/documentVault.service.js";

// Use process.cwd() — resolves to backend/ in both dev and production
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"]);

const empDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_ROOT, "employee-documents");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const empDocUpload = multer({
  storage: empDocStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed`));
  },
});

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/employee-docs/:employeeId
router.get("/:employeeId", selfOrAdminHr("employeeId"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, employee_id, doc_type AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC",
    [req.params.employeeId]
  );
  res.json({ success: true, data: rows });
}));

// POST /api/employee-docs/:employeeId/upload — multipart upload (self or admin/hr only)
router.post("/:employeeId/upload", selfOrAdminHr("employeeId"), (req: any, res: any, next: any) => {
  empDocUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  const { employeeId } = req.params;
  const documentType = (req.body?.document_type as string) || "other";
  const documentName = (req.body?.document_name as string) || req.file.originalname;
  const fileUrl = `/api/files/employee-documents/${req.file.filename}`;

  // Vault inventory registration is MANDATORY — mirrors files.routes.ts's
  // upload route (SECURITY: no untracked files allowed on disk). Without this,
  // GET /api/files/employee-documents/:filename (what the frontend actually
  // requests for preview/download) 403s with VAULT_ITEM_NOT_FOUND for every
  // file uploaded here, including for the uploader — this was previously
  // never called, so nothing uploaded through this route could be opened
  // again by anyone. access_level "pii": these are identity/statutory
  // documents (PAN, Aadhaar, etc.), so only HR/DPO/admin-tier roles or the
  // owning employee (via the owner-bypass in documentVaultAuth.ts) may view
  // or download them.
  try {
    const sha256 = createHash("sha256").update(fs.readFileSync(req.file.path)).digest("hex");
    await registerUpload({
      uploadedByUser: req.authUser!.id,
      category: "employee-documents",
      storedFilename: req.file.filename,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
      sha256Hash: sha256,
      accessLevel: "pii",
      ownerEmployeeId: employeeId,
    });
  } catch (vaultErr) {
    console.error("[employee-docs] Failed to register upload in document vault:", vaultErr);
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(500).json({
      success: false,
      message: "Failed to register file in document vault. Upload rolled back.",
      code: "VAULT_REGISTRATION_FAILED",
    });
  }

  const id = randomUUID();
  await db.execute(
    "INSERT INTO employee_documents (id, employee_id, doc_type, doc_name, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
    [id, employeeId, documentType, documentName, fileUrl, req.authUser!.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, employee_id, doc_type AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at FROM employee_documents WHERE id = ? LIMIT 1",
    [id]
  );
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// POST /api/employee-docs/:employeeId — register document metadata (file URL from caller)
router.post("/:employeeId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { document_type, document_name, file_url } = req.body as {
    document_type: string;
    document_name: string;
    file_url: string;
  };
  if (!document_type || !file_url) return res.status(400).json({ error: "document_type and file_url required" });
  if (file_url.length > 2048) return res.status(400).json({ error: "file_url too long" });
  // Reject javascript: URLs and other dangerous schemes
  const dangerousScheme = /^(javascript|data|vbscript):/i;
  if (dangerousScheme.test(file_url)) return res.status(400).json({ error: "Invalid file_url scheme" });
  if (document_name && document_name.length > 255) {
    return res.status(400).json({ error: "document_name must be 255 characters or fewer" });
  }
  const id = randomUUID();
  await db.execute(
    "INSERT INTO employee_documents (id, employee_id, doc_type, doc_name, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
    [id, req.params.employeeId, document_type, document_name ?? null, file_url, req.authUser!.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT id, employee_id, doc_type AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at FROM employee_documents WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// PATCH /api/employee-docs/:employeeId/:docId/verify — verify or reject a document
// payroll_head added per the Payroll Head salary/journey review gate (migration
// 1541) — full write access on the review screen, reusing this endpoint rather
// than duplicating verify logic.
router.patch("/:employeeId/:docId/verify", requireRole("admin", "hr", "super_admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { action, remarks } = req.body as { action: "verified" | "rejected"; remarks?: string };
  if (!action || !["verified", "rejected"].includes(action)) {
    return res.status(400).json({ success: false, message: "action must be 'verified' or 'rejected'" });
  }

  const [check] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM employee_documents WHERE id = ? AND employee_id = ? LIMIT 1",
    [req.params.docId, req.params.employeeId]
  );
  if (!(check as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, message: "Document not found" });
  }

  const verified = action === "verified" ? 1 : 0;
  // No updated_at here: employee_documents does not have that column. Verified live
  // 2026-08-15 — it holds id, employee_id, doc_type, doc_category, legacy_source,
  // legacy_ref_id, doc_name, file_url, verified, uploaded_by, created_at, expiry_date,
  // verified_by, verification_date, verification_remarks, and nothing else. Setting it
  // raised ER_BAD_FIELD_ERROR, so this endpoint 500'd on every call and no document
  // could ever be verified or rejected through it.
  //
  // Dropped rather than added as a column: nothing in the codebase reads
  // employee_documents.updated_at, and verification_date = NOW() already records when
  // the decision was made. Adding an unread column to a 207,616-row table to satisfy
  // one statement is the wrong trade.
  await db.execute(
    `UPDATE employee_documents
     SET verified = ?, verified_by = ?, verification_date = NOW(),
         verification_remarks = ?
     WHERE id = ? AND employee_id = ?`,
    [verified, req.authUser!.id, remarks ?? null, req.params.docId, req.params.employeeId]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, employee_id, doc_type AS document_type, doc_name AS document_name, file_url, verified, verification_remarks, created_at AS uploaded_at FROM employee_documents WHERE id = ? LIMIT 1",
    [req.params.docId]
  );
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// GET /api/employee-docs/:employeeId/:docId/download — download with original filename
router.get("/:employeeId/:docId/download", selfOrAdminHr("employeeId"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT doc_name, file_url FROM employee_documents WHERE id = ? AND employee_id = ? LIMIT 1",
    [req.params.docId, req.params.employeeId]
  );
  const doc = (rows as RowDataPacket[])[0];
  if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

  // Resolve physical file path from the stored URL
  const filename = path.basename(String(doc.file_url ?? ""));
  const filePath = path.join(UPLOADS_ROOT, "employee-documents", filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found on disk" });
  }

  const originalName = String(doc.doc_name ?? filename);
  const ext = path.extname(filename);
  const safeOriginalName = originalName.endsWith(ext) ? originalName : `${originalName}${ext}`;

  res.setHeader("Content-Disposition", `attachment; filename="${safeOriginalName}"`);
  res.sendFile(filePath);
}));

// DELETE /api/employee-docs/:employeeId/:docId
router.delete("/:employeeId/:docId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [result] = await db.execute(
    "DELETE FROM employee_documents WHERE id = ? AND employee_id = ?",
    [req.params.docId, req.params.employeeId]
  );
  const affected = (result as any).affectedRows;
  if (affected === 0) return res.status(404).json({ success: false, message: "Document not found" });
  res.json({ success: true });
}));

export { router as employeeDocsRouter };
