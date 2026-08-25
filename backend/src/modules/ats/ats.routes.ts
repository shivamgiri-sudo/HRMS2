import { Router } from "express";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { atsController as c } from "./ats.controller.js";
import { convertCandidateToEmployee } from "./ats.convert.service.js";
import onboardingRouter from "./ats.onboarding.routes.js";
import onboardingFullRouter from "./onboarding-full.routes.js";
import bgvVerificationRouter from "./bgv-verification.routes.js";
import fraudAlertsRouter from "./fraud-alerts.routes.js";
import { recruiterHiringRouter } from "./recruiter-hiring.routes.js";
import multer from "multer";
import path from "path";

import { atsQueueService } from "./ats.queue.service.js";
import { verifyRecruiter, resolveRecruiterForActor, getMyPendingCandidates, getOtherRecruitersPendingCandidates, reassignCandidate, getSubmissionHistory, getRecruiterDailyStats } from "../ats-full-parity/recruiterInterview.service.js";
import { persistCandidateFile } from "./candidate-file.service.js";
import { joiningDocumentsTrackerRouter } from "./ats.joiningDocumentsTracker.routes.js";
import { getIstDateString } from '../../utils/dateUtils.js';
import { bulkImportRouter } from "./bulk-import.routes.js";

export const atsRouter = Router();
export const atsPublicRouter = Router(); // Public routes (no auth)

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// â”€â”€ PUBLIC â€” candidate self-registration (no auth required) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
atsRouter.post("/candidates",                    h(c.createCandidate.bind(c)));

// â”€â”€ PUBLIC â€” candidate onboarding with token (no auth required) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
atsRouter.use("/onboarding-full", onboardingFullRouter);
atsRouter.use("/bgv", bgvVerificationRouter);
atsRouter.use("/fraud-alerts", fraudAlertsRouter);
// Keep onboarding mounted before recruiterHiringRouter; that router installs
// root-level auth/role middleware and can otherwise intercept /onboarding/*.
atsRouter.use("/onboarding", onboardingRouter);
atsRouter.use(recruiterHiringRouter);

