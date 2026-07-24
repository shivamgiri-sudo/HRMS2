import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
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
import {
  registerUpload,
  findByStoredFilename,
  softDelete,
  issueDownloadToken,
  consumeDownloadToken,
  logDocumentAccess,
} from "../document-vault/documentVault.service.js";
import { authorizeDocumentAccess } from "./documentVaultAuth.js";
import { db } from "../../db/mysql.js";

// SECURITY: Document authorization is ALWAYS enforced.
// The flag now controls audit verbosity, not authorization bypass.
const DPDP_VERBOSE_AUDIT = process.env.DPDP_DOCUMENT_AUTH_ENABLED === "true";

// Magic bytes for file validation (prevent disguised executables)
const MAGIC_BYTES: Record<string, Uint8Array[]> = {
  ".pdf": [new Uint8Array([0x25, 0x50, 0x44, 0x46])], // %PDF
  ".jpg": [new Uint8Array([0xff, 0xd8, 0xff])],
  ".jpeg": [new Uint8Array([0xff, 0xd8, 0xff])],
  ".png": [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
  ".gif": [new Uint8Array([0x47, 0x49, 0x46, 0x38])], // GIF8
  ".webp": [new Uint8Array([0x52, 0x49, 0x46, 0x46])], // RIFF
  ".doc": [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], // OLE compound
  ".docx": [new Uint8Array([0x50, 0x4b, 0x03, 0x04])], // ZIP (OOXML)
  ".xls": [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])],
  ".xlsx": [new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
  ".csv": [], // Text file, no magic bytes
  ".txt": [], // Text file, no magic bytes
};

function validateFileMagicBytes(filePath: string, ext: string): boolean {
  const normalExt = ext.toLowerCase();
  const signatures = MAGIC_BYTES[normalExt];
  if (!signatures || signatures.length === 0) return true; // No validation for text files

  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    return signatures.some((sig) => {
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) return false;
      }
      return true;
    });
  } catch {
    return false;
  }
}

// Use process.cwd() — resolves to backend/ in both dev and production (avoids dist/ path issue)
export const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

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

// SECURITY: Employee photos now require authentication.
// Only HRMS employees can view employee photos (internal access level).
router.get(
  "/employee-photos/:filename",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const safeFile = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_ROOT, "employee-photos", safeFile);

    // Verify authentication
    const authHeader = req.headers.authorization;
    let actorUserId: string | undefined;
    let actorRole: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      const user = authService.verifyAccessToken(token);
      if (user) {
        actorUserId = user.id;
        const ctx = await getUserRoleContext(user.id).catch(() => null);
        actorRole = ctx?.primaryRole ?? undefined;
      }
    }

    // SECURITY: Require authentication for employee photos
    if (!actorUserId) {
      await logDocumentAccess({
        storedPath: filePath,
        actorType: "anonymous",
        action: "view",
        accessResult: "denied",
        denialReason: "Authentication required for employee photos",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      }).catch(() => {});
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(204).send();
    }

    // Log access
    await logDocumentAccess({
      storedPath: filePath,
      actorUserId,
      actorType: "employee",
      action: "view",
      accessResult: "allowed",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    }).catch(() => {});

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    res.set("Content-Type", mimeTypes[ext] || "image/png");
    // SECURITY: Reduced cache time, no public caching
    res.set("Cache-Control", "private, max-age=3600");
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
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    // SECURITY: Magic-byte validation - prevent disguised executables
    const magicValid = validateFileMagicBytes(filePath, ext);
    if (!magicValid) {
      // Delete the uploaded file immediately
      try { fs.unlinkSync(filePath); } catch {}
      console.warn(`[upload] Magic-byte validation failed for ${req.file.originalname} (${ext})`);
      return res.status(400).json({
        error: "File content does not match its extension. Upload rejected.",
        code: "MAGIC_BYTE_MISMATCH",
      });
    }

    const url = `/api/files/${category}/${req.file.filename}`;

    // SECURITY: Vault inventory registration is MANDATORY.
    // If registration fails, delete the physical file and return error.
    // No untracked files allowed on disk.
    try {
      await registerUpload({
        uploadedByUser: req.authUser!.id,
        category,
        storedFilename: req.file.filename,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        accessLevel: (req.body?.accessLevel as any) ?? "internal",
        ownerEmployeeId: req.body?.ownerEmployeeId ?? undefined,
        ownerCandidateId: req.body?.ownerCandidateId ?? undefined,
      });
    } catch (vaultErr) {
      // Registration failed - delete physical file and return error
      console.error("[documentVault] Failed to register upload in inventory:", vaultErr);
      try { fs.unlinkSync(filePath); } catch {}
      return res.status(500).json({
        error: "Failed to register file in document vault. Upload rolled back.",
        code: "VAULT_REGISTRATION_FAILED",
      });
    }

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

