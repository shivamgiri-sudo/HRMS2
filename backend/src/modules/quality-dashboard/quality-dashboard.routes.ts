import { Router } from "express";
import mysql from "mysql2/promise";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { hasRole, getEmployeeForUser } from "../../shared/accessGuard.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const ALLOWED_ROLES = ["admin", "hr", "ceo", "qa", "analyst", "manager", "process_manager", "branch_head"] as const;

/**
 * Resolve caller's data scope:
 * - admin/hr/ceo/qa/analyst → full access (no filter)
 * - process_manager/manager → scoped to their assigned process campaign_ids
 * - branch_head → scoped to their branch's agent emp_codes
 * Returns extra SQL conditions to AND into queries, or null for global access.
 */
async function resolveScope(req: AuthenticatedRequest): Promise<{
  global: boolean;
  campaignIds: string[] | null;  // filter Shivamgiri.apr by campaign_id
  agentCodes: string[] | null;   // filter db_audit by User / Shivamgiri by UserID
}> {
  const userId = req.authUser!.id;

  // Global roles see everything
  if (await hasRole(userId, "admin", "hr", "ceo", "qa", "analyst")) {
    return { global: true, campaignIds: null, agentCodes: null };
  }

  // Process manager / manager: get their assigned processes from user_assignment_scope
  if (await hasRole(userId, "process_manager", "manager")) {
    const [scopeRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT pm.process_name
       FROM user_assignment_scope uas
       JOIN process_master pm ON pm.id = uas.process_id
       WHERE uas.user_id = ? AND uas.active_status = 1 AND uas.process_id IS NOT NULL`,
      [userId]
    );
    const names = (scopeRows as any[]).map((r) => r.process_name as string).filter(Boolean);
    if (!names.length) return { global: false, campaignIds: [], agentCodes: [] };
    // Map mas_hrms process_name → Shivamgiri campaign_id (same values, direct match)
    return { global: false, campaignIds: names, agentCodes: null };
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
  if (scope.agentCodes !== null) {
    if (!scope.agentCodes.length) { params.push("__no_match__"); return " AND User = ?"; }
    const ph = scope.agentCodes.map(() => "?").join(",");
    params.push(...scope.agentCodes);
    return ` AND User IN (${ph})`;
  }
  // campaignIds for db_audit — no direct campaign column; return empty (process scope maps to UserID not User)
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
}));

// GET /api/quality-dashboard/trend
router.get("/trend", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
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
}));

// GET /api/quality-dashboard/agents
router.get("/agents", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
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
      User as agent_name,
      COUNT(*) as total_calls,
      ROUND(AVG(quality_percentage), 2) as avg_score,
      COUNT(CASE WHEN quality_percentage >= 80 THEN 1 END) as calls_above_80,
      COUNT(CASE WHEN quality_percentage < 50 THEN 1 END) as calls_below_50,
      CASE
        WHEN AVG(quality_percentage) >= 90 THEN 'excellent'
        WHEN AVG(quality_percentage) >= 80 THEN 'good'
        WHEN AVG(quality_percentage) >= 70 THEN 'average'
        WHEN AVG(quality_percentage) >= 60 THEN 'below_average'
        ELSE 'poor'
      END as band
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ? AND User IS NOT NULL AND User != ''${clientCond}${scopeCond}
    GROUP BY User
    HAVING COUNT(*) >= 3
    ORDER BY avg_score DESC
    LIMIT ?
  `, params);

  return res.json({ success: true, agents: rows });
}));

