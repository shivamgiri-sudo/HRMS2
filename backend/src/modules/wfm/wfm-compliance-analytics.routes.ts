import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireQueryScope } from "../../middleware/scopeMiddleware.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  getEmployeeWfmCompliance,
  getBranchWfmCompliance,
} from "./wfm-compliance-analytics.service.js";

const router = Router();

router.use(requireAuth);

/**
 * Middleware to verify employee scope access for compliance queries.
 * branch_head/manager/operations_manager can only query employees in their assigned scope.
 */
async function verifyEmployeeScope(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const employeeId = req.query.employeeId as string;
    if (!employeeId) return next();

    // Get employee's branch/process to verify scope
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    const emp = empRows[0] as { branch_id?: string; process_id?: string } | undefined;
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    // Verify caller has access to this employee's branch/process
    const hasAccess = await hasScopedAccess(
      userId,
      ["wfm", "manager", "branch_head", "operations_manager"],
      { branchId: emp.branch_id ?? null, processId: emp.process_id ?? null },
      { allowAdminBypass: true }
    );

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: employee is outside your assigned branch/process scope",
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/wfm-compliance/employee
 * Query params: employeeId (required), period (YYYY-MM, optional)
 * Roles: hr | wfm | admin | super_admin | manager | branch_head | operations_manager
 * Scope: branch_head/manager/operations_manager can only query employees in their assigned scope
 */
router.get(
  "/employee",
  requireRole("hr", "wfm", "admin", "super_admin", "manager", "branch_head", "operations_manager"),
  verifyEmployeeScope,
  (req, res, next) => {
    getEmployeeWfmCompliance(req, res).catch(next);
  }
);

/**
 * GET /api/wfm-compliance/branch
 * Query params: branchId (required), period (YYYY-MM, optional), processId (optional)
 * Roles: hr | wfm | admin | super_admin | manager | branch_head | operations_manager
 * Scope: branch_head/manager/operations_manager can only query branches in their assigned scope
 */
router.get(
  "/branch",
  requireRole("hr", "wfm", "admin", "super_admin", "manager", "branch_head", "operations_manager"),
  requireQueryScope(
    ["wfm", "manager", "branch_head", "operations_manager"],
    ["admin", "hr", "super_admin", "ceo"]
  ),
  (req, res, next) => {
    getBranchWfmCompliance(req, res).catch(next);
  }
);

// ── Roster Compliance Summary (for RosterComplianceMonitor dashboard) ─────────

/**
 * GET /api/wfm-compliance/summary
 * Returns compliance summary with rule violation counts for the compliance dashboard
 */
router.get(
  "/summary",
  requireRole("hr", "wfm", "admin", "super_admin", "operations_manager", "ceo"),
  async (req, res, next) => {
    try {
      const branchId = req.query.branchId as string | undefined;
      const processId = req.query.processId as string | undefined;
      const period = (req.query.period as string) || new Date().toISOString().slice(0, 7);

      const periodStart = `${period}-01`;
      const periodEnd = `${period}-${new Date(+period.split('-')[0], +period.split('-')[1], 0).getDate().toString().padStart(2, '0')}`;

      let whereClause = 'ra.roster_date BETWEEN ? AND ?';
      const params: (string | number)[] = [periodStart, periodEnd];

      if (branchId) {
        whereClause += ' AND e.branch_id = ?';
        params.push(branchId);
      }
      if (processId) {
        whereClause += ' AND e.process_id = ?';
        params.push(processId);
      }

      // Overall compliance score (adherence-based)
      const [compRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(DISTINCT ra.employee_id) AS total_employees,
           SUM(CASE WHEN ra.adherence_status = 'GREEN' THEN 1 ELSE 0 END) AS compliant,
           SUM(CASE WHEN ra.adherence_status IN ('AMBER','RED','BROWN') THEN 1 ELSE 0 END) AS violations,
           COUNT(*) AS total_shifts
         FROM roster_assignment ra
         JOIN employees e ON ra.employee_id = e.id
         WHERE ${whereClause}`,
        params
      );

      const compliancePct = compRows[0]?.total_shifts > 0
        ? Math.round((compRows[0].compliant / compRows[0].total_shifts) * 100)
        : 100;

      // Count by violation type (simulated WFM rules)
      // Rule 1: Minimum rest (< 11 hours between shifts)
      const [restRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM (
           SELECT ra1.employee_id, ra1.roster_date,
             TIMESTAMPDIFF(HOUR,
               CONCAT(ra1.roster_date, ' ', sm1.end_time),
               CONCAT(ra2.roster_date, ' ', sm2.start_time)
             ) AS rest_hours
           FROM roster_assignment ra1
           JOIN roster_assignment ra2 ON ra1.employee_id = ra2.employee_id
             AND ra2.roster_date = DATE_ADD(ra1.roster_date, INTERVAL 1 DAY)
           JOIN employees e ON ra1.employee_id = e.id
           JOIN wfm_shift_master sm1 ON ra1.shift_id = sm1.id
           JOIN wfm_shift_master sm2 ON ra2.shift_id = sm2.id
           WHERE ra1.roster_date BETWEEN ? AND DATE_SUB(?, INTERVAL 1 DAY)
             ${branchId ? 'AND e.branch_id = ?' : ''}
             ${processId ? 'AND e.process_id = ?' : ''}
           HAVING rest_hours < 11
         ) AS rest_violations`,
        branchId && processId
          ? [periodStart, periodEnd, branchId, processId]
          : branchId
            ? [periodStart, periodEnd, branchId]
            : processId
              ? [periodStart, periodEnd, processId]
              : [periodStart, periodEnd]
      );

      // Rule 2: Consecutive days (> 6 consecutive working days)
      const [consecRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT employee_id) AS count FROM (
           SELECT employee_id, roster_date,
             @seq := IF(@prev_emp = employee_id AND DATEDIFF(roster_date, @prev_date) = 1, @seq + 1, 1) AS consecutive,
             @prev_emp := employee_id,
             @prev_date := roster_date
           FROM roster_assignment ra
           JOIN employees e ON ra.employee_id = e.id,
             (SELECT @seq := 0, @prev_emp := '', @prev_date := NULL) AS vars
           WHERE ra.roster_date BETWEEN ? AND ?
             AND ra.status NOT IN ('WEEK_OFF','HOLIDAY','LEAVE')
             ${branchId ? 'AND e.branch_id = ?' : ''}
             ${processId ? 'AND e.process_id = ?' : ''}
           ORDER BY employee_id, roster_date
           HAVING consecutive > 6
         ) AS consec_violations`,
        branchId && processId
          ? [periodStart, periodEnd, branchId, processId]
          : branchId
            ? [periodStart, periodEnd, branchId]
            : processId
              ? [periodStart, periodEnd, processId]
              : [periodStart, periodEnd]
      );

      // Rule 3: Weekly off fairness (unfair distribution)
      const [weekoffRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM (
           SELECT e.id, COUNT(*) AS weekoffs
           FROM roster_assignment ra
           JOIN employees e ON ra.employee_id = e.id
           WHERE ra.roster_date BETWEEN ? AND ?
             AND ra.status = 'WEEK_OFF'
             ${branchId ? 'AND e.branch_id = ?' : ''}
             ${processId ? 'AND e.process_id = ?' : ''}
           GROUP BY e.id
           HAVING weekoffs < 4
         ) AS weekoff_violations`,
        branchId && processId
          ? [periodStart, periodEnd, branchId, processId]
          : branchId
            ? [periodStart, periodEnd, branchId]
            : processId
              ? [periodStart, periodEnd, processId]
              : [periodStart, periodEnd]
      );

      // Rule 4: Max hours/week (> 48 hours) - simplified count
      const [hoursRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT employee_id) AS count FROM (
           SELECT ra.employee_id, WEEK(ra.roster_date) AS wk,
             SUM(COALESCE(sm.required_minutes, 480)) / 60 AS weekly_hours
           FROM roster_assignment ra
           JOIN employees e ON ra.employee_id = e.id
           LEFT JOIN wfm_shift_master sm ON ra.shift_id = sm.id
           WHERE ra.roster_date BETWEEN ? AND ?
             AND ra.status NOT IN ('WEEK_OFF','HOLIDAY','LEAVE')
             ${branchId ? 'AND e.branch_id = ?' : ''}
             ${processId ? 'AND e.process_id = ?' : ''}
           GROUP BY ra.employee_id, WEEK(ra.roster_date)
           HAVING weekly_hours > 48
         ) AS hours_violations`,
        branchId && processId
          ? [periodStart, periodEnd, branchId, processId]
          : branchId
            ? [periodStart, periodEnd, branchId]
            : processId
              ? [periodStart, periodEnd, processId]
              : [periodStart, periodEnd]
      );

      // Rule 5: Night shift limit (> 5 consecutive night shifts)
      const [nightRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT employee_id) AS count FROM (
           SELECT ra.employee_id, COUNT(*) AS night_count
           FROM roster_assignment ra
           JOIN employees e ON ra.employee_id = e.id
           JOIN wfm_shift_master sm ON ra.shift_id = sm.id
           WHERE ra.roster_date BETWEEN ? AND ?
             AND sm.shift_type = 'NIGHT'
             ${branchId ? 'AND e.branch_id = ?' : ''}
             ${processId ? 'AND e.process_id = ?' : ''}
           GROUP BY ra.employee_id, WEEK(ra.roster_date)
           HAVING night_count > 5
         ) AS night_violations`,
        branchId && processId
          ? [periodStart, periodEnd, branchId, processId]
          : branchId
            ? [periodStart, periodEnd, branchId]
            : processId
              ? [periodStart, periodEnd, processId]
              : [periodStart, periodEnd]
      );

      const rules = [
        {
          ruleId: 'MIN_REST',
          ruleName: 'Minimum Rest Period',
          description: 'Less than 11 hours between shifts',
          threshold: '11 hours',
          violationCount: Number(restRows[0]?.count ?? 0),
          severity: 'high' as const,
        },
        {
          ruleId: 'CONSECUTIVE_DAYS',
          ruleName: 'Consecutive Working Days',
          description: 'More than 6 consecutive working days',
          threshold: '6 days max',
          violationCount: Number(consecRows[0]?.count ?? 0),
          severity: 'high' as const,
        },
        {
          ruleId: 'WEEKOFF_FAIRNESS',
          ruleName: 'Week-off Fairness',
          description: 'Less than 4 week-offs in month',
          threshold: '4 per month',
          violationCount: Number(weekoffRows[0]?.count ?? 0),
          severity: 'medium' as const,
        },
        {
          ruleId: 'MAX_HOURS',
          ruleName: 'Maximum Weekly Hours',
          description: 'More than 48 hours in a week',
          threshold: '48 hours/week',
          violationCount: Number(hoursRows[0]?.count ?? 0),
          severity: 'high' as const,
        },
        {
          ruleId: 'NIGHT_SHIFT_LIMIT',
          ruleName: 'Night Shift Limit',
          description: 'More than 5 consecutive night shifts',
          threshold: '5 nights max',
          violationCount: Number(nightRows[0]?.count ?? 0),
          severity: 'medium' as const,
        },
      ];

      const totalViolations = rules.reduce((s, r) => s + r.violationCount, 0);

      res.json({
        period,
        compliancePct,
        totalEmployees: Number(compRows[0]?.total_employees ?? 0),
        totalViolations,
        rules,
        trend: 0,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/wfm-compliance/violations
 * Returns list of specific violations for the compliance dashboard
 */
router.get(
  "/violations",
  requireRole("hr", "wfm", "admin", "super_admin", "operations_manager"),
  async (req, res, next) => {
    try {
      const branchId = req.query.branchId as string | undefined;
      const ruleId = req.query.ruleId as string | undefined;
      const period = (req.query.period as string) || new Date().toISOString().slice(0, 7);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

      const periodStart = `${period}-01`;
      const periodEnd = `${period}-${new Date(+period.split('-')[0], +period.split('-')[1], 0).getDate().toString().padStart(2, '0')}`;

      // Get violations by type (simplified - mainly adherence violations)
      const params: (string | number)[] = [periodStart, periodEnd];
      let branchFilter = '';
      if (branchId) {
        branchFilter = 'AND e.branch_id = ?';
        params.push(branchId);
      }
      params.push(limit);

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ra.id AS violation_id,
           ra.roster_date AS date,
           e.id AS employee_id,
           e.employee_code,
           e.full_name AS employee_name,
           p.process_name,
           b.branch_name,
           CASE
             WHEN ra.adherence_status = 'RED' THEN 'ABSENT_NO_CALL'
             WHEN ra.adherence_status = 'AMBER' THEN 'LATE_ARRIVAL'
             WHEN ra.adherence_status = 'BROWN' THEN 'EARLY_LOGOUT'
             ELSE 'ADHERENCE'
           END AS rule_id,
           CASE
             WHEN ra.adherence_status = 'RED' THEN 'Absent Without Notification'
             WHEN ra.adherence_status = 'AMBER' THEN 'Late Arrival'
             WHEN ra.adherence_status = 'BROWN' THEN 'Early Logout / Incomplete Shift'
             ELSE 'Adherence Violation'
           END AS rule_name,
           ra.adherence_status AS severity,
           sm.shift_name,
           ra.status
         FROM roster_assignment ra
         JOIN employees e ON ra.employee_id = e.id
         LEFT JOIN process_master p ON e.process_id = p.id
         LEFT JOIN branch_master b ON e.branch_id = b.id
         LEFT JOIN wfm_shift_master sm ON ra.shift_id = sm.id
         WHERE ra.roster_date BETWEEN ? AND ?
           AND ra.adherence_status IN ('RED', 'AMBER', 'BROWN')
           ${branchFilter}
           ${ruleId ? "AND CASE WHEN ra.adherence_status = 'RED' THEN 'ABSENT_NO_CALL' WHEN ra.adherence_status = 'AMBER' THEN 'LATE_ARRIVAL' WHEN ra.adherence_status = 'BROWN' THEN 'EARLY_LOGOUT' END = ?" : ''}
         ORDER BY ra.roster_date DESC, ra.adherence_status
         LIMIT ?`,
        ruleId ? [...params.slice(0, -1), ruleId, limit] : params
      );

      res.json({
        period,
        violations: rows.map((r: RowDataPacket) => ({
          violationId: r.violation_id,
          date: r.date,
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          employeeName: r.employee_name,
          processName: r.process_name,
          branchName: r.branch_name,
          ruleId: r.rule_id,
          ruleName: r.rule_name,
          severity: r.severity === 'RED' ? 'high' : r.severity === 'AMBER' ? 'medium' : 'low',
          shiftName: r.shift_name,
          status: r.status,
        })),
        totalCount: rows.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/wfm-compliance/trend
 * Returns compliance trend over past 6 months
 */
router.get(
  "/trend",
  requireRole("hr", "wfm", "admin", "super_admin", "ceo"),
  async (req, res, next) => {
    try {
      const branchId = req.query.branchId as string | undefined;

      let branchFilter = '';
      const params: string[] = [];
      if (branchId) {
        branchFilter = 'AND e.branch_id = ?';
        params.push(branchId);
      }

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(ra.roster_date, '%Y-%m') AS month,
           COUNT(*) AS total_shifts,
           SUM(CASE WHEN ra.adherence_status = 'GREEN' THEN 1 ELSE 0 END) AS compliant,
           SUM(CASE WHEN ra.adherence_status IN ('AMBER','RED','BROWN') THEN 1 ELSE 0 END) AS violations
         FROM roster_assignment ra
         JOIN employees e ON ra.employee_id = e.id
         WHERE ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
           ${branchFilter}
         GROUP BY DATE_FORMAT(ra.roster_date, '%Y-%m')
         ORDER BY month`,
        params
      );

      const trend = rows.map((r: RowDataPacket) => ({
        month: r.month,
        compliancePct: r.total_shifts > 0 ? Math.round((r.compliant / r.total_shifts) * 100) : 100,
        totalShifts: r.total_shifts,
        violations: r.violations,
      }));

      res.json({ trend });
    } catch (err) {
      next(err);
    }
  }
);

export const wfmComplianceAnalyticsRouter = router;