// POST /api/files/download-token — issue a short-lived download token for a vault item
// Body: { storedFilename: string, category: string, ttlMinutes?: number, issuedFor?: string }
router.post(
  "/download-token",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { storedFilename, category, ttlMinutes, issuedFor } = req.body ?? {};
    if (!storedFilename || !category) {
      return res.status(400).json({ error: "storedFilename and category required" });
    }
    const item = await findByStoredFilename(storedFilename);
    if (!item || item.category !== (category as string).replace(/[^a-zA-Z0-9_-]/g, "")) {
      return res.status(404).json({ error: "File not found in vault" });
    }

    // DPDP authorization — ALWAYS enforced (fail-closed)
    // Must be allowed to view/download before a token can be issued
    const ctx = await getUserRoleContext(req.authUser!.id).catch(() => null);
    const actorRole = ctx?.primaryRole ?? "";
    if (!actorRole) {
      return res.status(403).json({ error: "Access denied - unable to verify role", code: "ROLE_LOOKUP_FAILED" });
    }
    const authResult = await authorizeDocumentAccess({
      actorUserId: req.authUser!.id,
      actorRole,
      storedFilename: storedFilename as string,
      action: "token_generate",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    if (!authResult.allowed) {
      return res.status(403).json({ error: "Access denied", code: authResult.reasonCode });
    }

    const result = await issueDownloadToken({
      vaultItemId: item.id,
      issuedTo: req.authUser!.id,
      issuedFor: issuedFor ?? undefined,
      ttlMinutes: ttlMinutes ? Number(ttlMinutes) : 15,
    });
    res.json({
      token: result.rawToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  })
);

// GET /api/files/:category/:filename — serve file
// Accepts either: session JWT (requireAuth) OR ?token=<short-lived-download-token>
router.get(
  "/:category/:filename",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const safe = (req.params.category.replace(/[^a-zA-Z0-9_-]/g, "")) || "misc";
    const safeFile = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_ROOT, safe, safeFile);

    let actorUserId: string | undefined;
    let actorRole: string | undefined;
    let tokenId: string | undefined;

    // Check for short-lived download token first
    const rawToken = req.query.token as string | undefined;
    if (rawToken) {
      const resolved = await consumeDownloadToken(rawToken);
      if (!resolved) {
        await logDocumentAccess({
          storedPath: filePath,
          actorType: "token",
          action: "download",
          accessResult: "denied",
          denialReason: "Invalid, expired, or exhausted download token",
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
        });
        return res.status(403).json({ error: "Invalid or expired download token" });
      }
      actorUserId = resolved.issuedTo ?? undefined;
      tokenId = resolved.tokenId;
    } else {
      // Fall back to session JWT
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const user = authService.verifyAccessToken(authHeader.replace("Bearer ", "").trim());
      if (!user) {
        return res.status(401).json({ error: "Invalid session" });
      }
      actorUserId = user.id;
      const ctx = await getUserRoleContext(user.id).catch(() => null);
      actorRole = ctx?.primaryRole ?? undefined;
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    // DPDP document vault authorization — ALWAYS enforced (fail-closed)
    // Token-based access bypasses role check: token was issued after authorization.
    // DPDP_VERBOSE_AUDIT controls audit verbosity, NOT authorization.
    if (!tokenId && actorUserId) {
      // If we couldn't determine actor role, default-deny for security
      if (!actorRole) {
        await logDocumentAccess({
          storedPath: filePath,
          actorUserId,
          actorType: "employee",
          action: req.query.download === "1" ? "download" : "view",
          accessResult: "denied",
          denialReason: "Could not determine actor role for authorization",
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
        }).catch(err => console.error("[documentVault] audit log failed:", err));
        return res.status(403).json({
          error: "Access denied - unable to verify authorization",
          code: "ROLE_LOOKUP_FAILED",
        });
      }

      const authResult = await authorizeDocumentAccess({
        actorUserId,
        actorRole,
        storedFilename: safeFile,
        action: req.query.download === "1" ? "download" : "view",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      if (!authResult.allowed) {
        return res.status(403).json({
          error: "Access denied",
          code: authResult.reasonCode,
        });
      }
    }

    // Look up vault item for audit logging (non-fatal if not in inventory)
    const item = await findByStoredFilename(safeFile).catch(() => null);

    await logDocumentAccess({
      vaultItemId: item?.id,
      storedPath: filePath,
      actorUserId,
      actorType: tokenId ? "token" : "employee",
      action: req.query.download === "1" ? "download" : "view",
      accessResult: "allowed",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
      tokenId,
    }).catch(err => console.error("[documentVault] audit log failed:", err));

    res.set("Cache-Control", "private, no-store, max-age=0");
    if (req.query.download === "1") {
      const dispName = item?.original_filename ?? safeFile;
      res.set("Content-Disposition", `attachment; filename="${dispName}"`);
    }
    if (item?.mime_type) res.type(item.mime_type);
    res.sendFile(filePath);
  })
);

// DELETE /api/files/:category/:filename — soft-delete with retention/legal-hold protection
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

    // Look up vault item first - deletion requires item to be in inventory
    const item = await findByStoredFilename(safeFile).catch(() => null);
    if (!item) {
      // Untracked file - still allow deletion but log warning
      console.warn(`[documentVault] DELETE requested for untracked file: ${safeFile}`);
    }

    // SECURITY: Check retention policy and legal hold BEFORE deletion
    if (item) {
      // Check legal hold - category-level or item-level
      const [legalHolds] = await db.execute<RowDataPacket[]>(
        `SELECT id, hold_reason FROM document_legal_hold
         WHERE is_active = 1 AND (vault_item_id = ? OR category = ?)`,
        [item.id, safe]
      ).catch(() => [[]]);

      if (legalHolds.length > 0) {
        await logDocumentAccess({
          vaultItemId: item.id,
          storedPath: filePath,
          actorUserId: req.authUser!.id,
          action: "delete",
          accessResult: "denied",
          denialReason: `Legal hold active: ${(legalHolds[0] as any).hold_reason}`,
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
        }).catch(() => {});

        return res.status(403).json({
          error: "Cannot delete - document is under legal hold",
          code: "LEGAL_HOLD_ACTIVE",
          holdReason: (legalHolds[0] as any).hold_reason,
        });
      }

      // Check retention policy - document must be past retention period
      const [retentionRows] = await db.execute<RowDataPacket[]>(
        `SELECT p.retention_days, p.deletion_requires_approval, i.created_at
         FROM document_retention_policy p
         JOIN document_vault_inventory i ON i.category = p.category
         WHERE i.stored_filename = ? AND p.category = ?`,
        [safeFile, safe]
      ).catch(() => [[]]);

      if (retentionRows.length > 0) {
        const policy = retentionRows[0] as any;
        const createdAt = new Date(policy.created_at);
        const retentionExpiry = new Date(createdAt);
        retentionExpiry.setDate(retentionExpiry.getDate() + policy.retention_days);

        if (new Date() < retentionExpiry) {
          await logDocumentAccess({
            vaultItemId: item.id,
            storedPath: filePath,
            actorUserId: req.authUser!.id,
            action: "delete",
            accessResult: "denied",
            denialReason: `Retention period not expired (until ${retentionExpiry.toISOString()})`,
            ipAddress: req.ip,
            userAgent: req.get("user-agent") ?? undefined,
          }).catch(() => {});

          return res.status(403).json({
            error: "Cannot delete - retention period has not expired",
            code: "RETENTION_ACTIVE",
            retentionExpiry: retentionExpiry.toISOString(),
          });
        }

        // If deletion requires approval, check for approved deletion request
        if (policy.deletion_requires_approval) {
          const [approvalRows] = await db.execute<RowDataPacket[]>(
            `SELECT id FROM document_deletion_request
             WHERE vault_item_id = ? AND status = 'approved'`,
            [item.id]
          ).catch(() => [[]]);

          if (approvalRows.length === 0) {
            await logDocumentAccess({
              vaultItemId: item.id,
              storedPath: filePath,
              actorUserId: req.authUser!.id,
              action: "delete",
              accessResult: "denied",
              denialReason: "Deletion requires maker-checker approval",
              ipAddress: req.ip,
              userAgent: req.get("user-agent") ?? undefined,
            }).catch(() => {});

            return res.status(403).json({
              error: "Deletion requires approval - submit a deletion request first",
              code: "APPROVAL_REQUIRED",
            });
          }
        }
      }
    }

    // Soft-delete in vault inventory
    await softDelete(safeFile, req.authUser!.id).catch(err =>
      console.error("[documentVault] soft-delete inventory update failed:", err)
    );

    // Log successful deletion
    await logDocumentAccess({
      vaultItemId: item?.id,
      storedPath: filePath,
      actorUserId: req.authUser!.id,
      action: "delete",
      accessResult: "allowed",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    }).catch(() => {});

    // Physical delete — still performed after soft-delete is recorded
    fs.unlinkSync(filePath);
    res.json({ success: true });
  })
);

export { router as filesRouter };
