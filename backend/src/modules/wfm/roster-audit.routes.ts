/**
 * Roster Audit Trail Routes
 * Exposes roster decision audit data for compliance tracking
 */

import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const wrap = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * GET /api/roster-audit/trails
 * Returns audit trail entries with filters
 */
router.get(
  '/trails',
  requireRole('hr', 'wfm', 'admin', 'super_admin', 'operations_manager'),
  wrap(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId, branchId, processId, dateFrom, dateTo, changeType, limit } = req.query;
    const maxLimit = Math.min(parseInt(limit as string) || 100, 500);

    const conditions: string[] = ['1=1'];
    const params: (string | number)[] = [];

    if (employeeId) {
      conditions.push('rda.employee_id = ?');
      params.push(String(employeeId));
    }
    if (branchId) {
      conditions.push('e.branch_id = ?');
      params.push(String(branchId));
    }
    if (processId) {
      conditions.push('e.process_id = ?');
      params.push(String(processId));
    }
    if (dateFrom) {
      conditions.push('rda.roster_date >= ?');
      params.push(String(dateFrom));
    }
    if (dateTo) {
      conditions.push('rda.roster_date <= ?');
      params.push(String(dateTo));
    }
    if (changeType) {
      conditions.push('rda.decision_type = ?');
      params.push(String(changeType));
    }

    params.push(maxLimit);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         rda.id,
         rda.roster_date AS date,
         rda.decision_type AS changeType,
         rda.rule_applied AS reason,
         rda.override_reason AS overrideReason,
         rda.created_at AS timestamp,
         e.id AS employeeId,
         e.employee_code AS employeeCode,
         e.full_name AS employeeName,
         p.process_name AS processName,
         b.branch_name AS branchName,
         sm.shift_name AS shiftName,
         actor.full_name AS changedByName,
         rda.override_by AS changedById,
         rgr.run_type AS runType,
         rgr.triggered_by AS triggeredById,
         trigger_user.full_name AS triggeredByName
       FROM roster_decision_audit rda
       LEFT JOIN employees e ON rda.employee_id = e.id
       LEFT JOIN process_master p ON e.process_id = p.id
       LEFT JOIN branch_master b ON e.branch_id = b.id
       LEFT JOIN wfm_shift_master sm ON rda.assigned_shift_template_id = sm.id
       LEFT JOIN employees actor ON rda.override_by = actor.id
       LEFT JOIN roster_generation_run rgr ON rda.run_id = rgr.id
       LEFT JOIN employees trigger_user ON rgr.triggered_by = trigger_user.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY rda.created_at DESC
       LIMIT ?`,
      params
    );

    const trails = rows.map((r: RowDataPacket) => ({
      id: r.id,
      date: r.date,
      changeType: formatDecisionType(r.changeType),
      changeTypeCode: r.changeType,
      reason: r.overrideReason || r.reason || 'System generated',
      timestamp: r.timestamp,
      employee: {
        id: r.employeeId,
        code: r.employeeCode,
        name: r.employeeName,
      },
      processName: r.processName,
      branchName: r.branchName,
      shiftName: r.shiftName,
      changedBy: r.changedByName || r.triggeredByName || 'System',
      changedById: r.changedById || r.triggeredById,
      runType: r.runType,
    }));

    res.json({ trails, count: trails.length });
  })
);

/**
 * GET /api/roster-audit/summary
 * Returns audit summary statistics
 */
router.get(
  '/summary',
  requireRole('hr', 'wfm', 'admin', 'super_admin'),
  wrap(async (req: AuthenticatedRequest, res: Response) => {
    const { branchId, dateFrom, dateTo } = req.query;
    const period = dateFrom && dateTo
      ? [String(dateFrom), String(dateTo)]
      : [
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          new Date().toISOString().slice(0, 10),
        ];

    let branchFilter = '';
    const params: string[] = [...period];
    if (branchId) {
      branchFilter = 'AND e.branch_id = ?';
      params.push(String(branchId));
    }

    const [typeRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         rda.decision_type,
         COUNT(*) AS count
       FROM roster_decision_audit rda
       LEFT JOIN employees e ON rda.employee_id = e.id
       WHERE rda.roster_date BETWEEN ? AND ?
         ${branchFilter}
       GROUP BY rda.decision_type`,
      params
    );

    const [overrideRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM roster_decision_audit rda
       LEFT JOIN employees e ON rda.employee_id = e.id
       WHERE rda.roster_date BETWEEN ? AND ?
         AND rda.override_by IS NOT NULL
         ${branchFilter}`,
      params
    );

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         rgr.run_type,
         COUNT(*) AS count,
         SUM(rgr.assignments_created) AS assignments,
         SUM(rgr.conflicts_found) AS conflicts
       FROM roster_generation_run rgr
       WHERE rgr.started_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY rgr.run_type`,
      [period[0], period[1]]
    );

    const byType: Record<string, number> = {};
    typeRows.forEach((r: RowDataPacket) => {
      byType[formatDecisionType(r.decision_type)] = Number(r.count);
    });

    const totalChanges = Object.values(byType).reduce((s, n) => s + n, 0);
    const manualOverrides = Number(overrideRows[0]?.count ?? 0);

    const runs = {
      auto: 0,
      manual: 0,
      totalAssignments: 0,
      totalConflicts: 0,
    };
    runRows.forEach((r: RowDataPacket) => {
      if (r.run_type === 'auto') runs.auto = Number(r.count);
      else runs.manual += Number(r.count);
      runs.totalAssignments += Number(r.assignments ?? 0);
      runs.totalConflicts += Number(r.conflicts ?? 0);
    });

    res.json({
      period: { from: period[0], to: period[1] },
      totalChanges,
      manualOverrides,
      overrideRate: totalChanges > 0 ? Math.round((manualOverrides / totalChanges) * 100) : 0,
      byType,
      generationRuns: runs,
    });
  })
);