// â”€â”€ PUBLIC â€” candidate file upload (1 hour window after registration) â”€â”€â”€â”€â”€â”€â”€â”€
// Configure multer for candidate uploads
const candidateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
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
atsPublicRouter.post(
  "/candidates/:id/upload",
  candidateUpload.single("file"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { type, mobile } = req.body; // "resume" or "selfie" + mobile for ownership proof

    if (!type || !["resume", "selfie"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be 'resume' or 'selfie'" });
    }

    // Ownership proof is required before anything is looked up. Checking it after
    // the candidate query turned this public endpoint into an existence oracle: a
    // caller with no proof at all could tell a real candidate id (404) from a fake
    // one (404 vs 403). Validating first also matches the type check above — no DB
    // hit for a request that cannot succeed.
    const normalizedInput = String(mobile ?? "").replace(/\D/g, "").slice(-10);
    if (!normalizedInput) {
      return res.status(400).json({ success: false, message: "mobile is required to verify ownership of this candidate record" });
    }

    // Verify candidate exists and was registered recently (within 1 hour of walk-in)
    // Use updated_at (not created_at) — pre-entered leads have old created_at but updated_at
    // is always stamped NOW() by the registration route when a candidate walks in.
    const { db } = await import("../../db/mysql.js");
    const [rows] = await db.execute(
      `SELECT id, updated_at, mobile FROM ats_candidate WHERE id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    const candidate = rows[0] as { id: string; updated_at: string; mobile: string | null };

    // Ownership check: mobile sent by caller must match the registered candidate mobile.
    //
    // This endpoint is public — no JWT — so this comparison is the ONLY thing tying
    // the uploader to the candidate. It used to run under `if (mobile && candidate.mobile)`,
    // which made the proof optional in both directions: omit the field and the check
    // was skipped rather than failed, and any caller holding a candidate id could
    // upload against it. A missing proof is rejected above, before the lookup.
    if (!candidate.mobile) {
      // Nothing to compare against, so ownership cannot be established. Denying is
      // the only safe reading — the alternative lets a candidate row with no stored
      // mobile accept an upload from anyone.
      return res.status(403).json({ success: false, message: "Mobile number does not match candidate record" });
    }
    const normalizedStored = String(candidate.mobile).replace(/\D/g, "").slice(-10);
    if (normalizedInput !== normalizedStored) {
      return res.status(403).json({ success: false, message: "Mobile number does not match candidate record" });
    }

    // dateStrings:true returns bare "YYYY-MM-DD HH:mm:ss" — append T and Z for safe UTC parse
    const registeredAt = new Date((candidate.updated_at as string).replace(" ", "T") + "Z");
    const now = new Date();
    const hoursSinceRegistration = (now.getTime() - registeredAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceRegistration > 1) {
      return res.status(403).json({
        success: false,
        message: "Upload window expired (1 hour limit from registration)"
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    // Magic-byte validation — prevent disguised executable files
    const MAGIC: Record<string, number[][]> = {
      ".pdf":  [[0x25, 0x50, 0x44, 0x46]],
      ".jpg":  [[0xFF, 0xD8, 0xFF]],
      ".jpeg": [[0xFF, 0xD8, 0xFF]],
      ".png":  [[0x89, 0x50, 0x4E, 0x47]],
    };
    const ext = path.extname(req.file.originalname).toLowerCase();
    const sigs = MAGIC[ext];
    if (sigs) {
      const head = req.file.buffer;
      const valid = sigs.some(sig => sig.every((b, i) => head[i] === b));
      if (!valid) {
        return res.status(400).json({ success: false, message: "File content does not match declared type" });
      }
    }

    const uploaded = await persistCandidateFile({
      candidateId: id,
      fileType: type,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      visibility: "private",
    });

    const secureUrl = `/api/files/candidate/${uploaded.id}`;

    // Store file reference in candidate record
    const updateField = type === "resume" ? "resume_url" : "selfie_url";
    await db.execute(
      `UPDATE ats_candidate SET ${updateField} = ? WHERE id = ?`,
      [secureUrl, id]
    );

    return res.json({
      success: true,
      fileId: uploaded.id,
      path: secureUrl,
      url: secureUrl,
      filename: uploaded.stored_filename,
      message: `${type} uploaded successfully`,
    });
  })
);

// â”€â”€ PROTECTED â€” all remaining routes require a logged-in HR/recruiter â”€â”€â”€â”€â”€â”€â”€â”€
atsRouter.use(requireAuth);

// Candidates (HR/recruiter facing) - Scoped
// ats_candidate stores applied_for_branch as a text name (not a UUID), so we can't use
// buildScopeWhereClause which compares against UUID branch_id from user_assignment_scope.
// admin/hr/manager/super_admin see all; recruiter scope is resolved via branch_master name lookup.
atsRouter.get("/candidates", requireRole("admin", "hr", "recruiter", "manager", "super_admin"), h(async (req, res) => {
  // Scope comes from the shared resolver in candidate-access.ts, which is the same rule the
  // by-id routes now use. It was previously resolved inline here, which is why the by-id
  // paths had no scope at all: there was nothing to reuse.
  const { resolveCandidateScope } = await import("./candidate-access.js");
  const scopeFilter = await resolveCandidateScope(req.authUser!.id);
  (req as AuthenticatedRequest & { scopeFilter?: unknown }).scopeFilter = scopeFilter;
  return c.listCandidates.bind(c)(req, res);
}));
atsRouter.get("/candidates/:id",                 requireRole("admin", "hr", "recruiter", "manager"), h(c.getCandidate.bind(c)));
atsRouter.put("/candidates/:id",                 requireWriteAccess, requireRole("admin", "recruiter"), h(c.updateCandidate.bind(c)));
atsRouter.post("/candidates/:id/move-stage",     requireWriteAccess, requireRole("admin", "recruiter", "manager"), h(c.moveStage.bind(c)));
atsRouter.get("/candidates/:id/stage-logs",      requireRole("admin", "hr", "recruiter", "manager"), h(c.listStageLogs.bind(c)));

// Candidate â†’ Employee conversion
atsRouter.post(
  "/convert/:candidateId",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Defence in depth: admin and hr are both wide roles today, so this guard passes for
    // every caller who can currently reach the route. It is here so that widening the role
    // list later cannot silently hand conversion of any candidate to a scoped role.
    const { assertCandidateInScope } = await import("./candidate-access.js");
    if (!(await assertCandidateInScope(req.authUser!.id, req.params.candidateId, res))) return;

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
atsRouter.get("/stats",                          requireRole("admin", "hr", "recruiter", "manager", "super_admin"), h(c.getDashboardStats.bind(c)));

// Walk-in queue â€” candidates who arrived via Walk-In channel, sorted by walk_in_date desc
atsRouter.get("/walkin-queue",                   requireRole("admin", "hr", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT c.*, e.full_name AS assigned_to_name
     FROM ats_candidate c
     LEFT JOIN employees e ON e.id = c.created_by
     WHERE c.sourcing_channel = 'Walk-In' AND c.active_status = 1
     ORDER BY c.walk_in_date DESC, c.created_at DESC
     LIMIT 100`,
    []
  );
  return res.json({ success: true, data: rows });
}));

