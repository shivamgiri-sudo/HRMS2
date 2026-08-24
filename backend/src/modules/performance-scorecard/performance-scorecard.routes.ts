import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { managementService } from "../management/management.service.js";
import { db } from "../../db/mysql.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

/**
 * Resolve scoped employee ID list for non-admin/hr/ceo/qa roles.
 * Mirrors management.routes.ts's resolveTeamScope (not exported from there,
 * so replicated here rather than imported — see task-7-report.md).
 * Admins, HR, CEO, QA see everyone. Managers/TLs see only their direct reports.
 * Returns null if the caller has no employee record (block the request).
 * Returns [] if the manager has no reports yet (no data returned).
 */
async function resolveTeamScope(userId: string): Promise<{ employeeIds: string[] | null; isWide: boolean }> {
  if (await hasRole(userId, "admin", "hr", "ceo", "qa")) {
    return { employeeIds: null, isWide: true };
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return { employeeIds: null, isWide: false };
  const ids = await managementService.getDirectReportIds(emp.id);
  if (!ids.includes(emp.id)) ids.push(emp.id);
  return { employeeIds: ids, isWide: false };
}

/**
 * Role list is SECURITY-SENSITIVE. Matches dashboardAccessRegistry.ts's
 * PERFORMANCE_SCORECARD.allowedRoleKeys exactly (confirmed 2026-08-25).
 * Deliberately excludes "admin" and "wfm" per Task 5's 2026-08-22
 * production-incident fix — do not add them back without a security review.
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
    const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
    if (!isWide && employeeIds !== null && employeeIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const conds = ["s.snapshot_date BETWEEN ? AND ?"];
    const params: unknown[] = [dateFrom, dateTo];
    if (!isWide && employeeIds && employeeIds.length > 0) {
      conds.push(`s.employee_id IN (${employeeIds.map(() => "?").join(",")})`);
      params.push(...employeeIds);
    }

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
        LIMIT 5000`,
      params,
    )) as any;

    res.json({ success: true, data: rows });
  }),
);

export default router;
