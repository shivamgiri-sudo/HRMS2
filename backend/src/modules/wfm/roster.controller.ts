import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { rosterService } from "./roster.service.js";
import { parseRosterCsv } from "./rosterCsvParser.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const createPlanSchema = z.object({
  planName: z.string().trim().min(1).max(255),
  processId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  fromDate: z.string().regex(DATE_RE, "fromDate must be YYYY-MM-DD"),
  toDate: z.string().regex(DATE_RE, "toDate must be YYYY-MM-DD"),
  requiredHeadcount: z.coerce.number().int().min(0).default(0),
});

const planFiltersSchema = z.object({
  processId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  planStatus: z.string().optional(),
  fromDate: z.string().regex(DATE_RE).optional(),
  toDate: z.string().regex(DATE_RE).optional(),
});

const assignSchema = z.object({
  employeeId: z.string().uuid(),
  rosterDate: z.string().regex(DATE_RE, "rosterDate must be YYYY-MM-DD"),
  shiftId: z.string().uuid().nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  shiftStartTime: z.string().regex(TIME_RE, "shift_start_time must be HH:MM").nullable().optional(),
  shiftEndTime: z.string().regex(TIME_RE, "shift_end_time must be HH:MM").nullable().optional(),
  branchName: z.string().trim().max(255).nullable().optional(),
  processName: z.string().trim().max(255).nullable().optional(),
  rosterStatus: z.string().max(50).default("Rostered"),
});

const assignFiltersSchema = z.object({
  planId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  fromDate: z.string().regex(DATE_RE).optional(),
  toDate: z.string().regex(DATE_RE).optional(),
  publishStatus: z.string().optional(),
  processName: z.string().optional(),
});

const actualAssignmentFiltersSchema = z.object({
  processId: z.string().uuid().optional(),
  fromDate: z.string().regex(DATE_RE).optional(),
  toDate: z.string().regex(DATE_RE).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(250),
});

export const rosterController = {
  async createPlan(req: AuthenticatedRequest, res: Response) {
    const input = createPlanSchema.parse(req.body);
    const data = await rosterService.createPlan(input, req.authUser!.id);
    return res.status(201).json({ success: true, data, message: "Roster plan created" });
  },

  async listPlans(req: AuthenticatedRequest, res: Response) {
    const filters = planFiltersSchema.parse(req.query);
    const data = await rosterService.listPlans(filters);
    return res.json({ success: true, data });
  },

  async publishPlan(req: AuthenticatedRequest, res: Response) {
    const data = await rosterService.publishPlan(req.params.id, req.authUser!.id);
    return res.json({ success: true, data, message: "Roster plan published" });
  },

  async assignEmployee(req: AuthenticatedRequest, res: Response) {
    const input = assignSchema.parse(req.body);
    const data = await rosterService.assignEmployee(
      {
        employeeId: input.employeeId,
        rosterDate: input.rosterDate,
        shiftId: input.shiftId,
        planId: input.planId,
        shiftStartTime: input.shiftStartTime,
        shiftEndTime: input.shiftEndTime,
        branchName: input.branchName,
        processName: input.processName,
        rosterStatus: input.rosterStatus,
      },
      req.authUser!.id
    );
    return res.status(201).json({ success: true, data, message: "Assignment saved" });
  },

  async listAssignments(req: AuthenticatedRequest, res: Response) {
    const filters = assignFiltersSchema.parse(req.query);
    const data = await rosterService.listAssignments(filters);
    return res.json({ success: true, data });
  },

  async listActualAssignments(req: AuthenticatedRequest, res: Response) {
    const filters = actualAssignmentFiltersSchema.parse(req.query);
    const data = await rosterService.listActualAssignments(filters);
    return res.json({ success: true, data });
  },

  async getActualProcess(_req: AuthenticatedRequest, res: Response) {
    const data = await rosterService.getFirstProcessWithAssignments();
    return res.json({ success: true, data });
  },

  async uploadCsv(req: AuthenticatedRequest & { file?: Express.Multer.File }, res: Response) {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded. Attach a CSV as multipart field 'file'." });
    }

    const planId = (req.query.planId as string)?.trim();
    if (!planId) {
      return res.status(400).json({ success: false, message: "planId query param is required" });
    }

    const csvText = req.file.buffer.toString("utf-8");
    const { rows, errors } = parseRosterCsv(csvText);

    if (errors.length > 0) {
      return res.status(422).json({
        success: false,
        message: `CSV has ${errors.length} validation error(s)`,
        errors,
        rows_parsed: rows.length,
      });
    }

    // Map employee_code → employeeId lookup not needed here because
    // roster_assignment stores employee_id (UUID). We use employee_code
    // as-is and let the DB FK surface any mismatches.
    const bulkRows = rows.map((r) => ({
      employeeId: r.employee_code, // process manager uploads by code; FK resolved at DB level
      rosterDate: r.roster_date,
      shiftStartTime: r.shift_start_time,
      shiftEndTime: r.shift_end_time,
      processName: r.process_name,
      branchName: r.branch_name,
    }));

    const result = await rosterService.bulkAssign(bulkRows, planId, req.authUser!.id);

    return res.json({
      success: true,
      message: `Upload complete`,
      rows_in_file: rows.length,
      assigned: result.assigned,
      failed: result.failed,
      errors: result.errors,
    });
  },
};