/**
 * GET /api/roster-audit/generation-runs
 * Returns list of roster generation runs
 */
router.get(
  '/generation-runs',
  requireRole('hr', 'wfm', 'admin', 'super_admin'),
  wrap(async (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         rgr.id,
         rgr.cycle_id AS cycleId,
         rgr.process_id AS processId,
         p.process_name AS processName,
         rgr.branch_id AS branchId,
         b.branch_name AS branchName,
         rgr.run_type AS runType,
         rgr.status,
         rgr.employees_processed AS employeesProcessed,
         rgr.assignments_created AS assignmentsCreated,
         rgr.weekoffs_allocated AS weekoffsAllocated,
         rgr.conflicts_found AS conflictsFound,
         rgr.started_at AS startedAt,
         rgr.completed_at AS completedAt,
         e.full_name AS triggeredByName
       FROM roster_generation_run rgr
       LEFT JOIN process_master p ON rgr.process_id = p.id
       LEFT JOIN branch_master b ON rgr.branch_id = b.id
       LEFT JOIN employees e ON rgr.triggered_by = e.id
       ORDER BY rgr.started_at DESC
       LIMIT ?`,
      [limit]
    );

    res.json({
      runs: rows.map((r: RowDataPacket) => ({
        id: r.id,
        cycleId: r.cycleId,
        processId: r.processId,
        processName: r.processName,
        branchId: r.branchId,
        branchName: r.branchName,
        runType: r.runType,
        status: r.status,
        stats: {
          employeesProcessed: r.employeesProcessed,
          assignmentsCreated: r.assignmentsCreated,
          weekoffsAllocated: r.weekoffsAllocated,
          conflictsFound: r.conflictsFound,
        },
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        duration: r.completedAt && r.startedAt
          ? Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)
          : null,
        triggeredBy: r.triggeredByName || 'System',
      })),
    });
  })
);

function formatDecisionType(type: string): string {
  const map: Record<string, string> = {
    shift_assigned: 'Shift Assigned',
    weekoff_assigned: 'Week-off Assigned',
    weekoff_denied: 'Week-off Denied',
    weekoff_waitlisted: 'Week-off Waitlisted',
    shift_frozen: 'Shift Frozen',
    holiday_applied: 'Holiday Applied',
    rejected_request: 'Request Rejected',
    manager_override: 'Manager Override',
  };
  return map[type] || type;
}

export const rosterAuditRouter = router;
