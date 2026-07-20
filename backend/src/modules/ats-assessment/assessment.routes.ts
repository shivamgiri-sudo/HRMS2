import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { assessmentAdminPage } from "./assessment.admin.page.js";
import { candidateAssessmentPage } from "./assessment.page.js";
import { assessmentService } from "./assessment.service.js";

export const assessmentPublicRouter = Router();
export const assessmentProtectedRouter = Router();

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const h = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  void handler(req, res).catch(next);
};

const candidateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many assessment requests. Please wait briefly and try again.",
    code: "RATE_LIMITED",
  },
});

const lookupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many candidate lookup attempts. Ask the recruiter for assistance.",
    code: "LOOKUP_RATE_LIMITED",
  },
});

const tokenSchema = z.string().min(20).max(1000);
const uuidSchema = z.string().uuid();
const lookupSchema = z.object({
  queueToken: z.string().trim().min(1).max(100),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Valid registered mobile number required"),
}).strict();
const responseSchema = z.object({
  answer: z.unknown(),
  timeTakenSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
}).strict();
const integritySchema = z.object({
  eventType: z.string().trim().min(1).max(100),
  details: z.unknown().optional().default({}),
}).strict();
const typingSubmitSchema = z.object({
  typedText: z.string().max(20_000),
  backspaceCount: z.coerce.number().int().min(0).max(1_000_000).default(0),
  pasteAttempts: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();
const attemptsQuerySchema = z.object({
  status: z.string().trim().max(50).optional(),
  process: z.enum(["inbound", "outbound", "backoffice", "document", "email"]).optional(),
  role: z.enum(["executive", "team_leader", "quality_auditor"]).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});
const manualAssignSchema = z.object({
  templateId: uuidSchema,
  sendEmail: z.boolean().optional(),
}).strict();
const reviewSchema = z.object({
  scores: z.array(z.object({
    questionId: z.string().trim().min(1).max(120),
    marks: z.coerce.number().min(0).max(10_000),
    remarks: z.string().trim().max(2000).nullable().optional(),
  })).min(1).max(100),
  decisionOverride: z.enum(["pass", "fail"]).nullable().optional(),
  reviewRemarks: z.string().trim().max(2000).default(""),
}).strict();
const cancellationSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();
const activeSchema = z.object({ active: z.boolean() }).strict();
const mappingSchema = z.object({
  id: uuidSchema.optional(),
  mappingName: z.string().trim().min(2).max(255),
  branchName: z.string().trim().max(255).nullable().optional(),
  processMatch: z.string().trim().max(255).nullable().optional(),
  roleMatch: z.string().trim().max(255).nullable().optional(),
  experienceMatch: z.string().trim().max(100).nullable().optional(),
  vacancyId: z.string().trim().max(100).nullable().optional(),
  templateId: uuidSchema,
  priority: z.coerce.number().int().min(-10_000).max(10_000).optional(),
  mandatoryFlag: z.boolean().optional(),
  activeStatus: z.boolean().optional(),
}).strict();

function requestMeta(req: Request, actorType?: "candidate" | "system" | "recruiter" | "hr" | "admin") {
  const authenticated = req as AuthenticatedRequest;
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.get("user-agent") ?? null,
    actorType,
    actorId: authenticated.authUser?.id ?? null,
  };
}

function actorId(req: Request) {
  const id = (req as AuthenticatedRequest).authUser?.id;
  if (!id) throw Object.assign(new Error("Authenticated user is required"), { statusCode: 401, code: "AUTH_REQUIRED" });
  return id;
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: error.issues[0]?.message ?? "Invalid request",
      code: "VALIDATION_ERROR",
      issues: error.issues,
    });
  }
  const value = error as { statusCode?: number; code?: string; message?: string };
  const status = Number(value?.statusCode ?? 500);
  if (status >= 500) console.error("Assessment route error", error);
  return res.status(Number.isFinite(status) ? status : 500).json({
    success: false,
    message: value?.message ?? "Assessment request failed",
    code: value?.code ?? "ASSESSMENT_REQUEST_FAILED",
  });
}

