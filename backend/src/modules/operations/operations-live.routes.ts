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

const router = Router();

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

      const result: LiveStatusResponse = await operationsLiveService.getLiveStatus(
        processName,
        branchName
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
      const result: RosterVsActualResponse = await operationsLiveService.getRosterVsActual();

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

      const result: AttritionRiskResponse = await operationsLiveService.getAttritionRiskScores(
        minRiskScore
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
