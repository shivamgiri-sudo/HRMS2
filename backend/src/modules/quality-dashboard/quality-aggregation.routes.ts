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
import { requireAgent, QUALITY_VIEW_ANY_AGENT_ROLES } from "../../middleware/requireAgent.js";
import { hasRoleForRequest } from "../../shared/accessGuard.js";
import {
  getAgentMyKpi,
  getAgentCalls,
  getAgentCall,
  getAgentLoginDays,
  getAgentQueue,
  getAgentDaily,
  validDate,
} from "./agent-my-kpi.service.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { QualityAggregationService } from "./quality-aggregation.service.js";
import { cacheInstance } from "../../lib/cache/quality-cache.js";

export const qualityAggregationRouter = Router();

// Apply auth middleware globally
qualityAggregationRouter.use(requireAuth);

// Typed error handler wrapper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

const qualityService = new QualityAggregationService(db);

// ─── GET /api/agent/audited-agents ──────────────────────────────────────────
/**
 * Agents with audited calls in the last 30 days, for the "view agent" picker shown to org-wide
 * quality roles. 403 for everyone else — the frontend uses that to hide the picker.
 */
qualityAggregationRouter.get(
  "/audited-agents",
  h(async (req: AuthenticatedRequest, res) => {
    if (!(await hasRoleForRequest(req.authUser, ...QUALITY_VIEW_ANY_AGENT_ROLES))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const [agents] = await db.execute<RowDataPacket[]>(
      `SELECT User AS masid, COUNT(*) AS audits, MAX(CallDate) AS last_audit
         FROM db_audit.call_quality_assessment
        WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND User LIKE 'MAS%'
          AND quality_percentage IS NOT NULL
        GROUP BY User
        ORDER BY audits DESC`,
    );
    const ids = agents.map((a) => String(a.masid));
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const ph = ids.map(() => "?").join(",");
      // Two indexed lookups; a single "call_centre_code IN (…) OR employee_code IN (…)" defeats
      // both indexes and measured ~58s against ~0.5s for the pair.
      const [byCcc] = await db.execute<RowDataPacket[]>(
        `SELECT call_centre_code, employee_code, TRIM(full_name) AS full_name FROM employees WHERE call_centre_code IN (${ph})`,
        ids,
      );
      const [byCode] = await db.execute<RowDataPacket[]>(
        `SELECT call_centre_code, employee_code, TRIM(full_name) AS full_name FROM employees WHERE employee_code IN (${ph})`,
        ids,
      );
      for (const e of [...byCcc, ...byCode]) {
        for (const code of [e.call_centre_code, e.employee_code]) {
          const k = typeof code === "string" ? code.toUpperCase() : "";
          if (k && e.full_name && !names.has(k)) names.set(k, e.full_name);
        }
      }
    }
    res.json({
      success: true,
      data: agents.map((a) => ({
        masid: String(a.masid).toUpperCase(),
        name: names.get(String(a.masid).toUpperCase()) ?? null,
        audits: Number(a.audits),
        last_audit: a.last_audit,
      })),
    });
  }),
);

// ─── My KPIs call-performance dashboard ─────────────────────────────────────
type AgentReq = AuthenticatedRequest & { agentCode: string };

qualityAggregationRouter.get("/my-kpi", requireAgent, h(async (req: AgentReq, res) => {
  res.json({ success: true, data: await getAgentMyKpi(req.agentCode, req.query.date) });
}));

qualityAggregationRouter.get("/my-calls", requireAgent, h(async (req: AgentReq, res) => {
  const to = validDate(req.query.to ?? req.query.date);
  const from = req.query.from ? validDate(req.query.from) : to;
  if (from > to) return res.status(400).json({ success: false, message: "from must be on or before to" });
  const hourRaw = req.query.hour;
  const hour = hourRaw === undefined || hourRaw === "" ? null : Number(hourRaw);
  if (hour !== null && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
    return res.status(400).json({ success: false, message: "hour must be 0-23" });
  }
  const sl = req.query.sl === "in" || req.query.sl === "out" ? req.query.sl : null;
  const campaign = typeof req.query.campaign === "string" && req.query.campaign.trim() ? req.query.campaign.trim().slice(0, 45) : null;
  const data = await getAgentCalls(req.agentCode, {
    from, to, hour, campaign, sl,
    sort: req.query.sort === "duration" ? "duration" : "time",
    limit: Number(req.query.limit) || 25,
    offset: Number(req.query.offset) || 0,
  });
  res.json({ success: true, data: { from, to, ...data } });
}));

qualityAggregationRouter.get("/my-calls/:id", requireAgent, h(async (req: AgentReq, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "Invalid call id" });
  const call = await getAgentCall(req.agentCode, id);
  if (!call) return res.status(404).json({ success: false, message: "Call not found for this agent" });
  res.json({ success: true, data: call });
}));

qualityAggregationRouter.get("/my-daily", requireAgent, h(async (req: AgentReq, res) => {
  const to = validDate(req.query.to);
  const from = req.query.from ? validDate(req.query.from) : `${to.slice(0, 8)}01`;
  if (from > to) return res.status(400).json({ success: false, message: "from must be on or before to" });
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > 92) return res.status(400).json({ success: false, message: "Date range is limited to 92 days" });
  res.json({ success: true, data: { from, to, days: await getAgentDaily(req.agentCode, from, to) } });
}));

qualityAggregationRouter.get("/my-login", requireAgent, h(async (req: AgentReq, res) => {
  const to = validDate(req.query.to);
  const from = req.query.from ? validDate(req.query.from) : `${to.slice(0, 8)}01`;
  res.json({ success: true, data: { from, to, days: await getAgentLoginDays(req.agentCode, from, to) } });
}));

qualityAggregationRouter.get("/my-queue", requireAgent, h(async (req: AgentReq, res) => {
  const to = validDate(req.query.to);
  const from = req.query.from ? validDate(req.query.from) : to;
  if (from > to) return res.status(400).json({ success: false, message: "from must be on or before to" });
  res.json({ success: true, data: await getAgentQueue(req.agentCode, from, to) });
}));

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

export default qualityAggregationRouter;