// Alias: waiting-queue = walkin-queue (used by NativeATSWaitingQueue page)
atsRouter.get("/waiting-queue",                  requireRole("admin", "hr", "recruiter", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT c.* FROM ats_candidate c
     WHERE c.current_stage IN ('New','Screening') AND c.active_status = 1
     ORDER BY c.walk_in_date DESC, c.created_at DESC
     LIMIT 100`,
    []
  );
  return res.json({ success: true, data: rows });
}));

// â”€â”€ Queue Token Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// POST /api/ats/queue-tokens â€” create arrival token for a candidate (HR/recruiter)
atsRouter.post("/queue-tokens", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { candidateId, arrivalTime } = req.body;
  if (!candidateId || typeof candidateId !== 'string') {
    return res.status(400).json({ success: false, message: "candidateId is required" });
  }
  const arrival = arrivalTime ?? `${getIstDateString()} 00:00:00`;
  const data = await atsQueueService.createToken(candidateId, arrival);
  return res.status(201).json({ success: true, data });
}));

// GET /api/ats/queue-tokens/candidate/:candidateId â€” active token for a candidate
atsRouter.get("/queue-tokens/candidate/:candidateId", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  // recruiter is a scoped role, so this needs the same candidate guard as the by-id routes:
  // a walk-in token names the candidate and their queue position.
  const { assertCandidateInScope } = await import("./candidate-access.js");
  if (!(await assertCandidateInScope(req.authUser!.id, req.params.candidateId, res))) return;

  const data = await atsQueueService.getTokenByCandidateId(req.params.candidateId);
  return res.json({ success: true, data });
}));

// POST /api/ats/queue-tokens/:id/walk-out â€” mark candidate as walked out
atsRouter.post("/queue-tokens/:id/walk-out", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await atsQueueService.walkOut(req.params.id);
  return res.json({ success: true, data });
}));

// POST /api/ats/queue-tokens/re-entry â€” re-entry after walk-out
atsRouter.post("/queue-tokens/re-entry", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { candidateId, arrivalTime } = req.body;
  if (!candidateId || typeof candidateId !== 'string') {
    return res.status(400).json({ success: false, message: "candidateId is required" });
  }
  const arrival = arrivalTime ?? `${getIstDateString()} 00:00:00`;
  const data = await atsQueueService.reEntry(candidateId, arrival);
  return res.status(201).json({ success: true, data });
}));

// PATCH /api/ats/queue-tokens/:id/assign-recruiter
atsRouter.patch("/queue-tokens/:id/assign-recruiter", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { recruiterId } = req.body;
  const data = await atsQueueService.assignRecruiter(req.params.id, recruiterId ?? null);
  return res.json({ success: true, data });
}));

// PATCH /api/ats/queue-tokens/:id/assign-interviewer
atsRouter.patch("/queue-tokens/:id/assign-interviewer", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { interviewerId } = req.body;
  const data = await atsQueueService.assignInterviewer(req.params.id, interviewerId ?? null);
  return res.json({ success: true, data });
}));

// PATCH /api/ats/queue-tokens/:id/stage
atsRouter.patch("/queue-tokens/:id/stage", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { stage } = req.body;
  if (!stage || typeof stage !== 'string') {
    return res.status(400).json({ success: false, message: "stage is required" });
  }
  const data = await atsQueueService.updateStage(req.params.id, stage);
  return res.json({ success: true, data });
}));

// GET /api/ats/queue-tokens/active â€” full active queue with wait times and >20min alerts
atsRouter.get("/queue-tokens/active", requireRole("admin", "hr", "super_admin", "recruiter", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "recruiter"],
    { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
    { allowCeoAllRead: true }
  );
  const data = await atsQueueService.listActiveQueue(
    { sql: scoped.sql ?? '', params: scoped.params ?? [] }
  );
  return res.json({ success: true, data, alert_count: data.filter((r) => r.over_threshold).length });
}));

// â”€â”€ Recruiter identity + scoped candidate list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// POST /api/ats/recruiter/verify â€” validates recruiter code + PIN and biometric availability
// Requires HRMS JWT (requireAuth already applied above)
// No role restriction: recruiter app provides separate credential layer
atsRouter.post("/recruiter/verify", h(async (req: AuthenticatedRequest, res: Response) => {
  const { recruiterCode, pin } = req.body;
  if (!recruiterCode || !pin) return res.status(400).json({ success: false, message: "recruiterCode and pin are required" });
  const profile = await verifyRecruiter(recruiterCode, pin);
  return res.json({ success: true, data: profile });
}));

// GET /api/ats/recruiter/my-candidates â€” returns candidates assigned to the authenticated recruiter.
// Admin/hr/super_admin may inspect all or filter by supplying ?recruiterName=.
// Any other role sees only their own queue derived from the JWT â†’ employee â†’ roster chain.
atsRouter.get("/recruiter/my-candidates", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userRoles = ((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
  const isPrivileged = userRoles.some((role) => ["admin", "hr", "super_admin"].includes(role));
  const isRecruiterUser = userRoles.includes("recruiter");
  const overrideName = String(req.query.recruiterName ?? "").trim();

  let recruiterName: string | undefined;
  let profile: Awaited<ReturnType<typeof resolveRecruiterForActor>> = null;

  if (isPrivileged && overrideName) {
    // Admin/HR may explicitly request any recruiter's queue by name
    recruiterName = overrideName;
  } else if (isRecruiterUser) {
    // Mixed HR+recruiter accounts should still default to their own recruiter queue.
    profile = await resolveRecruiterForActor(req.authUser!.id);
    if (!profile) {
      return res.status(403).json({ success: false, message: "No recruiter profile linked to this account" });
    }
    recruiterName = profile.name;
  }

  const data = await getMyPendingCandidates(recruiterName);
  return res.json({ success: true, data, recruiter: profile });
}));

// GET /api/ats/recruiter/submission-history â€” submission history for the authenticated recruiter.
// Admin/hr/super_admin may inspect all or filter by supplying ?recruiterCode=.
atsRouter.get("/recruiter/submission-history", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userRoles = ((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
  const isPrivileged = userRoles.some((role) => ["admin", "hr", "super_admin"].includes(role));
  const isRecruiterUser = userRoles.includes("recruiter");
  const overrideCode = String(req.query.recruiterCode ?? "").trim();

  let recruiterCode: string | null = null;
  let rosterId: string | null = null;
  let profile: Awaited<ReturnType<typeof resolveRecruiterForActor>> = null;

  if (isPrivileged && overrideCode) {
    recruiterCode = overrideCode;
  } else if (isRecruiterUser) {
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

// GET /api/ats/recruiter/daily-stats â€” today's KPI summary for the authenticated recruiter.
atsRouter.get("/recruiter/daily-stats", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userRoles = ((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
  const isPrivileged = userRoles.some((role) => ["admin", "hr", "super_admin"].includes(role));
  const isRecruiterUser = userRoles.includes("recruiter");
  let recruiterName: string | undefined;
  let recruiterCode: string | null = null;
  if (isPrivileged && req.query.recruiterName) {
    recruiterName = String(req.query.recruiterName).trim();
  } else if (isRecruiterUser) {
    const profile = await resolveRecruiterForActor(req.authUser!.id);
    if (!profile) return res.status(403).json({ success: false, message: "No recruiter profile linked to this account" });
    recruiterName = profile.name;
    recruiterCode = profile.recruiterCode ?? null;
  } else {
    return res.status(400).json({ success: false, message: "recruiterName is required for privileged non-recruiter users" });
  }
  const stats = await getRecruiterDailyStats(recruiterName!, recruiterCode);
  return res.json({ success: true, data: stats });
}));

// GET /api/ats/recruiter/my-performance — detailed performance report for the logged-in recruiter
atsRouter.get("/recruiter/my-performance", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { db } = await import("../../db/mysql.js");

  const userId = req.authUser!.id;
  const period = String(req.query.period ?? "MTD"); // FTD | WTD | MTD | L30

  let dateStart: string;
  if (period === "FTD") {
    dateStart = "CURDATE()";
  } else if (period === "WTD") {
    dateStart = "DATE(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY))";
  } else if (period === "MTD") {
    dateStart = "DATE(DATE_FORMAT(CURDATE(),'%Y-%m-01'))";
  } else { // L30
    dateStart = "DATE(DATE_SUB(CURDATE(), INTERVAL 29 DAY))";
  }

  const dateClause = period === "FTD"
    ? `DATE(s.submitted_at) = ${dateStart}`
    : `DATE(s.submitted_at) >= ${dateStart}`;

  const base = `FROM ats_interview_submission s WHERE s.recruiter_user_id = ? AND ${dateClause}`;
  const params: unknown[] = [userId];

  // ── KPI summary ────────────────────────────────────────────────────────────
  // TAT = Turn Around Time (interview_started_at to submitted_at)
  // SLA breach = TAT > 90 minutes
  const [[kpi]] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT
      COUNT(*)                                                              AS total,
      SUM(s.final_decision='Selected')                                      AS selected,
      SUM(s.final_decision='Rejected')                                      AS rejected,
      SUM(s.final_decision='Hold')                                          AS hold,
      SUM(s.final_decision='No Show')                                       AS no_show,
      SUM(s.final_decision='Client Round - Pending')                        AS client_pending,
      ROUND(SUM(s.final_decision='Selected')*100.0/NULLIF(COUNT(*),0),1)   AS conversion_rate,
      ROUND(AVG(TIMESTAMPDIFF(MINUTE,s.interview_started_at,s.submitted_at)),1) AS avg_tat_min,
      SUM(CASE WHEN TIMESTAMPDIFF(MINUTE,s.interview_started_at,s.submitted_at) > 90 THEN 1 ELSE 0 END) AS sla_breach_count
    ${base}`,
    params
  );

  // ── Hiring flow KPIs — compute from ats_interview_submission ─────────────────
  // This shows: Total Interviewed → Walkins (arrived) → Selected → Joined
  // We derive this from the same interview submission data for consistency
  const [[hiringFlowRow]] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT
      COUNT(*)                                              AS total_entries,
      COUNT(*)                                              AS walkin_count,
      SUM(s.final_decision='Selected')                      AS selected_count,
      0                                                     AS joined_count
     ${base}`,
    params
  );

  // Try to get joined count from ats_recruiter_hiring_activity if roster exists
  const [[rosterRow]] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT r.id AS roster_id, r.recruiter_code
     FROM ats_recruiter_roster r
     INNER JOIN employees e ON e.id = r.employee_id
     WHERE e.user_id = ? LIMIT 1`,
    [userId]
  );
  const rosterId = (rosterRow?.roster_id as string) ?? null;
  const recruiterCode = (rosterRow?.recruiter_code as string) ?? null;

  let joinedCount = 0;
  if (rosterId) {
    const [[joinedRow]] = await db.execute<import("mysql2").RowDataPacket[]>(
      `SELECT SUM(h.joined_flag=1) AS joined_count
       FROM ats_recruiter_hiring_activity h
       WHERE h.recruiter_id = ?
         AND DATE(h.activity_date) >= ${dateStart}`,
      [rosterId]
    );
    joinedCount = Number(joinedRow?.joined_count) || 0;
  }

  const hiringFlow = {
    total_entries: Number(hiringFlowRow?.total_entries) || 0,
    walkin_count: Number(hiringFlowRow?.walkin_count) || 0,
    selected_count: Number(hiringFlowRow?.selected_count) || 0,
    joined_count: joinedCount,
  };

  // ── Stage funnel — derive stage from round results ─────────────────────────────
  // Stages: Arrival → HR Round → Skill Test → Ops Round → Client Round → Selection
  //
  // Logic to determine which stage a candidate was rejected/stopped at:
  // - No Show at Arrival: final_decision='No Show' AND round1_result IS NULL
  // - Rejected at HR Round: round1_result='Rejected'
  // - Rejected at Skill Test: round1='Selected' AND (skilltest='Rejected' OR skilltest='No Show')
  // - Rejected at Ops Round: round1='Selected' AND skilltest NOT rejected AND round2='Rejected'
  // - Rejected at Client Round: round1='Selected' AND round2='Selected' AND round3='Rejected'
  // - Selected: final_decision='Selected'

  const [stageRows] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT
      CASE
        WHEN final_decision = 'No Show' AND (round1_result IS NULL OR round1_result = '') THEN 'Arrival'
        WHEN round1_result = 'Rejected' THEN 'HR Round'
        WHEN round1_result = 'Selected' AND (skilltest_result = 'Rejected' OR skilltest_result = 'No Show') THEN 'Skill Test'
        WHEN round1_result = 'Selected' AND (skilltest_result IS NULL OR skilltest_result = '' OR skilltest_result = 'Selected') AND round2_result = 'Rejected' THEN 'Ops Round'
        WHEN round1_result = 'Selected' AND round2_result = 'Selected' AND round3_result = 'Rejected' THEN 'Client Round'
        WHEN final_decision = 'Selected' THEN 'Selection'
        WHEN final_decision = 'Hold' OR final_decision = 'Client Round - Pending' THEN 'Pending'
        ELSE 'Other'
      END AS effective_stage,
      final_decision,
      COUNT(*) AS cnt
     ${base}
     GROUP BY effective_stage, final_decision`,
    params
  );

  // Aggregate by stage
  const stageData: Record<string, { rejected: number; no_show: number; hold: number; pending: number; selected: number }> = {
    'Arrival': { rejected: 0, no_show: 0, hold: 0, pending: 0, selected: 0 },
    'HR Round': { rejected: 0, no_show: 0, hold: 0, pending: 0, selected: 0 },
    'Skill Test': { rejected: 0, no_show: 0, hold: 0, pending: 0, selected: 0 },
    'Ops Round': { rejected: 0, no_show: 0, hold: 0, pending: 0, selected: 0 },
    'Client Round': { rejected: 0, no_show: 0, hold: 0, pending: 0, selected: 0 },
    'Selection': { rejected: 0, no_show: 0, hold: 0, pending: 0, selected: 0 },
  };

  for (const row of stageRows) {
    const stage = row.effective_stage as string;
    const decision = row.final_decision as string;
    const cnt = Number(row.cnt) || 0;

    if (!stageData[stage]) continue;

    if (decision === 'Rejected') stageData[stage].rejected += cnt;
    else if (decision === 'No Show') stageData[stage].no_show += cnt;
    else if (decision === 'Hold') stageData[stage].hold += cnt;
    else if (decision === 'Client Round - Pending') stageData[stage].pending += cnt;
    else if (decision === 'Selected') stageData[stage].selected += cnt;
  }

  // Build funnel: calculate entered/passed for each stage
  const STAGES = ['Arrival', 'HR Round', 'Skill Test', 'Ops Round', 'Client Round', 'Selection'];
  const totalCount = Number(kpi?.total) || 0;

  // Calculate cumulative: entered at stage N = total - sum of all rejected/no_show at stages before N
  let cumulativeDropped = 0;
  const funnel = STAGES.map((stageName, idx) => {
    const data = stageData[stageName];
    const entered = totalCount - cumulativeDropped;
    const rejected = data.rejected;
    const no_show = data.no_show;
    const hold = data.hold;
    const pending = data.pending;
    const selected = data.selected;

    // Dropped at this stage = rejected + no_show at this stage
    const droppedHere = rejected + no_show;

    // Passed = entered - dropped at this stage (for final stage, passed = selected)
    const passed = idx === STAGES.length - 1 ? selected : (entered - droppedHere);

    // Pass rate
    const passRate = entered > 0 ? Math.round((passed / entered) * 1000) / 10 : 0;

    // Add to cumulative for next stage
    cumulativeDropped += droppedHere;

    return {
      stage: stageName,
      entered,
      passed,
      rejected,
      hold,
      no_show,
      pending,
      completed: passed + rejected + no_show,
      pass_rate: passRate,
    };
  }).filter(row => row.entered > 0); // skip stages no candidate ever reached

  // ── Daily trend (all days in period, filled) ───────────────────────────────
  const [trend] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT DATE(s.submitted_at) AS day,
            COUNT(*) AS total,
            SUM(s.final_decision='Selected') AS selected,
            SUM(s.final_decision='Rejected') AS rejected,
            SUM(s.final_decision='No Show')  AS no_show
     ${base}
     GROUP BY DATE(s.submitted_at)
     ORDER BY day ASC`,
    params
  );

  // ── Process breakdown ──────────────────────────────────────────────────────
  const [byProcess] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT COALESCE(s.interviewed_for_process,'Unknown') AS process,
            COUNT(*) AS total,
            SUM(s.final_decision='Selected') AS selected,
            ROUND(SUM(s.final_decision='Selected')*100.0/NULLIF(COUNT(*),0),1) AS rate
     ${base}
     GROUP BY s.interviewed_for_process
     ORDER BY total DESC LIMIT 10`,
    params
  );

  // ── VOC breakdown ──────────────────────────────────────────────────────────
  const [voc] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT voc_reason, COUNT(*) AS cnt FROM (
       SELECT s.round1_voc   AS voc_reason ${base} AND s.round1_voc   IS NOT NULL AND s.round1_voc   != ''
       UNION ALL
       SELECT s.round2_voc   AS voc_reason ${base} AND s.round2_voc   IS NOT NULL AND s.round2_voc   != ''
       UNION ALL
       SELECT s.round3_voc   AS voc_reason ${base} AND s.round3_voc   IS NOT NULL AND s.round3_voc   != ''
       UNION ALL
       SELECT s.skilltest_voc AS voc_reason ${base} AND s.skilltest_voc IS NOT NULL AND s.skilltest_voc != ''
     ) v GROUP BY voc_reason ORDER BY cnt DESC LIMIT 10`,
    [...params, ...params, ...params, ...params]
  );

  // ── Source breakdown ───────────────────────────────────────────────────────
  const [bySource] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(s.hiring_source_snapshot,''),'Direct/Walk-in') AS source,
            COUNT(*) AS total,
            SUM(s.final_decision='Selected') AS selected
     ${base}
     GROUP BY source
     ORDER BY total DESC LIMIT 8`,
    params
  );

  // ── Recruiter profile ──────────────────────────────────────────────────────
  const profile = await resolveRecruiterForActor(userId);
  void recruiterCode;

  return res.json({
    success: true,
    period,
    profile: profile ?? null,
    data: { kpi, hiringFlow, funnel, trend, byProcess, voc, bySource },
  });
}));

// GET /api/ats/recruiter/other-pending — candidates in same branch assigned to absent recruiters
atsRouter.get("/recruiter/other-pending", requireRole("admin", "hr", "super_admin", "recruiter"), h(async (req: AuthenticatedRequest, res: Response) => {
  const profile = await resolveRecruiterForActor(req.authUser!.id);
  if (!profile) {
    return res.status(403).json({ success: false, message: "No recruiter profile linked to this account" });
  }
  if (!profile.branch) {
    return res.json({ success: true, data: [] });
  }
  const data = await getOtherRecruitersPendingCandidates(profile.name, profile.branch);
  return res.json({ success: true, data, recruiter: profile });
}));

// GET /api/ats/recruiter-roster/active — list of active recruiters for reassignment dropdown
// Only returns recruiters whose linked employee is still active
atsRouter.get("/recruiter-roster/active", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT r.id, r.name, r.recruiter_code, r.branch, r.email, r.employee_id
     FROM ats_recruiter_roster r
     LEFT JOIN employees e ON e.id = r.employee_id
     WHERE r.active_status = 1
       AND (r.employee_id IS NULL OR (e.active_status = 1 AND LOWER(e.employment_status) = 'active'))
     ORDER BY r.name ASC`,
    []
  );
  return res.json({ success: true, data: rows });
}));

