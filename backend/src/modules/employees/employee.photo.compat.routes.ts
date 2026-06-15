import { randomUUID } from "crypto";
import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.resolve(__dirname, "../../../uploads/employee-photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_IMAGE_TYPES.get(file.mimetype) ?? path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    return cb(new Error("Only JPG, PNG, or WebP images are allowed"));
  },
});

export const employeePhotoCompatRouter = Router();
employeePhotoCompatRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function photoMiddleware(req: any, res: any, next: any) {
  upload.single("photo")(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return next();
  });
}

function removeUploadedFile(file?: Express.Multer.File) {
  if (file?.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
}

async function savePhotoForEmployee(employeeId: string, uploadedFile: Express.Multer.File) {
  const ext = path.extname(uploadedFile.filename).toLowerCase() || ".jpg";
  const finalName = `${employeeId}${ext}`;
  const finalPath = path.join(PHOTOS_DIR, finalName);

  if (uploadedFile.path !== finalPath) {
    for (const existingExt of [".jpg", ".jpeg", ".png", ".webp"]) {
      const oldPath = path.join(PHOTOS_DIR, `${employeeId}${existingExt}`);
      if (oldPath !== uploadedFile.path && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }
    fs.renameSync(uploadedFile.path, finalPath);
  }

  const fileUrl = `/api/files/employee-photos/${finalName}`;
  await db.execute(
    `UPDATE employees
        SET avatar_url = ?, photo_url = ?, updated_at = COALESCE(updated_at, NOW())
      WHERE id = ?`,
    [fileUrl, fileUrl, employeeId],
  );

  return fileUrl;
}

employeePhotoCompatRouter.post("/me/photo", photoMiddleware, h(async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No image uploaded" });
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp?.id) {
    removeUploadedFile(req.file);
    return res.status(403).json({ success: false, error: "No employee record" });
  }

  const fileUrl = await savePhotoForEmployee(String(emp.id), req.file);
  return res.json({ success: true, avatarUrl: fileUrl, photoUrl: fileUrl, url: fileUrl });
}));

employeePhotoCompatRouter.post("/:id/photo", requireRole("admin", "hr"), photoMiddleware, h(async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No image uploaded" });
  const employeeId = String(req.params.id ?? "").trim();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  if (!rows.length) {
    removeUploadedFile(req.file);
    return res.status(404).json({ success: false, error: "Employee not found" });
  }

  const fileUrl = await savePhotoForEmployee(employeeId, req.file);
  return res.json({ success: true, avatarUrl: fileUrl, photoUrl: fileUrl, url: fileUrl });
}));

employeePhotoCompatRouter.delete("/:id/photo", requireRole("admin", "hr"), h(async (req: any, res: any) => {
  const employeeId = String(req.params.id ?? "").trim();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(avatar_url, ''), photo_url) AS photo_url FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );

  const photoUrl = String(rows[0]?.photo_url ?? "");
  if (photoUrl) {
    const filePath = path.join(PHOTOS_DIR, path.basename(photoUrl));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await db.execute(
    `UPDATE employees SET avatar_url = NULL, photo_url = NULL WHERE id = ?`,
    [employeeId],
  );
  return res.json({ success: true });
}));
