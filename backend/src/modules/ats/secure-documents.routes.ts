import fs from "fs";
import path from "path";
import { Router } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  getDocumentAudit,
  getDocumentFile,
  getDocumentMetadata,
  listCandidateDocuments,
  rejectCandidateDocument,
  requestDocumentReupload,
  verifyCandidateDocument,
} from "./secure-documents.service.js";

export const secureDocumentsRouter = Router();

const documentRoles = requireRole("super_admin", "admin", "hr", "payroll_hr", "branch_head", "finance", "operations", "it_admin");

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (
  req: AuthenticatedRequest,
  res: any,
  next: any,
) => fn(req, res).catch(next);

function meta(req: AuthenticatedRequest) {
  return { ip: req.ip, userAgent: req.get("user-agent") || undefined };
}

secureDocumentsRouter.get("/candidates/:candidateId/documents", documentRoles, h(async (req, res) => {
  const data = await listCandidateDocuments(req.params.candidateId, req.authUser?.id || null, meta(req));
  return res.json({ success: true, data });
}));

secureDocumentsRouter.get("/documents/:documentId/metadata", documentRoles, h(async (req, res) => {
  const data = await getDocumentMetadata(req.params.documentId, req.authUser?.id || null, meta(req));
  return res.json({ success: true, data });
}));

secureDocumentsRouter.get("/documents/:documentId/preview-url", documentRoles, h(async (req, res) => {
  const data = await getDocumentMetadata(req.params.documentId, req.authUser?.id || null, meta(req));
  return res.json({ success: true, data: { preview_url: data.preview_url, expires_in_seconds: 300 } });
}));

secureDocumentsRouter.get("/documents/:documentId/audit", documentRoles, h(async (req, res) => {
  const data = await getDocumentAudit(req.params.documentId, req.authUser?.id || null, meta(req));
  return res.json({ success: true, data });
}));

secureDocumentsRouter.get("/documents/:documentId/stream", documentRoles, h(async (req, res) => {
  const { document, filePath } = await getDocumentFile(req.params.documentId, req.authUser?.id || null, "stream", meta(req));
  const mime = document.mime_type || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(document.file_name).replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return fs.createReadStream(filePath).pipe(res);
}));

secureDocumentsRouter.get("/documents/:documentId/download", documentRoles, h(async (req, res) => {
  const { document, filePath } = await getDocumentFile(req.params.documentId, req.authUser?.id || null, "download", meta(req));
  res.setHeader("Content-Type", document.mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${path.basename(document.file_name).replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return fs.createReadStream(filePath).pipe(res);
}));

secureDocumentsRouter.post("/documents/:documentId/verify", documentRoles, h(async (req, res) => {
  const data = await verifyCandidateDocument(req.params.documentId, req.authUser!.id, String(req.body?.remarks || ""));
  return res.json({ success: true, data });
}));

secureDocumentsRouter.post("/documents/:documentId/reject", documentRoles, h(async (req, res) => {
  const data = await rejectCandidateDocument(req.params.documentId, req.authUser!.id, String(req.body?.reason || ""));
  return res.json({ success: true, data });
}));

secureDocumentsRouter.post("/documents/:documentId/request-reupload", documentRoles, h(async (req, res) => {
  const data = await requestDocumentReupload(
    req.params.documentId,
    req.authUser!.id,
    String(req.body?.reason || ""),
    req.body?.due_at ? String(req.body.due_at) : undefined,
  );
  return res.status(201).json({ success: true, data });
}));
