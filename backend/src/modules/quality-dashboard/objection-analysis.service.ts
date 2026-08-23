/**
 * Objection Analysis Service
 *
 * SECURITY FIX: All query functions now accept a scope parameter and apply row-level
 * filtering via AgentName (for branch_head scope) or campaign_id (for process_manager scope).
 * Previously, any user with route access could see full org-wide objection data regardless
 * of their role-based scope assignment.
 */

import type { RowDataPacket } from "mysql2";
import { sqlLimit } from "../../db/pagination.js";
import { getShivamgiriPool } from "../../db/shivamgiriDb.js";

function getCiPool() {
  return getShivamgiriPool();
}

/**
 * Scope descriptor resolved by the route layer (resolveScope in quality-dashboard.routes.ts).
 * Duplicated here as an interface to avoid circular imports.
 */
export interface QualityScope {
  global: boolean;
  campaignIds: string[] | null;
  agentCodes: string[] | null;
  resolvedAuditCodes?: string[] | null;
}

/**
 * Build a WHERE clause fragment for db_external.CallDetails scoped by AgentName or campaign_id.
 * Mirrors the auditScopeCond() pattern in quality-dashboard.routes.ts but targets the
 * CallDetails table columns.
 *
 * SECURITY: ensures non-global callers only see rows matching their assigned agents/processes.
 *
 * @param tableAlias - optional table alias (e.g. "cd") to prefix column names
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callDetailsScopeCond(scope: QualityScope, params: any[], tableAlias?: string): string {
  if (scope.global) return "";
  const prefix = tableAlias ? `${tableAlias}.` : "";

  // Process manager: filter by campaign_id (process names)
  if (scope.campaignIds !== null) {
    if (!scope.campaignIds.length) { params.push("__no_match__"); return ` AND ${prefix}campaign_id = ?`; }
    const ph = scope.campaignIds.map(() => "?").join(",");
    params.push(...scope.campaignIds);
    return ` AND ${prefix}campaign_id IN (${ph})`;
  }

  // Branch head: filter by AgentName (agent employee codes)
  // Also use resolvedAuditCodes if agentCodes is null (process_manager resolved codes)
  const codes = scope.agentCodes ?? scope.resolvedAuditCodes ?? null;
  if (codes !== null) {
    if (!codes.length) { params.push("__no_match__"); return ` AND ${prefix}AgentName = ?`; }
    const ph = codes.map(() => "?").join(",");
    params.push(...codes);
    return ` AND ${prefix}AgentName IN (${ph})`;
  }

  return "";
}

/**
 * Top Objection Types with Resolution and Sales Metrics
 */
export interface ObjectionPattern {
  CustomerObjectionCategory: string;
  CALL_COUNT: number;
  HANDLED_COUNT: number;
  RESOLUTION_RATE_PCT: number;
  SALES_AFTER_OBJECTION: number;
  SALES_CLOSE_RATE_AFTER_OBJECTION_PCT: number | null;
}

/**
 * SECURITY FIX: Added scope parameter - filters by AgentName/campaign_id so
 * branch_head sees only their branch's objection patterns.
 */
