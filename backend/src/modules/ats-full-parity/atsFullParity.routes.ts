import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { atsFullParityService as svc } from "./atsFullParity.service.js";
import { submitInterviewUpdate } from "./recruiterInterview.service.js";

export const atsFullParityRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Public parity endpoints: equivalent to App Script candidate-facing forms.
atsFullParityRouter.post("/intake", h(async (req, res) => {
  const data = await svc.createIntake(req.body, "PUBLIC_FORM");
  res.status(201).json({ success: true, data, message: "Candidate intake captured" });
}));

atsFullParityRouter.post("/candidate-confirmation", h(async (req, res) => {
  const data = await svc.submitConfirmation(req.body);
  res.status(201).json({ success: true, data });
}));

atsFullParityRouter.post("/bgv", h(async (req, res) => {
  const data = await svc.submitBgv(req.body);
  res.status(201).json({ success: true, data });
}));

atsFullParityRouter.post("/doc-upload-response", h(async (req, res) => {
  const data = await svc.submitDocUpload(req.body);
  res.status(201).json({ success: true, data });
}));

atsFullParityRouter.post("/recruiter-devices", h(async (req, res) => {
  const data = await svc.registerDevice(req.body);
  res.status(201).json({ success: true, data });
}));

// Protected command center endpoints.
atsFullParityRouter.use(requireAuth);

atsFullParityRouter.get("/web-data", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req, res) => {
  const data = await svc.webData(req.query as any);
  res.json(data);
}));

atsFullParityRouter.get("/queue", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (_req, res) => {
  const data = await svc.webData({ period: "ALL" });
  res.json({ success: true, data: data.queueRows });
}));

atsFullParityRouter.get("/journey", requireRole("admin", "hr", "recruiter", "manager", "branch_head", "process_manager", "ceo"), h(async (req, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) return res.status(400).json({ success: false, message: "query required" });
  const data = await svc.candidateJourney(query);
  if (!data) return res.status(404).json({ success: false, message: "Candidate not found" });
  res.json({ success: true, data });
}));

atsFullParityRouter.post("/recruiter-submission", requireRole("admin", "hr", "recruiter", "manager"), h(async (req: any, res) => {
  // recruiterCode must be supplied in the body (obtained from POST /api/ats/recruiter/verify)
  const recruiterCode = String(req.body?.recruiterCode ?? "").trim();
  if (!recruiterCode) {
    return res.status(400).json({ success: false, message: "recruiterCode is required in the request body" });
  }
  // Resolve recruiter profile from DB (no PIN re-check here — JWT already validates user)
  const { db: _db } = await import("../../db/mysql.js");
  const [recRows] = await _db.execute(
    `SELECT id, name, recruiter_code, email, branch, employee_id FROM ats_recruiter_roster WHERE recruiter_code = ? AND active_status = 1 LIMIT 1`,
    [recruiterCode]
  ) as any;
  if (!recRows[0]) return res.status(403).json({ success: false, message: "Recruiter not found or inactive" });
  const recruiterProfile = {
    id: recRows[0].id,
    name: recRows[0].name,
    recruiterCode: recRows[0].recruiter_code,
    branch: recRows[0].branch ?? "",
    email: recRows[0].email ?? null,
    employeeId: recRows[0].employee_id ?? null,
  };
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

atsFullParityRouter.get("/daily-report/snapshot", requireRole("admin", "hr", "branch_head", "process_manager", "ceo"), h(async (req, res) => {
  const mode = req.query.mode === "send" ? "send" : "preview";
  const data = await svc.dailyReportSnapshot(mode);
  res.json({ success: true, data });
}));

atsFullParityRouter.post("/daily-report/send", requireRole("admin", "hr"), h(async (_req, res) => {
  const data = await svc.dailyReportSnapshot("send");
  res.json({ success: true, data });
}));

atsFullParityRouter.get("/health", requireRole("admin", "hr", "ceo"), h(async (_req, res) => {
  const data = await svc.healthCheck();
  res.json({ success: true, data });
}));
