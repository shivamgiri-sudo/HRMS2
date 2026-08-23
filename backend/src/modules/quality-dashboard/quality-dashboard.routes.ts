import { Router } from "express";
import { sqlLimit } from "../../db/pagination.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getShivamgiriPool } from "../../db/shivamgiriDb.js";
import { db } from "../../db/mysql.js";
import { hasRole, getEmployeeForUser } from "../../shared/accessGuard.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getQualityHeatmap, predictAgentRisk, generateInsights, calculateQualityROI } from "./quality-insights.service.js";
import { logSourceFailure } from "../../shared/apiResponse.js";
import {
  getTopObjectionPatterns,
  getTopObjectionHandlers,
  getSalesClosedAfterObjection,
  getObjectionsByProcess,
  getObjectionRebuttalMatrix,
  getObjectionHealthDashboard,
  generateComprehensiveObjectionReport,
} from "./objection-analysis.service.js";
import { getInboundSummary } from "./inbound-ops.service.js";

const router = Router();
router.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const ALLOWED_ROLES = ["admin", "hr", "super_admin", "ceo", "qa", "quality_analyst", "manager", "process_manager", "branch_head"] as const;

/**
 * Resolve caller's data scope:
 * - admin/hr/ceo/qa/quality_analyst → full access (no filter)
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
  if (await hasRole(userId, "admin", "hr", "ceo", "qa", "quality_analyst")) {
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

function getCiPool() {
  return getShivamgiriPool();
}

function dateDefaults(query: Record<string, unknown>): { from: string; to: string } {
  const now = new Date();
  const to = query.to ? String(query.to) : now.toISOString().slice(0, 10);
  const from = query.from ? String(query.from) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return { from, to };
}

// GET /api/quality-dashboard/inbound-ops/summary
router.get("/inbound-ops/summary", requireRole(...ALLOWED_ROLES), h(async (req, res) => {
  const { from, to } = dateDefaults(req.query);
  const projectKeys = typeof req.query.projects === "string"
    ? req.query.projects.split(",").map((key) => key.trim()).filter(Boolean)
    : undefined;
  const data = await getInboundSummary(from, to, projectKeys);
  return res.json({ success: true, data });
}));

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
        -- Each fail_rate is scoped to calls where that specific parameter was actually
        -- recorded (COUNT(col), not COUNT(*)) rather than treating every NULL as a fail.
        -- Confirmed live: professionalism_maintained alone is NULL on 4,788 of 13,071
        -- rows in a typical 30-day window -- more than the 3,871 rows with no
        -- quality_percentage at all -- so "not scored on this parameter" is common even
        -- among calls that otherwise got a score, and COALESCE(x,0) was counting every
        -- one of those as a hard fail and inflating every fail-rate tile.
        ROUND(100 - (AVG(call_answered_within_5_seconds) * 100), 1) as fail_rate_call_open,
        ROUND(100 - (AVG(professionalism_maintained) * 100), 1) as fail_rate_professionalism,
        ROUND(100 - (AVG(active_listening) * 100), 1) as fail_rate_active_listening,
        ROUND(100 - (AVG(proper_call_closure) * 100), 1) as fail_rate_call_closure,
        ROUND(100 - (AVG(correct_and_complete_information) * 100), 1) as fail_rate_accuracy
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

    // Stamp the newest audited call in range. db_audit is an upstream system, so a
    // dashboard must be able to say how current its quality numbers are rather than
    // implying they are live.
    const [freshRows] = await pool.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) AS latest FROM db_audit.call_quality_assessment
        WHERE CallDate BETWEEN ? AND ?`,
      [from, to],
    );

    return res.json({
      success: true,
      summary: row,
      parameter_fails: parameterFails,
      source: { table: "db_audit.call_quality_assessment", latest_record: (freshRows[0] as any)?.latest ?? null },
      scope_label: scope.global ? "All" : scope.campaignIds ? `Processes: ${scope.campaignIds.join(", ")}` : `Branch agents: ${scope.agentCodes?.length ?? 0}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    logSourceFailure("quality-dashboard.summary", err, { endpoint: "/summary" });
    // Previously returned a full set of zeros at HTTP 200, which renders as "0% quality,
    // 0 calls audited" — indistinguishable from a genuinely quiet period. Return nulls
    // plus an explicit unavailable reason so the UI states the source is down.
    return res.json({
      success: true,
      summary: null,
      parameter_fails: [],
      scope_label: "All",
      unavailableSources: { quality: `Quality audit source unavailable: ${msg}` },
    });
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

    const groupExpr = granularity === "week" ? "YEARWEEK(CallDate)" : "DATE_FORMAT(CallDate,'%Y-%m-%d')";
    const labelExpr = granularity === "week" ? "DATE_FORMAT(MIN(CallDate),'%Y-%m-%d')" : "DATE_FORMAT(CallDate,'%Y-%m-%d')";

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
    // limit is interpolated by sqlLimit below, not bound. It was being pushed as String(limit)
    // specifically because binding the number fails - a workaround one Number() away from
    // breaking again.

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        cqa.User AS agent_code,
        ANY_VALUE(COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, COALESCE(e.last_name,'')), cqa.User)) AS agent_name,
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
      LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User COLLATE utf8mb4_unicode_ci
      WHERE cqa.CallDate BETWEEN ? AND ?
        AND cqa.User IS NOT NULL AND cqa.User != ''
        AND COALESCE(e.active_status, 1) = 1
        ${clientCond}${scopeCond}
      GROUP BY cqa.User
      HAVING COUNT(*) >= 3
        AND agent_name NOT LIKE 'Codex E2E%'
      ORDER BY avg_score DESC
      ${sqlLimit(limit, { maxLimit: 100 })}
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
    // Row scope was missing here while /summary, /trend and /fraud-signals all apply
    // it, so a branch_head or process_manager saw correctly-scoped headline figures
    // beside an org-wide client table. Harmless for a global-scope caller such as the
    // CEO, which is why the UAT did not surface it.
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    const scopeCond = auditScopeCond(scope, params);

    // client_name is no longer COALESCEd over a join that cannot match.
    //
    // db_audit.call_quality_assessment.ClientId holds opaque numeric ids belonging to
    // the audit system. Verified 31-Jul-2026: 15 distinct ids, ZERO of which match
    // mas_hrms.client_master on either client_code (business codes like 'MCIPL') or id
    // (CHAR(36) UUIDs), and db_audit contains no client table at all. There is no name
    // source reachable from either database.
    //
    // The old COALESCE(cm.client_name, cqa.ClientId) hid that: a 0% match rate rendered
    // as a "client name" of 475, which reads as corrupted data rather than a missing
    // mapping. client_name is now explicitly NULL so callers can distinguish "unmapped"
    // from "named", and the UI labels the id as an id.
    //
    // Resolving this needs a ClientId -> name mapping for those 15 ids from whoever owns
    // the audit system; it is not recoverable in code.
    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        cqa.ClientId as client_id,
        NULL as client_name,
        COUNT(*) as total_calls,
        ROUND(AVG(cqa.quality_percentage), 2) as avg_score,
        COUNT(DISTINCT cqa.User) as agent_count
      FROM db_audit.call_quality_assessment cqa
      WHERE cqa.CallDate BETWEEN ? AND ?
        AND cqa.ClientId IS NOT NULL AND cqa.ClientId != ''
        ${scopeCond}
      GROUP BY cqa.ClientId
      ORDER BY total_calls DESC
      LIMIT 20
    `, params);

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
      -- Shivamgiri.apr.UserID is utf8mb4_0900_ai_ci and mas_hrms.employees.employee_code is
      -- utf8mb4_unicode_ci, so comparing them raised ER_CANT_AGGREGATE_2COLLATIONS and this
      -- endpoint returned 500 for every request against 27,374 rows of agent performance.
      LEFT JOIN mas_hrms.employees e ON e.employee_code = apr.UserID COLLATE utf8mb4_unicode_ci
      WHERE apr.ReportDate BETWEEN ? AND ?
      ORDER BY apr.ReportDate DESC
      ${sqlLimit(limit)}
    `, [from, to]);

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
      LEFT JOIN mas_hrms.process_master pm ON pm.process_code = apr.campaign_id COLLATE utf8mb4_unicode_ci
      WHERE apr.ReportDate BETWEEN ? AND ?${scopeCond}
      GROUP BY apr.campaign_id
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
        SUM(CASE WHEN SaleDone='1' OR SaleDone=1 OR LOWER(SaleDone)='yes' THEN 1 ELSE 0 END) as sales_done,
        SUM(CASE WHEN CompetitorName IS NOT NULL AND CompetitorName NOT IN ('','null','None','none') THEN 1 ELSE 0 END) as competitor_mentions,
        COUNT(DISTINCT client_id) as unique_clients,
        SUM(CASE WHEN ObjectionHandling='1' OR ObjectionHandling=1 THEN 1 ELSE 0 END) as objection_calls
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ?${clientCond}
    `, summaryParams);

    const [competitorRows] = await pool.execute<RowDataPacket[]>(`
      SELECT CompetitorName, COUNT(*) as mentions
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ?
        AND CompetitorName IS NOT NULL
        AND CompetitorName NOT IN ('','null','None','none')
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
      ${sqlLimit(limit)}
    `, []);

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
        SUM(CASE WHEN Opening='1' OR Opening=1 THEN 1 ELSE 0 END) as opening_done,
        SUM(CASE WHEN Offered='1' OR Offered=1 THEN 1 ELSE 0 END) as offer_made,
        SUM(CASE WHEN ObjectionHandling='1' OR ObjectionHandling=1 THEN 1 ELSE 0 END) as objection_handled,
        SUM(CASE WHEN SaleDone='1' OR SaleDone=1 OR LOWER(SaleDone)='yes' THEN 1 ELSE 0 END) as sale_done
      FROM db_external.CallDetails WHERE ${where}
    `, params);

    const [rejection] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*) as total_calls,
        SUM(CASE WHEN NotInterestedBucketReason IS NOT NULL AND NotInterestedBucketReason NOT IN ('','null','None') THEN 1 ELSE 0 END) as not_interested,
        SUM(CASE WHEN CustomerObjectionCategory IS NOT NULL AND CustomerObjectionCategory NOT IN ('','null','None') THEN 1 ELSE 0 END) as objection_raised,
        SUM(CASE WHEN AfterListeningOfferRejected='1' OR AfterListeningOfferRejected=1 THEN 1 ELSE 0 END) as rejected_after_offer,
        SUM(CASE WHEN OfferingRejected='1' OR OfferingRejected=1 THEN 1 ELSE 0 END) as offering_rejected,
        SUM(CASE WHEN OpeningRejected='1' OR OpeningRejected=1 THEN 1 ELSE 0 END) as opening_rejected
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
// SECURITY FIX: Now resolves scope so branch_head/process_manager see only their agents' heatmap
router.get("/heatmap", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const scope = await resolveScope(req);
    const data = await getQualityHeatmap(from, to, scope);
    return res.json({ success: true, heatmap: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/heatmap]", msg);
    return res.json({ success: true, heatmap: {}, _error: msg });
  }
}));

// GET /api/quality-dashboard/agent-risk
// SECURITY FIX: Scope is now applied at the SQL level inside predictAgentRisk instead of
// post-filtering in JS. The old post-filter only handled agentCodes (branch_head) and
// missed process_manager scope entirely.
router.get("/agent-risk", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const scope = await resolveScope(req);
    const agents = await predictAgentRisk(from, to, scope);
    return res.json({ success: true, agents });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/agent-risk]", msg);
    return res.json({ success: true, agents: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/insights
// SECURITY FIX: Now resolves scope so insights are computed only from the caller's scoped data
router.get("/insights", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const scope = await resolveScope(req);
    const insights = await generateInsights(from, to, scope);
    return res.json({ success: true, insights });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/insights]", msg);
    return res.json({ success: true, insights: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/roi
// SECURITY FIX: Now resolves scope so ROI projections are based only on the caller's scoped data
router.get("/roi", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const scope = await resolveScope(req);
    const roi = await calculateQualityROI(from, to, scope);
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
// SECURITY FIX: Now resolves scope so branch_head/process_manager see only their scoped data
router.get("/objections/patterns", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const scope = await resolveScope(req);
    const patterns = await getTopObjectionPatterns(limit, scope);
    return res.json({ success: true, patterns });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/patterns]", msg);
    return res.json({ success: true, patterns: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/handlers
// Top objection handlers with best resolution and sales conversion rates
// SECURITY FIX: Now resolves scope so branch_head/process_manager see only their scoped agents
router.get("/objections/handlers", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const scope = await resolveScope(req);
    const handlers = await getTopObjectionHandlers(limit, scope);
    return res.json({ success: true, handlers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/handlers]", msg);
    return res.json({ success: true, handlers: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/sales-metrics
// Sales conversion rates after objection handling by objection type
// SECURITY FIX: Now resolves scope so branch_head/process_manager see only their scoped data
router.get("/objections/sales-metrics", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const scope = await resolveScope(req);
    const metrics = await getSalesClosedAfterObjection(limit, scope);
    return res.json({ success: true, metrics });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[quality-dashboard/objections/sales-metrics]", msg);
    return res.json({ success: true, metrics: [], _error: msg });
  }
}));

// GET /api/quality-dashboard/objections/by-process
// Objection types breakdown by process/campaign
// SECURITY FIX: Now resolves scope so process_manager only sees their assigned processes
router.get("/objections/by-process", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const scope = await resolveScope(req);
    const data = await getObjectionsByProcess(limit, scope);
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
// SECURITY FIX: Now resolves scope so branch_head/process_manager see only their scoped aggregates
router.get("/objections/health", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const scope = await resolveScope(req);
    // Optional bounds. Passing neither keeps the all-time figures this returned before; passing
    // both lets the query seek on CallDate's index instead of scanning 503k rows.
    const dashboard = await getObjectionHealthDashboard({
      startDate: req.query.from ? String(req.query.from) : undefined,
      endDate: req.query.to ? String(req.query.to) : undefined,
    }, scope);
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
// SECURITY FIX: Now resolves scope so the full report respects row-level access
router.get("/objections/comprehensive-report", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const patternLimit = Math.min(Number(req.query.patternLimit ?? 50), 200);
    const handlerLimit = Math.min(Number(req.query.handlerLimit ?? 50), 200);
    const processLimit = Math.min(Number(req.query.processLimit ?? 100), 500);
    const rebuttalLimit = Math.min(Number(req.query.rebuttalLimit ?? 100), 500);
    const scope = await resolveScope(req);

    const report = await generateComprehensiveObjectionReport(
      patternLimit,
      handlerLimit,
      processLimit,
      rebuttalLimit,
      scope
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

/**
 * GET /api/quality-dashboard/scores
 *
 * The quality feed for UnifiedPerformanceCommandCenter. It has called this since it was
 * written and the route did not exist, so its safe() wrapper turned the failure into an empty
 * array: avgQuality read 0, critical read 0, and because neither crossed a threshold the alert
 * panel settled on "Stable control — no major alert" using data it never received.
 *
 * ATTRIBUTION — the part that made this look unbuildable
 *   db_audit.call_quality_assessment identifies an agent only by `User`, an 8-character dialer
 *   login. employees.call_centre_code, the obvious bridge, is NULL on all 58,627 rows, so that
 *   join resolves nothing and the feed appeared impossible to scope.
 *
 *   Shivamgiri.employee_source_alias is the real bridge: employee_code ↔ source_agent_name per
 *   source_system, with 2,033 rows for 'db_audit'. Measured over the last 90 days it resolves
 *   17,949 of 19,827 audits (90.5%) to an employee, and every one of those has a branch. The
 *   remaining ~9% are agents with no alias row and are simply absent rather than lumped into
 *   an "Unmapped" bucket that would silently distort a branch average.
 *
 *   COLLATE is required and not cosmetic: db_audit is utf8mb4_0900_ai_ci and Shivamgiri is
 *   utf8mb4_unicode_ci, so the unqualified join dies with ER_CANT_AGGREGATE_2COLLATIONS.
 *
 * SHAPE
 *   One row per employee, which is what the page's maths wants: it averages quality_score
 *   across rows and SUMs fatal_count. Per-agent keeps that average meaningful and the row
 *   count small (55 agents in 90 days) against its limit=1000.
 *
 *   fatal_count follows the classification already established in client-drill.service.ts —
 *   quality_percentage = 0 is a fatal audit — rather than inventing a second definition.
 */
