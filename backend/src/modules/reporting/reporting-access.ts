import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { REPORT_CATALOG } from "./report-catalog.js";
import { resolveBranchScope, resolveFullScope, type BranchScope } from "./reporting.scope.js";
import { appendScopeConditions, appendFilterConditions, type ExecFilters } from "./executors/types.js";

export interface ScopedReportRequest extends AuthenticatedRequest {
  reportBranchScope?: BranchScope;
}

const NO_BRANCH_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";
const ROLE_ALIASES: Record<string, string[]> = {
  finance_head: ["finance"],
  accounts_head: ["finance"],
  payroll_head: ["payroll"],
  payroll_branch: ["payroll"],
  payroll_hr: ["payroll"],
  recruitment_hr: ["recruiter"],
  quality_analyst: ["quality"],
  qa: ["quality"],
  visitor_security: ["security"],
  visitor_reception: ["security"],
  branch_hr: ["hr"],
  hr_branch: ["hr"],
  team_leader: ["manager"],
  tl: ["manager"],
};

function normalisedRoles(req: AuthenticatedRequest) {
  const raw = [...new Set([
    ...(req.authUser?.roles ?? []),
    ...(req.userRoles ?? []),
    req.authUser?.role,
  ].filter((role): role is string => Boolean(role)))];
  return [...new Set(raw.flatMap((role) => [role, ...(ROLE_ALIASES[role] ?? [])]))];
}

function reportCodeFromRequest(req: AuthenticatedRequest) {
  if (req.params?.code) return String(req.params.code);
  return String(req.path ?? "").split("/").filter(Boolean)[0] ?? "";
}

function isExportRequest(req: AuthenticatedRequest) {
  const value = String(req.query.export ?? req.query.fullExport ?? "").toLowerCase();
  return ["1", "true", "yes"].includes(value);
}

export async function reportScopeMiddleware(
  req: ScopedReportRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const scope = await resolveBranchScope(req.authUser.id);
    const requestedBranchId = req.query.branchId ? String(req.query.branchId) : undefined;
    if (
      requestedBranchId
      && !scope.isSuperAdmin
      && scope.branchIds.length > 0
      && !scope.branchIds.includes(requestedBranchId)
    ) {
      return res.status(403).json({
        success: false,
        error: "Requested branch is outside your authorised reporting scope.",
      });
    }
    req.reportBranchScope = scope;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function reportCatalogAccessMiddleware(
  req: ScopedReportRequest,
  res: Response,
  next: NextFunction
) {
  const code = reportCodeFromRequest(req);
  const report = REPORT_CATALOG.find((definition) => definition.code === code);
  if (!report) {
    return res.status(404).json({ success: false, error: "Report definition not found." });
  }

  const roles = normalisedRoles(req);
  if (!roles.includes("super_admin") && !report.viewRoles.some((role) => roles.includes(role))) {
    return res.status(403).json({ success: false, error: "You do not have permission to view this report." });
  }
  if (
    isExportRequest(req)
    && !roles.includes("super_admin")
    && !report.exportRoles.some((role) => roles.includes(role))
  ) {
    return res.status(403).json({ success: false, error: "You do not have permission to export this report." });
  }
  return next();
}

function addScopedBranchClause(
  req: ScopedReportRequest,
  clauses: string[],
  params: unknown[],
  alias: string
) {
  const query = req.query;
  const requestedBranchId = query.branchId ? String(query.branchId) : undefined;
  const scope = req.reportBranchScope;

  if (requestedBranchId) {
    clauses.push(`${alias}.branch_id = ?`);
    params.push(requestedBranchId);
  } else if (scope && !scope.isSuperAdmin && scope.branchIds.length > 0) {
    if (scope.branchIds.includes(NO_BRANCH_SCOPE_SENTINEL)) {
      clauses.push("1 = 0");
    } else {
      clauses.push(`${alias}.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
  }
}

export function addScopedEmployeeFilters(
  req: ScopedReportRequest,
  clauses: string[],
  params: unknown[],
  alias = "e"
) {
  const query = req.query;
  addScopedBranchClause(req, clauses, params, alias);

  if (query.departmentId) {
    clauses.push(`${alias}.department_id = ?`);
    params.push(String(query.departmentId));
  }
  if (query.processId) {
    clauses.push(`${alias}.process_id = ?`);
    params.push(String(query.processId));
  }
  if (query.costCentreId) {
    clauses.push(`${alias}.cost_centre_id = ?`);
    params.push(String(query.costCentreId));
  }
  if (query.managerId) {
    clauses.push(`(${alias}.reporting_manager_id = ? OR ${alias}.manager_id = ?)`);
    params.push(String(query.managerId), String(query.managerId));
  }
}

/**
 * Branch scoping only, for reports built on a table that has its own `branch_id` but is not
 * employee-shaped — no department_id/process_id/cost_centre_id/manager columns to filter on.
 * asset_master is the first case (asset-inventory-report, 2026-08-18): calling
 * addScopedEmployeeFilters here would 500 the query the moment a caller passed
 * ?departmentId=/?processId=/?costCentreId=, since those columns don't exist on that table.
 */
export function addScopedBranchOnlyFilters(
  req: ScopedReportRequest,
  clauses: string[],
  params: unknown[],
  alias: string
) {
  addScopedBranchClause(req, clauses, params, alias);
}

/**
 * Full multi-dimensional scoping (branch AND process AND department AND cost centre) for
 * screen-route (`GET /:code`) case blocks in report-suite.routes.ts, matching what the
 * export path (executors/*.ts, dispatched through executeReport()) already enforces via
 * appendScopeConditions.
 *
 * addScopedEmployeeFilters above enforces branch only; department/process/cost-centre from
 * the query string are applied there as unenforced user-selected narrowing, never checked
 * against what the user is actually scoped to. Several screen-route case blocks used that
 * function (or, for leave-trend-monthly, no scope call at all) while their corresponding
 * executor called the full appendScopeConditions for the same report code — so a
 * process-restricted viewer could see more on screen than their own export, or their actual
 * access, allowed. Confirmed live 2026-08-19: 26 users hold scope_type='process' in
 * user_assignment_scope, and 1,016 active employees carry a process_id that would be wrongly
 * included or excluded depending on which of the two code paths served the request. See the
 * identical incident documented on lifecycleEvents in executors/employee.executor.ts.
 *
 * This mirrors the executor call exactly: appendScopeConditions(scope, ...) enforces the
 * user's assigned scope, then appendFilterConditions(filters, ...) applies the same optional
 * user-selected narrowing addScopedEmployeeFilters used to provide from the query string —
 * narrowing that must stay within scope, not bypass it.
 */
export async function addFullScopedEmployeeFilters(
  req: ScopedReportRequest,
  clauses: string[],
  params: unknown[],
  alias = "e"
): Promise<void> {
  const scope = await resolveFullScope(req.authUser.id);
  appendScopeConditions(scope, clauses, params, alias);
  const filters: ExecFilters = {
    branchId: req.query.branchId ? String(req.query.branchId) : undefined,
    processId: req.query.processId ? String(req.query.processId) : undefined,
    departmentId: req.query.departmentId ? String(req.query.departmentId) : undefined,
    costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
    managerId: req.query.managerId ? String(req.query.managerId) : undefined,
  };
  appendFilterConditions(filters, clauses, params, alias);
}
