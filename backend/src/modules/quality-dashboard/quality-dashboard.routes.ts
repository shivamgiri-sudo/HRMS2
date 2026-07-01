import { Router } from "express";
import mysql from "mysql2/promise";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { hasRole, getEmployeeForUser } from "../../shared/accessGuard.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getQualityHeatmap, predictAgentRisk, generateInsights, calculateQualityROI } from "./quality-insights.service.js";
import {
  getTopObjectionPatterns,
  getTopObjectionHandlers,
  getSalesClosedAfterObjection,
  getObjectionsByProcess,
  getObjectionRebuttalMatrix,
  getObjectionHealthDashboard,
  generateComprehensiveObjectionReport,
} from "./objection-analysis.service.js";

const router = Router();
router.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const ALLOWED_ROLES = ["admin", "hr", "super_admin", "ceo", "qa", "analyst", "manager", "process_manager", "branch_head"] as const;

/**
 * Resolve caller's data scope:
 * - admin/hr/ceo/qa/analyst → full access (no filter)
 * - process_manager/manager → scoped to their assigned process campaign_ids
 * - branch_head → scoped to their branch's agent emp_codes
 * Returns extra SQL conditions to AND into queries, or null for global access.
 */
async function resolveScope(req: AuthenticatedRequest): Promise<{
  global: boolean;
  campaignIds: string[] | null;         // filter Shivamgiri.apr by campaign_id
  agentCodes: string[] | null;          // filter db_audit by User / Shivamgiri by UserID (branch scope)
  resolvedAuditCodes?: string[] | null; // filter db_audit for process managers (resolved from process_id)
}> {
  const userId = req.authUser!.id;

  // Global roles see everything
  if (await hasRole(userId, "admin", "hr", "ceo", "qa", "analyst")) {
    return { global: true, campaignIds: null, agentCodes: null };
  }

  // Process manager / manager: get their assigned processes from user_assignment_scope
  if (await hasRole(userId, "process_manager", "manager")) {
    const [scopeRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT uas.process_id, pm.process_name
       FROM user_assignment_scope uas
       JOIN process_master pm ON pm.id = uas.process_id
       WHERE uas.user_id = ? AND uas.active_status = 1 AND uas.process_id IS NOT NULL`,
      [userId]
    );
    const processIds = (scopeRows as any[]).map((r) => r.process_id as string).filter(Boolean);
    const names = (scopeRows as any[]).map((r) => r.process_name as string).filter(Boolean);
    if (!names.length) return { global: false, campaignIds: [], agentCodes: [], resolvedAuditCodes: [] };
    // Resolve employee codes in these processes for db_audit filtering
    let resolvedAuditCodes: string[] | null = null;
    if (processIds.length) {
      const ph = processIds.map(() => "?").join(",");
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code FROM employees WHERE process_id IN (${ph}) AND active_status = 1`, processIds
      );
      resolvedAuditCodes = (empRows as any[]).map((r) => r.employee_code as string).filter(Boolean);
    }
    return { global: false, campaignIds: names, agentCodes: null, resolvedAuditCodes };
  }

  // Branch head: get all agent emp_codes in their branch
  if (await hasRole(userId, "branch_head")) {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return { global: false, campaignIds: [], agentCodes: [] };
    const [bRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id FROM employees WHERE id = ? LIMIT 1`, [emp.id]
    );
    const branchId = (bRows[0] as any)?.branch_id;
    if (!branchId) return { global: false, campaignIds: [], agentCodes: [] };
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code FROM employees WHERE branch_id = ? AND active_status = 1`, [branchId]
    );
    const codes = (empRows as any[]).map((r) => r.employee_code as string).filter(Boolean);
    return { global: false, campaignIds: null, agentCodes: codes.length ? codes : [] };
  }

  // Default: no access
  return { global: false, campaignIds: [], agentCodes: [] };
}

let ciPool: mysql.Pool | null = null;
function getCiPool(): mysql.Pool {
  if (!ciPool) ciPool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: "Shivamgiri",
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10000,
  });
  return ciPool;
}

function dateDefaults(query: Record<string, unknown>): { from: string; to: string } {
  const now = new Date();
  const to = query.to ? String(query.to) : now.toISOString().slice(0, 10);
  const from = query.from ? String(query.from) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return { from, to };
}

// Build scope conditions for db_audit.call_quality_assessment (filters by User = agent emp_code)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function auditScopeCond(scope: Awaited<ReturnType<typeof resolveScope>>, params: any[]): string {
  if (scope.global) return "";
  // Use agentCodes if available (branch_head scope or process manager with resolved codes)
  const codes = scope.agentCodes ?? scope.resolvedAuditCodes ?? null;
  if (codes !== null) {
    if (!codes.length) { params.push("__no_match__"); return " AND User = ?"; }
    const ph = codes.map(() => "?").join(",");
    params.push(...codes);
    return ` AND User IN (${ph})`;
  }
  return "";
}

