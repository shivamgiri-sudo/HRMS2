import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { leaveService } from "./leave.service.js";
import {
  createHolidaySchema,
  createLeaveTypeSchema,
  leaveRequestFiltersSchema,
  leaveRequestSchema,
  reviewLeaveSchema,
} from "./leave.validation.js";

export const leaveController = {
  async listLeaveTypes(_req: AuthenticatedRequest, res: Response) {
    const data = await leaveService.listLeaveTypes();
    return res.json({ success: true, data });
  },

  async createLeaveType(req: AuthenticatedRequest, res: Response) {
    const input = createLeaveTypeSchema.parse(req.body);
    const data = await leaveService.createLeaveType(input);
    return res.status(201).json({ success: true, data, message: "Leave type created" });
  },

  async submitRequest(req: AuthenticatedRequest, res: Response) {
    const input = leaveRequestSchema.parse(req.body);
    const data = await leaveService.submitRequest(input);
    return res.status(201).json({ success: true, data, message: "Leave request submitted" });
  },

  async listRequests(req: AuthenticatedRequest, res: Response) {
    const filters = leaveRequestFiltersSchema.parse(req.query);
    const scopeFilter = (req as any).scopeFilter as { sql: string; params: unknown[] } | undefined;
    const result = await leaveService.listRequests(filters, scopeFilter);
    return res.json({ success: true, ...result });
  },

  async reviewRequest(req: AuthenticatedRequest, res: Response) {
    const input = reviewLeaveSchema.parse(req.body);
    const data = await leaveService.reviewRequest(req.params.id, input, req.authUser!.id);
    return res.json({ success: true, data, message: `Leave ${input.status}` });
  },

  async getBalance(req: AuthenticatedRequest, res: Response) {
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const data = await leaveService.getBalance(req.params.employeeId, year);
    return res.json({ success: true, data });
  },

  async listHolidays(req: AuthenticatedRequest, res: Response) {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const data = await leaveService.listHolidays(year);
    return res.json({ success: true, data });
  },

  async createHoliday(req: AuthenticatedRequest, res: Response) {
    const input = createHolidaySchema.parse(req.body);
    const data = await leaveService.createHoliday(input);
    return res.status(201).json({ success: true, data, message: "Holiday created" });
  },
};
