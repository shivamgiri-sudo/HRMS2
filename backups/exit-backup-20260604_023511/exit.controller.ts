import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { exitService } from "./exit.service.js";
import {
  createExitRequestSchema,
  listExitRequestsSchema,
  updateExitStatusSchema,
} from "./exit.validation.js";

export const exitController = {
  async listExitRequests(req: AuthenticatedRequest, res: Response) {
    const filters = listExitRequestsSchema.parse(req.query);
    const result = await exitService.listExitRequests(filters);
    return res.json({ success: true, ...result });
  },

  async getExitRequest(req: AuthenticatedRequest, res: Response) {
    const data = await exitService.getExitRequest(req.params.id);
    return res.json({ success: true, data });
  },

  async createExitRequest(req: AuthenticatedRequest, res: Response) {
    const input = createExitRequestSchema.parse(req.body);
    const data = await exitService.createExitRequest(
      {
        employeeId: input.employeeId,
        exitDate: input.exitDate,
        exitType: input.exitType,
        reason: input.reason,
      },
      req.authUser!.id
    );
    return res.status(201).json({ success: true, data, message: "Exit request created" });
  },

  async updateExitStatus(req: AuthenticatedRequest, res: Response) {
    const input = updateExitStatusSchema.parse(req.body);
    const data = await exitService.updateExitStatus(
      req.params.id,
      input.status,
      input.remarks,
      req.authUser!.id
    );
    return res.json({ success: true, data, message: `Exit request status updated to ${input.status}` });
  },

  async getExitStats(_req: AuthenticatedRequest, res: Response) {
    const data = await exitService.getExitStats();
    return res.json({ success: true, data });
  },
};