// GET /api/quality-dashboard/clients
router.get("/clients", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  const { from, to } = dateDefaults(req.query);
  const pool = getCiPool();

  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT
      ClientId as client_id,
      COUNT(*) as total_calls,
      ROUND(AVG(quality_percentage), 2) as avg_score,
      COUNT(DISTINCT User) as agent_count
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
      AND ClientId IS NOT NULL AND ClientId != ''
    GROUP BY ClientId
    ORDER BY total_calls DESC
    LIMIT 20
  `, [from, to]);

  return res.json({ success: true, clients: rows });
}));

// GET /api/quality-dashboard/apr
router.get("/apr", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  const { from, to } = dateDefaults(req.query);
  const limit = Math.min(Number(req.query.limit ?? 50), 500);
  const pool = getCiPool();

  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT
      UserID as agent_code,
      DATE_FORMAT(ReportDate, '%Y-%m-%d') as date,
      campaign_id,
      Calls,
      TIME_TO_SEC(COALESCE(AHT, '00:00:00')) as aht_seconds,
      TIME_TO_SEC(COALESCE(Login_Time, '00:00:00')) as login_seconds,
      TIME_TO_SEC(COALESCE(Net_Login, '00:00:00')) as net_login_seconds,
      TIME_TO_SEC(COALESCE(BIO, '00:00:00')) as bio_seconds,
      TIME_TO_SEC(COALESCE(LUNCH, '00:00:00')) as lunch_seconds,
      TIME_TO_SEC(COALESCE(QA, '00:00:00')) as qa_seconds,
      TIME_TO_SEC(COALESCE(TRAINING, '00:00:00')) as training_seconds,
      TIME_TO_SEC(COALESCE(DISMX, '00:00:00')) as dismx_seconds,
      CASE WHEN TIME_TO_SEC(COALESCE(Login_Time,'00:00:00')) > 0
        THEN ROUND((TIME_TO_SEC(COALESCE(BIO,'00:00:00')) + TIME_TO_SEC(COALESCE(LUNCH,'00:00:00')) +
                    TIME_TO_SEC(COALESCE(QA,'00:00:00')) + TIME_TO_SEC(COALESCE(TRAINING,'00:00:00')) +
                    TIME_TO_SEC(COALESCE(DISMX,'00:00:00'))) /
                   TIME_TO_SEC(COALESCE(Login_Time,'00:00:00')) * 100, 1)
        ELSE NULL
      END as shrinkage_pct
    FROM Shivamgiri.apr
    WHERE ReportDate BETWEEN ? AND ?
    ORDER BY ReportDate DESC
    LIMIT ?
  `, [from, to, limit]);

  return res.json({ success: true, apr: rows });
}));

// GET /api/quality-dashboard/apr-summary
router.get("/apr-summary", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const { from, to } = dateDefaults(req.query);
  const pool = getCiPool();
  const scope = await resolveScope(req);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [from, to];
  const scopeCond = aprScopeCond(scope, params);

  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT
      campaign_id as process,
      COUNT(DISTINCT UserID) as agents,
      ROUND(AVG(Calls), 1) as avg_calls,
      SEC_TO_TIME(ROUND(AVG(TIME_TO_SEC(COALESCE(AHT,'00:00:00'))),0)) as avg_aht,
      ROUND(AVG(
        CASE WHEN TIME_TO_SEC(COALESCE(Login_Time,'00:00:00')) > 0
        THEN (TIME_TO_SEC(COALESCE(BIO,'00:00:00')) + TIME_TO_SEC(COALESCE(LUNCH,'00:00:00')) +
              TIME_TO_SEC(COALESCE(QA,'00:00:00')) + TIME_TO_SEC(COALESCE(TRAINING,'00:00:00')) +
              TIME_TO_SEC(COALESCE(DISMX,'00:00:00'))) /
             TIME_TO_SEC(COALESCE(Login_Time,'00:00:00')) * 100
        ELSE NULL END
      ), 1) as avg_shrinkage_pct,
      ROUND(AVG(TIME_TO_SEC(COALESCE(BIO,'00:00:00')))/60, 1) as avg_bio_mins,
      ROUND(AVG(TIME_TO_SEC(COALESCE(LUNCH,'00:00:00')))/60, 1) as avg_lunch_mins,
      ROUND(AVG(TIME_TO_SEC(COALESCE(QA,'00:00:00')))/60, 1) as avg_qa_mins,
      ROUND(AVG(TIME_TO_SEC(COALESCE(TRAINING,'00:00:00')))/60, 1) as avg_training_mins
    FROM Shivamgiri.apr
    WHERE ReportDate BETWEEN ? AND ?${scopeCond}
    GROUP BY campaign_id
    ORDER BY avg_calls DESC
    LIMIT 20
  `, params);

  return res.json({ success: true, processes: rows });
}));

// GET /api/quality-dashboard/sales-intelligence
router.get("/sales-intelligence", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
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
}));

// GET /api/quality-dashboard/objections
router.get("/objections", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
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
}));

// GET /api/quality-dashboard/fraud-signals
router.get("/fraud-signals", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
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
}));

// GET /api/quality-dashboard/sales-funnel
router.get("/sales-funnel", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  const { from, to } = dateDefaults(req.query);
  const clientId = req.query.client_id as string | undefined;
  const pool = getCiPool();

  const whereClauses = ["CallDate BETWEEN ? AND ?"];
  const params: unknown[] = [from, to];
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
}));

export const qualityDashboardRouter = router;
