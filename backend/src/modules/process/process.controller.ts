import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { processService } from "./process.service.js";
import {
  createProcessSchema,
  processFiltersSchema,
  updateProcessSchema,
  updateProcessStatusSchema
} from "./process.validation.js";

export const processController = {
  async list(req: AuthenticatedRequest, res: Response) {
    const filters = processFiltersSchema.parse(req.query);

    const data = await processService.list(filters);

    return res.json({
      success: true,
      data
    });
  },

  /**
   * Processes assigned to the CALLER.
   *
   * The identity comes from the verified token, never from the request. The frontend used to
   * send ?userId=..., and honouring that would let anyone read another user's process
   * assignments by changing a query string. The parameter is ignored on purpose; the caller
   * has been updated to stop sending it.
   */
  async listMyProcesses(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const data = await processService.listAssignedToUser(userId);

    return res.json({
      success: true,
      data
    });
  },

  async getById(req: AuthenticatedRequest, res: Response) {
    const data = await processService.getById(req.params.id);

    return res.json({
      success: true,
      data
    });
  },

  async getConfiguration(req: AuthenticatedRequest, res: Response) {
    const data = await processService.getConfiguration(req.params.id);
    return res.json({ success: true, data });
  },

  async saveConfiguration(req: AuthenticatedRequest, res: Response) {
    const values = req.body?.values;
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      return res.status(400).json({
        success: false,
        message: "values must be an object"
      });
    }
    const data = await processService.saveConfiguration(
      req.params.id,
      values,
      req.authUser!.id
    );
    return res.json({
      success: true,
      data,
      message: "Process configuration saved"
    });
  },

  async create(req: AuthenticatedRequest, res: Response) {
    const input = createProcessSchema.parse(req.body);

    const data = await processService.create(input, req.authUser!.id);

    return res.status(201).json({
      success: true,
      data,
      message: "Process created successfully"
    });
  },

  async update(req: AuthenticatedRequest, res: Response) {
    const input = updateProcessSchema.parse(req.body);

    const data = await processService.update(
      req.params.id,
      input,
      req.authUser!.id
    );

    return res.json({
      success: true,
      data,
      message: "Process updated successfully"
    });
  },

  async updateStatus(req: AuthenticatedRequest, res: Response) {
    const input = updateProcessStatusSchema.parse(req.body);

    const data = await processService.updateStatus(
      req.params.id,
      input.activeStatus,
      req.authUser!.id
    );

    return res.json({
      success: true,
      data,
      message: input.activeStatus
        ? "Process activated successfully"
        : "Process deactivated successfully"
    });
  }
};
