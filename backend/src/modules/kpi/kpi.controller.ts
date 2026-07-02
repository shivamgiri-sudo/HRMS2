import type { Request, Response } from "express";
import {
  addTemplateMetricSchema,
  assignTemplateSchema,
  bulkScoreSchema,
  createMetricSchema,
  createTemplateSchema,
  leaderboardFiltersSchema,
  metricsFiltersSchema,
  recordScoreSchema,
} from "./kpi.validation.js";
import { kpiService } from "./kpi.service.js";

export const kpiController = {
  async listMetrics(req: Request, res: Response) {
    const parsed = metricsFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json({ data: await kpiService.listMetrics(parsed.data) });
  },

  async createMetric(req: Request, res: Response) {
    const parsed = createMetricSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await kpiService.createMetric(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  async listTemplates(_req: Request, res: Response) {
    res.json({ data: await kpiService.listTemplates() });
  },

  async createTemplate(req: Request, res: Response) {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await kpiService.createTemplate(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  async listTemplateMetrics(req: Request, res: Response) {
    res.json({ data: await kpiService.listTemplateMetrics(req.params.id) });
  },

  async addTemplateMetric(req: Request, res: Response) {
    const parsed = addTemplateMetricSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await kpiService.addTemplateMetric(
      { ...parsed.data, templateId: req.params.id },
      (req as any).userId ?? "system"
    );
    res.status(201).json({ data });
  },

  async assignTemplate(req: Request, res: Response) {
    const parsed = assignTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await kpiService.assignTemplate(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  async getEmployeeTemplate(req: Request, res: Response) {
    const data = await kpiService.getEmployeeTemplate(req.params.employeeId);
    res.json({ data });
  },

  async recordScore(req: Request, res: Response) {
    const parsed = recordScoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await kpiService.recordScore(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  async bulkRecordScores(req: Request, res: Response) {
    const parsed = bulkScoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await kpiService.bulkRecordScores(parsed.data, (req as any).userId ?? "system");
    res.json({ data });
  },

  async getEmployeeSummary(req: Request, res: Response) {
    const { employeeId, templateId, period } = req.params;
    const data = await kpiService.getEmployeeSummary(employeeId, templateId, period);
    res.json({ data });
  },

  async getLeaderboard(req: Request, res: Response) {
    const parsed = leaderboardFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await kpiService.getLeaderboard(parsed.data);
    res.json({ data });
  },
};
