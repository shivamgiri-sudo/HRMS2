import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { resolveDashboardScope, DashboardScopeConfigurationError } from "../../shared/dashboardScope.js";
import { qualityDashboardV2Service, type QualityDrillLevel } from "./quality-dashboard-v2.service.js";
import { logger } from "../../logger.js";

const router = Router();

const VALID_LEVELS = new Set<QualityDrillLevel>(["branch", "process", "team", "analyst"]);

const ALLOWED_ROLES = [
  "super_admin", "admin", "ceo", "coo", "management", "hr", "hr_admin",
  "qa", "qa_manager", "quality_analyst", "quality_lead",
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
      const level = String(req.query.level ?? "branch") as QualityDrillLevel;
      const id = req.query.id ? String(req.query.id) : null;
      const rangeDays = Math.min(Math.max(parseInt(String(req.query.rangeDays ?? "30"), 10) || 30, 1), 90);

      if (!VALID_LEVELS.has(level)) {
        return res.status(400).json({ success: false, message: "Invalid level. Use branch|process|team|analyst." });
      }
      if (level !== "branch" && !id) {
        return res.status(400).json({ success: false, message: `id is required for level=${level}` });
      }

      const ctx = await getUserRoleContext(userId);
      // Security boundary is enforced inside the service (per-row scope filtering against
      // the caller's resolved branch/process/employee ids), independent of which parent id
      // is requested here — narrowing is not needed for correctness, only for UX.
      const scope = await resolveDashboardScope(userId, ctx.primaryRole);

      let result;
      if (level === "branch") result = await qualityDashboardV2Service.branchLevel(scope, rangeDays);
      else if (level === "process") result = await qualityDashboardV2Service.processLevel(id, scope, rangeDays);
      else if (level === "team") result = await qualityDashboardV2Service.teamLevel(id, scope, rangeDays);
      else result = await qualityDashboardV2Service.analystLevel(id, scope, rangeDays);

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof DashboardScopeConfigurationError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      }
      logger.error("GET /quality-dashboard-v2/summary error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch quality dashboard summary",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

router.get(
  "/analyst/:employeeId/calls",
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).authUser!.id;
      const { employeeId } = req.params;
      const rangeDays = Math.min(Math.max(parseInt(String(req.query.rangeDays ?? "30"), 10) || 30, 1), 90);

      const ctx = await getUserRoleContext(userId);
      const scope = await resolveDashboardScope(userId, ctx.primaryRole);

      // Scope is now enforced inside analystCalls itself, for every scope level
      // (not just SELF_ONLY/TEAM_ONLY, which is all this route-level check used
      // to cover — a BRANCH_ALL/PROCESS_ALL/CUSTOM_SCOPE caller had no check at
      // all before this. Matches the /summary route's own stated architecture:
      // "Security boundary is enforced inside the service."
      const result = await qualityDashboardV2Service.analystCalls(employeeId, rangeDays, scope);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("GET /quality-dashboard-v2/analyst/:employeeId/calls error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch analyst calls",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

export default router;
