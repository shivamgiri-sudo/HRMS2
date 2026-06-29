import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import {
  initiateReactivation,
  branchHeadAction,
  hrFinalAction,
  cancelReactivation,
  listPendingForBranchHead,
  listAllReactivations,
  getReactivationDetail,
} from "./employee-reactivation.service.js";

export const employeeReactivationRouter = Router();

// All routes require authentication
employeeReactivationRouter.use(requireAuth);

// POST /api/employees/reactivation/initiate
employeeReactivationRouter.post(
  "/reactivation/initiate",
  requireRole("hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actorId = req.authUser!.id;
      const { employee_id, proposed_joining_date, reinstatement_reason,
              new_branch_id, new_process_id, new_cost_centre_id } = req.body;

      if (!employee_id || typeof employee_id !== "string") {
        return res.status(400).json({ success: false, message: "employee_id is required" });
      }
      if (!proposed_joining_date || !/^\d{4}-\d{2}-\d{2}$/.test(proposed_joining_date)) {
        return res.status(400).json({ success: false, message: "proposed_joining_date must be YYYY-MM-DD" });
      }
      if (!reinstatement_reason || String(reinstatement_reason).trim().length < 10) {
        return res.status(400).json({ success: false, message: "reinstatement_reason must be at least 10 characters" });
      }

      const result = await initiateReactivation(employee_id, actorId, {
        proposed_joining_date,
        reinstatement_reason: String(reinstatement_reason).trim(),
        new_branch_id: new_branch_id ?? null,
        new_process_id: new_process_id ?? null,
        new_cost_centre_id: new_cost_centre_id ?? null,
      });

      return res.status(201).json({ success: true, ...result });
    } catch (err: any) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
          ...(err.earliest_eligible_date ? { earliest_eligible_date: err.earliest_eligible_date } : {}),
        });
      }
      return next(err);
    }
  }
);

// GET /api/employees/reactivation/pending
employeeReactivationRouter.get(
  "/reactivation/pending",
  requireRole("branch_head", "hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actorId = req.authUser!.id;
      const data = await listPendingForBranchHead(actorId);
      return res.json({ success: true, data });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /api/employees/reactivation/all
employeeReactivationRouter.get(
  "/reactivation/all",
  requireRole("hr", "admin", "super_admin", "payroll_head"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { status, page, limit } = req.query as Record<string, string>;
      const result = await listAllReactivations({
        status: status || undefined,
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 20,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /api/employees/reactivation/:id
employeeReactivationRouter.get(
  "/reactivation/:id",
  requireRole("branch_head", "hr", "admin", "super_admin", "payroll_head"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actorId = req.authUser!.id;
      const detail = await getReactivationDetail(req.params.id);
      if (!detail) return res.status(404).json({ success: false, message: "Request not found" });

      // Branch heads can only see requests for their branch
      const isBranchHeadOnly = await hasAnyRole(actorId, "branch_head") &&
        !(await hasAnyRole(actorId, "hr", "admin", "super_admin", "payroll_head"));
      if (isBranchHeadOnly) {
        // scope check via assignment
        const { getUserAssignmentScopes } = await import("../../shared/scopeAccess.js");
        const scopes = await getUserAssignmentScopes(actorId, ["branch_head"]);
        const branchIds = scopes.map((s: any) => s.branch_id).filter(Boolean);
        const hasAll = scopes.some((s: any) => s.scope_type === "all");
        if (!hasAll && !branchIds.includes(detail.branch_id)) {
          return res.status(403).json({ success: false, message: "Outside assigned scope" });
        }
      }

      return res.json({ success: true, data: detail });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /api/employees/reactivation/:id/branch-action
employeeReactivationRouter.post(
  "/reactivation/:id/branch-action",
  requireRole("branch_head", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actorId = req.authUser!.id;
      const { action, remarks } = req.body;

      if (!["approved", "rejected"].includes(action)) {
        return res.status(400).json({ success: false, message: "action must be 'approved' or 'rejected'" });
      }
      if (!remarks || String(remarks).trim().length < 5) {
        return res.status(400).json({ success: false, message: "remarks must be at least 5 characters" });
      }

      const result = await branchHeadAction(req.params.id, actorId, { action, remarks: String(remarks).trim() });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      return next(err);
    }
  }
);

// POST /api/employees/reactivation/:id/hr-action
employeeReactivationRouter.post(
  "/reactivation/:id/hr-action",
  requireRole("hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actorId = req.authUser!.id;
      const { action, remarks } = req.body;

      if (!["confirmed", "rejected"].includes(action)) {
        return res.status(400).json({ success: false, message: "action must be 'confirmed' or 'rejected'" });
      }
      if (!remarks || String(remarks).trim().length < 5) {
        return res.status(400).json({ success: false, message: "remarks must be at least 5 characters" });
      }

      const result = await hrFinalAction(req.params.id, actorId, { action, remarks: String(remarks).trim() });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      return next(err);
    }
  }
);

// POST /api/employees/reactivation/:id/cancel
employeeReactivationRouter.post(
  "/reactivation/:id/cancel",
  requireRole("hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actorId = req.authUser!.id;
      const result = await cancelReactivation(req.params.id, actorId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      return next(err);
    }
  }
);
