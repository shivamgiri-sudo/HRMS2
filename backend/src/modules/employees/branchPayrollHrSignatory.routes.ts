/**
 * Super Admin configuration for each branch's Payroll HR signatory.
 *
 * Joining documents name an HR person and carry an employer signature. Until
 * now the name printed blank ({{surveillance_hr_name}} had no source) and the
 * signature came from one company-wide seal, so every branch's joiners were
 * signed for by the same person. This lets each branch's Payroll HR be named
 * and their signature uploaded.
 *
 * Storage deliberately matches companySeal.routes.ts: the same uploads
 * directory, the same size limit, the same extension filter, and the same
 * magic-byte check — because trusting the extension alone would let any file
 * through under a .png name.
 */
import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { COMPANY_ASSET_CATEGORY } from "./companySeal.service.js";
import {
  listBranchPayrollHrSignatories,
  upsertBranchPayrollHrSignatory,
  getBranchPayrollHrSignatory,
} from "./branchPayrollHrSignatory.service.js";

const router = Router();
router.use(requireAuth);

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const ASSET_DIR = path.join(UPLOADS_ROOT, COMPANY_ASSET_CATEGORY);

/** A signature is a small image; anything larger is a mistake. */
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

/** The extension can be anything; the bytes cannot. */
function looksLikeImage(buffer: Buffer) {
  const png = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const jpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
  return png || jpg;
}

/** Every branch, including those with nobody configured — that is the point. */
router.get("/", requireRole("admin", "super_admin"), async (_req, res: Response) => {
  res.json({ success: true, data: await listBranchPayrollHrSignatories() });
});

/**
 * Save a branch's Payroll HR, with an optional signature image.
 *
 * Sent as multipart so the name and the image arrive together — configuring a
 * branch is one action to the person doing it, and splitting it into two
 * requests invites half-configured branches.
 */
router.post(
  "/:branchId",
  requireRole("admin", "super_admin"),
  upload.single("signature"),
  async (req: AuthenticatedRequest, res: Response) => {
    const branchId = String(req.params.branchId || "").trim();
    if (!branchId) return res.status(400).json({ success: false, error: "A branch is required." });

    const hrName = typeof req.body?.hrName === "string" ? req.body.hrName.trim() : "";
    if (!hrName) return res.status(400).json({ success: false, error: "The Payroll HR name is required." });

    let signatureFile: string | undefined;
    if (req.file) {
      const bytes = fs.readFileSync(req.file.path);
      if (!looksLikeImage(bytes)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, error: "That file is not a valid PNG or JPEG image." });
      }
      signatureFile = req.file.filename;
    }

    await upsertBranchPayrollHrSignatory({
      branchId,
      hrName,
      hrDesignation: typeof req.body?.hrDesignation === "string" ? req.body.hrDesignation : null,
      employeeId: typeof req.body?.employeeId === "string" && req.body.employeeId ? req.body.employeeId : null,
      // undefined leaves any existing image alone, so fixing a typo in the name
      // does not silently drop the signature.
      signatureFile,
      actorUserId: req.authUser?.id ?? null,
    });

    res.json({ success: true });
  },
);

/**
 * The stored signature image, so the screen can show which one is on file.
 *
 * Answers "which branch has whose signature" without anyone opening the
 * uploads directory.
 */
router.get("/:branchId/signature", requireRole("admin", "super_admin"), async (req: AuthenticatedRequest, res: Response) => {
  const signatory = await getBranchPayrollHrSignatory(String(req.params.branchId), { withImage: true });
  if (!signatory?.signature) return res.status(404).json({ success: false, error: "No signature on file for this branch." });
  res.setHeader("Content-Type", signatory.signatureFile?.endsWith(".png") ? "image/png" : "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(signatory.signature);
});

export default router;
