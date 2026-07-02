import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { exitService } from "./exit.service.js";
import {
  createExitRequestSchema,
  listExitRequestsSchema,
  updateExitStatusSchema,
} from "./exit.validation.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";

export const exitController = {
  async listExitRequests(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser!.id;
    const isAdminHr = await hasRole(userId, "admin", "hr");
    const isFinancePayroll = await hasRole(userId, "finance", "payroll");
    const isManager = await hasRole(userId, "manager");
    const baseFilters = listExitRequestsSchema.parse(req.query);

    if (!isAdminHr && !isFinancePayroll) {
      const emp = await getEmployeeForUser(userId);
      if (!emp) return res.status(403).json({ success: false, message: "Forbidden: no employee record linked to your account" });
      if (isManager) {
        baseFilters.managerEmployeeId = emp.id;
      } else {
        baseFilters.employeeId = emp.id;
      }
    }

    const result = await exitService.listExitRequests(baseFilters);
    return res.json({ success: true, ...result });
  },

  async getExitRequest(req: AuthenticatedRequest, res: Response) {
    const data = await exitService.getExitRequest(req.params.id);
    const resolvedEmployeeId = (req as any).resolvedEmployeeId;
    if (resolvedEmployeeId && (data as any).employee_id !== resolvedEmployeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    return res.json({ success: true, data });
  },

  async createExitRequest(req: AuthenticatedRequest, res: Response) {
    const body = {
      ...req.body,
      exitDate: req.body?.exitDate ?? req.body?.lastWorkingDayProposed,
      reason: req.body?.reason ?? req.body?.resignationReason,
    };
    const input = createExitRequestSchema.parse(body);
    const data = await exitService.createExitRequest(
      {
        employeeId: input.employeeId!,
        exitDate: input.exitDate!,
        exitType: input.exitType,
        exitSubType: input.exitSubType,
        exitReasonCategory: input.exitReasonCategory,
        reason: input.reason,
        noticePeriodDays: input.noticePeriodDays,
      },
      req.authUser!.id
    );
    return res.status(201).json({ success: true, data, message: "Exit request submitted" });
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