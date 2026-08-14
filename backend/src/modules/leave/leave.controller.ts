import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { leaveService } from "./leave.service.js";
import {
  createHolidaySchema,
  createLeaveTypeSchema,
  leaveRequestFiltersSchema,
  leaveRequestSchema,
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
    const data = await leaveService.submitRequest(input, req.authUser!.id);
    return res.status(201).json({ success: true, data, message: "Leave request submitted" });
  },

  async listRequests(req: AuthenticatedRequest, res: Response) {
    const filters = leaveRequestFiltersSchema.parse(req.query);
    // leaveService.listRequests only accepts filters; scopeFilter not yet supported in service
    const result = await leaveService.listRequests(filters);
    return res.json({ success: true, ...result });
  },

  // reviewRequest (leave approve/reject) removed here (delta-audit 2026-08-14, Stage 7,
  // item 4) — orphaned since leave.routes.ts's GET /requests and
  // PATCH /requests/:id/review were removed in the 2026-08-13 audit (see that file's own
  // comment): both were shadowed dead code behind leaveSecureRouter, mounted first at
  // /api/leave, and had no row-scope check. The live equivalent is
  // leaveSecureRouter's PATCH /requests/:id/review (leave.secure.routes.ts), which calls
  // leaveService.reviewRequest directly with a real canReviewLeave scope check. No route
  // called this method any more; confirmed zero references repo-wide before removing.

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
