import { Router, type NextFunction, type Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { getUserAssignmentScopes, getUserRoleKeys, type AssignmentScope } from "../../shared/scopeAccess.js";

export const reportSuiteScopeRouter = Router();
reportSuiteScopeRouter.use(requireAuth);

const ENTERPRISE_READ_ROLES = new Set([
  "super_admin",
  "admin",
  "ceo",
  "hr",
  "hr_head",
  "finance",
  "finance_head",
  "payroll",
  "payroll_head",
  "payroll_admin",
]);

const SCOPED_REPORT_ROLES = [
  "wfm",
  "wfm_analyst",
  "manager",
  "process_manager",
  "branch_head",
  "department_head",
  "quality",
  "qa",
  "training",
  "trainer",
  "recruiter",
];

function queryValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.length ? String(value[0]) : null;
  const text = String(value ?? "").trim();
  return text || null;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function assignQuery(req: AuthenticatedRequest, key: string, value: string) {
  (req.query as Record<string, unknown>)[key] = value;
}

function scopeMatchesRequested(scope: AssignmentScope, requested: Record<string, string | null>) {
  if (scope.scope_type === "all") return true;
  if (requested.branchId && scope.branch_id && requested.branchId !== scope.branch_id) return false;
  if (requested.processId && scope.process_id && requested.processId !== scope.process_id) return false;
  if (requested.departmentId && scope.department_id && requested.departmentId !== scope.department_id) return false;
  if (requested.lobId && scope.lob_id && requested.lobId !== scope.lob_id) return false;

  if (scope.scope_type === "branch" && requested.branchId) return requested.branchId === scope.branch_id;
  if (scope.scope_type === "process" && requested.processId) return requested.processId === scope.process_id;
  if (scope.scope_type === "branch_process" && requested.branchId && requested.processId) {
    return requested.branchId === scope.branch_id && requested.processId === scope.process_id;
  }
  if (scope.scope_type === "department" && requested.departmentId) return requested.departmentId === scope.department_id;
  if (scope.scope_type === "lob" && requested.lobId) return requested.lobId === scope.lob_id;

  return true;
}

function requiredDimensions(scopes: AssignmentScope[]) {
  return {
    branch: scopes.some((scope) => scope.scope_type === "branch" || scope.scope_type === "branch_process" || Boolean(scope.branch_id)),
    process: scopes.some((scope) => scope.scope_type === "process" || scope.scope_type === "branch_process" || Boolean(scope.process_id)),
    department: scopes.some((scope) => scope.scope_type === "department" || Boolean(scope.department_id)),
    lob: scopes.some((scope) => scope.scope_type === "lob" || Boolean(scope.lob_id)),
  };
}

reportSuiteScopeRouter.use(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated" });

    const roleKeys = await getUserRoleKeys(userId);
    if (roleKeys.some((role) => ENTERPRISE_READ_ROLES.has(role))) return next();

    // Health exposes control counts and source-table freshness only; scoped users may see it.
    if (req.path === "/health") return next();

    // Employee-code exception lookup is intentionally restricted to enterprise HR/payroll roles.
    if (req.path === "/employee-lookup") {
      return res.status(403).json({ success: false, error: "Attendance exception lookup requires HR or payroll authority" });
    }

    const matchedRoles = roleKeys.filter((role) => SCOPED_REPORT_ROLES.includes(role));
    if (!matchedRoles.length) {
      return res.status(403).json({ success: false, error: "Your role is not permitted to access the enterprise report suite" });
    }

    const scopes = await getUserAssignmentScopes(userId, matchedRoles);
    if (scopes.some((scope) => scope.scope_type === "all")) return next();
    if (!scopes.length) {
      return res.status(403).json({ success: false, error: "No active report assignment scope is configured for your role" });
    }

    if (scopes.some((scope) => scope.scope_type === "team" || scope.scope_type === "self")) {
      return res.status(403).json({
        success: false,
        error: "Team/self report access requires an employee-level report builder and is not available through aggregate suite reports",
      });
    }

    const requested = {
      branchId: queryValue(req.query.branchId),
      processId: queryValue(req.query.processId),
      departmentId: queryValue(req.query.departmentId),
      lobId: queryValue(req.query.lobId),
    };

    const compatibleScopes = scopes.filter((scope) => scopeMatchesRequested(scope, requested));
    if (!compatibleScopes.length) {
      return res.status(403).json({ success: false, error: "Selected report filters are outside your assigned reporting scope" });
    }

    const required = requiredDimensions(compatibleScopes);
    const branchIds = unique(compatibleScopes.map((scope) => scope.branch_id));
    const processIds = unique(compatibleScopes.map((scope) => scope.process_id));
    const departmentIds = unique(compatibleScopes.map((scope) => scope.department_id));
    const lobIds = unique(compatibleScopes.map((scope) => scope.lob_id));

    if (!requested.branchId && required.branch) {
      if (branchIds.length !== 1) return res.status(400).json({ success: false, error: "Select one of your assigned branches before running this report" });
      assignQuery(req, "branchId", branchIds[0]);
    }
    if (!requested.processId && required.process) {
      if (processIds.length !== 1) return res.status(400).json({ success: false, error: "Select one of your assigned processes before running this report" });
      assignQuery(req, "processId", processIds[0]);
    }
    if (!requested.departmentId && required.department && departmentIds.length) {
      if (departmentIds.length !== 1) return res.status(400).json({ success: false, error: "Select one of your assigned departments before running this report" });
      assignQuery(req, "departmentId", departmentIds[0]);
    }
    if (!requested.lobId && required.lob && lobIds.length) {
      if (lobIds.length !== 1) return res.status(400).json({ success: false, error: "Select one of your assigned LOBs before running this report" });
      assignQuery(req, "lobId", lobIds[0]);
    }

    return next();
  } catch (error) {
    next(error);
  }
});
