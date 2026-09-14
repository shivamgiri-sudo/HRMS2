import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { wfmService } from "./wfm.service.js";
import {
  attendanceSessionFiltersSchema,
  breakSchema,
  clockInSchema,
  clockOutSchema,
  createShiftSchema,
  regularizationSchema,
  reviewRegularizationSchema,
  updateShiftSchema,
} from "./wfm.validation.js";

export const wfmController = {
  async listShifts(req: AuthenticatedRequest, res: Response) {
    const { activeStatus } = req.query as { activeStatus?: string };
    const filters =
      activeStatus === "active" || activeStatus === "inactive"
        ? { activeStatus: activeStatus as "active" | "inactive" | "all" }
        : undefined;
    const data = await wfmService.listShifts(filters);
    return res.json({ success: true, data });
  },

  async getShift(req: AuthenticatedRequest, res: Response) {
    const data = await wfmService.getShift(req.params.id);
    return res.json({ success: true, data });
  },

  async createShift(req: AuthenticatedRequest, res: Response) {
    const input = createShiftSchema.parse(req.body);
    const data = await wfmService.createShift(input, req.authUser!.id);
    return res.status(201).json({ success: true, data, message: "Shift created" });
  },

  async updateShift(req: AuthenticatedRequest, res: Response) {
    const input = updateShiftSchema.parse(req.body);
    const data = await wfmService.updateShift(req.params.id, input, req.authUser!.id);
    return res.json({ success: true, data, message: "Shift updated" });
  },

  async clockIn(req: AuthenticatedRequest, res: Response) {
    const input = clockInSchema.parse(req.body);
    // Derive employeeId from authenticated user (security: prevent spoofing)
    const { getEmployeeForUser } = await import("../../shared/accessGuard.js");
    const employee = await getEmployeeForUser(req.authUser!.id);
    if (!employee) {
      return res.status(403).json({ success: false, message: "No employee record for authenticated user" });
    }
    const data = await wfmService.clockIn({ ...input, employeeId: employee.id }, req.authUser!.id);
    return res.status(201).json({ success: true, data, message: "Clocked in" });
  },

  async clockOut(req: AuthenticatedRequest, res: Response) {
    const input = clockOutSchema.parse(req.body);
    const data = await wfmService.clockOut(input.sessionId, req.authUser!.id);
    return res.json({ success: true, data, message: "Clocked out" });
  },

  async listSessions(req: AuthenticatedRequest, res: Response) {
    const filters = attendanceSessionFiltersSchema.parse(req.query);
    const result = await wfmService.listSessions(filters);
    return res.json({ success: true, ...result });
  },

  async logBreak(req: AuthenticatedRequest, res: Response) {
    const input = breakSchema.parse(req.body);
    await wfmService.logBreak(input, req.authUser!.id);
    return res.status(201).json({ success: true, message: "Break logged" });
  },

  async submitRegularization(req: AuthenticatedRequest, res: Response) {
    const input = regularizationSchema.parse(req.body);
    // Derive employeeId from authenticated user (security: prevent spoofing)
    const { getEmployeeForUser } = await import("../../shared/accessGuard.js");
    const employee = await getEmployeeForUser(req.authUser!.id);
    if (!employee) {
      return res.status(403).json({ success: false, message: "No employee record for authenticated user" });
    }
    const data = await wfmService.submitRegularization({ ...input, employeeId: employee.id }, req.authUser!.id);
    return res.status(201).json({ success: true, data, message: "Regularization submitted" });
  },

  async listRegularizations(req: AuthenticatedRequest, res: Response) {
    const { employeeId, status } = req.query as { employeeId?: string; status?: string };
    const data = await wfmService.listRegularizations({ employeeId, status });
    return res.json({ success: true, data });
  },

  async reviewRegularization(req: AuthenticatedRequest, res: Response) {
    const input = reviewRegularizationSchema.parse(req.body);
    const data = await wfmService.reviewRegularization(req.params.id, input, req.authUser!.id);
    return res.json({ success: true, data, message: `Regularization ${input.status}` });
  },
};
