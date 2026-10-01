import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { companyForPerformancePath, tpzCompany } from "../tpz-access/tpz-access.catalog.js";
import { accessOf } from "../tpz-access/tpz-access.middleware.js";
import { resolveProcessScope, tpzCompanyAllowed } from "../dashboards/process-scope-guards.js";

/**
 * Branch scoping for the TPZ company dashboards (owner ruling 2026-10-01).
 *
 * The TPZ gate (app.ts) lets every role in LEGACY_TPZ_VIEW_ROLES open every company dashboard unless an admin
 * opted that user into restrict_to_grants. Those role-based viewers (manager, process_manager, branch_head, qa,
 * operations_manager ...) must still be limited to the processes inside their own branch / assigned scope, so
 * this guard runs first on /api/process-performance (processPerformanceRouter is mounted before every other
 * TPZ router) and refuses a company whose process_master row is outside the caller's scope.
 *
 * Not applied to: org-wide callers; callers whose access comes from explicit TPZ grants (an admin chose those
 * branches / companies); companies the catalogue ties to no process (no branch to scope by).
 */
export async function tpzBranchScopeGuard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const hit = companyForPerformancePath(req.path);
    if (!hit || !req.authUser?.id || !tpzCompany(hit.company)) return next();
    const scope = await resolveProcessScope(req.authUser.id);
    if (scope.orgWide) return next();
    const access = await accessOf(req);
    if (!access.roleFullView) return next();
    if (tpzCompanyAllowed(scope, hit.company)) return next();
    return res.status(403).json({ success: false, message: "Forbidden: this process is outside your branch / assigned scope" });
  } catch (err) {
    // Fail closed.
    console.error("[tpz-branch-scope] could not verify scope:", err instanceof Error ? err.message : String(err));
    return res.status(403).json({ success: false, message: "Scope could not be verified. Please try again." });
  }
}
