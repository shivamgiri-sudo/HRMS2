import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { atsController as c } from "./ats.controller.js";
import { convertCandidateToEmployee } from "./ats.convert.service.js";
import onboardingRouter from "./ats.onboarding.routes.js";
import onboardingFullRouter from "./onboarding-full.routes.js";
import bgvVerificationRouter from "./bgv-verification.routes.js";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import fs from "fs";

export const atsRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// ── PUBLIC — candidate self-registration (no auth required) ──────────────────
atsRouter.post("/candidates",                    h(c.createCandidate.bind(c)));

// ── PUBLIC — candidate onboarding with token (no auth required) ──────────────
atsRouter.use("/onboarding-full", onboardingFullRouter);
atsRouter.use("/bgv", bgvVerificationRouter);

// ── PROTECTED — all remaining routes require a logged-in HR/recruiter ────────
atsRouter.use(requireAuth);

// Candidates (HR/recruiter facing) - Scoped
atsRouter.get("/candidates", requireRole("admin", "hr", "recruiter", "manager"), h(async (req, res) => {
  // Apply scope filtering
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "recruiter"],
    {
      branchId: "c.branch_id",
      processId: "c.process_id"
    },
    { allowCeoAllRead: true }
  );
  (req as any).scopeFilter = scoped;
  return c.listCandidates.bind(c)(req, res);
}));
atsRouter.get("/candidates/:id",                 requireRole("admin", "hr", "recruiter", "manager"), h(c.getCandidate.bind(c)));
atsRouter.put("/candidates/:id",                 requireRole("admin", "recruiter"), h(c.updateCandidate.bind(c)));
atsRouter.post("/candidates/:id/move-stage",     requireRole("admin", "recruiter", "manager"), h(c.moveStage.bind(c)));
atsRouter.get("/candidates/:id/stage-logs",      requireRole("admin", "hr", "recruiter", "manager"), h(c.listStageLogs.bind(c)));

// Candidate → Employee conversion
atsRouter.post(
  "/convert/:candidateId",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const result = await convertCandidateToEmployee(
      req.params.candidateId,
      req.authUser!.id
    );
    return res.status(201).json({ success: true, data: result });
  })
);

// Onboarding bridge
atsRouter.get("/onboarding-bridge",              requireRole("admin", "hr"), h(c.listOnboardingBridges.bind(c)));
atsRouter.post("/onboarding-bridge",             requireRole("admin", "hr"), h(c.createOnboardingBridge.bind(c)));
atsRouter.patch("/onboarding-bridge/:id",        requireRole("admin", "hr"), h(c.updateOnboardingBridge.bind(c)));

// Reference data
atsRouter.get("/sourcing-channels",              requireRole("admin", "hr", "recruiter"), h(c.listSourcingChannels.bind(c)));
atsRouter.get("/stats",                          requireRole("admin", "hr", "recruiter", "manager"), h(c.getDashboardStats.bind(c)));

// Walk-in queue — candidates who arrived via Walk-In channel, sorted by walk_in_date desc
atsRouter.get("/walkin-queue",                   requireRole("admin", "hr", "recruiter"), h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT c.*, e.full_name AS assigned_to_name
     FROM ats_candidate c
     LEFT JOIN employees e ON e.id = c.created_by
     WHERE c.sourcing_channel = 'Walk-In' AND c.active_status = 1
     ORDER BY c.walk_in_date DESC, c.created_at DESC
     LIMIT 100`,
    []
  ) as any[];
  return res.json({ success: true, data: rows });
}));

// Alias: waiting-queue = walkin-queue (used by NativeATSWaitingQueue page)
atsRouter.get("/waiting-queue",                  requireRole("admin", "hr", "recruiter", "manager"), h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT c.* FROM ats_candidate c
     WHERE c.current_stage IN ('New','Screening') AND c.active_status = 1
     ORDER BY c.walk_in_date DESC, c.created_at DESC
     LIMIT 100`,
    []
  ) as any[];
  return res.json({ success: true, data: rows });
}));

// ── Candidate File Upload (PUBLIC - 1 hour window after registration) ────────

// Configure multer for candidate uploads
const uploadDir = path.join(process.cwd(), "uploads", "candidates");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const candidateStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const candidateUpload = multer({
  storage: candidateStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Allowed: PDF, JPG, PNG"));
    }
  },
});

// PUBLIC endpoint for candidate uploads (within 1 hour of registration)
atsRouter.post(
  "/candidates/:id/upload",
  candidateUpload.single("file"),
  h(async (req: any, res: any) => {
    const { id } = req.params;
    const { type } = req.body; // "resume" or "selfie"

    if (!type || !["resume", "selfie"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be 'resume' or 'selfie'" });
    }

    // Verify candidate exists and was created recently (within 1 hour)
    const { db } = await import("../../db/mysql.js");
    const [rows] = await db.execute(
      `SELECT id, created_at FROM ats_candidate WHERE id = ?`,
      [id]
    ) as any[];

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    const candidate = rows[0];
    const createdAt = new Date(candidate.created_at);
    const now = new Date();
    const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceCreation > 1) {
      return res.status(403).json({
        success: false,
        message: "Upload window expired (1 hour limit from registration)"
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const fileUrl = `/uploads/candidates/${req.file.filename}`;

    // Store file reference in candidate record
    const updateField = type === "resume" ? "resume_url" : "selfie_url";
    await db.execute(
      `UPDATE ats_candidate SET ${updateField} = ? WHERE id = ?`,
      [fileUrl, id]
    );

    return res.json({
      success: true,
      path: fileUrl,
      url: fileUrl,
      filename: req.file.filename,
      message: `${type} uploaded successfully`,
    });
  })
);

// Onboarding flow — token generation, profile submission, offer mgmt, approve/reject
atsRouter.use("/onboarding", onboardingRouter);