// PATCH /api/ats/recruiter-roster/:id/deactivate — remove a recruiter from the active roster
atsRouter.patch("/recruiter-roster/:id/deactivate", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { db } = await import("../../db/mysql.js");
  const [result] = await db.execute<import("mysql2").ResultSetHeader>(
    `UPDATE ats_recruiter_roster SET active_status = 0 WHERE id = ?`,
    [req.params.id]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: "Recruiter roster entry not found" });
  }
  return res.json({ success: true, message: "Recruiter deactivated from roster" });
}));

// PATCH /api/ats/candidates/:id/reassign — HR/Admin formal reassignment with audit
atsRouter.patch("/candidates/:id/reassign", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  // Defence in depth, as with /convert: every role admitted here is wide today, so this
  // guard is currently a no-op. It exists so the route cannot become scoped-role-reachable
  // without the candidate check coming with it.
  const { assertCandidateInScope } = await import("./candidate-access.js");
  if (!(await assertCandidateInScope(req.authUser!.id, req.params.id, res))) return;

  const { newRecruiterId, reason } = req.body;
  if (!newRecruiterId || typeof newRecruiterId !== "string") {
    return res.status(400).json({ success: false, message: "newRecruiterId is required" });
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return res.status(400).json({ success: false, message: "reason is required" });
  }
  const actorEmail = req.authUser!.email ?? req.authUser!.id;
  await reassignCandidate(req.params.id, newRecruiterId, reason.trim(), actorEmail);
  return res.json({ success: true, message: "Candidate reassigned successfully" });
}));

