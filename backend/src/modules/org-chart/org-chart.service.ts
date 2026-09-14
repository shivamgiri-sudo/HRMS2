import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  resolveUserOrgContext,
  buildScopeWhereClause,
  assertScopeAccess,
  getManagerChain,
  type OrgChartScope,
  type UserOrgContext,
} from "./org-chart.scope.js";
import { buildOrgTree, buildEdgeList, searchOrgTree, flattenTree, type OrgTreeNode, type OrgTreeResponse } from "./org-chart.builder.js";
import { validateOrgChartDataQuality, type DataQualitySummary } from "./org-chart.validation.js";

/**
 * Get available scopes for the current user.
 */
export async function getAvailableScopes(userId: string): Promise<UserOrgContext> {
  return resolveUserOrgContext(userId);
}

/**
 * Get org tree for a given scope.
 */
export async function getOrgTree(
  userId: string,
  requestedScope: OrgChartScope,
  filters: {
    branchId?: string;
    processId?: string;
    departmentId?: string;
    designationId?: string;
    status?: string;
  }
): Promise<OrgTreeResponse> {
  // Verify scope access
  const ctx = await assertScopeAccess(userId, requestedScope);

  // Build WHERE clause
  const { sql, params } = buildScopeWhereClause(ctx, requestedScope, filters);

  // Fetch employees
  const [employeeRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name,
            e.designation_id, e.branch_id, e.process_id, e.department_id,
            e.reporting_manager_id, e.active_status, e.employment_status,
            e.photo_url, e.avatar_url,
            d.designation_name,
            b.branch_name,
            p.process_name,
            dept.dept_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
      WHERE ${sql}
      ORDER BY e.first_name, e.last_name`,
    params
  );

  // Build tree
  const nodes = await buildOrgTree(employeeRows, ctx);
  const edges = buildEdgeList(nodes);

  // Quick data quality summary
  const flatNodes = flattenTree(nodes);
  const missingManager = flatNodes.filter((n) => !n.manager_id && !isCLevelNode(n)).length;
  const inactiveManager = flatNodes.filter((n) => n.warnings.includes("Reporting manager not in scope")).length;
  const unmapped = flatNodes.filter((n) => !n.branch_id || !n.process_id || !n.department_id).length;

  // Scope metadata
  const scopeResolution = ctx.availableScopes.find((s) => s.scopeType === requestedScope);

  return {
    scope: {
      scope_type: requestedScope,
      scope_id: scopeResolution?.scopeId ?? null,
      scope_name: scopeResolution?.scopeName ?? requestedScope,
    },
    nodes,
    edges,
    data_quality: {
      confidence_score: flatNodes.length > 0 ? Math.round(((flatNodes.length - (missingManager + unmapped)) / flatNodes.length) * 100) : 100,
      missing_manager_count: missingManager,
      inactive_manager_count: inactiveManager,
      circular_mapping_count: flatNodes.filter((n) => n.warnings.some((w) => w.includes("circular"))).length,
      unmapped_count: unmapped,
    },
  };
}

/**
 * Get single node detail with reporting chain and direct reports.
 */
export async function getNodeDetail(userId: string, targetEmployeeId: string): Promise<{
  employee: Record<string, unknown>;
  reporting_chain: Array<{ id: string; name: string; designation: string | null; employee_code: string }>;
  direct_reports: Array<{ id: string; name: string; designation: string | null; employee_code: string }>;
  data_quality_issues: string[];
}> {
  // Verify access to this employee
  const ctx = await resolveUserOrgContext(userId);

  // Check if user can see this employee
  const canSee = await canAccessEmployee(ctx, targetEmployeeId);
  if (!canSee) {
    const err = new Error("Forbidden: employee is outside your assigned scope") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }

  // Fetch employee stat card (reuse existing endpoint logic)
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, d.designation_name, b.branch_name, p.process_name, dept.dept_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
      WHERE e.id = ? AND e.active_status = 1
      LIMIT 1`,
    [targetEmployeeId]
  );

  if (empRows.length === 0) {
    const err = new Error("Employee not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const employee = empRows[0] as any;

  // Get reporting chain
  const reporting_chain = await getManagerChain(targetEmployeeId).then(async (ids) => {
    if (ids.length === 0) return [];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name, d.designation_name
         FROM employees e
         LEFT JOIN designation_master d ON d.id = e.designation_id
        WHERE e.id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    return (rows as any[]).map((r) => ({
      id: r.id,
      name: r.full_name,
      designation: r.designation_name,
      employee_code: r.employee_code,
    }));
  });

  // Get direct reports
  const [directRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name, d.designation_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.reporting_manager_id = ? AND e.active_status = 1
      ORDER BY e.first_name, e.last_name`,
    [targetEmployeeId]
  );

  const direct_reports = (directRows as any[]).map((r: any) => ({
    id: r.id,
    name: r.full_name,
    designation: r.designation_name,
    employee_code: r.employee_code,
  }));

  // Data quality issues for this employee
  const data_quality_issues: string[] = [];
  if (!employee.reporting_manager_id && !isCLevelNode(employee)) {
    data_quality_issues.push("No reporting manager assigned");
  }
  if (!employee.designation_id) {
    data_quality_issues.push("No designation assigned");
  }
  if (!employee.branch_id || !employee.process_id || !employee.department_id) {
    data_quality_issues.push("Incomplete org mapping (missing branch/process/department)");
  }

  return {
    employee,
    reporting_chain,
    direct_reports,
    data_quality_issues,
  };
}

/**
 * Search org chart within allowed scope.
 */
export async function searchOrgChart(
  userId: string,
  query: string,
  requestedScope: OrgChartScope
): Promise<{
  results: OrgTreeNode[];
  scope_applied: OrgChartScope;
  total_results: number;
}> {
  // Get tree for scope
  const treeResponse = await getOrgTree(userId, requestedScope, {});

  // Search within tree
  const results = searchOrgTree(treeResponse.nodes, query);

  return {
    results,
    scope_applied: requestedScope,
    total_results: results.length,
  };
}

/**
 * Get data quality report.
 */
export async function getDataQualityReport(
  userId: string,
  scopeFilter?: { branchId?: string; processId?: string }
): Promise<DataQualitySummary> {
  // Verify user has HR/Admin role
  const ctx = await resolveUserOrgContext(userId);
  if (!ctx.isAdmin && !ctx.isHr && !ctx.isSuperAdmin) {
    const err = new Error("Forbidden: only HR/Admin can view data quality report") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }

  return validateOrgChartDataQuality(scopeFilter);
}

/**
 * Check if user can access a specific employee.
 */
async function canAccessEmployee(ctx: UserOrgContext, employeeId: string): Promise<boolean> {
  // Super admin / admin / HR / CEO can see all
  if (ctx.isSuperAdmin || ctx.isAdmin || ctx.isHr || ctx.isCeo) {
    return true;
  }

  // Self access
  if (ctx.employeeId === employeeId) {
    return true;
  }

  // Fetch employee
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, branch_id, process_id, department_id, reporting_manager_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1",
    [employeeId]
  );

  if (rows.length === 0) return false;

  const emp = rows[0] as any;

  // Branch head: same branch
  if (ctx.isBranchHead && ctx.branchId === emp.branch_id) {
    return true;
  }

  // Process manager / WFM: same process
  if ((ctx.isProcessManager || ctx.isWfm) && ctx.processId === emp.process_id) {
    return true;
  }

  // Team leader: direct report or in manager chain
  if (ctx.isTeamLeader && ctx.employeeId) {
    if (emp.reporting_manager_id === ctx.employeeId) {
      return true;
    }
    // Check if user is in the upward chain
    const chain = await getManagerChain(employeeId);
    if (chain.includes(ctx.employeeId)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a node is C-level (CEO, CTO, etc.).
 */
function isCLevelNode(node: any): boolean {
  const designation = node.designation_name || node.designation || "";
  const lower = designation.toLowerCase();
  return (
    lower.includes("ceo") ||
    lower.includes("cto") ||
    lower.includes("cfo") ||
    lower.includes("coo") ||
    lower.includes("director") ||
    lower.includes("president") ||
    lower.includes("founder")
  );
}
