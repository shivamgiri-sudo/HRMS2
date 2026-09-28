/**
 * Quality Aggregation Routes — Phase 7.1
 *
 * Agent self-service quality dashboard endpoints.
 * Tasks A2-A4: Express routes + auth + error handling
 *
 * All endpoints:
 * - Auth: requireAuth → requireAgent (agent sees own data only)
 * - Error handling: 403 (unauthorized), 404 (not found), 400 (invalid params), 503 (service down + cached fallback)
 * - Cache: Redis with fallback to null if unavailable
 *
 * Endpoints:
 * - GET /api/agent/cq-score          → CQ Score hero card data
 * - GET /api/agent/weakness-detail   → 5 dimensional scores + weak calls
 * - GET /api/agent/calls-review      → Paginated calls list
 * - GET /api/agent/call/:callId/detail → Single call + sub-scores
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireAgent } from "../../middleware/requireAgent.js";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { QualityAggregationService } from "./quality-aggregation.service.js";
import { cacheInstance } from "../../lib/cache/quality-cache.js";
import { getShivamgiriPool } from "../../db/shivamgiriDb.js";
import type { RowDataPacket } from "mysql2/promise";

export const qualityAggregationRouter = Router();

// Apply auth middleware globally
qualityAggregationRouter.use(requireAuth);

// Typed error handler wrapper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

const qualityService = new QualityAggregationService(db);

// ─── GET /api/agent/cq-score ────────────────────────────────────────────────
/**
 * CQ Score Hero Card
 *
 * Query params:
 * - daysBack (optional): 7 (default), 30, or custom number
 *
 * Response: { cq_score_current, rank, gap_pct, trend_7day, weekly, status, ... }
 * Cache: 5 minutes
 * Error: 503 if service down (returns cached data if available)
 */
qualityAggregationRouter.get(
  "/cq-score",
  requireAgent,
  h(async (req: AuthenticatedRequest & { agentCode: string }, res) => {
    try {
      const employeeCode = req.agentCode;
      const daysBack = Math.min(
        Math.max(1, Number(req.query.daysBack) || 7),
        90 // Limit to 90 days max
      );

      logger.info(`CQ Score request: agent=${employeeCode}, daysBack=${daysBack}`);

      const result = await qualityService.getCQScore(employeeCode, daysBack);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      logger.error("CQ Score endpoint error:", err);

      // Attempt to serve cached data on error (503 Service Unavailable)
      const cacheKey = `quality:cq_score:${(req as AuthenticatedRequest & { agentCode: string }).agentCode}:${Number(req.query.daysBack) || 7}d`;
      const cached = await cacheInstance.get(cacheKey);

      if (cached) {
        logger.warn(`Serving cached CQ score for agent ${(req as AuthenticatedRequest & { agentCode: string }).agentCode}`);
        res.status(503).json({
          success: true,
          data: cached,
          cached: true,
          message: "Service temporarily unavailable; serving cached data",
        });
        return;
      }

      res.status(503).json({
        success: false,
        error: "Service unavailable",
        message: "Unable to fetch quality data and no cache available",
      });
    }
  })
);

// ─── GET /api/agent/weakness-detail ─────────────────────────────────────────
/**
 * Weakness Detail Report
 *
 * Returns: { weakness_areas: [ { category, score, peer_avg, gap, sub_metrics, related_calls }, ... ] }
 * Cache: 10 minutes
 * Error: 503 if service down (returns cached data if available)
 */
qualityAggregationRouter.get(
  "/weakness-detail",
  requireAgent,
  h(async (req: AuthenticatedRequest & { agentCode: string }, res) => {
    try {
      const employeeCode = req.agentCode;

      logger.info(`Weakness Detail request: agent=${employeeCode}`);

      const result = await qualityService.getWeaknessDetail(employeeCode);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      logger.error("Weakness Detail endpoint error:", err);

      // Attempt to serve cached data on error
      const cacheKey = `quality:weakness:${(req as AuthenticatedRequest & { agentCode: string }).agentCode}`;
      const cached = await cacheInstance.get(cacheKey);

      if (cached) {
        logger.warn(`Serving cached weakness detail for agent ${(req as AuthenticatedRequest & { agentCode: string }).agentCode}`);
        res.status(503).json({
          success: true,
          data: cached,
          cached: true,
          message: "Service temporarily unavailable; serving cached data",
        });
        return;
      }

      res.status(503).json({
        success: false,
        error: "Service unavailable",
        message: "Unable to fetch weakness data and no cache available",
      });
    }
  })
);

// ─── GET /api/agent/calls-review ────────────────────────────────────────────
/**
 * Paginated Calls Review List
 *
 * Query params:
 * - limit (optional): 10 (default), 1-50 max
 * - offset (optional): 0 (default)
 * - sort (optional): 'date' (default), 'cq', 'fatal'
 *
 * Response: { total_calls, page: { limit, offset, has_next }, calls: [...] }
 * Cache: 2 minutes
 * Error: 400 (invalid params), 503 (service down with cached fallback)
 */
