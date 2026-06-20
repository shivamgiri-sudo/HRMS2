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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");

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
  requireRole("admin", "hr"),
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