// Build scope conditions for Shivamgiri.apr (filters by campaign_id or UserID)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aprScopeCond(scope: Awaited<ReturnType<typeof resolveScope>>, params: any[]): string {
  if (scope.global) return "";
  if (scope.campaignIds !== null) {
    if (!scope.campaignIds.length) { params.push("__no_match__"); return " AND campaign_id = ?"; }
    const ph = scope.campaignIds.map(() => "?").join(",");
    params.push(...scope.campaignIds);
    return ` AND campaign_id IN (${ph})`;
  }
  if (scope.agentCodes !== null) {
    if (!scope.agentCodes.length) { params.push("__no_match__"); return " AND UserID = ?"; }
    const ph = scope.agentCodes.map(() => "?").join(",");
    params.push(...scope.agentCodes);
    return ` AND UserID IN (${ph})`;
  }
  return "";
}

// GET /api/quality-dashboard/summary
router.get("/summary", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = req.query.client_id ? String(req.query.client_id) : null;
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    const clientCond = clientId ? " AND ClientId = ?" : "";
    if (clientId) params.push(clientId);
    const scopeCond = auditScopeCond(scope, params);

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(CASE WHEN quality_percentage IS NOT NULL THEN 1 END) as audited_calls,
        ROUND(AVG(quality_percentage), 2) as avg_quality_score,
        COUNT(CASE WHEN quality_percentage >= 80 THEN 1 END) as calls_above_80,
        COUNT(CASE WHEN quality_percentage < 50 THEN 1 END) as calls_below_50,
        COUNT(DISTINCT User) as unique_agents,
        COUNT(DISTINCT ClientId) as unique_clients,
        SUM(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 ELSE 0 END) as fraud_flags,
        ROUND(100 - (AVG(COALESCE(call_answered_within_5_seconds,0)) * 100), 1) as fail_rate_call_open,
        ROUND(100 - (AVG(COALESCE(professionalism_maintained,0)) * 100), 1) as fail_rate_professionalism,
        ROUND(100 - (AVG(COALESCE(active_listening,0)) * 100), 1) as fail_rate_active_listening,
        ROUND(100 - (AVG(COALESCE(proper_call_closure,0)) * 100), 1) as fail_rate_call_closure,
        ROUND(100 - (AVG(COALESCE(correct_and_complete_information,0)) * 100), 1) as fail_rate_accuracy
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ?${clientCond}${scopeCond}
    `, params);

    const row = rows[0] as Record<string, unknown>;
    const parameterFails = [
      { param: "call_open",       fail_rate: row.fail_rate_call_open },
      { param: "professionalism", fail_rate: row.fail_rate_professionalism },
      { param: "active_listening",fail_rate: row.fail_rate_active_listening },
      { param: "call_closure",    fail_rate: row.fail_rate_call_closure },
      { param: "accuracy",        fail_rate: row.fail_rate_accuracy },
    ];

    return res.json({ success: true, summary: row, parameter_fails: parameterFails, scope_label: scope.global ? "All" : scope.campaignIds ? `Processes: ${scope.campaignIds.join(", ")}` : `Branch agents: ${scope.agentCodes?.length ?? 0}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/summary]", msg);
    return res.json({ success: true, summary: { total_calls: 0, audited_calls: 0, avg_quality_score: 0, calls_above_80: 0, calls_below_50: 0, unique_agents: 0, unique_clients: 0, fraud_flags: 0 }, parameter_fails: [], scope_label: "All", _error: msg });
  }
}));

