import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireQueryScope } from "../../middleware/scopeMiddleware.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  getEmployeeWfmCompliance,
  getBranchWfmCompliance,
} from "./wfm-compliance-analytics.service.js";

const router = Router();

router.use(requireAuth);

/**
 * Middleware to verify employee scope access for compliance queries.
 * branch_head/manager/operations_manager can only query employees in their assigned scope.
 */
async function verifyEmployeeScope(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const employeeId = req.query.employeeId as string;
    if (!employeeId) return next();

    // Get employee's branch/process to verify scope
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    const emp = empRows[0] as { branch_id?: string; process_id?: string } | undefined;
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    // Verify caller has access to this employee's branch/process
    const hasAccess = await hasScopedAccess(
      userId,
      ["wfm", "manager", "branch_head", "operations_manager"],
      { branchId: emp.branch_id ?? null, processId: emp.process_id ?? null },
      { allowAdminBypass: true }
    );

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: employee is outside your assigned branch/process scope",
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/wfm-compliance/employee
 * Query params: employeeId (required), period (YYYY-MM, optional)
 * Roles: hr | wfm | admin | super_admin | manager | branch_head | operations_manager
 * Scope: branch_head/manager/operations_manager can only query employees in their assigned scope
 */
router.get(
  "/employee",
  requireRole("hr", "wfm", "admin", "super_admin", "manager", "branch_head", "operations_manager"),
  verifyEmployeeScope,
  (req, res, next) => {
    getEmployeeWfmCompliance(req, res).catch(next);
  }
);

/**
 * GET /api/wfm-compliance/branch
 * Query params: branchId (required), period (YYYY-MM, optional), processId (optional)
 * Roles: hr | wfm | admin | super_admin | manager | branch_head | operations_manager
 * Scope: branch_head/manager/operations_manager can only query branches in their assigned scope
 */
router.get(
  "/branch",
  requireRole("hr", "wfm", "admin", "super_admin", "manager", "branch_head", "operations_manager"),
  requireQueryScope(
    ["wfm", "manager", "branch_head", "operations_manager"],
    ["admin", "hr", "super_admin", "ceo"]
  ),
  (req, res, next) => {
    getBranchWfmCompliance(req, res).catch(next);
  }
);

export const wfmComplianceAnalyticsRouter = router;
