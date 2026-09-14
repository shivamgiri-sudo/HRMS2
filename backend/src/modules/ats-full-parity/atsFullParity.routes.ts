import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { env } from "../../config/env.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { atsFullParityService as svc } from "./atsFullParity.service.js";
import { submitInterviewUpdate, resolveRecruiterForActor } from "./recruiterInterview.service.js";
// analytics-simple.service.ts is no longer imported: the six /analytics/* routes that used it
// were removed (see below). The file is left in place rather than deleted because
// atsFullParity.service.ts's webData() — which DOES have a consumer — shares its shape, and
// removing a service is a wider change than removing unreachable routes. It now has no
// importer, so nothing runs it.
import type { RowDataPacket } from "mysql2";

export const atsFullParityRouter = Router();

interface RecruiterLookupRow extends RowDataPacket {
  id: string;
  name: string;
  recruiter_code: string;
  email?: string | null;
  branch?: string | null;
  employee_id?: string | null;
}

type AsyncHandler = (req: AuthenticatedRequest | Request, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest | Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

/**
 * requireFormApiKey — guards the Google App Script / webhook form endpoints.
 * Caller must supply X-ATS-Api-Key header matching ATS_FORM_API_KEY env var.
 * In non-production, if the secret is not configured, the check is skipped with a warning.
 */
function requireFormApiKey(req: Request, res: Response, next: NextFunction): void {
  const secret = env.ATS_FORM_API_KEY;
  if (!secret) {
    if (env.NODE_ENV === "production") {
      res.status(503).json({ success: false, message: "Form endpoint not configured" });
      return;
    }
    console.warn("[ATS-FORM] ATS_FORM_API_KEY not set — skipping key check in non-production");
    next();
    return;
  }
  const provided = String(req.headers["x-ats-api-key"] ?? "");
  if (!provided) {
    res.status(401).json({ success: false, message: "Missing X-ATS-Api-Key header" });
    return;
  }
  let match = false;
  try {
    match = provided.length === secret.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    match = false;
  }
  if (!match) {
    res.status(401).json({ success: false, message: "Invalid API key" });
    return;
  }
  next();
}

// Form webhook endpoints — require X-ATS-Api-Key (set on Google App Script trigger).
atsFullParityRouter.post("/intake", requireFormApiKey, h(async (req, res) => {
  const data = await svc.createIntake(req.body, "PUBLIC_FORM");
  res.status(201).json({ success: true, data, message: "Candidate intake captured" });
}));

atsFullParityRouter.post("/candidate-confirmation", requireFormApiKey, h(async (req, res) => {
  const data = await svc.submitConfirmation(req.body);
  res.status(201).json({ success: true, data });
}));

atsFullParityRouter.post("/bgv", requireFormApiKey, h(async (req, res) => {
  const data = await svc.submitBgv(req.body);
  res.status(201).json({ success: true, data });
}));

atsFullParityRouter.post("/doc-upload-response", requireFormApiKey, h(async (req, res) => {
  const data = await svc.submitDocUpload(req.body);
  res.status(201).json({ success: true, data });
}));

atsFullParityRouter.post("/recruiter-devices", requireFormApiKey, h(async (req, res) => {
  const data = await svc.registerDevice(req.body);
  res.status(201).json({ success: true, data });
}));

// Protected command center endpoints.
atsFullParityRouter.use(requireAuth);

atsFullParityRouter.get("/web-data", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req: AuthenticatedRequest, res) => {
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const bypassScope = isSuperAdmin || role === "hr" || role === "ceo";
  const data = await svc.webData({ ...(req.query as Record<string, unknown>), actorId: req.authUser?.id, bypassScope });
  res.json(data);
}));

/**
 * The ATS Command Center's data call.
 *
 * Same filters, same roles and the same scope resolution as /web-data — it is the payload
 * that differs. /web-data returns every candidate row in full because /submissions and the
 * daily report are built on it; this returns the aggregates plus only the rows the tabs
 * render. See commandCenterData() for the measurements.
 */
