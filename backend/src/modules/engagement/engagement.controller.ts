import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import {
  awardBadge,
  getBadges,
  getEmployeeBadges,
} from "./badge.service.js";
import { getEmployeeEngagementSummary } from "./engagement.service.js";
import {
  addPoints,
  getEmployeeTier,
  getLeaderboard,
  getPointsHistory,
  getTiers,
} from "./gamification.service.js";
import {
  getMonthlyKudosLimit,
  listKudos,
  listKudosTemplates,
  sendKudos,
} from "./kudos.service.js";
import {
  calculateENPS,
  createSurvey,
  getPulseSummary,
  getSurvey,
  getSurveyResults,
  listPulseChecks,
  listSurveys,
  submitPulseCheck,
  submitSurveyResponse,
} from "./survey.service.js";
import {
  AddPointsSchema,
  AwardBadgeSchema,
  CreateSurveySchema,
  SendKudosSchema,
  SubmitPulseCheckSchema,
  SubmitSurveyResponseSchema,
} from "./engagement.validation.js";

async function requireEmployee(req: AuthenticatedRequest) {
  const employee = await getEmployeeForUser(req.authUser!.id);
  if (!employee) throw new Error("No employee profile mapped to this account");
  return employee;
}

function parseLimit(value: unknown, fallback = 50) {
  const limit = Number(value ?? fallback);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : fallback;
}

export const engagementController = {
  async getMySummary(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    return res.json({ success: true, data: await getEmployeeEngagementSummary(employee.id) });
  },

  async listBadges(req: AuthenticatedRequest, res: Response) {
    const category = req.query.category as "performance" | "activity" | "tenure" | "social" | undefined;
    return res.json({ success: true, data: await getBadges({ badge_category: category, is_active: true }) });
  },

  async getEmployeeBadges(req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getEmployeeBadges(req.params.employeeId) });
  },

  async awardBadge(req: AuthenticatedRequest, res: Response) {
    const parsed = AwardBadgeSchema.safeParse({
      employee_id: req.body.employeeId,
      badge_id: req.body.badgeId,
      reason: req.body.reason,
      awarded_by: req.authUser!.id,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    return res.status(201).json({ success: true, data: await awardBadge(parsed.data) });
  },

  async getPoints(req: AuthenticatedRequest, res: Response) {
    return res.json({
      success: true,
      data: await getPointsHistory(req.params.employeeId, undefined, 1, parseLimit(req.query.limit)),
    });
  },

  async adjustPoints(req: AuthenticatedRequest, res: Response) {
    const parsed = AddPointsSchema.safeParse({
      employee_id: req.body.employeeId,
      points_delta: req.body.points,
      transaction_type: "manual_adjustment",
      description: req.body.reason,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    return res.status(201).json({
      success: true,
      data: await addPoints(
        parsed.data.employee_id,
        parsed.data.points_delta,
        parsed.data.transaction_type,
        parsed.data.description
      ),
    });
  },

  async getLeaderboard(req: AuthenticatedRequest, res: Response) {
    const period = req.query.period === "month" || req.query.period === "quarter"
      ? req.query.period
      : "all-time";
    return res.json({ success: true, data: await getLeaderboard(period, parseLimit(req.query.limit, 10)) });
  },

  async listTiers(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getTiers(true) });
  },

  async getEmployeeTier(req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getEmployeeTier(req.params.employeeId) });
  },

  async listKudosTemplates(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await listKudosTemplates(true) });
  },

  async sendKudos(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const parsed = SendKudosSchema.safeParse({
      ...req.body,
      sender_id: employee.id,
      receiver_id: req.body.receiverId,
      kudos_template_id: req.body.templateId,
      custom_message: req.body.message,
      is_anonymous: req.body.isAnonymous,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    return res.status(201).json({ success: true, data: { id: await sendKudos(parsed.data) } });
  },

  async listKudos(req: AuthenticatedRequest, res: Response) {
    const filters = req.query.scope === "received"
      ? { receiver_id: req.params.employeeId }
      : req.query.scope === "given"
        ? { sender_id: req.params.employeeId }
        : {};
    return res.json({ success: true, data: await listKudos(filters, parseLimit(req.query.limit)) });
  },

  async getMyKudosLimit(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    return res.json({ success: true, data: await getMonthlyKudosLimit(employee.id) });
  },

  async listSurveys(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await listSurveys({ is_active: true }) });
  },

  async getSurvey(req: AuthenticatedRequest, res: Response) {
    const survey = await getSurvey(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });
    return res.json({ success: true, data: survey });
  },

  async createSurvey(req: AuthenticatedRequest, res: Response) {
    const parsed = CreateSurveySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    return res.status(201).json({
      success: true,
      data: { id: await createSurvey(parsed.data, req.authUser!.id) },
    });
  },

  async submitSurvey(req: AuthenticatedRequest, res: Response) {
    const survey = await getSurvey(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });
    const employee = survey.is_anonymous ? null : await requireEmployee(req);
    const parsed = SubmitSurveyResponseSchema.safeParse({
      survey_id: req.params.id,
      employee_id: employee?.id,
      responses: req.body.responses,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    await submitSurveyResponse(parsed.data);
    return res.status(201).json({ success: true });
  },

  async getSurveyResults(req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getSurveyResults(req.params.id) });
  },

  async getENPS(req: AuthenticatedRequest, res: Response) {
    return res.json({
      success: true,
      data: await calculateENPS(req.params.id, req.params.questionId),
    });
  },

  async submitPulse(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const parsed = SubmitPulseCheckSchema.safeParse({ ...req.body, employee_id: employee.id });
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    await submitPulseCheck(parsed.data);
    return res.status(201).json({ success: true });
  },

  async getMyPulseChecks(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    return res.json({ success: true, data: await listPulseChecks({ employee_id: employee.id }) });
  },

  async getPulseSummary(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getPulseSummary() });
  },
};