// GET /api/quality-dashboard/trend
router.get("/trend", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = req.query.client_id ? String(req.query.client_id) : null;
    const granularity = req.query.granularity === "week" ? "week" : "day";
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    const clientCond = clientId ? " AND ClientId = ?" : "";
    if (clientId) params.push(clientId);
    const scopeCond = auditScopeCond(scope, params);

    const groupExpr = granularity === "week" ? "YEARWEEK(CallDate)" : "DATE(CallDate)";
    const labelExpr = granularity === "week" ? "MIN(DATE(CallDate))" : "DATE(CallDate)";

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        ${labelExpr} as date,
        COUNT(*) as total_calls,
        ROUND(AVG(quality_percentage), 2) as avg_score,
        COUNT(CASE WHEN quality_percentage >= 80 THEN 1 END) as above_80,
        COUNT(CASE WHEN quality_percentage < 50 THEN 1 END) as below_50
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ?${clientCond}${scopeCond}
      GROUP BY ${groupExpr}
      ORDER BY date ASC
      LIMIT 180
    `, params);

    return res.json({ success: true, trend: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/trend]", msg);
    return res.json({ success: true, trend: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/agents
router.get("/agents", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = req.query.client_id ? String(req.query.client_id) : null;
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    const clientCond = clientId ? " AND ClientId = ?" : "";
    if (clientId) params.push(clientId);
    const scopeCond = auditScopeCond(scope, params);
    params.push(limit);

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        cqa.User AS agent_code,
        COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, COALESCE(e.last_name,'')), cqa.User) AS agent_name,
        COUNT(*) as total_calls,
        ROUND(AVG(cqa.quality_percentage), 2) as avg_score,
        COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) as calls_above_80,
        COUNT(CASE WHEN cqa.quality_percentage < 50 THEN 1 END) as calls_below_50,
        CASE
          WHEN AVG(cqa.quality_percentage) >= 90 THEN 'excellent'
          WHEN AVG(cqa.quality_percentage) >= 80 THEN 'good'
          WHEN AVG(cqa.quality_percentage) >= 70 THEN 'average'
          WHEN AVG(cqa.quality_percentage) >= 60 THEN 'below_average'
          ELSE 'poor'
        END as band
      FROM db_audit.call_quality_assessment cqa
      LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
      WHERE cqa.CallDate BETWEEN ? AND ? AND cqa.User IS NOT NULL AND cqa.User != ''${clientCond}${scopeCond}
      GROUP BY cqa.User, e.full_name, e.first_name, e.last_name
      HAVING COUNT(*) >= 3
      ORDER BY avg_score DESC
      LIMIT ?
    `, params);

    return res.json({ success: true, agents: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/agents]", msg);
    return res.status(500).json({ success: false, error: "Quality dashboard data unavailable", _details: msg });
  }
}));

