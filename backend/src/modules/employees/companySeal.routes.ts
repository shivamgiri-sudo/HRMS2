/**
 * Admin API for the company's authorised signature and rubber stamp.
 *
 * Uploading either one immediately changes what appears on every statutory form
 * generated afterwards, so the preview endpoint renders the real EPF form with
 * the seal applied. That way the placement is checked before a joiner sees it,
 * rather than after.
 */
import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  COMPANY_ASSET_CATEGORY,
  COMPANY_SEAL_SETTING_KEYS,
  applyCompanySeal,
  loadCompanySeal,
} from "./companySeal.service.js";
import { buildEpfDeclarationPdf } from "./epfDeclarationForm.js";

const router = Router();
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const ASSET_DIR = path.join(UPLOADS_ROOT, COMPANY_ASSET_CATEGORY);

/** A signature or stamp is a small image; anything larger is a mistake. */
const MAX_BYTES = 4 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(ASSET_DIR, { recursive: true });
      cb(null, ASSET_DIR);
    },
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = [".png", ".jpg", ".jpeg"].includes(path.extname(file.originalname).toLowerCase());
    if (!ok) return cb(new Error("Only PNG or JPEG images are accepted."));
    cb(null, true);
  },
});

/** Trusting the extension alone would let any file through under a .png name. */
function looksLikeImage(buffer: Buffer) {
  const png = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const jpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
  return png || jpg;
}

async function writeSetting(key: string, value: string | null, actorUserId?: string | null) {
  const [[row]] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM org_settings WHERE setting_key = ? LIMIT 1`,
    [key],
  );
  if (row) {
    await db.execute(
      `UPDATE org_settings SET setting_value = ?, updated_by = ?, updated_at = NOW() WHERE id = ?`,
      [value, actorUserId ?? null, row.id],
    );
  } else {
    await db.execute(
      `INSERT INTO org_settings (id, setting_key, setting_value, updated_by) VALUES (UUID(), ?, ?, ?)`,
      [key, value, actorUserId ?? null],
    );
  }
}

router.use(requireAuth);

/** Current configuration. Never returns the image bytes, only whether they exist. */
router.get("/", requireRole("admin", "super_admin", "hr"), async (_req, res: Response) => {
  const seal = await loadCompanySeal();
  res.json({
    success: true,
    signature: { configured: Boolean(seal.signature) },
    stamp: { configured: Boolean(seal.stamp) },
    signatoryName: seal.signatoryName,
    signatoryDesignation: seal.signatoryDesignation,
    appliesTo: ["EPF_DECLARATION", "EPF_NOMINATION_FORM2"],
  });
});

/**
 * Upload the signature and/or the stamp, and set the signatory's details.
 * Both files are optional so either can be replaced on its own.
 */
router.post(
  "/",
  requireRole("admin", "super_admin"),
  upload.fields([{ name: "signature", maxCount: 1 }, { name: "stamp", maxCount: 1 }]),
  async (req: AuthenticatedRequest, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const actor = req.authUser?.id ?? null;
    const written: string[] = [];

    for (const [field, key] of [
      ["signature", COMPANY_SEAL_SETTING_KEYS.signature],
      ["stamp", COMPANY_SEAL_SETTING_KEYS.stamp],
    ] as const) {
      const file = files?.[field]?.[0];
      if (!file) continue;
      const bytes = fs.readFileSync(file.path);
      if (!looksLikeImage(bytes)) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, error: `${field} is not a valid PNG or JPEG image.` });
      }
      await writeSetting(key, file.filename, actor);
      written.push(field);
    }

    const name = typeof req.body?.signatoryName === "string" ? req.body.signatoryName.trim() : null;
    const designation = typeof req.body?.signatoryDesignation === "string" ? req.body.signatoryDesignation.trim() : null;
    if (name !== null) await writeSetting(COMPANY_SEAL_SETTING_KEYS.signatoryName, name || null, actor);
    if (designation !== null) await writeSetting(COMPANY_SEAL_SETTING_KEYS.signatoryDesignation, designation || null, actor);

    res.json({ success: true, updated: written });
  },
);

/**
 * Renders the real EPF Form 11 with the current seal applied, so placement can
 * be confirmed against the actual document rather than guessed at.
 */
router.get("/preview", requireRole("admin", "super_admin", "hr"), async (_req, res: Response) => {
  const blank = await buildEpfDeclarationPdf();
  const sealed = await applyCompanySeal(blank, "EPF_DECLARATION");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="company-seal-preview.pdf"');
  res.send(Buffer.from(sealed));
});

/** Remove one of the images without disturbing the other. */
router.delete("/:asset", requireRole("admin", "super_admin"), async (req: AuthenticatedRequest, res: Response) => {
  const key = req.params.asset === "signature"
    ? COMPANY_SEAL_SETTING_KEYS.signature
    : req.params.asset === "stamp"
      ? COMPANY_SEAL_SETTING_KEYS.stamp
      : null;
  if (!key) return res.status(400).json({ success: false, error: "asset must be 'signature' or 'stamp'." });
  await writeSetting(key, null, req.authUser?.id ?? null);
  res.json({ success: true });
});

export default router;