router.get("/scores", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  try {
    const { from, to } = dateDefaults(req.query);
    const pool = getCiPool();
    const scope = await resolveScope(req);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [from, to];
    const scopeCond = auditScopeCond(scope, params);

    const [rows] = await pool.query(
      `SELECT e.employee_code,
              COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
              COALESCE(NULLIF(b.branch_name, ''), 'Unmapped')  AS branch_name,
              COALESCE(NULLIF(p.process_name, ''), 'Unmapped') AS process_name,
              COUNT(*)                                                        AS audit_count,
              ROUND(AVG(cqa.quality_percentage), 1)                           AS quality_score,
              SUM(CASE WHEN cqa.quality_percentage = 0 THEN 1 ELSE 0 END)     AS fatal_count
         FROM db_audit.call_quality_assessment cqa
         JOIN Shivamgiri.employee_source_alias a
           ON a.source_agent_name = cqa.User COLLATE utf8mb4_unicode_ci
          AND a.source_system = 'db_audit'
          AND a.active_status = 1
         JOIN mas_hrms.employees e
           ON e.employee_code = a.employee_code COLLATE utf8mb4_unicode_ci
         LEFT JOIN mas_hrms.branch_master b  ON b.id = e.branch_id
         LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
        WHERE DATE(cqa.CallDate) BETWEEN ? AND ?${scopeCond}
        GROUP BY e.employee_code, employee_name, branch_name, process_name
        ORDER BY fatal_count DESC, audit_count DESC`,
      params
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    // The module's convention: report the source failure and return an empty feed, which the
    // page then names in its "unavailable" banner rather than charting a fabricated zero.
    logSourceFailure("quality-dashboard", err, { endpoint: "scores" });
    return res.json({ success: true, data: [] });
  }
}));

export const qualityDashboardRouter = router;