function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
}

assessmentPublicRouter.use("/assessment", candidateLimiter);

assessmentPublicRouter.get("/assessment", (_req, res) => {
  noStore(res);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  );
  return res.type("html").send(candidateAssessmentPage());
});

// The shell contains no candidate or assessment data. Data APIs below remain
// protected by requireAuth and role checks after the existing ats-ext auth gate.
assessmentPublicRouter.get("/assessment-admin", (_req, res) => {
  noStore(res);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'",
  );
  return res.type("html").send(assessmentAdminPage());
});

assessmentPublicRouter.get("/assessment/health", (_req, res) => {
  return res.json({
    success: true,
    data: {
      status: assessmentService.isAssessmentEnabled() ? "enabled" : "disabled",
      oneAssessmentAttempt: true,
      maxTypingAttempts: 2,
      queueLifecycleIsolated: true,
    },
  });
});

assessmentPublicRouter.post("/assessment/lookup", lookupLimiter, h(async (req, res) => {
  try {
    const input = lookupSchema.parse(req.body);
    const data = await assessmentService.lookupOrAssignAssessment({
      ...input,
      meta: requestMeta(req, "candidate"),
    });
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.get("/assessment/session/:token", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const data = await assessmentService.getAssessmentSession(token);
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.post("/assessment/session/:token/start", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const data = await assessmentService.startAssessment(token, requestMeta(req, "candidate"));
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.put("/assessment/session/:token/responses/:questionId", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const questionId = z.string().trim().min(1).max(120).parse(req.params.questionId);
    const input = responseSchema.parse(req.body);
    const data = await assessmentService.saveResponse(token, questionId, input.answer, input.timeTakenSeconds);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.post("/assessment/session/:token/integrity", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const input = integritySchema.parse(req.body);
    const data = await assessmentService.recordIntegrityEvent(
      token,
      input.eventType,
      input.details,
      requestMeta(req, "candidate"),
    );
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.post("/assessment/session/:token/typing/start", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const data = await assessmentService.startTypingAttempt(token, requestMeta(req, "candidate"));
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.post("/assessment/session/:token/typing/:typingAttemptId/submit", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const typingAttemptId = uuidSchema.parse(req.params.typingAttemptId);
    const input = typingSubmitSchema.parse(req.body);
    const data = await assessmentService.submitTypingAttempt(
      token,
      typingAttemptId,
      input,
      requestMeta(req, "candidate"),
    );
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.post("/assessment/session/:token/submit", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const data = await assessmentService.submitAssessment(token, {}, requestMeta(req, "candidate"));
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.post("/assessment/session/:token/identity/otp", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const data = await assessmentService.issueIdentityOtp(token, requestMeta(req, "candidate"));
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.post("/assessment/session/:token/identity/verify", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const otp = z.string().trim().min(4).max(8).parse((req.body as { otp?: string }).otp);
    const data = await assessmentService.verifyIdentityOtp(token, otp, requestMeta(req, "candidate"));
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentPublicRouter.get("/assessment/session/:token/result", h(async (req, res) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const data = await assessmentService.getAssessmentResult(token);
    noStore(res);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

const readRoles = requireRole("admin", "super_admin", "hr", "recruitment_hr", "recruiter", "manager", "qa");
const reviewRoles = requireRole("admin", "super_admin", "hr", "recruitment_hr", "manager", "qa");
const configureRoles = requireRole("admin", "super_admin", "hr", "recruitment_hr");
const superAdminOnly = requireRole("super_admin");
const candidateSummaryRoles = requireRole("admin", "super_admin", "hr", "recruitment_hr", "recruiter", "manager", "qa", "operations_manager");

assessmentProtectedRouter.get("/assessment-admin/dashboard", readRoles, h(async (_req, res) => {
  try {
    return res.json({ success: true, data: await assessmentService.getAssessmentDashboard() });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.get("/assessment-admin/candidates/:candidateId/summary", candidateSummaryRoles, h(async (req, res) => {
  try {
    const candidateId = uuidSchema.parse(req.params.candidateId);
    return res.json({ success: true, data: await assessmentService.getCandidateAssessmentSummary(candidateId) });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.post("/assessment-admin/candidates/:candidateId/assign", readRoles, h(async (req, res) => {
  try {
    const candidateId = uuidSchema.parse(req.params.candidateId);
    const input = manualAssignSchema.parse(req.body);
    const userId = actorId(req);
    const data = await assessmentService.assignAssessmentManually({
      candidateId,
      templateId: input.templateId,
      actorId: userId,
      sendEmail: input.sendEmail,
      meta: requestMeta(req, "recruiter"),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.get("/assessment-admin/attempts", readRoles, h(async (req, res) => {
  try {
    const filters = attemptsQuerySchema.parse(req.query);
    return res.json({ success: true, data: await assessmentService.listAssessmentAttempts(filters) });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.get("/assessment-admin/attempts/:attemptId", readRoles, h(async (req, res) => {
  try {
    const attemptId = uuidSchema.parse(req.params.attemptId);
    return res.json({ success: true, data: await assessmentService.getAssessmentAttemptDetail(attemptId) });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.post("/assessment-admin/attempts/:attemptId/review", reviewRoles, h(async (req, res) => {
  try {
    const attemptId = uuidSchema.parse(req.params.attemptId);
    const input = reviewSchema.parse(req.body);
    const reviewerId = actorId(req);
    const data = await assessmentService.reviewAssessment({
      attemptId,
      reviewerId,
      scores: input.scores,
      decisionOverride: input.decisionOverride,
      reviewRemarks: input.reviewRemarks,
      meta: requestMeta(req, "hr"),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.post("/assessment-admin/attempts/:attemptId/cancel", configureRoles, h(async (req, res) => {
  try {
    const attemptId = uuidSchema.parse(req.params.attemptId);
    const input = cancellationSchema.parse(req.body);
    const data = await assessmentService.cancelUnstartedAssessment(
      attemptId,
      actorId(req),
      input.reason,
      requestMeta(req, "admin"),
    );
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.get("/assessment-admin/templates", readRoles, h(async (_req, res) => {
  try {
    return res.json({ success: true, data: await assessmentService.listTemplates() });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.post("/assessment-admin/templates/sync-defaults", configureRoles, h(async (_req, res) => {
  try {
    return res.json({ success: true, data: await assessmentService.syncDefaultTemplates() });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.patch("/assessment-admin/templates/:templateId/active", superAdminOnly, h(async (req, res) => {
  try {
    const templateId = uuidSchema.parse(req.params.templateId);
    const input = activeSchema.parse(req.body);
    const data = await assessmentService.setTemplateActive(
      templateId,
      input.active,
      actorId(req),
      requestMeta(req, "admin"),
    );
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.post("/assessment-admin/templates", configureRoles, h(async (req, res) => {
  try {
    const definition = req.body as Parameters<typeof assessmentService.createCustomTemplate>[0];
    const data = await assessmentService.createCustomTemplate(definition, actorId(req));
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.get("/assessment-admin/mappings", readRoles, h(async (_req, res) => {
  try {
    return res.json({ success: true, data: await assessmentService.listMappings() });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.post("/assessment-admin/mappings", configureRoles, h(async (req, res) => {
  try {
    const input = mappingSchema.parse(req.body);
    const data = await assessmentService.saveMapping(input, actorId(req));
    return res.status(input.id ? 200 : 201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}));

assessmentProtectedRouter.patch("/assessment-admin/mappings/:mappingId/active", configureRoles, h(async (req, res) => {
  try {
    const mappingId = uuidSchema.parse(req.params.mappingId);
    const input = activeSchema.parse(req.body);
    return res.json({
      success: true,
      data: await assessmentService.setMappingActive(mappingId, input.active),
    });
  } catch (error) {
    return sendError(res, error);
  }
}));
