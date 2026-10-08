import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import {
  buildScopeWhereEmployees,
  resolveDashboardScope,
  DashboardScopeConfigurationError,
} from "../../shared/dashboardScope.js";
import { db } from "../../db/mysql.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

/**
 * Role list is SECURITY-SENSITIVE. Matches dashboardAccessRegistry.ts's
 * PERFORMANCE_SCORECARD.allowedRoleKeys exactly (confirmed 2026-08-25).
 * Deliberately excludes "admin" and "wfm" per Task 5's 2026-08-22
 * production-incident fix — do not add them back without a security review.
 *
 * NOTE (asymmetry, not a bug): requireRole's role-alias expansion means
 * "management" here also admits "operations_manager" — it is NOT in this
 * registry's allowedRoleKeys or in migration 1607's seeded grants.
 * operations_manager therefore passes this route gate, but is then scoped
 * (and possibly zeroed out) by resolveDashboardScope below, and is blocked
 * at the page-level Gate in the frontend. Not a security leak today — just
 * a reminder that the three gates (route requireRole, registry
 * allowedRoleKeys, page Gate) are not alias-for-alias identical.
 */
router.get(
  "/",
  requireRole(
    "manager",
    "process_manager",
    "assistant_manager",
    "branch_head",
    "branch_manager",
    "team_leader",
    "tl",
    "hr",
    "hr_admin",
    "ho_hr",
    "branch_hr",
    "process_hr",
    "ceo",
    "coo",
    "management",
    "super_admin",
  ),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ success: false, message: "dateFrom and dateTo are required" });
    }

    // Real branch/process/team scoping via the shared resolver (30+ call sites),
    // replacing a locally-duplicated resolver that only supported
    // direct-reports-only or fully-org-wide with no branch/process tier —
    // contradicting this feature's own spec promising HR/Ops roles a
    // branch/process view. See performance-scorecard-drilldown.ts, fixed the
    // same way just before this route.
    let scopeSql: string;
    let scopeParams: string[];
    try {
      const context = await getUserRoleContext(req.authUser!.id);
      const scope = await resolveDashboardScope(req.authUser!.id, context.primaryRole);
      ({ sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e"));
    } catch (err) {
      // resolveDashboardScope throws DashboardScopeConfigurationError (409) when it
      // cannot establish any scope for the caller's role (no employee mapping, no
      // branch/process assignment, no reporting hierarchy). Preserving this route's
      // prior fail-closed contract: that condition surfaces here as 403, not 409.
      if (err instanceof DashboardScopeConfigurationError) {
        return res.status(403).json({
          success: false,
          message: "Unable to resolve your team scope — no employee record or organization-wide role found",
        });
      }
      throw err;
    }

    // A resolvable scope with zero matching employees (e.g. a manager with no
    // reports yet) is not an error — it is legitimately "no data".
    if (scopeSql === "1=0") {
      return res.json({ success: true, data: [] });
    }

    const conds = ["s.snapshot_date BETWEEN ? AND ?", scopeSql];
    const params: unknown[] = [dateFrom, dateTo, ...scopeParams];

    // One row per employee per day. Raised from 5000: at ~1,110 active employees the
    // previous cap silently truncated any org-wide request wider than ~5 days
    // (1,110 x 45-day range needs ~50k rows) and returned only the alphabetically-first
    // slice with no indication of truncation — presented to a CEO/HR viewer as if it were
    // the whole organization. 50000 comfortably covers realistic scale (~1,110 employees x
    // 45 days is under that) without changing the per-day row shape the Compare panel's
    // client-side filtering (frontend groupByEmployee) depends on. A full
    // aggregation/pagination redesign is a separate follow-up, not this fix.
    const ROW_LIMIT = 50000;
    const [rows] = (await db.execute(
      `SELECT e.id AS employeeId, e.full_name AS employeeName, e.employee_code AS employeeCode,
              s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
              s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
              s.pip_status AS pipStatus, s.designation_id AS designationId,
              s.quality_score AS qualityScore, s.template_metrics AS templateMetrics,
              s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
              s.team_revenue AS teamRevenue
         FROM employee_performance_daily_snapshot s
         JOIN employees e ON e.id = s.employee_id
        WHERE ${conds.join(" AND ")}
        ORDER BY e.full_name ASC, s.snapshot_date ASC
        LIMIT ${ROW_LIMIT}`,
      params,
    )) as any;

    if (Array.isArray(rows) && rows.length >= ROW_LIMIT) {
      // eslint-disable-next-line no-console
      console.warn(
        `[performance-scorecard] row limit hit (${ROW_LIMIT}) for dateFrom=${dateFrom} dateTo=${dateTo} ` +
          `userId=${req.authUser!.id} — response was truncated`,
      );
    }

    res.json({ success: true, data: rows });
  }),
);

export default router;
