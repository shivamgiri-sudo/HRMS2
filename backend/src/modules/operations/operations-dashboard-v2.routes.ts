import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { resolveDashboardScope, DashboardScopeConfigurationError } from "../../shared/dashboardScope.js";
import { operationsDashboardV2Service, type OperationsDrillLevel } from "./operations-dashboard-v2.service.js";
import { logger } from "../../logger.js";

const router = Router();

const VALID_LEVELS = new Set<OperationsDrillLevel>(["branch", "process", "team", "analyst"]);

const ALLOWED_ROLES = [
  "super_admin", "admin", "ceo", "coo", "management", "hr", "hr_admin",
  "ho_operations", "operations_head", "operations_manager", "operations",
  "branch_head", "branch_manager", "bm",
  "process_manager", "manager", "assistant_manager", "team_leader", "team_lead", "tl",
  "employee", "agent",
];

router.get(
  "/summary",
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).authUser!.id;
      const level = String(req.query.level ?? "branch") as OperationsDrillLevel;
      const id = req.query.id ? String(req.query.id) : null;
      const rangeDays = Math.min(Math.max(parseInt(String(req.query.rangeDays ?? "30"), 10) || 30, 1), 90);

      if (!VALID_LEVELS.has(level)) {
        return res.status(400).json({ success: false, message: "Invalid level. Use branch|process|team|analyst." });
      }

      const ctx = await getUserRoleContext(userId);
      // Security boundary is enforced inside the service (scope clause applied to every
      // aggregate query), independent of which parent id is requested here.
      const scope = await resolveDashboardScope(userId, ctx.primaryRole);

      let result;
      if (level === "branch") result = await operationsDashboardV2Service.branchLevel(scope, rangeDays);
      else if (level === "process") result = await operationsDashboardV2Service.processLevel(id, scope, rangeDays);
      else if (level === "team") result = await operationsDashboardV2Service.teamLevel(id, scope, rangeDays);
      else result = await operationsDashboardV2Service.analystLevel(id, scope, rangeDays);

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof DashboardScopeConfigurationError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      }
      logger.error("GET /operations-dashboard-v2/summary error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch operations dashboard summary",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

router.get(
  "/analyst/:employeeId/detail",
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).authUser!.id;
      const { employeeId } = req.params;
      const rangeDays = Math.min(Math.max(parseInt(String(req.query.rangeDays ?? "30"), 10) || 30, 1), 90);

      const ctx = await getUserRoleContext(userId);
      const scope = await resolveDashboardScope(userId, ctx.primaryRole);

      // Fail-closed: SELF_ONLY/TEAM_ONLY callers may only view an employee inside their
      // resolved employeeIds set; broader scopes are checked by branch/process membership.
      if ((scope.level === "SELF_ONLY" || scope.level === "TEAM_ONLY") && !scope.employeeIds.includes(employeeId)) {
        return res.status(403).json({ success: false, message: "Employee is outside your dashboard scope" });
      }

      const result = await operationsDashboardV2Service.analystDetail(employeeId, rangeDays);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("GET /operations-dashboard-v2/analyst/:employeeId/detail error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch analyst detail",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

export default router;