// Joining Documents Tracker routes
atsRouter.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);

// Historical data bulk import
atsRouter.use('/bulk-import', bulkImportRouter);

// GET /api/ats/my-onboarding-status — employee's own onboarding progress (stub for dashboard)
atsRouter.get("/my-onboarding-status", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const { getEmployeeForUser } = await import("../../shared/accessGuard.js");
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) {
    return res.json({ success: true, data: { status: "not_applicable" }, generatedAt: new Date().toISOString() });
  }

  const { db } = await import("../../db/mysql.js");
  // `ats_onboarding` does not exist and never has. The query threw on every
  // call, the .catch() turned that into "no rows", and the branch below reads
  // no rows as "already onboarded" — so this endpoint told every employee they
  // were 100% complete, four of four steps done, regardless of the truth. It
  // also logged an ER_NO_SUCH_TABLE on each request.
  //
  // The real milestones live across the bridge, the onboarding profile and the
  // BGV report, so read those. Response shape is unchanged.
  const [rows] = await db.execute<import("mysql2").RowDataPacket[]>(
    `SELECT b.status              AS bridge_status,
            b.joining_date,
            b.converted_at,
            b.joining_document_status,
            p.profile_status,
            r.overall_status      AS bgv_status,
            EXISTS(SELECT 1 FROM ats_employment_offer o
                    WHERE o.candidate_id = b.candidate_id) AS has_offer
       FROM ats_onboarding_bridge b
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = b.candidate_id
       LEFT JOIN candidate_bgv_report r        ON r.candidate_id = b.candidate_id
      WHERE b.employee_id = ?
      LIMIT 1`,
    [emp.id]
  ).catch(() => [[]] as any);

  const record = (rows as any[])[0];
  if (!record) {
    // No onboarding record = already onboarded, return completed status with steps
    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      data: {
        status: "completed",
        stage: "Joining Completion",
        percentComplete: 100,
        completedSteps: 4,
        totalSteps: 4,
        offer_accepted: true,
        documents_submitted: true,
        bgv_cleared: true,
        joining_date: (emp as any).date_of_joining ?? null,
      }
    });
  }

  const offerAccepted = Boolean(record.has_offer);
  const documentsSubmitted = String(record.profile_status ?? "") === "submitted"
    || String(record.joining_document_status ?? "") === "completed";
  // Only 'clear' counts. 'pending' and 'refer' are explicitly not cleared —
  // see migration 1070, where six reports were reset off a fabricated 'clear'.
  const bgvCleared = String(record.bgv_status ?? "") === "clear";

  return res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    data: {
      status: record.converted_at ? "completed" : String(record.bridge_status ?? "in_progress"),
      stage: "Joining Completion",
      percentComplete: bgvCleared ? 100 : documentsSubmitted ? 75 : offerAccepted ? 50 : 25,
      completedSteps: [offerAccepted, documentsSubmitted, bgvCleared].filter(Boolean).length + 1,
      totalSteps: 4,
      offer_accepted: offerAccepted,
      documents_submitted: documentsSubmitted,
      bgv_cleared: bgvCleared,
      joining_date: record.joining_date
    }
  });
}));

