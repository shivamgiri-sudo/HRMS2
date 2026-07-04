import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { env } from "../../config/env.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { atsFullParityService as svc } from "./atsFullParity.service.js";
import { submitInterviewUpdate, resolveRecruiterForActor } from "./recruiterInterview.service.js";
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

atsFullParityRouter.get("/queue", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req: AuthenticatedRequest, res) => {
  const { primaryRole: role, isSuperAdmin } = await getUserRoleContext(req.authUser?.id ?? "");
  const bypassScope = isSuperAdmin || role === "hr" || role === "ceo";
  const data = await svc.webData({ period: "ALL", actorId: req.authUser?.id, bypassScope });
  res.json({ success: true, data: data.queueRows });
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
