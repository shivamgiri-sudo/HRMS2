import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { authService } from "../auth/auth.service.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { verifyToken as verifyCandidatePortalToken } from "../ats/candidate-portal.service.js";
import {
  auditCandidateFileAccess,
  findCandidateFileById,
} from "../ats/candidate-file.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.resolve(__dirname, "../../../../uploads");

// Ensure uploads root exists on startup
fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const category = ((req.query.category as string) || "misc")
      .replace(/[^a-zA-Z0-9_-]/g, "") || "misc";
    const dir = path.join(UPLOADS_ROOT, category);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".webp",
  ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`));
    }
  },
});

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

async function resolveCandidateFileActor(req: AuthenticatedRequest): Promise<
  | { actorType: "candidate"; candidateId: string; actorUserId: null; actorRole: null }
  | { actorType: "employee"; candidateId?: string; actorUserId: string; actorRole: string | null }
  | null
> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();

  const candidate = verifyCandidatePortalToken(token);
  if (candidate) {
    return {
      actorType: "candidate",
      candidateId: candidate.candidate_id,
      actorUserId: null,
      actorRole: null,
    };
  }

  const user = authService.verifyAccessToken(token);
  if (!user) return null;
  const ctx = await getUserRoleContext(user.id).catch(() => null);
  const role = ctx?.primaryRole ?? null;
  const allowedRoles = new Set(["admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo", "super_admin"]);
  if (!role || !allowedRoles.has(role)) return null;

  return {
    actorType: "employee",
    actorUserId: user.id,
    actorRole: role,
  };
}

router.get(
  "/candidate/:fileId",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const file = await findCandidateFileById(req.params.fileId);
    if (!file || file.status !== "active") {
      return res.status(404).json({ error: "File not found" });
    }

    const actor = await resolveCandidateFileActor(req);
    const actorAny = actor as any;
    const candidateActor = actorAny?.actorType === "candidate" ? actorAny : null;
    const employeeActor = actorAny?.actorType === "employee" ? actorAny : null;
    const isCandidateOwner = !!candidateActor && candidateActor.candidateId === file.candidate_id;
    const isHrmsEmployee = !!employeeActor;

    if (!isCandidateOwner && !isHrmsEmployee) {
      await auditCandidateFileAccess({
        fileId: file.id,
        candidateId: file.candidate_id,
        actorUserId: employeeActor?.actorUserId ?? null,
        actorType: actor?.actorType ?? "system",
        action: req.query.download ? "download" : "view",
        accessResult: "denied",
        denialReason: "Unauthorized access",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
      return res.status(403).json({ error: "Access denied" });
    }

    if (!fs.existsSync(file.storage_path)) {
      await auditCandidateFileAccess({
        fileId: file.id,
        candidateId: file.candidate_id,
        actorUserId: employeeActor?.actorUserId ?? null,
        actorType: actor?.actorType ?? "system",
        action: req.query.download ? "download" : "view",
        accessResult: "denied",
        denialReason: "Stored file missing on disk",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
      return res.status(404).json({ error: "File not found" });
    }

    await auditCandidateFileAccess({
      fileId: file.id,
      candidateId: file.candidate_id,
      actorUserId: employeeActor?.actorUserId ?? null,
      actorType: actor?.actorType ?? "system",
      action: req.query.download ? "download" : "view",
      accessResult: "allowed",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    if (file.mime_type) {
      res.type(file.mime_type);
    }
    if (String(req.query.download ?? "") === "1") {
      res.set("Content-Disposition", `attachment; filename="${path.basename(file.stored_filename)}"`);
    }
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.sendFile(file.storage_path);
  })
);

// Allow public access to employee photos (no auth required)
// Must come BEFORE other routes that use requireAuth
router.get(
  "/employee-photos/:filename",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const safeFile = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_ROOT, "employee-photos", safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(204).send();
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    res.set("Content-Type", mimeTypes[ext] || "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Access-Control-Allow-Origin", "*");
    res.sendFile(filePath);
  })
);

// POST /api/files/upload?category=employee-documents
// Accepts multipart/form-data with field "file"
// Admin/HR only for employee docs; any authenticated user for self-service uploads
router.post(
  "/upload",
  requireAuth,
  requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"),
  (req: any, res: any, next: any) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded or file type not allowed" });
    const category = ((req.query.category as string) || req.body?.category || "misc")
      .replace(/[^a-zA-Z0-9_-]/g, "") || "misc";
    const url = `/api/files/${category}/${req.file.filename}`;
    res.status(201).json({
      success: true,
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  })
);

// GET /api/files/:category/:filename — serve file (authenticated users only)
router.get(
  "/:category/:filename",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const safe = (req.params.category.replace(/[^a-zA-Z0-9_-]/g, "")) || "misc";
    const safeFile = path.basename(req.params.filename); // strip any path traversal
    const filePath = path.join(UPLOADS_ROOT, safe, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    res.sendFile(filePath);
  })
);

// DELETE /api/files/:category/:filename — delete file (admin/hr only)
router.delete(
  "/:category/:filename",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const safe = (req.params.category.replace(/[^a-zA-Z0-9_-]/g, "")) || "misc";
    const safeFile = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_ROOT, safe, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    fs.unlinkSync(filePath);
    res.json({ success: true });
  })
);

export { router as filesRouter };