atsFullParityRouter.get("/command-center", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req: AuthenticatedRequest, res) => {
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const bypassScope = isSuperAdmin || role === "hr" || role === "ceo";
  const data = await svc.commandCenterData({ ...(req.query as Record<string, unknown>), actorId: req.authUser?.id, bypassScope });
  res.json(data);
}));

atsFullParityRouter.get("/queue", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req: AuthenticatedRequest, res) => {
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const bypassScope = isSuperAdmin || role === "hr" || role === "ceo";
  const data = await svc.webData({ period: "ALL", actorId: req.authUser?.id, bypassScope });
  res.json({ success: true, data: data.queueRows });
}));

/**
 * Candidate submissions for a date range.
 *
 * UnifiedPerformanceCommandCenter has called this since it was written, and it did not exist:
 * the page counts submissions by final_decision to produce its "Selected" and "ATS client
 * pending" figures, and its safe() wrapper turned the failure into an empty array, so both
 * tiles read zero and the page's own "sources unavailable" banner stayed up permanently.
 *
 * candidateRows is the right dataset. /queue is NOT — it filters to open candidates and
 * explicitly drops _selected and _rejected, so a "Selected" count taken from it would be
 * permanently zero, which is worse than the honest failure it replaced.
 *
 * from/to are mapped onto fromDate/toDate deliberately. webData pushes those into SQL; the
 * page's own query-string names are `from` and `to`, and passing them through unmapped would
 * be silently ignored — the page would then show ALL-TIME counts under a date-range heading.
 * period is pinned to "ALL" so the in-memory filter cannot narrow the SQL range further.
 */
atsFullParityRouter.get("/submissions", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req: AuthenticatedRequest, res) => {
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const bypassScope = isSuperAdmin || role === "hr" || role === "ceo";
  const data = await svc.webData({
    fromDate: req.query.from ? String(req.query.from) : undefined,
    toDate: req.query.to ? String(req.query.to) : undefined,
    period: "ALL",
    actorId: req.authUser?.id,
    bypassScope,
  });
  res.json({ success: true, data: data.candidateRows });
}));

atsFullParityRouter.get("/journey", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req: AuthenticatedRequest, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) return res.status(400).json({ success: false, message: "query required" });
  const data = await svc.candidateJourney(query);
  if (!data) return res.status(404).json({ success: false, message: "Candidate not found" });
  // Scope check: admin/hr/ceo may view any candidate; all other roles require branch/process match
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const isPrivileged = isSuperAdmin || role === "hr" || role === "ceo";
  if (!isPrivileged) {
    const candidate = data.candidate as Record<string, unknown>;
    const recruiterProfile = await resolveRecruiterForActor(req.authUser!.id);
    const assignedRecruiterIds = [
      candidate.recruiter_id,
      candidate.recruiter_assigned_id,
      candidate.assigned_recruiter_id,
    ].filter(Boolean).map(String);
    const assignedByRecruiterId = recruiterProfile
      ? assignedRecruiterIds.includes(String(recruiterProfile.id))
      : false;
    const assignedByRecruiterName = recruiterProfile
      ? String(candidate.recruiter_assigned_name ?? candidate.recruiter_name ?? "").trim() === recruiterProfile.name
      : false;
    if (assignedByRecruiterId || assignedByRecruiterName) {
      return res.json({ success: true, data });
    }
    const allowed = await hasScopedAccess(
      req.authUser!.id,
      ["recruiter", "manager", "branch_head", "process_manager"],
      {
        branchId: typeof candidate.applied_for_branch === "string" ? candidate.applied_for_branch : null,
        processId: typeof candidate.applied_for_process === "string" ? candidate.applied_for_process : null,
      },
      { allowAdminBypass: true },
    );
    if (!allowed) return res.status(403).json({ success: false, message: "Access denied: candidate outside your scope" });
  }
  res.json({ success: true, data });
}));

