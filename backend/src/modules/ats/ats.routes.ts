import { Router } from "express";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
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
import { recruiterHiringRouter } from "./recruiter-hiring.routes.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

import { atsQueueService } from "./ats.queue.service.js";
import { verifyRecruiter, resolveRecruiterForActor, getMyPendingCandidates, getSubmissionHistory, getRecruiterDailyStats } from "../ats-full-parity/recruiterInterview.service.js";

export const atsRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// ── PUBLIC — candidate self-registration (no auth required) ──────────────────
atsRouter.post("/candidates",                    h(c.createCandidate.bind(c)));

// ── PUBLIC — candidate onboarding with token (no auth required) ──────────────
atsRouter.use("/onboarding-full", onboardingFullRouter);
atsRouter.use("/bgv", bgvVerificationRouter);
atsRouter.use(recruiterHiringRouter);

// ── PUBLIC — candidate file upload (1 hour window after registration) ────────
// Configure multer for candidate uploads
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, "../../../uploads/candidates");
const fs = await import("fs");
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
atsRouter.put("/candidates/:id",                 requireWriteAccess, requireRole("admin", "recruiter"), h(c.updateCandidate.bind(c)));
atsRouter.post("/candidates/:id/move-stage",     requireWriteAccess, requireRole("admin", "recruiter", "manager"), h(c.moveStage.bind(c)));
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
atsRouter.get("/onboarding-bridge",              requireRole("admin", "hr", "manager"), h(c.listOnboardingBridges.bind(c)));
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

// ── Queue Token Management ────────────────────────────────────────────────────

// POST /api/ats/queue-tokens — create arrival token for a candidate (HR/recruiter)
atsRouter.post("/queue-tokens", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const { candidateId, arrivalTime } = req.body;
  if (!candidateId || typeof candidateId !== 'string') {
    return res.status(400).json({ success: false, message: "candidateId is required" });
  }
  const arrival = arrivalTime ?? new Date().toISOString().slice(0, 19).replace('T', ' ');
  const data = await atsQueueService.createToken(candidateId, arrival);
  return res.status(201).json({ success: true, data });
}));

// GET /api/ats/queue-tokens/candidate/:candidateId — active token for a candidate
atsRouter.get("/queue-tokens/candidate/:candidateId", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const data = await atsQueueService.getTokenByCandidateId(req.params.candidateId);
  return res.json({ success: true, data });
}));

// POST /api/ats/queue-tokens/:id/walk-out — mark candidate as walked out
atsRouter.post("/queue-tokens/:id/walk-out", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const data = await atsQueueService.walkOut(req.params.id);
  return res.json({ success: true, data });
}));

// POST /api/ats/queue-tokens/re-entry — re-entry after walk-out
atsRouter.post("/queue-tokens/re-entry", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const { candidateId, arrivalTime } = req.body;
  if (!candidateId || typeof candidateId !== 'string') {
    return res.status(400).json({ success: false, message: "candidateId is required" });
  }
  const arrival = arrivalTime ?? new Date().toISOString().slice(0, 19).replace('T', ' ');
  const data = await atsQueueService.reEntry(candidateId, arrival);
  return res.status(201).json({ success: true, data });
}));

// PATCH /api/ats/queue-tokens/:id/assign-recruiter
atsRouter.patch("/queue-tokens/:id/assign-recruiter", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const { recruiterId } = req.body;
  const data = await atsQueueService.assignRecruiter(req.params.id, recruiterId ?? null);
  return res.json({ success: true, data });
}));

// PATCH /api/ats/queue-tokens/:id/assign-interviewer
atsRouter.patch("/queue-tokens/:id/assign-interviewer", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const { interviewerId } = req.body;
  const data = await atsQueueService.assignInterviewer(req.params.id, interviewerId ?? null);
  return res.json({ success: true, data });
}));

// PATCH /api/ats/queue-tokens/:id/stage
atsRouter.patch("/queue-tokens/:id/stage", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const { stage } = req.body;
  if (!stage || typeof stage !== 'string') {
    return res.status(400).json({ success: false, message: "stage is required" });
  }
  const data = await atsQueueService.updateStage(req.params.id, stage);
  return res.json({ success: true, data });
}));

