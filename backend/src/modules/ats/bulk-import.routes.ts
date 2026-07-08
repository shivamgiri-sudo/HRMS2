import { Router } from "express";
import type { NextFunction, Response } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { parseHistoricalFile, validateRow, runBulkImport } from "./bulk-import.service.js";

export const bulkImportRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

type AH = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AH) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => void fn(req, res).catch(next);

// ── POST /api/ats/bulk-import/candidates ─────────────────────────────────────
// Roles: admin, super_admin
bulkImportRouter.post(
  "/candidates",
  requireAuth,
  requireRole("admin", "super_admin"),
  upload.single("file"),
  h(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded. Send file as multipart field 'file'." });
    }

    const dryRun = String(req.body?.dryRun ?? "false").toLowerCase() === "true";
    const rows = parseHistoricalFile(req.file.buffer, req.file.mimetype);

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "File parsed but no data rows found. Check that the file has a header row and at least one data row." });
    }

    const result = await runBulkImport({
      rows,
      actorUserId: req.authUser!.id,
      dryRun,
    });

    return res.json({ success: true, dryRun, ...result });
  })
);

// ── POST /api/ats/bulk-import/preview ────────────────────────────────────────
// Parse file and return first 10 rows + column mapping + validation summary (no DB writes)
bulkImportRouter.post(
  "/preview",
  requireAuth,
  requireRole("admin", "super_admin"),
  upload.single("file"),
  h(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const rows = parseHistoricalFile(req.file.buffer, req.file.mimetype);
    const previewRows = rows.slice(0, 10);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    const validationSummary: { errors: number; warnings: number; sampleErrors: string[] } = {
      errors: 0,
      warnings: 0,
      sampleErrors: [],
    };

    for (let i = 0; i < Math.min(rows.length, 50); i++) {
      const { errors, warnings } = validateRow(rows[i], i + 2);
      validationSummary.errors += errors.length;
      validationSummary.warnings += warnings.length;
      if (errors.length && validationSummary.sampleErrors.length < 5) {
        validationSummary.sampleErrors.push(`Row ${i + 2}: ${errors[0].message}`);
      }
    }

    return res.json({
      success: true,
      totalRows: rows.length,
      columns,
      previewRows,
      validationSummary,
    });
  })
);