atsFullParityRouter.post("/recruiter-submission", requireRole("admin", "hr", "recruiter", "manager"), h(async (req: AuthenticatedRequest, res) => {
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const isPrivileged = isSuperAdmin || role === "hr";
  const bodyCode = String(req.body?.recruiterCode ?? "").trim();

  let recruiterProfile: import("./recruiterInterview.service.js").RecruiterProfile;

  if (isPrivileged && bodyCode) {
    // Admin/HR may submit on behalf of any active recruiter
    const { db: _db } = await import("../../db/mysql.js");
    const [recRows] = await _db.execute<RecruiterLookupRow[]>(
      `SELECT id, name, recruiter_code, email, branch, employee_id FROM ats_recruiter_roster WHERE recruiter_code = ? AND active_status = 1 LIMIT 1`,
      [bodyCode]
    );
    if (!recRows[0]) return res.status(403).json({ success: false, message: "Recruiter not found or inactive" });
    recruiterProfile = {
      id: recRows[0].id,
      name: recRows[0].name,
      recruiterCode: recRows[0].recruiter_code,
      branch: recRows[0].branch ?? "",
      email: recRows[0].email ?? null,
      employeeId: recRows[0].employee_id ?? null,
    };
  } else {
    // Derive recruiter identity from JWT — prevents impersonation
    const resolved = await resolveRecruiterForActor(req.authUser!.id);
    if (!resolved) {
      return res.status(403).json({ success: false, message: "No recruiter profile linked to this account" });
    }
    // If the caller also supplied a recruiterCode in the body, verify it matches their linked profile
    if (bodyCode && bodyCode !== resolved.recruiterCode) {
      return res.status(403).json({ success: false, message: "recruiterCode in body does not match your linked recruiter profile" });
    }
    recruiterProfile = resolved;
  }

  const result = await submitInterviewUpdate(req.body, req.authUser?.id, recruiterProfile);
  res.json({ success: true, data: result.submission, action: result.action, message: `Submission ${result.action} successfully` });
}));

atsFullParityRouter.post("/jobs/sla-check", requireRole("admin", "hr"), h(async (_req, res) => {
  const data = await svc.checkSlaBreaches();
  res.json({ success: true, data });
}));

atsFullParityRouter.post("/jobs/recruiters/reset-load", requireRole("admin", "hr"), h(async (_req, res) => {
  const data = await svc.resetRecruiterDailyLoad();
  res.json({ success: true, data });
}));

atsFullParityRouter.post("/jobs/repair", requireRole("admin", "hr"), h(async (req, res) => {
  const limit = req.body?.limit ? Number(req.body.limit) : 200;
  const data = await svc.repairBatch(limit);
  res.json({ success: true, data });
}));

atsFullParityRouter.get("/daily-report/snapshot", requireRole("admin", "hr", "branch_head", "process_manager", "ceo"), h(async (req: AuthenticatedRequest, res) => {
  const mode = req.query.mode === "send" ? "send" : "preview";
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const actorId = (isSuperAdmin || role === "hr" || role === "ceo") ? undefined : req.authUser?.id;
  const data = await svc.dailyReportSnapshot(mode, actorId);
  res.json({ success: true, data });
}));

atsFullParityRouter.post("/daily-report/send", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res) => {
  // admin/hr always bypass scope — full cross-branch report
  const data = await svc.dailyReportSnapshot("send");
  res.json({ success: true, data });
}));

atsFullParityRouter.get("/health", requireRole("admin", "hr", "ceo"), h(async (_req, res) => {
  const data = await svc.healthCheck();
  res.json({ success: true, data });
}));

/**
 * The six /analytics/* endpoints that stood here were removed.
 *
 * They served hiring funnel, trends, recruiter performance, sources, rejections and queue
 * metrics from analytics-simple.service.ts, and carried three defects at once: no legacy
 * exclusion, the LIMIT-5000 truncation, and — unlike /web-data on the same service — no
 * actor row scope. Each handler passed only req.query, so filters.actorId was undefined and
 * buildScopeWhereClause never fired. They admitted branch_head and process_manager, so a
 * branch-scoped user would have received org-wide recruitment analytics.
 *
 * The only reason that was not already a live cross-branch leak is that nothing called them:
 * no frontend file references /ats-full-parity/analytics anywhere. The command center reads
 * /web-data, which scopes correctly and is now also legacy-excluded.
 *
 * Deleted rather than repaired because keeping them means maintaining a second analytics path
 * that has to stay correct forever, in a module that already has four rival funnel
 * implementations. /web-data is the one with a consumer.
 */

