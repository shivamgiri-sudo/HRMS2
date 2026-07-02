import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import {
  hasScopedAccess,
  hasAnyRole,
  getRosterPlanScope,
  AccessDeniedError,
  BadRequestAccessError,
  type ScopeTarget,
} from "../shared/scopeAccess.js";

export function requireScopedRole(
  allowedRoles: string[],
  targetResolver: (req: AuthenticatedRequest) => ScopeTarget | Promise<ScopeTarget>,
  options: { allowAdminBypass?: boolean; requireScopeForNonAdmin?: boolean } = {}
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const target = await Promise.resolve(targetResolver(req));
      const ok = await hasScopedAccess(userId, allowedRoles, target, options);

      if (!ok) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: this record is outside your assigned branch/process/team scope",
        });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function getTargetFromBodyOrQuery(req: AuthenticatedRequest): ScopeTarget {
  return {
    branchId: (req.body?.branchId ?? req.body?.branch_id ?? req.query?.branchId ?? req.query?.branch_id ?? null) as string | null,
    processId: (req.body?.processId ?? req.body?.process_id ?? req.query?.processId ?? req.query?.process_id ?? null) as string | null,
    lobId: (req.body?.lobId ?? req.body?.lob_id ?? req.query?.lobId ?? req.query?.lob_id ?? null) as string | null,
    departmentId: (req.body?.departmentId ?? req.body?.department_id ?? req.query?.departmentId ?? req.query?.department_id ?? null) as string | null,
    managerEmployeeId: (req.body?.managerEmployeeId ?? req.body?.manager_employee_id ?? req.query?.managerEmployeeId ?? req.query?.manager_employee_id ?? null) as string | null,
    employeeId: (req.body?.employeeId ?? req.body?.employee_id ?? req.query?.employeeId ?? req.query?.employee_id ?? null) as string | null,
  };
}

// ─── Helper Function ──────────────────────────────────────────────────────────

function getQueryString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function handleAccessError(err: unknown, res: Response, next: NextFunction) {
  const anyErr = err as any;
  if (anyErr?.statusCode) {
    return res.status(anyErr.statusCode).json({ success: false, message: anyErr.message });
  }
  return next(err);
}

// ─── Generic Scoped Access Wrapper ────────────────────────────────────────────

type ScopeExtractor = (req: AuthenticatedRequest) => ScopeTarget | Promise<ScopeTarget>;

export function requireScopedAccess(options: {
  scopedRoles: string[];
  globalRoles?: string[];
  extractScope: ScopeExtractor;
  allowMissingScopeForGlobalOnly?: boolean;
}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const globalRoles = options.globalRoles ?? ["admin"];
      if (await hasAnyRole(userId, ...globalRoles)) return next();

      const scope = await options.extractScope(req);
      const hasAnyScopeValue = Boolean(scope.branchId || scope.processId || scope.lobId || scope.departmentId || scope.managerEmployeeId);
      if (!hasAnyScopeValue && options.allowMissingScopeForGlobalOnly !== false) {
        throw new BadRequestAccessError("Scope is required. Provide branchId/processId/lobId/departmentId based on your role.");
      }

      if (await hasScopedAccess(userId, options.scopedRoles, scope)) return next();

      return res.status(403).json({ success: false, message: "Forbidden for this branch/process scope" });
    } catch (err) {
      return handleAccessError(err, res, next);
    }
  };
}

// ─── Query Scope Middleware ───────────────────────────────────────────────────

export function requireQueryScope(scopedRoles: string[], globalRoles = ["admin", "hr", "ceo"]) {
  return requireScopedAccess({
    scopedRoles,
    globalRoles,
    extractScope: (req) => ({
      processId: getQueryString(req.query.processId),
      branchId: getQueryString(req.query.branchId),
      lobId: getQueryString(req.query.lobId),
      departmentId: getQueryString(req.query.departmentId),
    }),
  });
}

// ─── Body Scope Middleware ────────────────────────────────────────────────────

export function requireBodyScope(scopedRoles: string[], globalRoles = ["admin", "hr"]) {
  return requireScopedAccess({
    scopedRoles,
    globalRoles,
    extractScope: (req) => ({
      processId: req.body?.processId ?? req.body?.process_id ?? null,
      branchId: req.body?.branchId ?? req.body?.branch_id ?? null,
      lobId: req.body?.lobId ?? req.body?.lob_id ?? null,
      departmentId: req.body?.departmentId ?? req.body?.department_id ?? null,
    }),
  });
}

// ─── Roster Plan Scope Middleware ─────────────────────────────────────────────

export function requireRosterPlanScope(options: {
  planIdSource?: "param" | "body" | "query";
  planIdKey?: string;
  scopedRoles: string[];
  globalRoles?: string[];
  requireDraft?: boolean;
  publishedChangeRoles?: string[];
}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const source = options.planIdSource ?? "param";
      const key = options.planIdKey ?? "id";
      const planId =
        source === "body" ? req.body?.[key] :
        source === "query" ? getQueryString(req.query[key]) :
        req.params[key];

      if (!planId) throw new BadRequestAccessError(`Roster plan id is required (${source}.${key})`);

      const planScope = await getRosterPlanScope(planId);
      if (!planScope) return res.status(404).json({ success: false, message: "Roster plan not found" });

      const globalRoles = options.globalRoles ?? ["admin"];
      if (await hasAnyRole(userId, ...globalRoles)) return next();

      const isPublished = String(planScope.planStatus ?? "").toLowerCase() === "published";
      if (options.requireDraft && isPublished) {
        throw new AccessDeniedError("Published roster is locked. Only Process Manager change flow can amend it.");
      }

      if (isPublished && options.publishedChangeRoles?.length) {
        if (!(await hasAnyRole(userId, ...options.publishedChangeRoles))) {
          throw new AccessDeniedError("Published roster changes are restricted to Process Manager.");
        }
      }

      if (await hasScopedAccess(userId, options.scopedRoles, planScope)) return next();

      return res.status(403).json({ success: false, message: "Forbidden for this roster plan scope" });
    } catch (err) {
      return handleAccessError(err, res, next);
    }
  };
}
