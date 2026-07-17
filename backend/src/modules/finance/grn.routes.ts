import { Router } from "express";
import multer from "multer";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { grnService } from "./grn.service.js";

const GRN_WRITE_ROLES = [
  "accounts_head",
  "finance_head",
  "super_admin",
  "admin",
  "branch_head",
  "branch_admin",
] as const;
const GRN_READ_ROLES = [...GRN_WRITE_ROLES, "finance", "hr_admin"] as const;
const GRN_REVIEW_ROLES = ["branch_head", "finance_head", "super_admin"] as const;

const UPLOAD_DIR = "uploads/grn-attachments";
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const allowedMimeTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    const extension = path.extname(file.originalname).toLowerCase();
    cb(null, allowedExtensions.includes(extension) && allowedMimeTypes.includes(file.mimetype));
  },
});

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  const role = String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown");
  return { id, role };
}

export const grnRouter = Router();
grNRouterUseAuth(grnRouter);

function grNRouterUseAuth(router: Router) {
  router.use(requireAuth);
}

// List GRNs
 grnRouter.get(
  "/grns",
  requireRole(...GRN_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await grnService.listGrns({
        branchId: req.query.branchId ? String(req.query.branchId) : undefined,
        processId: req.query.processId ? String(req.query.processId) : undefined,
        costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
        costClass: req.query.costClass ? String(req.query.costClass) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
        grnType: req.query.grnType ? String(req.query.grnType) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to list GRNs";
      res.status(400).json({ error: message });
    }
  }
);

// Get single GRN
 grnRouter.get(
  "/grns/:id",
  requireRole(...GRN_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const grn = await grnService.getGrn(req.params.id);
      res.json({ data: grn });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Not found";
      res.status(404).json({ error: message });
    }
  }
);

// Create draft GRN
 grnRouter.post(
  "/grns",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.createDraft(req.body, user.id, user.role);
      res.status(201).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create GRN";
      res.status(400).json({ error: message });
    }
  }
);

// Submit GRN for approval
 grnRouter.post(
  "/grns/:id/submit",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.submitForApproval(
        req.params.id,
        req.body,
        user.id,
        user.role
      );
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to submit GRN";
      res.status(400).json({ error: message });
    }
  }
);

// Branch Head or Finance Head approval/rejection
 grnRouter.post(
  "/grns/:id/review",
  requireWriteAccess,
  requireRole(...GRN_REVIEW_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.reviewGrn(
        req.params.id,
        req.body,
        user.id,
        user.role
      );
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to review GRN";
      res.status(400).json({ error: message });
    }
  }
);

// Cancel GRN
 grnRouter.post(
  "/grns/:id/cancel",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.cancelGrn(req.params.id, user.id, user.role);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to cancel GRN";
      res.status(400).json({ error: message });
    }
  }
);

// Upload attachment to existing draft GRN
 grnRouter.post(
  "/grns/:id/attachment",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  upload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "A PDF or supported image file is required" });
        return;
      }
      const user = actor(req);
      await grnService.saveAttachment(
        req.params.id,
        req.file.path,
        req.file.originalname,
        user.id
      );
      res.json({ success: true, path: req.file.path });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Attachment upload failed";
      res.status(400).json({ error: message });
    }
  }
);

// Serve GRN attachment file
 grnRouter.get(
  "/grns/:id/attachment",
  requireRole(...GRN_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const grn = await grnService.getGrn(req.params.id);
      const filePath = grn.attachment_path ?? grn.attachment_file_path;
      const fileName = grn.attachment_original_name ?? grn.attachment_file_name ?? "grn-attachment";
      if (!filePath || !existsSync(filePath)) {
        res.status(404).json({ error: "GRN attachment not found" });
        return;
      }
      res.download(filePath, fileName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "File not found";
      res.status(404).json({ error: message });
    }
  }
);