// GET /api/ats/queue-tokens/active — full active queue with wait times and >20min alerts
atsRouter.get("/queue-tokens/active", requireRole("admin", "hr", "super_admin", "recruiter", "manager"), h(async (req: any, res: any) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "recruiter"],
    { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
    { allowCeoAllRead: true }
  );
  const data = await atsQueueService.listActiveQueue(
    { sql: scoped.sql ?? '', params: scoped.params ?? [] },
    new Date()
  );
  return res.json({ success: true, data, alert_count: data.filter((r) => r.over_threshold).length });
}));

// ── Recruiter identity + scoped candidate list ───────────────────────────────

// POST /api/ats/recruiter/verify — validates recruiter code + PIN and biometric availability
// Requires HRMS JWT (requireAuth already applied above)
// No role restriction: recruiter app provides separate credential layer
atsRouter.post("/recruiter/verify", h(async (req: any, res: any) => {
  const { recruiterCode, pin } = req.body;
  if (!recruiterCode || !pin) return res.status(400).json({ success: false, message: "recruiterCode and pin are required" });
  const profile = await verifyRecruiter(recruiterCode, pin);
  return res.json({ success: true, data: profile });
}));

// GET /api/ats/recruiter/my-candidates — returns candidates assigned to the authenticated recruiter.
// Admin/hr/super_admin may inspect all or filter by supplying ?recruiterName=.
// Any other role sees only their own queue derived from the JWT → employee → roster chain.
atsRouter.get("/recruiter/my-candidates", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const userRoles = (req.userRoles ?? []) as string[];
  const isPrivileged = userRoles.some((role) => ["admin", "hr", "super_admin"].includes(role));
  const overrideName = String(req.query.recruiterName ?? "").trim();

  let recruiterName: string | undefined;
  let profile: Awaited<ReturnType<typeof resolveRecruiterForActor>> = null;

  if (isPrivileged && overrideName) {
    // Admin/HR may explicitly request any recruiter's queue by name
    recruiterName = overrideName;
  } else if (!isPrivileged) {
    // Derive name from the JWT-linked recruiter row
    profile = await resolveRecruiterForActor(req.authUser!.id);
    if (!profile) {
      return res.status(403).json({ success: false, message: "No recruiter profile linked to this account" });
    }
    recruiterName = profile.name;
  }

  const data = await getMyPendingCandidates(recruiterName);
  return res.json({ success: true, data, recruiter: profile });
}));

// GET /api/ats/recruiter/submission-history — submission history for the authenticated recruiter.
// Admin/hr/super_admin may inspect all or filter by supplying ?recruiterCode=.
atsRouter.get("/recruiter/submission-history", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const userRoles = (req.userRoles ?? []) as string[];
  const isPrivileged = userRoles.some((role) => ["admin", "hr", "super_admin"].includes(role));
  const overrideCode = String(req.query.recruiterCode ?? "").trim();

  let recruiterCode: string | null = null;
  let rosterId: string | null = null;
  let profile: Awaited<ReturnType<typeof resolveRecruiterForActor>> = null;

  if (isPrivileged && overrideCode) {
    recruiterCode = overrideCode;
  } else if (!isPrivileged) {
    profile = await resolveRecruiterForActor(req.authUser!.id);
    if (!profile) {
      return res.status(403).json({ success: false, message: "No recruiter profile linked to this account" });
    }
    recruiterCode = profile.recruiterCode ?? null;
    rosterId = profile.id ?? null;
  }

  const userId = req.authUser?.id ?? null;
  const data = await getSubmissionHistory(recruiterCode, rosterId, userId);
  return res.json({ success: true, data, recruiter: profile });
}));

// GET /api/ats/recruiter/daily-stats — today's KPI summary for the authenticated recruiter.
atsRouter.get("/recruiter/daily-stats", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: any, res: any) => {
  const userRoles = (req.userRoles ?? []) as string[];
  const isPrivileged = userRoles.some((role) => ["admin", "hr", "super_admin"].includes(role));
  let recruiterName: string | undefined;
  if (isPrivileged && req.query.recruiterName) {
    recruiterName = String(req.query.recruiterName).trim();
  } else {
    const profile = await resolveRecruiterForActor(req.authUser!.id);
    if (!profile) return res.status(403).json({ success: false, message: "No recruiter profile linked to this account" });
    recruiterName = profile.name;
  }
  const stats = await getRecruiterDailyStats(recruiterName!);
  return res.json({ success: true, data: stats });
}));

// Onboarding flow — token generation, profile submission, offer mgmt, approve/reject
atsRouter.use("/onboarding", onboardingRouter);
