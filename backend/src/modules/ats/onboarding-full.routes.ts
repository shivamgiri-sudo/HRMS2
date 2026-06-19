import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  addQualification,
  deleteOnboardingDocument,
  getFullOnboardingByCandidate,
  getFullOnboardingStatus,
  listFullOnboardingRequests,
  reviewFullOnboarding,
  saveBankDetails,
  saveEmployeeDetails,
  saveExperienceDetails,
  saveFamilyDetails,
  saveFinalSection,
  saveProgress,
  submitFullOnboarding,
  uploadOnboardingDocument,
  validateOnboardingToken,
} from "./onboarding-full.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") ?? undefined });

const uploadDir = path.join(process.cwd(), "uploads", "onboarding");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) { cb(null, true); } else { cb(new Error("Invalid file type. Allowed: PDF, JPG, PNG, WEBP")); }
  },
});

// Public token-driven candidate routes. Mount this BEFORE requireAuth in ats.routes.ts.
router.get("/validate-token", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await validateOnboardingToken(token) });
}));

router.get("/status", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await getFullOnboardingStatus(token) });
}));

router.post("/employee-details", h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveEmployeeDetails(token, input, meta(req)) });
}));

router.post("/bank-details", h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveBankDetails(token, input, meta(req)) });
}));

router.post("/qualification", h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.status(201).json({ success: true, data: await addQualification(token, input, meta(req)) });
}));

router.post("/family", h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveFamilyDetails(token, input, meta(req)) });
}));

router.post("/experience", h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveExperienceDetails(token, input, meta(req)) });
}));

router.post("/final-section", h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveFinalSection(token, input, meta(req)) });
}));

router.post("/documents", upload.single("file"), h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  if (!req.file) return res.status(400).json({ success: false, message: "file required" });
  return res.status(201).json({ success: true, data: await uploadOnboardingDocument(token, req.file, req.body, meta(req)) });
}));

router.delete("/documents/:documentId", h(async (req, res) => {
  const token = String(req.body.token ?? req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await deleteOnboardingDocument(token, req.params.documentId, meta(req)) });
}));

router.post("/progress", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  const stepIdx = Number(req.body.stepIdx ?? req.body.step_idx ?? 0);
  return res.json({ success: true, data: await saveProgress(token, stepIdx) });
}));

router.post("/submit", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await submitFullOnboarding(token, meta(req)) });
}));

// HR/BGV/Admin review routes
router.get("/requests", requireAuth, requireRole("admin", "hr", "recruiter"), h(async (_req: AuthenticatedRequest, res) => {
  return res.json({ success: true, data: await listFullOnboardingRequests(undefined) });
}));

router.get("/candidate/:candidateId", requireAuth, requireRole("admin", "hr", "recruiter"), h(async (req: AuthenticatedRequest, res) => {
  return res.json({ success: true, data: await getFullOnboardingByCandidate(req.params.candidateId) });
}));

router.patch("/candidate/:candidateId/review", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  return res.json({ success: true, data: await reviewFullOnboarding(req.params.candidateId, req.body, req.authUser!.id) });
}));

export default router;
