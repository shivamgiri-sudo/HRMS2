/**
 * Employee BGV Routes
 *
 * GET /api/bgv/employee/me     — Employee self-view (own BGV status)
 * GET /api/bgv/employee/:id    — HR lookup (view any employee's BGV status)
 */

import { Router, type Response, type NextFunction } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  getEmployeeBgvStatus,
  getEmployeeIdForUser,
  canViewEmployeeBgv,
} from "./employee-bgv.service.js";

export const employeeBgvRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// All routes require authentication
employeeBgvRouter.use(requireAuth);

/**
 * GET /me — Employee's own BGV status
 */
employeeBgvRouter.get(
  "/me",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;

    // Get employee ID for this user
    const employeeId = await getEmployeeIdForUser(userId);

    if (!employeeId) {
      return res.status(404).json({
        success: false,
        message: "No employee record found for your account",
      });
    }

    try {
      const data = await getEmployeeBgvStatus(employeeId);
      return res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      console.error("[employee-bgv] GET /me error:", err.message);
      return res.status(err.statusCode ?? 500).json({
        success: false,
        message: err.message ?? "Failed to fetch BGV status",
      });
    }
  })
);

/**
 * GET /:employeeId — HR lookup of any employee's BGV status
 */
employeeBgvRouter.get(
  "/:employeeId",
  requireRole("admin", "super_admin", "hr", "payroll_hr", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.params;
    const actorUserId = req.authUser!.id;
    // userRoles comes from requireRole middleware, or fall back to single role
    const actorRoles = req.userRoles ?? (req.authUser!.role ? [req.authUser!.role] : []);

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "employeeId is required",
      });
    }

    // Check access permission
    const canView = await canViewEmployeeBgv(actorUserId, employeeId, actorRoles);
    if (!canView) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this employee's BGV status",
      });
    }

    try {
      const data = await getEmployeeBgvStatus(employeeId);
      return res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      console.error("[employee-bgv] GET /:employeeId error:", err.message);
      return res.status(err.statusCode ?? 500).json({
        success: false,
        message: err.message ?? "Failed to fetch BGV status",
      });
    }
  })
);
