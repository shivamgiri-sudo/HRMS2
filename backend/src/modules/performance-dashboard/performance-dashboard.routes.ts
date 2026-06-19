import { Router } from "express";
import mysql from "mysql2/promise";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { hasRole, getEmployeeForUser } from "../../shared/accessGuard.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getPerfSummary, getAgentMatrix, getPerfTrend, getProcessComparison, getUtilization } from "./performance-dashboard.service.js";

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

// GET /api/performance-dashboard/summary
router.get("/summary", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const { from, to } = dateDefaults(req.query);
  try {
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aprParams: any[] = [from, to];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditParams: any[] = [from, to];
    const aprSql = aprScopeCond(scope, aprParams);
    const auditSql = auditScopeCond(scope, auditParams);
    const data = await getPerfSummary(pool, from, to, aprSql, auditSql, aprParams, auditParams);
    return res.json({
      success: true,
      summary: data,
      scope_label: scope.global ? "All" : scope.campaignIds ? `Processes: ${scope.campaignIds.join(", ")}` : `Branch agents: ${scope.agentCodes?.length ?? 0}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[performance-dashboard/summary]", msg);
    return res.json({ success: true, summary: { total_agents: 0, avg_calls_per_agent: 0, avg_quality: 0, avg_shrinkage: 0, avg_conversion_rate: 0, total_sales: 0, calls_per_hour_avg: 0 }, scope_label: "All", _error: msg });
  }
}));

// GET /api/performance-dashboard/agent-matrix
router.get("/agent-matrix", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const { from, to } = dateDefaults(req.query);
  try {
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aprParams: any[] = [from, to];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditParams: any[] = [from, to];
    const aprSql = aprScopeCond(scope, aprParams);
    const auditSql = auditScopeCond(scope, auditParams);
    const rows = await getAgentMatrix(pool, from, to, aprSql, auditSql, aprParams, auditParams);
    return res.json({
      success: true,
      matrix: rows,
      scope_label: scope.global ? "All" : scope.campaignIds ? `Processes: ${scope.campaignIds.join(", ")}` : `Branch agents: ${scope.agentCodes?.length ?? 0}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[performance-dashboard/agent-matrix]", msg);
    return res.json({ success: true, matrix: [], scope_label: "All", _error: msg });
  }
}));

// GET /api/performance-dashboard/trend
router.get("/trend", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const { from, to } = dateDefaults(req.query);
  try {
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aprParams: any[] = [from, to];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditParams: any[] = [from, to];
    const aprSql = aprScopeCond(scope, aprParams);
    const auditSql = auditScopeCond(scope, auditParams);
    const data = await getPerfTrend(pool, from, to, aprSql, auditSql, aprParams, auditParams);
    return res.json({
      success: true,
      ...data,
      scope_label: scope.global ? "All" : scope.campaignIds ? `Processes: ${scope.campaignIds.join(", ")}` : `Branch agents: ${scope.agentCodes?.length ?? 0}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[performance-dashboard/trend]", msg);
    return res.json({ success: true, apr_trend: [], audit_trend: [], sales_trend: [], scope_label: "All", _error: msg });
  }
}));

// GET /api/performance-dashboard/process-comparison
router.get("/process-comparison", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const { from, to } = dateDefaults(req.query);
  try {
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aprParams: any[] = [from, to];
    const aprSql = aprScopeCond(scope, aprParams);
    const rows = await getProcessComparison(pool, from, to, aprSql, aprParams);
    return res.json({
      success: true,
      processes: rows,
      scope_label: scope.global ? "All" : scope.campaignIds ? `Processes: ${scope.campaignIds.join(", ")}` : `Branch agents: ${scope.agentCodes?.length ?? 0}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[performance-dashboard/process-comparison]", msg);
    return res.json({ success: true, processes: [], scope_label: "All", _error: msg });
  }
}));

// GET /api/performance-dashboard/utilization
router.get("/utilization", requireRole(...ALLOWED_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const { from, to } = dateDefaults(req.query);
  try {
    const pool = getCiPool();
    const scope = await resolveScope(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aprParams: any[] = [from, to];
    const aprSql = aprScopeCond(scope, aprParams);
    const rows = await getUtilization(pool, from, to, aprSql, aprParams);
    return res.json({
      success: true,
      utilization: rows,
      scope_label: scope.global ? "All" : scope.campaignIds ? `Processes: ${scope.campaignIds.join(", ")}` : `Branch agents: ${scope.agentCodes?.length ?? 0}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "External DB unavailable";
    console.error("[performance-dashboard/utilization]", msg);
    return res.json({ success: true, utilization: [], scope_label: "All", _error: msg });
  }
}));

export const performanceDashboardRouter = router;