// ── Trigger Daily Hiring Report ──────────────────────────────────────────────

atsRouter.post("/trigger-daily-report", requireRole("admin", "hr_admin", "super_admin"), h(async (req, res) => {
  const { date, email, preview } = req.body;

  // Import the report function
  const { runDailyHiringReport } = await import("./ats-reminders.cron.js");

  try {
    // If preview mode, just return the data
    if (preview) {
      const result = await runDailyHiringReport(date || '2026-08-24', 'preview');
      return res.json({
        success: true,
        preview: true,
        data: result,
        message: "Preview generated. Check 'data' field for report content."
      });
    }

    // Otherwise send the email
    const result = await runDailyHiringReport(
      date || '2026-08-24',  // Default to yesterday
      email || 'shivam.giri@teammas.in'
    );

    return res.json({
      success: result.success,
      messageId: result.messageId,
      recipients: result.recipients || email,
      stats: result.stats,
      error: result.error,
      message: result.success ? "Daily report email sent successfully" : "Failed to send email"
    });
  } catch (error) {
    console.error("[trigger-daily-report] Error:", error);
    return res.status(500).json({
      success: false,
      error: String(error),
      message: "Failed to generate report"
    });
  }
}));

// ── PUBLIC TEST ROUTE - REMOVE AFTER TESTING ────────────────────────────────

export const atsPublicTestRouter = Router();

atsPublicTestRouter.post("/test-daily-report", async (req, res) => {
  const { date, email, preview } = req.body;

  try {
    const { runDailyHiringReport } = await import("./ats-reminders.cron.js");

    if (preview) {
      const result = await runDailyHiringReport(date || '2026-08-24', 'preview');
      return res.json({
        success: true,
        preview: true,
        data: result,
        message: "Preview generated successfully"
      });
    }

    const result = await runDailyHiringReport(
      date || '2026-08-24',
      email || 'shivam.giri@teammas.in'
    );

    return res.json({
      success: result.success,
      messageId: result.messageId,
      recipients: result.recipients || email,
      stats: result.stats,
      error: result.error,
      message: result.success ? "Daily report email sent" : "Failed to send"
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || String(error),
      message: "Failed to generate report"
    });
  }
});

export default atsRouter;
export { atsPublicTestRouter };
