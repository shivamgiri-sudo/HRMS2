/**
 * Super Admin management of the company signing certificate.
 *
 * Deliberately narrow: super_admin only, no exceptions. This endpoint accepts a
 * private key, and the credential it manages is what binds the company to every
 * appointment letter issued.
 *
 * No response on this router ever contains key material. The service returns
 * metadata-only summaries; the decrypted PKCS#12 is reachable solely from
 * dscSigner.service.ts.
 */
import { Router, type NextFunction, type Response } from "express";
import multer from "multer";
import { randomBytes } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  listCertificates, storeCertificate, activateCertificate, deleteCertificate,
  generateSelfSignedP12, inspectP12,
} from "./dscConfig.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// In memory: the upload is a private key and must not be written to disk, even
// transiently, on its way to being encrypted.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 },
  // multer's callback is overloaded — cb(error) OR cb(null, accept) — so the two
  // outcomes must be separate calls rather than one with a union argument.
  fileFilter: (_req, file, cb) => {
    if (/\.(pfx|p12)$/i.test(file.originalname)) {
      cb(null, true);
      return;
    }
    cb(new Error("Upload a .pfx or .p12 certificate file."));
  },
});

router.use(requireAuth, requireRole("super_admin"));

/** Metadata for every certificate, plus what is active and what it is worth legally. */
router.get("/certificates", h(async (_req, res) => {
  const certificates = await listCertificates();
  const active = certificates.find((c) => c.activeStatus) ?? null;
  return res.json({
    success: true,
    data: {
      certificates,
      active,
      // Drives the banner on the issuance screen.
      signingReady: Boolean(active && !active.expired),
      usingSelfSigned: Boolean(active?.isSelfSigned),
    },
  });
}));

/** Inspect a file before committing to it — reports what the certificate really is. */
router.post("/certificates/inspect", upload.single("file"), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No certificate file uploaded." });
  const passphrase = String((req.body as Record<string, unknown>).passphrase ?? "");
  const info = inspectP12(req.file.buffer, passphrase);
  return res.json({
    success: true,
    data: {
      subjectCn: info.subjectCn,
      issuerCn: info.issuerCn,
      serialNumber: info.serialNumber,
      validFrom: info.validFrom.toISOString(),
      validTo: info.validTo.toISOString(),
      fingerprintSha256: info.fingerprintSha256,
      isSelfSigned: info.isSelfSigned,
      isCaIssued: info.isCaIssued,
    },
  });
}));

router.post("/certificates/upload", upload.single("file"), h(async (req, res) => {
  const b = req.body as Record<string, unknown>;
  if (!req.file) return res.status(400).json({ success: false, message: "No certificate file uploaded." });
  const signerName = String(b.signer_name ?? "").trim();
  const signerDesignation = String(b.signer_designation ?? "").trim();
  if (!signerName || !signerDesignation) {
    return res.status(400).json({
      success: false,
      message: "Signatory name and designation are required — they are printed on every letter.",
    });
  }

  const data = await storeCertificate({
    label: String(b.label ?? "").trim() || req.file.originalname,
    p12: req.file.buffer,
    passphrase: String(b.passphrase ?? ""),
    signerName,
    signerDesignation,
    actorUserId: req.authUser!.id,
    activate: String(b.activate ?? "true") !== "false",
    origin: "uploaded",
  });
  return res.json({ success: true, data });
}));

/**
 * Generate a self-signed certificate so signing works immediately.
 * Explicitly not a substitute for a CA-issued DSC — the resulting letters carry
 * a visible notice to that effect.
 */
router.post("/certificates/generate", h(async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const organisation = String(b.organisation ?? "Mas Callnet India Pvt. Ltd.").trim();
  const signerName = String(b.signer_name ?? "").trim();
  const signerDesignation = String(b.signer_designation ?? "").trim();
  if (!signerName || !signerDesignation) {
    return res.status(400).json({
      success: false,
      message: "Signatory name and designation are required — they are printed on every letter.",
    });
  }

  // Generated, never supplied: a passphrase chosen in the browser would travel
  // with the request and end up in logs.
  const passphrase = randomBytes(24).toString("base64url");
  const p12 = generateSelfSignedP12({
    organisation,
    signerName,
    validityYears: Number(b.validity_years ?? 2) || 2,
    passphrase,
  });

  const data = await storeCertificate({
    label: String(b.label ?? "").trim() || `Self-signed — ${organisation}`,
    p12, passphrase, signerName, signerDesignation,
    actorUserId: req.authUser!.id,
    activate: String(b.activate ?? "true") !== "false",
    origin: "generated",
  });
  return res.json({
    success: true,
    data,
    warning:
      "This is a self-signed certificate. It is valid for internal tamper-evidence and testing only — " +
      "PDF readers will report the signature as untrusted, and letters signed with it carry a notice saying so. " +
      "Upload a Class-3 organisation DSC from a CCA-licensed Certifying Authority for legally binding letters.",
  });
}));

router.post("/certificates/:id/activate", h(async (req, res) => {
  await activateCertificate(req.params.id, req.authUser!.id);
  return res.json({ success: true, message: "Certificate activated." });
}));

router.delete("/certificates/:id", h(async (req, res) => {
  await deleteCertificate(req.params.id, req.authUser!.id);
  return res.json({ success: true, message: "Certificate removed." });
}));

export const dscConfigRouter = router;