export async function getTopObjectionPatterns(limit = 50, scope?: QualityScope): Promise<ObjectionPattern[]> {
  const pool = getCiPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [];
  const scopeCond = scope ? callDetailsScopeCond(scope, params) : "";

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      CustomerObjectionCategory AS OBJECTION,
      COUNT(*) as CALL_COUNT,
      SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
      ROUND(
        (SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
      ) as RESOLUTION_RATE_PCT,
      SUM(CASE
        WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
        AND (SaleDone = 'Yes' OR SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_AFTER_OBJECTION,
      ROUND(
        (SUM(CASE
          WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
          AND (SaleDone = 'Yes' OR SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
      ) as SALES_CLOSE_RATE_AFTER_OBJECTION_PCT
    FROM db_external.CallDetails
    WHERE CustomerObjectionCategory IS NOT NULL
      AND CustomerObjectionCategory != ''
      AND CustomerObjectionCategory != 'null'
      AND CustomerObjectionCategory != 'None'
      AND CustomerObjectionCategory IS NOT NULL${scopeCond}
    GROUP BY CustomerObjectionCategory
    ORDER BY CALL_COUNT DESC
    ${sqlLimit(limit)}`,
    params
  );

  return rows as ObjectionPattern[];
}

/**
 * Top Objection Handlers - Agents with Best Resolution Rates
 */
export interface TopHandler {
  HANDLER_CODE: string;
  HANDLER_NAME: string;
  OBJECTIONS_HANDLED: number;
  UNIQUE_OBJECTION_TYPES: number;
  SALES_CLOSE_RATE_AFTER_OBJ_PCT: number;
  SALES_CLOSED_COUNT: number;
}

/**
 * SECURITY FIX: Added scope parameter - filters by AgentName/campaign_id so
 * branch_head/process_manager sees only their scoped agents' handler stats.
 */
export async function getTopObjectionHandlers(limit = 50, scope?: QualityScope): Promise<TopHandler[]> {
  const pool = getCiPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [];
  const scopeCond = scope ? callDetailsScopeCond(scope, params, "cd") : "";

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      cd.AgentName as HANDLER_CODE,
      COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, COALESCE(e.last_name,'')), cd.AgentName) AS HANDLER_NAME,
      COUNT(*) as OBJECTIONS_HANDLED,
      COUNT(DISTINCT cd.CustomerObjectionCategory) as UNIQUE_OBJECTION_TYPES,
      ROUND(
        (SUM(CASE
          WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
          AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) / COUNT(*), 2
      ) as SALES_CLOSE_RATE_AFTER_OBJ_PCT,
      SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_CLOSED_COUNT
    FROM db_external.CallDetails cd
    LEFT JOIN mas_hrms.employees e ON e.employee_code = cd.AgentName COLLATE utf8mb4_unicode_ci
    WHERE cd.CustomerObjectionCategory IS NOT NULL
      AND cd.CustomerObjectionCategory != ''
      AND cd.CustomerObjectionCategory != 'null'
      AND cd.CustomerObjectionCategory != 'None'
      AND cd.ObjectionHandling IS NOT NULL
      AND cd.ObjectionHandling NOT IN ('', 'null')
      AND cd.AgentName IS NOT NULL${scopeCond}
    GROUP BY cd.AgentName, e.full_name, e.first_name, e.last_name
    HAVING COUNT(*) >= 5
    ORDER BY SALES_CLOSE_RATE_AFTER_OBJ_PCT DESC
    ${sqlLimit(limit)}`,
    params
  );

  return rows as TopHandler[];
}

/**
 * Sales Closed After Objection Handling
 */
export interface ObjectionSalesMetric {
  CustomerObjectionCategory: string;
  OBJECTION_RAISED_COUNT: number;
  HANDLED_COUNT: number;
  SALES_CLOSED_AFTER_HANDLING: number;
  CONVERSION_RATE_AFTER_HANDLING_PCT: number | null;
}

/**
 * SECURITY FIX: Added scope parameter - filters by AgentName/campaign_id.
 */
export async function getSalesClosedAfterObjection(limit = 50, scope?: QualityScope): Promise<ObjectionSalesMetric[]> {
  const pool = getCiPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [];
  const scopeCond = scope ? callDetailsScopeCond(scope, params, "cd") : "";

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      cd.CustomerObjectionCategory AS OBJECTION,
      COUNT(*) as OBJECTION_RAISED_COUNT,
      SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
      SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_CLOSED_AFTER_HANDLING,
      ROUND(
        (SUM(CASE
          WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
          AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
      ) as CONVERSION_RATE_AFTER_HANDLING_PCT
    FROM db_external.CallDetails cd
    WHERE cd.CustomerObjectionCategory IS NOT NULL
      AND cd.CustomerObjectionCategory != ''
      AND cd.CustomerObjectionCategory != 'null'
      AND cd.CustomerObjectionCategory != 'None'${scopeCond}
    GROUP BY cd.CustomerObjectionCategory
    ORDER BY SALES_CLOSED_AFTER_HANDLING DESC
    ${sqlLimit(limit)}`,
    params
  );

  return rows as ObjectionSalesMetric[];
}

/**
 * Objection Types by Process
 */
export interface ProcessObjectionMetric {
  PROCESS_CODE: string;
  PROCESS_NAME: string;
  CustomerObjectionCategory: string;
  OBJECTION_COUNT: number;
  HANDLED_COUNT: number;
  RESOLUTION_RATE_PCT: number;
  SALES_AFTER_OBJECTION: number;
}

/**
 * SECURITY FIX: Added scope parameter - process_manager only sees their assigned processes,
 * branch_head only sees their branch's agents' objection data by process.
 */
export async function getObjectionsByProcess(limit = 100, scope?: QualityScope): Promise<ProcessObjectionMetric[]> {
  const pool = getCiPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [];
  const scopeCond = scope ? callDetailsScopeCond(scope, params, "cd") : "";

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      COALESCE(cd.campaign_id, 'UNASSIGNED') as PROCESS_CODE,
      COALESCE(pm.process_name, cd.campaign_id, 'UNASSIGNED') as PROCESS_NAME,
      cd.CustomerObjectionCategory AS OBJECTION,
      COUNT(*) as OBJECTION_COUNT,
      SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
      ROUND(
        (SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
      ) as RESOLUTION_RATE_PCT,
      SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_AFTER_OBJECTION
    FROM db_external.CallDetails cd
    -- Same collation boundary as the employees join above: CallDetails is utf8mb4_0900_ai_ci,
    -- mas_hrms.process_master is utf8mb4_unicode_ci.
    LEFT JOIN mas_hrms.process_master pm ON pm.process_code = cd.campaign_id COLLATE utf8mb4_unicode_ci
    WHERE cd.CustomerObjectionCategory IS NOT NULL
      AND cd.CustomerObjectionCategory != ''
      AND cd.CustomerObjectionCategory != 'null'
      AND cd.CustomerObjectionCategory != 'None'${scopeCond}
    GROUP BY cd.campaign_id, pm.process_name, cd.CustomerObjectionCategory
    ORDER BY PROCESS_CODE, OBJECTION_COUNT DESC
    ${sqlLimit(limit)}`,
    params
  );

  return rows as ProcessObjectionMetric[];
}

/**
 * Objection & Rebuttal Reference Matrix
 *
 * NOTE: This query hits db_external.tbl_obj which is a reference/knowledge-base table
 * (objection -> rebuttal mappings), not per-agent call data. It has no AgentName or
 * campaign_id column, so scope filtering is not applicable here. This is intentionally
 * unscoped — it's reference material available to all authorized roles.
 */
export interface ObjectionRebuttal {
  CustomerObjectionCategory: string;
  RECOMMENDED_REBUTTAL: string;
  FREQUENCY: number;
}

export async function getObjectionRebuttalMatrix(limit = 100): Promise<ObjectionRebuttal[]> {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      obj.Objection as OBJECTION,
      obj.Rebutal as RECOMMENDED_REBUTTAL,
      COUNT(*) as FREQUENCY
    FROM db_external.tbl_obj obj
    WHERE obj.Objection IS NOT NULL
      AND obj.Objection != ''
      AND obj.Objection != 'null'
    GROUP BY obj.Objection, obj.Rebutal
    ORDER BY FREQUENCY DESC
    ${sqlLimit(limit)}`,
    []
  );

  return rows as ObjectionRebuttal[];
}

/**
 * Overall Objection Health Dashboard
 */
export interface ObjectionHealthDashboard {
  TOTAL_OBJECTIONS_RAISED: number;
  UNIQUE_OBJECTION_TYPES: number;
  TOTAL_OBJECTIONS_HANDLED: number;
  OVERALL_RESOLUTION_RATE_PCT: number;
  SALES_CLOSED_AFTER_OBJECTION_HANDLING: number;
  SALES_CONVERSION_AFTER_OBJECTION_PCT: number | null;
  UNIQUE_HANDLERS: number;
  UNIQUE_CLIENTS: number;
  UNIQUE_PROCESSES: number;
}

/*
 * 'None' is the sentinel db_external.CallDetails writes when the customer raised no objection,
 * and it is by far the most common value: of 503,072 calls, 306,250 are 'None' and 68,453 are
 * NULL, leaving 128,365 real objections. Excluding NULL, '' and the string 'null' but not 'None'
 * counts a call where nothing was objected to as an objection - here that inflated
 * TOTAL_OBJECTIONS_RAISED to 434,618, and dragged every rate computed against it down by the
 * same factor, because the denominator grew while the sales numerator did not.
 */
/*
 * Optional date bounds. Omitting them keeps the previous all-time behaviour exactly, so no
 * existing caller changes meaning.
 *
 * They exist because this is the one objection query with no way to narrow it, and it aggregates
 * six SUM(CASE ...) expressions over every row of db_external.CallDetails - 503,072 of them, with
 * the objection and handling columns both TEXT, which cannot be indexed usefully. Measured over
 * HTTP, three consecutive runs: 33.0s, 33.6s, 28.2s. That is slow enough to sit past a proxy
 * timeout, and the endpoint takes no parameters, so a caller had no way out of it.
 *
 * CallDate does carry an index (Index_3), so bounding the range lets the optimiser seek instead
 * of scanning the table.
 */

/**
 * SECURITY FIX: Added scope parameter - filters health dashboard aggregates by the caller's
 * assigned agents/processes so branch_head/process_manager see only their scoped data.
 */
export async function getObjectionHealthDashboard(
  filters: { startDate?: string; endDate?: string } = {},
  scope?: QualityScope
): Promise<ObjectionHealthDashboard> {
  const pool = getCiPool();
  const bounded = Boolean(filters.startDate && filters.endDate);
  const dateClause = bounded ? " AND CallDate BETWEEN ? AND ?" : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = bounded ? [filters.startDate as string, filters.endDate as string] : [];
  const scopeCond = scope ? callDetailsScopeCond(scope, params) : "";

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) as TOTAL_OBJECTIONS_RAISED,
      COUNT(DISTINCT CustomerObjectionCategory) as UNIQUE_OBJECTION_TYPES,
      SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as TOTAL_OBJECTIONS_HANDLED,
      ROUND(
        (SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
      ) as OVERALL_RESOLUTION_RATE_PCT,
      SUM(CASE
        WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
        AND (SaleDone = 'Yes' OR SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_CLOSED_AFTER_OBJECTION_HANDLING,
      ROUND(
        (SUM(CASE
          WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
          AND (SaleDone = 'Yes' OR SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
      ) as SALES_CONVERSION_AFTER_OBJECTION_PCT,
      COUNT(DISTINCT AgentName) as UNIQUE_HANDLERS,
      COUNT(DISTINCT client_id) as UNIQUE_CLIENTS,
      COUNT(DISTINCT campaign_id) as UNIQUE_PROCESSES
    FROM db_external.CallDetails
    WHERE CustomerObjectionCategory IS NOT NULL
      AND CustomerObjectionCategory != ''
      AND CustomerObjectionCategory != 'null'
      AND CustomerObjectionCategory != 'None'${dateClause}${scopeCond}`,
    params
  );

  if (rows.length === 0) {
    return {
      TOTAL_OBJECTIONS_RAISED: 0,
      UNIQUE_OBJECTION_TYPES: 0,
      TOTAL_OBJECTIONS_HANDLED: 0,
      OVERALL_RESOLUTION_RATE_PCT: 0,
      SALES_CLOSED_AFTER_OBJECTION_HANDLING: 0,
      SALES_CONVERSION_AFTER_OBJECTION_PCT: 0,
      UNIQUE_HANDLERS: 0,
      UNIQUE_CLIENTS: 0,
      UNIQUE_PROCESSES: 0,
    };
  }

  return rows[0] as ObjectionHealthDashboard;
}

/**
 * Consolidated Report - All Metrics
 */
export interface ObjectionAnalysisReport {
  dashboard: ObjectionHealthDashboard;
  topPatterns: ObjectionPattern[];
  topHandlers: TopHandler[];
  salesMetrics: ObjectionSalesMetric[];
  processList: ProcessObjectionMetric[];
  rebuttalMatrix: ObjectionRebuttal[];
}

/**
 * SECURITY FIX: Added scope parameter - propagates to all sub-queries so the
 * comprehensive report respects caller's row-level access.
 */
export async function generateComprehensiveObjectionReport(
  patternLimit = 50,
  handlerLimit = 50,
  processLimit = 100,
  rebuttalLimit = 100,
  scope?: QualityScope
): Promise<ObjectionAnalysisReport> {
  const [dashboard, topPatterns, topHandlers, salesMetrics, processList, rebuttalMatrix] =
    await Promise.all([
      getObjectionHealthDashboard({}, scope),
      getTopObjectionPatterns(patternLimit, scope),
      getTopObjectionHandlers(handlerLimit, scope),
      getSalesClosedAfterObjection(patternLimit, scope),
      getObjectionsByProcess(processLimit, scope),
      getObjectionRebuttalMatrix(rebuttalLimit),
    ]);

  return {
    dashboard,
    topPatterns,
    topHandlers,
    salesMetrics,
    processList,
    rebuttalMatrix,
  };
}
