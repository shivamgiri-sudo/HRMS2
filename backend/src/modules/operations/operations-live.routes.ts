import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  operationsLiveService,
  LiveStatusResponse,
  RosterVsActualResponse,
  AttritionRiskResponse,
} from "./operations-live.service.js";
import { logger } from "../../logger.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { resolveDashboardScope } from "../../shared/dashboardScope.js";
import type { OperationsScopeFilter } from "./operations-live.service.js";

const router = Router();

/**
 * Resolve the caller's own row scope for the live-operations reads.
 *
 * These endpoints previously derived their branch/process filter entirely from query
 * parameters, so a caller who simply omitted them received live agent status and
 * per-employee attrition risk for the whole organisation. Scope now comes from the
 * caller's assignment; query params can only narrow within it.
 *
 * The roster/session tables store branch and process NAMES, while `employees` stores FK
 * ids, so both projections are returned.
 */
async function resolveOperationsScope(userId: string): Promise<{
  names: OperationsScopeFilter;
  ids: { branchIds: readonly string[] | null; processIds: readonly string[] | null };
}> {
  const ctx = await getUserRoleContext(userId);
  let scope;
  try {
    scope = await resolveDashboardScope(userId, ctx.primaryRole);
  } catch {
    // Fail closed: an unresolvable scope yields nothing, never everything.
    return { names: { branchNames: [], processNames: null }, ids: { branchIds: [], processIds: null } };
  }
  if (scope.level === "ORG_ALL") {
    return { names: null, ids: { branchIds: null, processIds: null } };
  }

  const branchIds = scope.branchIds.length ? scope.branchIds : null;
  const processIds = scope.processIds.length ? scope.processIds : null;

  const nameFor = async (table: string, col: string, ids: readonly string[] | null) => {
    if (!ids) return null;
    if (ids.length === 0) return [];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${col} AS name FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...ids],
    );
    return (rows as any[]).map((r) => String(r.name)).filter(Boolean);
  };

  return {
    names: {
      branchNames: await nameFor("branch_master", "branch_name", branchIds),
      processNames: await nameFor("process_master", "process_name", processIds),
    },
    ids: { branchIds, processIds },
  };
}

/**
 * GET /api/operations/live-status
 * Returns real-time agent status across all processes
 * Role: OPERATIONS, ADMIN, MANAGER
 * Query params: processName?, branchName?
 */
router.get(
  "/live-status",
  requireAuth,
  requireRole("operations", "admin", "process_manager", "manager", "branch_head"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { processName, branchName } = req.query as Record<string, string | undefined>;

      const { names } = await resolveOperationsScope((req as any).authUser!.id);
      const result: LiveStatusResponse = await operationsLiveService.getLiveStatus(
        processName,
        branchName,
        names
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("GET /live-status error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch live status",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * GET /api/operations/roster-vs-actual
 * Returns roster planned vs actual logged-in comparison by process
 * Role: OPERATIONS, ADMIN, MANAGER
 */
router.get(
  "/roster-vs-actual",
  requireAuth,
  requireRole("operations", "admin", "process_manager", "manager", "branch_head"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { names } = await resolveOperationsScope((req as any).authUser!.id);
      const result: RosterVsActualResponse = await operationsLiveService.getRosterVsActual(names);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("GET /roster-vs-actual error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch roster vs actual",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * GET /api/operations/attrition-risk
 * Returns employees at risk of attrition with scoring and signals
 * Role: OPERATIONS, ADMIN, HR
 * Query params: minRiskScore?
 */
router.get(
  "/attrition-risk",
  requireAuth,
  requireRole("operations", "admin", "hr", "manager", "branch_head"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const minRiskScore = parseInt(req.query.minRiskScore as string) || 0;

      const { ids } = await resolveOperationsScope((req as any).authUser!.id);
      const result: AttritionRiskResponse = await operationsLiveService.getAttritionRiskScores(
        minRiskScore,
        ids
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("GET /attrition-risk error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch attrition risk",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

export default router;