qualityAggregationRouter.get(
  "/calls-review",
  requireAgent,
  h(async (req: AuthenticatedRequest & { agentCode: string }, res) => {
    try {
      const employeeCode = req.agentCode;

      // Parse and validate query params
      let limit = Number(req.query.limit) || 10;
      let offset = Number(req.query.offset) || 0;
      const sort = (req.query.sort as string || "date") as "date" | "cq" | "fatal";

      // Validate params
      if (isNaN(limit) || limit < 1 || limit > 50) {
        return res.status(400).json({
          success: false,
          error: "Invalid limit: must be between 1 and 50",
        });
      }
      if (isNaN(offset) || offset < 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid offset: must be >= 0",
        });
      }
      if (!["date", "cq", "fatal"].includes(sort)) {
        return res.status(400).json({
          success: false,
          error: "Invalid sort: must be 'date', 'cq', or 'fatal'",
        });
      }

      logger.info(
        `Calls Review request: agent=${employeeCode}, limit=${limit}, offset=${offset}, sort=${sort}`
      );

      limit = Math.min(limit, 50); // Safety cap
      const result = await qualityService.getCallsReview(employeeCode, limit, offset, sort);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      logger.error("Calls Review endpoint error:", err);

      // Attempt to serve cached data on error
      const cacheKey = `quality:calls_review:${(req as AuthenticatedRequest & { agentCode: string }).agentCode}:${req.query.sort || "date"}:${Number(req.query.limit) || 10}:${Number(req.query.offset) || 0}`;
      const cached = await cacheInstance.get(cacheKey);

      if (cached) {
        logger.warn(`Serving cached calls review for agent ${(req as AuthenticatedRequest & { agentCode: string }).agentCode}`);
        res.status(503).json({
          success: true,
          data: cached,
          cached: true,
          message: "Service temporarily unavailable; serving cached data",
        });
        return;
      }

      res.status(503).json({
        success: false,
        error: "Service unavailable",
        message: "Unable to fetch calls data and no cache available",
      });
    }
  })
);

// ─── GET /api/agent/call/:callId/detail ─────────────────────────────────────
/**
 * Single Call Detail
 *
 * Path param:
 * - callId: Call ID from db_audit.call_quality_assessment.id
 *
 * Response: { call_id, date, lead, scenario, cq_pct, sub_scores, recording, feedback, peer_comparison }
 * Cache: None (single row, no caching)
 * Error: 404 (call not found), 400 (invalid callId), 500 (service error)
 */
qualityAggregationRouter.get(
  "/call/:callId/detail",
  requireAgent,
  h(async (req: AuthenticatedRequest & { agentCode: string }, res) => {
    try {
      const callId = req.params.callId;
      const employeeCode = req.agentCode;

      // Validate callId
      if (!callId || callId.trim() === "") {
        return res.status(400).json({
          success: false,
          error: "Invalid callId: must not be empty",
        });
      }

      logger.info(`Call Detail request: callId=${callId}, agent=${employeeCode}`);

      const result = await qualityService.getCallDetail(callId, employeeCode);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error("Call Detail endpoint error:", err);

      // Distinguish between not found and other errors
      if (err?.message?.includes("not found")) {
        return res.status(404).json({
          success: false,
          error: "Call not found",
          message: `Call ${req.params.callId} does not exist or has no quality assessment`,
        });
      }

      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Unable to fetch call detail",
      });
    }
  })
);

// GET /api/agent/apr — self-service AHT / APR trend (last 30 days, scoped to calling agent)
qualityAggregationRouter.get(
  "/apr",
  requireAuth,
  requireAgent,
  async (req: AuthenticatedRequest, res) => {
    try {
      const employeeCode = (req as unknown as { agentCode?: string }).agentCode;

      if (!employeeCode) {
        return res.status(403).json({ success: false, error: "Agent code not found for this user" });
      }

      const now = new Date();
      const to = req.query.to ? String(req.query.to) : now.toISOString().slice(0, 10);
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 30);
      const from = req.query.from ? String(req.query.from)
        : `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}-${String(fromDate.getDate()).padStart(2, "0")}`;

      const pool = getShivamgiriPool();
      const [rows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          apr.UserID             AS agent_code,
          DATE_FORMAT(apr.ReportDate, '%Y-%m-%d') AS date,
          apr.Calls              AS calls,
          TIME_TO_SEC(COALESCE(apr.AHT, '00:00:00'))        AS aht_seconds,
          TIME_TO_SEC(COALESCE(apr.Login_Time, '00:00:00'))  AS login_seconds,
          TIME_TO_SEC(COALESCE(apr.Net_Login, '00:00:00'))   AS net_login_seconds,
          CASE WHEN TIME_TO_SEC(COALESCE(apr.Login_Time,'00:00:00')) > 0
            THEN ROUND(
              (TIME_TO_SEC(COALESCE(apr.BIO,'00:00:00')) + TIME_TO_SEC(COALESCE(apr.LUNCH,'00:00:00')) +
               TIME_TO_SEC(COALESCE(apr.QA,'00:00:00')) + TIME_TO_SEC(COALESCE(apr.TRAINING,'00:00:00')) +
               TIME_TO_SEC(COALESCE(apr.DISMX,'00:00:00'))) /
              TIME_TO_SEC(COALESCE(apr.Login_Time,'00:00:00')) * 100, 1)
            ELSE NULL
          END AS shrinkage_pct
        FROM Shivamgiri.apr apr
        WHERE apr.UserID COLLATE utf8mb4_unicode_ci = ?
          AND apr.ReportDate BETWEEN ? AND ?
        ORDER BY apr.ReportDate ASC
        LIMIT 31
      `, [employeeCode, from, to]);

      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error("Agent APR endpoint error:", err);
      const msg = err instanceof Error ? err.message : "APR data unavailable";
      return res.json({ success: true, data: [], _error: msg });
    }
  }
);

export default qualityAggregationRouter;
