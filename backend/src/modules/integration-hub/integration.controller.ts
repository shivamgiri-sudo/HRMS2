import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { integrationService } from "./integration.service.js";
import {
  confirmFieldMapSchema,
  createIntegrationSchema,
  runFiltersSchema,
  updateIntegrationSchema,
  upsertScheduleSchema,
} from "./integration.validation.js";

export const integrationController = {
  async list(req: AuthenticatedRequest, res: Response) {
    const { activeStatus } = req.query as { activeStatus?: string };
    const filters =
      activeStatus === "active" || activeStatus === "inactive"
        ? { activeStatus: activeStatus as "active" | "inactive" | "all" }
        : undefined;
    const data = await integrationService.list(filters);
    return res.json({ success: true, data });
  },

  async getByKey(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.getByKey(req.params.key);
    return res.json({ success: true, data });
  },

  async create(req: AuthenticatedRequest, res: Response) {
    const input = createIntegrationSchema.parse(req.body);
    const data = await integrationService.create(input, req.authUser!.id);
    return res.status(201).json({ success: true, data, message: "Integration created" });
  },

  async update(req: AuthenticatedRequest, res: Response) {
    const input = updateIntegrationSchema.parse(req.body);
    const data = await integrationService.update(req.params.key, input, req.authUser!.id);
    return res.json({ success: true, data, message: "Integration updated" });
  },

  async listRuns(req: AuthenticatedRequest, res: Response) {
    const filters = runFiltersSchema.parse(req.query);
    const result = await integrationService.listRuns(filters);
    return res.json({ success: true, ...result });
  },

  async createRun(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.createRun(
      req.params.key,
      "manual",
      req.authUser!.id
    );
    return res.status(201).json({ success: true, data, message: "Run triggered" });
  },

  async listFieldMaps(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.listFieldMaps(req.params.key);
    return res.json({ success: true, data });
  },

  async confirmFieldMap(req: AuthenticatedRequest, res: Response) {
    const input = confirmFieldMapSchema.parse(req.body);
    const data = await integrationService.confirmFieldMap(input, req.authUser!.id);
    return res.json({ success: true, data, message: "Field mapping confirmed" });
  },

  async listSuggestions(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.listSuggestions(req.params.key);
    return res.json({ success: true, data });
  },

  async getSchedule(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.getSchedule(req.params.key);
    return res.json({ success: true, data });
  },

  async upsertSchedule(req: AuthenticatedRequest, res: Response) {
    const input = upsertScheduleSchema.parse(req.body);
    const data = await integrationService.upsertSchedule(req.params.key, input);
    return res.json({ success: true, data, message: "Schedule updated" });
  },
};