// GET /api/quality-dashboard/clients
router.get("/clients", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        cqa.ClientId as client_id,
        COALESCE(cm.client_name, cqa.ClientId) as client_name,
        COUNT(*) as total_calls,
        ROUND(AVG(cqa.quality_percentage), 2) as avg_score,
        COUNT(DISTINCT cqa.User) as agent_count
      FROM db_audit.call_quality_assessment cqa
      LEFT JOIN mas_hrms.client_master cm ON cm.client_code = cqa.ClientId
      WHERE cqa.CallDate BETWEEN ? AND ?
        AND cqa.ClientId IS NOT NULL AND cqa.ClientId != ''
      GROUP BY cqa.ClientId, cm.client_name
      ORDER BY total_calls DESC
      LIMIT 20
    `, [from, to]);

    return res.json({ success: true, clients: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/clients]", msg);
    return res.json({ success: true, clients: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/apr
router.get("/apr", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const limit = Math.min(Number(req.query.limit ?? 50), 500);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        apr.UserID AS agent_code,
        COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, COALESCE(e.last_name,'')), apr.UserID) AS agent_name,
        DATE_FORMAT(apr.ReportDate, '%Y-%m-%d') as date,
        apr.campaign_id,
        apr.Calls,
        TIME_TO_SEC(COALESCE(apr.AHT, '00:00:00')) as aht_seconds,
        TIME_TO_SEC(COALESCE(apr.Login_Time, '00:00:00')) as login_seconds,
        TIME_TO_SEC(COALESCE(apr.Net_Login, '00:00:00')) as net_login_seconds,
        TIME_TO_SEC(COALESCE(apr.BIO, '00:00:00')) as bio_seconds,
        TIME_TO_SEC(COALESCE(apr.LUNCH, '00:00:00')) as lunch_seconds,
        TIME_TO_SEC(COALESCE(apr.QA, '00:00:00')) as qa_seconds,
        TIME_TO_SEC(COALESCE(apr.TRAINING, '00:00:00')) as training_seconds,
        TIME_TO_SEC(COALESCE(apr.DISMX, '00:00:00')) as dismx_seconds,
        CASE WHEN TIME_TO_SEC(COALESCE(apr.Login_Time,'00:00:00')) > 0
          THEN ROUND((TIME_TO_SEC(COALESCE(apr.BIO,'00:00:00')) + TIME_TO_SEC(COALESCE(apr.LUNCH,'00:00:00')) +
                      TIME_TO_SEC(COALESCE(apr.QA,'00:00:00')) + TIME_TO_SEC(COALESCE(apr.TRAINING,'00:00:00')) +
                      TIME_TO_SEC(COALESCE(apr.DISMX,'00:00:00'))) /
                     TIME_TO_SEC(COALESCE(apr.Login_Time,'00:00:00')) * 100, 1)
          ELSE NULL
        END as shrinkage_pct
      FROM Shivamgiri.apr apr
      LEFT JOIN mas_hrms.employees e ON e.employee_code = apr.UserID
      WHERE apr.ReportDate BETWEEN ? AND ?
      ORDER BY apr.ReportDate DESC
      LIMIT ?
    `, [from, to, limit]);

    return res.json({ success: true, apr: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/apr]", msg);
    return res.json({ success: true, apr: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/apr-summary
router.get("/apr-summary", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    const scopeCond = aprScopeCond(scope, params);

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        apr.campaign_id AS process_code,
        COALESCE(pm.process_name, apr.campaign_id) AS process,
        COUNT(DISTINCT apr.UserID) as agents,
        ROUND(AVG(apr.Calls), 1) as avg_calls,
        SEC_TO_TIME(ROUND(AVG(TIME_TO_SEC(COALESCE(apr.AHT,'00:00:00'))),0)) as avg_aht,
        ROUND(AVG(
          CASE WHEN TIME_TO_SEC(COALESCE(apr.Login_Time,'00:00:00')) > 0
          THEN (TIME_TO_SEC(COALESCE(apr.BIO,'00:00:00')) + TIME_TO_SEC(COALESCE(apr.LUNCH,'00:00:00')) +
                TIME_TO_SEC(COALESCE(apr.QA,'00:00:00')) + TIME_TO_SEC(COALESCE(apr.TRAINING,'00:00:00')) +
                TIME_TO_SEC(COALESCE(apr.DISMX,'00:00:00'))) /
               TIME_TO_SEC(COALESCE(apr.Login_Time,'00:00:00')) * 100
          ELSE NULL END
        ), 1) as avg_shrinkage_pct,
        ROUND(AVG(TIME_TO_SEC(COALESCE(apr.BIO,'00:00:00')))/60, 1) as avg_bio_mins,
        ROUND(AVG(TIME_TO_SEC(COALESCE(apr.LUNCH,'00:00:00')))/60, 1) as avg_lunch_mins,
        ROUND(AVG(TIME_TO_SEC(COALESCE(apr.QA,'00:00:00')))/60, 1) as avg_qa_mins,
        ROUND(AVG(TIME_TO_SEC(COALESCE(apr.TRAINING,'00:00:00')))/60, 1) as avg_training_mins
      FROM Shivamgiri.apr apr
      LEFT JOIN mas_hrms.process_master pm ON pm.process_code = apr.campaign_id
      WHERE apr.ReportDate BETWEEN ? AND ?${scopeCond}
      GROUP BY apr.campaign_id, pm.process_name
      ORDER BY avg_calls DESC
      LIMIT 20
    `, params);

    return res.json({ success: true, processes: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/apr-summary]", msg);
    return res.json({ success: true, processes: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/sales-intelligence
router.get("/sales-intelligence", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = req.query.client_id ? String(req.query.client_id) : null;
    const pool = getCiPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summaryParams: any[] = [from, to];
    const clientCond = clientId ? " AND client_id = ?" : "";
    if (clientId) summaryParams.push(clientId);

    const [summaryRows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales_done,
        COUNT(CASE WHEN CompetitorName IS NOT NULL AND CompetitorName != '' AND CompetitorName != 'null' THEN 1 END) as competitor_mentions,
        COUNT(DISTINCT client_id) as unique_clients,
        COUNT(CASE WHEN COALESCE(ObjectionHandling,'') NOT IN ('','null') THEN 1 END) as objection_calls
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ?${clientCond}
    `, summaryParams);

    const [competitorRows] = await pool.execute<RowDataPacket[]>(`
      SELECT CompetitorName, COUNT(*) as mentions
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ?
        AND CompetitorName IS NOT NULL AND CompetitorName NOT IN ('','null')
      GROUP BY CompetitorName
      ORDER BY mentions DESC
      LIMIT 10
    `, [from, to]);

    return res.json({ success: true, summary: summaryRows[0], top_competitors: competitorRows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/sales-intelligence]", msg);
    return res.json({ success: true, summary: { total_calls: 0, sales_done: 0, competitor_mentions: 0, unique_clients: 0, objection_calls: 0 }, top_competitors: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections
router.get("/objections", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 200);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT Objection as objection, Rebutal as rebuttal, COUNT(*) as frequency
      FROM db_external.tbl_obj
      WHERE Objection IS NOT NULL AND Objection != ''
      GROUP BY Objection, Rebutal
      ORDER BY frequency DESC
      LIMIT ?
    `, [limit]);

    return res.json({ success: true, objections: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections]", msg);
    return res.json({ success: true, objections: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/fraud-signals
router.get("/fraud-signals", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    const scopeCond = auditScopeCond(scope, params);

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') NOT IN ('','null','No','no') THEN 1 END) as data_theft,
        COUNT(CASE WHEN COALESCE(financial_fraud,'') NOT IN ('','null','No','no') THEN 1 END) as financial_fraud,
        COUNT(CASE WHEN COALESCE(collusion,'') NOT IN ('','null','No','no') THEN 1 END) as collusion,
        COUNT(CASE WHEN COALESCE(escalation_failure,'') NOT IN ('','null','No','no') THEN 1 END) as escalation_failure,
        COUNT(CASE WHEN COALESCE(unprofessional_behavior,'') NOT IN ('','null','No','no') THEN 1 END) as unprofessional,
        COUNT(CASE WHEN COALESCE(system_manipulation,'') NOT IN ('','null','No','no') THEN 1 END) as system_manipulation
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ?${scopeCond}
    `, params);

    return res.json({ success: true, fraud_signals: rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/fraud-signals]", msg);
    return res.json({ success: true, fraud_signals: { data_theft: 0, financial_fraud: 0, collusion: 0, escalation_failure: 0, unprofessional: 0, system_manipulation: 0 }, _error: msg });
  }
}));

// GET /api/quality-dashboard/sales-funnel
router.get("/sales-funnel", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = req.query.client_id as string | undefined;
    const pool = getCiPool();

    const whereClauses = ["CallDate BETWEEN ? AND ?"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    if (clientId) { whereClauses.push("client_id = ?"); params.push(clientId); }
    const where = whereClauses.join(" AND ");

    const [sales] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(CASE WHEN COALESCE(Opening,'') NOT IN ('','null') THEN 1 END) as opening_done,
        COUNT(CASE WHEN COALESCE(Offered,'') NOT IN ('','null') THEN 1 END) as offer_made,
        COUNT(CASE WHEN COALESCE(ObjectionHandling,'') NOT IN ('','null') THEN 1 END) as objection_handled,
        COUNT(CASE WHEN COALESCE(SaleDone,'') NOT IN ('','null','No','no','0') THEN 1 END) as sale_done
      FROM db_external.CallDetails WHERE ${where}
    `, params);

    const [rejection] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(CASE WHEN COALESCE(NotInterestedBucketReason,'') NOT IN ('','null') THEN 1 END) as not_interested,
        COUNT(CASE WHEN COALESCE(CustomerObjectionCategory,'') NOT IN ('','null') THEN 1 END) as objection_raised,
        COUNT(CASE WHEN COALESCE(AfterListeningOfferRejected,'') NOT IN ('','null','No','no','0') THEN 1 END) as rejected_after_offer,
        COUNT(CASE WHEN COALESCE(OfferingRejected,'') NOT IN ('','null','No','no','0') THEN 1 END) as offering_rejected,
        COUNT(CASE WHEN COALESCE(OpeningRejected,'') NOT IN ('','null','No','no','0') THEN 1 END) as opening_rejected
      FROM db_external.CallDetails WHERE ${where}
    `, params);

    const [reasons] = await pool.execute<RowDataPacket[]>(`
      SELECT NotInterestedBucketReason as reason, COUNT(*) as count
      FROM db_external.CallDetails
      WHERE ${where}
        AND NotInterestedBucketReason IS NOT NULL AND NotInterestedBucketReason NOT IN ('','null')
      GROUP BY NotInterestedBucketReason ORDER BY count DESC LIMIT 8
    `, params);

    return res.json({
      success: true,
      sales_funnel: sales[0],
      rejection_funnel: rejection[0],
      top_rejection_reasons: reasons,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/sales-funnel]", msg);
    return res.json({ success: true, sales_funnel: { total_calls: 0, opening_done: 0, offer_made: 0, objection_handled: 0, sale_done: 0 }, rejection_funnel: { total_calls: 0, not_interested: 0, objection_raised: 0, rejected_after_offer: 0, offering_rejected: 0, opening_rejected: 0 }, top_rejection_reasons: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/heatmap
router.get("/heatmap", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const data = await getQualityHeatmap(from, to);
    return res.json({ success: true, heatmap: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/heatmap]", msg);
    return res.json({ success: true, heatmap: {}, _error: msg });
  }
}));

// GET /api/quality-dashboard/agent-risk
router.get("/agent-risk", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const scope = await resolveScope(req);
    let agents = await predictAgentRisk(from, to);
    if (!scope.global && scope.agentCodes !== null) {
      const codesSet = new Set(scope.agentCodes);
      agents = agents.filter((a: any) => codesSet.has(a.agent_code));
    }
    return res.json({ success: true, agents });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/agent-risk]", msg);
    return res.json({ success: true, agents: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/insights
router.get("/insights", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const insights = await generateInsights(from, to);
    return res.json({ success: true, insights });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/insights]", msg);
    return res.json({ success: true, insights: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/roi
router.get("/roi", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const roi = await calculateQualityROI(from, to);
    return res.json({ success: true, roi });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/roi]", msg);
    return res.json({ success: true, roi: { current_metrics: { quality: 0, conversion: 0, total_calls: 0, total_sales: 0 }, projections: [] }, _error: msg });
  }
}));

// ============================================================================
// OBJECTION ANALYSIS ENDPOINTS
// ============================================================================

// GET /api/quality-dashboard/objections/patterns
// Top objection types with resolution rates and sales conversion metrics
router.get("/objections/patterns", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const patterns = await getTopObjectionPatterns(limit);
    return res.json({ success: true, patterns });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/patterns]", msg);
    return res.json({ success: true, patterns: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/handlers
// Top objection handlers with best resolution and sales conversion rates
router.get("/objections/handlers", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const handlers = await getTopObjectionHandlers(limit);
    return res.json({ success: true, handlers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/handlers]", msg);
    return res.json({ success: true, handlers: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/sales-metrics
// Sales conversion rates after objection handling by objection type
router.get("/objections/sales-metrics", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const metrics = await getSalesClosedAfterObjection(limit);
    return res.json({ success: true, metrics });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/sales-metrics]", msg);
    return res.json({ success: true, metrics: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/by-process
// Objection types breakdown by process/campaign
router.get("/objections/by-process", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const data = await getObjectionsByProcess(limit);
    return res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/by-process]", msg);
    return res.json({ success: true, data: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/rebuttals
// Objection & Rebuttal reference matrix from knowledge base
router.get("/objections/rebuttals", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const rebuttals = await getObjectionRebuttalMatrix(limit);
    return res.json({ success: true, rebuttals });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/rebuttals]", msg);
    return res.json({ success: true, rebuttals: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/health
// Overall objection health dashboard metrics
router.get("/objections/health", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const dashboard = await getObjectionHealthDashboard();
    return res.json({ success: true, dashboard });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/health]", msg);
    return res.json({
      success: true,
      dashboard: {
        TOTAL_OBJECTIONS_RAISED: 0,
        UNIQUE_OBJECTION_TYPES: 0,
        TOTAL_OBJECTIONS_HANDLED: 0,
        OVERALL_RESOLUTION_RATE_PCT: 0,
        SALES_CLOSED_AFTER_OBJECTION_HANDLING: 0,
        SALES_CONVERSION_AFTER_OBJECTION_PCT: 0,
        UNIQUE_HANDLERS: 0,
        UNIQUE_CLIENTS: 0,
        UNIQUE_PROCESSES: 0,
      },
      _error: msg,
    });
  }
}));

// GET /api/quality-dashboard/objections/comprehensive-report
// Complete objection analysis report (all metrics consolidated)
router.get("/objections/comprehensive-report", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  try {
    const patternLimit = Math.min(Number(req.query.patternLimit ?? 50), 200);
    const handlerLimit = Math.min(Number(req.query.handlerLimit ?? 50), 200);
    const processLimit = Math.min(Number(req.query.processLimit ?? 100), 500);
    const rebuttalLimit = Math.min(Number(req.query.rebuttalLimit ?? 100), 500);

    const report = await generateComprehensiveObjectionReport(
      patternLimit,
      handlerLimit,
      processLimit,
      rebuttalLimit
    );
    return res.json({ success: true, report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/comprehensive-report]", msg);
    return res.json({
      success: true,
      report: {
        dashboard: {
          TOTAL_OBJECTIONS_RAISED: 0,
          UNIQUE_OBJECTION_TYPES: 0,
          TOTAL_OBJECTIONS_HANDLED: 0,
          OVERALL_RESOLUTION_RATE_PCT: 0,
          SALES_CLOSED_AFTER_OBJECTION_HANDLING: 0,
          SALES_CONVERSION_AFTER_OBJECTION_PCT: 0,
          UNIQUE_HANDLERS: 0,
          UNIQUE_CLIENTS: 0,
          UNIQUE_PROCESSES: 0,
        },
        topPatterns: [],
        topHandlers: [],
        salesMetrics: [],
        processList: [],
        rebuttalMatrix: [],
      },
      _error: msg,
    });
  }
}));

// ============================================================================
// INBOUND OPERATIONS ENDPOINTS (from dialer_db CDR data)
// ============================================================================

import {
  getInboundSummary,
  getInboundTrend,
  getConsolidatedTrend,
  getProjectHourly,
  getProjectsMeta,
} from "./inbound-ops.service.js";

const INBOUND_ROLES = ["admin", "super_admin", "ceo", "coo", "branch_head", "process_manager", "manager", "operations_manager"] as const;

// GET /api/quality-dashboard/inbound-ops/projects
router.get("/inbound-ops/projects", requireRole(...INBOUND_ROLES), h(async (_req, res) => {
  return res.json({ success: true, projects: getProjectsMeta() });
}));

// GET /api/quality-dashboard/inbound-ops/summary?from&to&projects=gnc,bellavita
router.get("/inbound-ops/summary", requireRole(...INBOUND_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const projectKeys = req.query.projects ? String(req.query.projects).split(",").filter(Boolean) : undefined;
    const data = await getInboundSummary(from, to, projectKeys);
    return res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Dialer DB unavailable";
    console.error("[inbound-ops/summary]", msg);
    return res.json({ success: true, data: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/inbound-ops/trend?from&to&project=gnc
router.get("/inbound-ops/trend", requireRole(...INBOUND_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const projectKey = req.query.project ? String(req.query.project) : null;
    if (projectKey) {
      const rows = await getInboundTrend(from, to, projectKey);
      return res.json({ success: true, data: rows });
    }
    const rows = await getConsolidatedTrend(from, to);
    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Dialer DB unavailable";
    console.error("[inbound-ops/trend]", msg);
    return res.json({ success: true, data: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/inbound-ops/hourly?project=gnc&date=2026-07-01
router.get("/inbound-ops/hourly", requireRole(...INBOUND_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const projectKey = String(req.query.project ?? "");
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    if (!projectKey) return res.status(400).json({ success: false, error: "project is required" });
    const data = await getProjectHourly(projectKey, date);
    return res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Dialer DB unavailable";
    console.error("[inbound-ops/hourly]", msg);
    return res.json({ success: true, data: [], _error: msg });
  }
}));

// ============================================================================
// CLIENT QUALITY DRILL ENDPOINTS
// ============================================================================

// GET /api/quality-dashboard/client-drill/kpis?clientId&from&to
router.get("/client-drill/kpis", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = String(req.query.clientId ?? "");
    if (!clientId) return res.status(400).json({ success: false, error: "clientId required" });
    const scope = await resolveScope(req);
    const params: any[] = [from, to, clientId];
    const scopeCond = auditScopeCond(scope, params);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*) AS audit_count,
        ROUND(AVG(quality_percentage), 2) AS cq_score,
        ROUND(AVG(CASE WHEN COALESCE(data_theft_or_misuse,'')='' OR data_theft_or_misuse='null' THEN quality_percentage END), 2) AS cq_score_no_fatal,
        COUNT(CASE WHEN quality_percentage >= 90 THEN 1 END) AS excellent,
        COUNT(CASE WHEN quality_percentage >= 75 AND quality_percentage < 90 THEN 1 END) AS good,
        COUNT(CASE WHEN quality_percentage >= 50 AND quality_percentage < 75 THEN 1 END) AS average_count,
        COUNT(CASE WHEN quality_percentage < 50 THEN 1 END) AS below_average,
        COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) AS fatal_count,
        ROUND(AVG(call_answered_within_5_seconds)*100, 1) AS param_call_open,
        ROUND(AVG(professionalism_maintained)*100, 1) AS param_professionalism,
        ROUND(AVG(active_listening)*100, 1) AS param_active_listening,
        ROUND(AVG(proper_hold_procedure)*100, 1) AS param_hold_procedure,
        ROUND(AVG(correct_and_complete_information)*100, 1) AS param_resolution,
        ROUND(AVG(proper_call_closure)*100, 1) AS param_closing
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? AND ClientId = ?${scopeCond}
    `, params);

    return res.json({ success: true, data: rows[0] ?? {} });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[client-drill/kpis]", msg);
    return res.json({ success: true, data: {}, _error: msg });
  }
}));

// GET /api/quality-dashboard/client-drill/daily?clientId&from&to
router.get("/client-drill/daily", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = String(req.query.clientId ?? "");
    if (!clientId) return res.status(400).json({ success: false, error: "clientId required" });
    const scope = await resolveScope(req);
    const params: any[] = [from, to, clientId];
    const scopeCond = auditScopeCond(scope, params);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        DATE(CallDate) AS date,
        COUNT(*) AS audit_count,
        ROUND(AVG(quality_percentage), 2) AS cq_score,
        COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) AS fatal_count,
        ROUND(COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) * 100.0 / COUNT(*), 1) AS fatal_pct
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? AND ClientId = ?${scopeCond}
      GROUP BY DATE(CallDate) ORDER BY date ASC
    `, params);

    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[client-drill/daily]", msg);
    return res.json({ success: true, data: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/client-drill/agents?clientId&from&to
router.get("/client-drill/agents", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = String(req.query.clientId ?? "");
    if (!clientId) return res.status(400).json({ success: false, error: "clientId required" });
    const scope = await resolveScope(req);
    const params: any[] = [from, to, clientId];
    const scopeCond = auditScopeCond(scope, params);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        User AS agent_code,
        COUNT(*) AS audit_count,
        ROUND(AVG(quality_percentage), 2) AS cq_score,
        COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) AS fatal_count,
        ROUND(COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) * 100.0 / COUNT(*), 1) AS fatal_pct,
        COUNT(CASE WHEN quality_percentage >= 90 THEN 1 END) AS excellent,
        COUNT(CASE WHEN quality_percentage >= 75 AND quality_percentage < 90 THEN 1 END) AS good,
        COUNT(CASE WHEN quality_percentage < 50 THEN 1 END) AS below_average
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? AND ClientId = ?${scopeCond}
      GROUP BY User ORDER BY cq_score DESC LIMIT 50
    `, params);

    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[client-drill/agents]", msg);
    return res.json({ success: true, data: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/client-drill/fatal?clientId&from&to
router.get("/client-drill/fatal", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = String(req.query.clientId ?? "");
    if (!clientId) return res.status(400).json({ success: false, error: "clientId required" });
    const scope = await resolveScope(req);
    const params: any[] = [from, to, clientId];
    const scopeCond = auditScopeCond(scope, params);
    const pool = getCiPool();

    const [dailyRows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        DATE(CallDate) AS date,
        COUNT(*) AS total_audited,
        COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) AS fatal_count,
        ROUND(COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) * 100.0 / COUNT(*), 1) AS fatal_pct
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? AND ClientId = ?${scopeCond}
      GROUP BY DATE(CallDate) ORDER BY date ASC
    `, params);

    const params2: any[] = [from, to, clientId];
    const scopeCond2 = auditScopeCond(scope, params2);
    const [agentRows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        User AS agent_code,
        COUNT(*) AS audit_count,
        COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) AS fatal_count,
        ROUND(COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) * 100.0 / COUNT(*), 1) AS fatal_pct
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? AND ClientId = ?${scopeCond2}
        AND COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null'
      GROUP BY User ORDER BY fatal_count DESC LIMIT 20
    `, params2);

    return res.json({ success: true, daily: dailyRows, agents: agentRows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[client-drill/fatal]", msg);
    return res.json({ success: true, daily: [], agents: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/client-drill/scenarios?clientId&from&to
router.get("/client-drill/scenarios", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = String(req.query.clientId ?? "");
    if (!clientId) return res.status(400).json({ success: false, error: "clientId required" });
    const scope = await resolveScope(req);
    const params: any[] = [from, to, clientId];
    const scopeCond = auditScopeCond(scope, params);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COALESCE(scenario, 'Unknown') AS scenario,
        COALESCE(scenario1, '') AS sub_scenario,
        COUNT(*) AS call_count,
        ROUND(AVG(quality_percentage), 2) AS avg_quality,
        COUNT(CASE WHEN COALESCE(data_theft_or_misuse,'') != '' AND data_theft_or_misuse != 'null' THEN 1 END) AS fatal_count
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? AND ClientId = ?${scopeCond}
      GROUP BY scenario, scenario1 ORDER BY call_count DESC LIMIT 50
    `, params);

    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[client-drill/scenarios]", msg);
    return res.json({ success: true, data: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/client-drill/transcript?leadId
router.get("/client-drill/transcript", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const leadId = String(req.query.leadId ?? "");
    if (!leadId) return res.status(400).json({ success: false, error: "leadId required" });
    const pool = getCiPool();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lead_id, User AS agent_code, CallDate, quality_percentage, Transcribe_Text AS transcript,
              scenario, scenario1, areas_for_improvement
       FROM db_audit.call_quality_assessment WHERE lead_id = ? LIMIT 1`, [leadId]
    );
    return res.json({ success: true, data: rows[0] ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[client-drill/transcript]", msg);
    return res.json({ success: true, data: null, _error: msg });
  }
}));

// GET /api/quality-dashboard/client-drill/repeat?clientId&from&to
router.get("/client-drill/repeat", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const clientId = String(req.query.clientId ?? "");
    if (!clientId) return res.status(400).json({ success: false, error: "clientId required" });
    const scope = await resolveScope(req);
    const params: any[] = [from, to, clientId];
    const scopeCond = auditScopeCond(scope, params);
    const pool = getCiPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT MobileNo, COUNT(*) AS call_count, MIN(CallDate) AS first_call, MAX(CallDate) AS last_call
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? AND ClientId = ?${scopeCond}
      GROUP BY MobileNo HAVING COUNT(*) > 1
      ORDER BY call_count DESC LIMIT 50
    `, params);

    const totalCalls = rows.reduce((s: number, r: any) => s + Number(r.call_count), 0);
    const uniqueRepeaters = rows.length;

    return res.json({ success: true, summary: { total_repeat_calls: totalCalls, unique_repeaters: uniqueRepeaters }, data: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[client-drill/repeat]", msg);
    return res.json({ success: true, summary: { total_repeat_calls: 0, unique_repeaters: 0 }, data: [], _error: msg });
  }
}));

export const qualityDashboardRouter = router;
