import { Router } from "express";
import multer from "multer";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { requireRole } from "../../middleware/requireRole.js";
import { grnService } from "./grn.service.js";

const GRN_WRITE_ROLES = ["accounts_head", "finance_head", "super_admin", "admin", "branch_head", "branch_admin"];
const GRN_READ_ROLES  = [...GRN_WRITE_ROLES, "finance", "hr_admin"];
const GRN_REVIEW_ROLES = ["accounts_head", "finance_head", "super_admin"];

const UPLOAD_DIR = "uploads/grn-attachments";
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

export const grnRouter = Router();

// List GRNs
grnRouter.get(
  "/grns",
  requireRole(...GRN_READ_ROLES),
  async (req, res) => {
    try {
      const result = await grnService.listGrns({
        branchId: req.query.branchId as string,
        status: req.query.status as string,
        financialYear: req.query.financialYear as string,
        grnType: req.query.grnType as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to list GRNs";
      res.status(400).json({ error: msg });
    }
  }
);

// Get single GRN
grnRouter.get(
  "/grns/:id",
  requireRole(...GRN_READ_ROLES),
  async (req, res) => {
    try {
      const grn = await grnService.getGrn(req.params.id);
      res.json({ data: grn });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Not found";
      res.status(404).json({ error: msg });
    }
  }
);

// Create draft GRN
grnRouter.post(
  "/grns",
  requireRole(...GRN_WRITE_ROLES),
  async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await grnService.createDraft(req.body, user.id, user.role);
      res.status(201).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create GRN";
      res.status(400).json({ error: msg });
    }
  }
);

// Submit GRN for approval
grnRouter.post(
  "/grns/:id/submit",
  requireRole(...GRN_WRITE_ROLES),
  async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await grnService.submitForApproval(req.params.id, req.body, user.id, user.role);
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit GRN";
      res.status(400).json({ error: msg });
    }
  }
);

// Approve or reject GRN
grnRouter.post(
  "/grns/:id/review",
  requireRole(...GRN_REVIEW_ROLES),
  async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await grnService.reviewGrn(req.params.id, req.body, user.id, user.role);
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to review GRN";
      res.status(400).json({ error: msg });
    }
  }
);

// Cancel GRN
grnRouter.post(
  "/grns/:id/cancel",
  requireRole(...GRN_WRITE_ROLES),
  async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await grnService.cancelGrn(req.params.id, user.id, user.role);
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel GRN";
      res.status(400).json({ error: msg });
    }
  }
);

// Upload attachment to existing draft GRN
grnRouter.post(
  "/grns/:id/attachment",
  requireRole(...GRN_WRITE_ROLES),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const user = (req as any).user;
      await grnService.saveAttachment(
        req.params.id,
        req.file.path,
        req.file.originalname,
        user.id
      );
      res.json({ success: true, path: req.file.path });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Attachment upload failed";
      res.status(400).json({ error: msg });
    }
  }
);

// Serve GRN attachment file
grnRouter.get(
  "/grns/:id/attachment",
  requireRole(...GRN_READ_ROLES),
  async (req, res) => {
    try {
      const grn = await grnService.getGrn(req.params.id);
      if (!grn.attachment_path) {
        res.status(404).json({ error: "No attachment" });
        return;
      }
      res.download(grn.attachment_path, grn.attachment_original_name ?? "grn-attachment");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "File not found";
      res.status(404).json({ error: msg });
    }
  }
);
