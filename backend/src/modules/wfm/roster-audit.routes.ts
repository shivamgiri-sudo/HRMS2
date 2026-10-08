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
import { lobCondition, readLobFilter, type LobFilter } from '../../shared/lobFilter.js';
import {
  AMENDABLE_CYCLE_STATUSES,
  DECISION_TYPE_CODES,
  ENGINE_ERROR_CODE,
  clampInt,
  deltaPct,
  effectiveDecisionCode,
  formatDecisionType,
  isEngineErrorRule,
  isIsoDate,
  pct,
  previousPeriod,
  resolvePeriod,
} from './roster-audit.helpers.js';
import { actorName, resolveActors } from './roster-audit.actors.js';
import { branchScopeGuard } from "./branch-scope.js";
import { mountAuditDetailRoutes } from "./roster-audit-detail.routes.js";
import { consoleScopeGuard, branchParamGuard, employeeParamGuard } from "./console-scope.js";

const router = Router();
const wrap = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const ROLES = ['hr', 'wfm', 'admin', 'super_admin', 'operations_manager'] as const;
const RUN_STATUSES = ['running', 'completed', 'failed', 'partial'];
/** SQL predicate: rows the engine logged for a per-employee failure (not a real roster decision). */
const NOT_ENGINE_ERROR = `(rda.rule_applied IS NULL OR rda.rule_applied NOT LIKE 'error:%')`;

router.use(requireAuth);
// Branch / process scoping for the whole console (see console-scope.ts): validates the branchId / processId the
// caller named, injects their single branch when they named none, and checks :branchId / :employeeId path params.
router.use(consoleScopeGuard());
router.param("branchId", branchParamGuard());
router.param("employeeId", employeeParamGuard());

interface Scope { conds: string[]; params: (string | number)[] }

/**
 * Shared branch/process/LOB scope for roster_decision_audit (alias rda, LEFT JOIN employees e).
 * Uses the audit row's own denormalised process/branch (what applied AT decision time) and falls back to
 * the employee's CURRENT assignment for older rows that predate those columns.
 */
function auditScope(q: Record<string, unknown>, lob: LobFilter): Scope {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (q.branchId) { conds.push('COALESCE(rda.branch_id, e.branch_id) = ?'); params.push(String(q.branchId)); }
  if (q.processId) { conds.push('COALESCE(rda.process_id, e.process_id) = ?'); params.push(String(q.processId)); }
  const lobCond = lobCondition(lob);
  if (lobCond) { conds.push(lobCond.sql); params.push(...lobCond.params); }
  return { conds, params };
}

/** Scope for roster_generation_run (alias rgr). Runs carry process/branch but no LOB. */
function runScope(q: Record<string, unknown>): Scope {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (q.branchId) { conds.push('rgr.branch_id = ?'); params.push(String(q.branchId)); }
  if (q.processId) { conds.push('rgr.process_id = ?'); params.push(String(q.processId)); }
  return { conds, params };
}

const runWindow = (from: string, to: string): Scope => ({
  conds: ['rgr.started_at >= ?', 'rgr.started_at < DATE_ADD(?, INTERVAL 1 DAY)'],
  params: [from, to],
});

/**
 * GET /api/roster-audit/trails
 * Returns audit trail entries with filters (server-side paged: limit/offset, total).
 */
router.get(
  '/trails',
  requireRole(...ROLES),
  wrap(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId, dateFrom, dateTo, changeType, cycleId, runId, q, overridesOnly } = req.query;
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const lob = readLobFilter(req, res);
    if (!lob) return;
    if ((dateFrom && !isIsoDate(dateFrom)) || (dateTo && !isIsoDate(dateTo))) {
      res.status(400).json({ error: 'dateFrom/dateTo must be YYYY-MM-DD' });
      return;
    }
    if (changeType && changeType !== ENGINE_ERROR_CODE && !(DECISION_TYPE_CODES as readonly string[]).includes(String(changeType))) {
      res.status(400).json({ error: 'Unknown changeType' });
      return;
    }

    const { conds, params } = auditScope(req.query, lob);
    if (employeeId) { conds.push('rda.employee_id = ?'); params.push(String(employeeId)); }
    if (cycleId) { conds.push('rda.cycle_id = ?'); params.push(String(cycleId)); }
    if (runId) { conds.push('rda.run_id = ?'); params.push(String(runId)); }
    if (dateFrom) { conds.push('rda.roster_date >= ?'); params.push(String(dateFrom)); }
    if (dateTo) { conds.push('rda.roster_date <= ?'); params.push(String(dateTo)); }
    if (changeType === ENGINE_ERROR_CODE) {
      conds.push(`rda.rule_applied LIKE 'error:%'`);
    } else if (changeType) {
      conds.push('rda.decision_type = ?', NOT_ENGINE_ERROR);
      params.push(String(changeType));
    }
    if (overridesOnly === '1' || overridesOnly === 'true') conds.push('rda.override_by IS NOT NULL');
    if (typeof q === 'string' && q.trim()) {
      const like = `%${q.trim().slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push('(e.full_name LIKE ? OR e.employee_code LIKE ?)');
      params.push(like, like);
    }
    const where = conds.length ? conds.join(' AND ') : '1=1';

    // LIMIT/OFFSET are interpolated, not bound: mysql2's prepared-statement path throws "Incorrect
    // arguments to mysqld_stmt_execute" for `LIMIT ?` here. Both are clamp()ed integers, never raw text.
    const [[rows], [countRows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT
           rda.id,
           rda.roster_date AS date,
           rda.decision_type AS changeType,
           rda.rule_applied AS reason,
           rda.override_reason AS overrideReason,
           rda.created_at AS timestamp,
           rda.cycle_id AS cycleId,
           rda.run_id AS runId,
           rda.acted_by_role AS actedByRole,
           e.id AS employeeId,
           e.employee_code AS employeeCode,
           e.full_name AS employeeName,
           p.process_name AS processName,
           b.branch_name AS branchName,
           st.shift_name AS shiftName,
           rda.override_by AS changedById,
           rgr.run_type AS runType,
           rgr.triggered_by AS triggeredById
         FROM roster_decision_audit rda
         LEFT JOIN employees e ON rda.employee_id = e.id
         LEFT JOIN process_master p ON p.id = COALESCE(rda.process_id, e.process_id)
         LEFT JOIN branch_master b ON b.id = COALESCE(rda.branch_id, e.branch_id)
         LEFT JOIN wfm_shift_template st ON rda.assigned_shift_template_id = st.id
         LEFT JOIN roster_generation_run rgr ON rda.run_id = rgr.id
         WHERE ${where}
         ORDER BY rda.created_at DESC, rda.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
           FROM roster_decision_audit rda
           LEFT JOIN employees e ON rda.employee_id = e.id
          WHERE ${where}`,
        params,
      ),
    ]);

    const actors = await resolveActors(rows.flatMap((r) => [r.changedById, r.triggeredById]));

    const trails = rows.map((r: RowDataPacket) => {
      const code = effectiveDecisionCode(r.changeType, r.reason);
      const isError = code === ENGINE_ERROR_CODE;
      return {
        id: r.id,
        date: r.date,
        changeType: formatDecisionType(code),
        changeTypeCode: code,
        reason: r.overrideReason || r.reason || 'System generated',
        ruleApplied: r.reason,
        isOverride: !!r.changedById,
        isEngineError: isError,
        timestamp: r.timestamp,
        cycleId: r.cycleId,
        runId: r.runId,
        actedByRole: r.actedByRole ?? null,
        employee: { id: r.employeeId, code: r.employeeCode, name: r.employeeName },
        processName: r.processName,
        branchName: r.branchName,
        shiftName: r.shiftName,
        changedBy: r.changedById
          ? actorName(actors, r.changedById)
          : r.triggeredById ? actorName(actors, r.triggeredById) : 'System',
        changedById: r.changedById || r.triggeredById,
        runType: r.runType,
      };
    });

    const total = Number(countRows[0]?.total ?? trails.length);
    res.json({ trails, count: trails.length, total, limit, offset });
  }),
);

/**
 * GET /api/roster-audit/summary
 * Returns audit summary statistics for the period, the previous equal-length period (for deltas),
 * a per-day series and the top override actors.
 */
router.get(
  '/summary',
  requireRole(...ROLES),
  wrap(async (req: AuthenticatedRequest, res: Response) => {
    const lob = readLobFilter(req, res);
    if (!lob) return;
    const period = resolvePeriod(req.query.dateFrom, req.query.dateTo);
    if ('error' in period) { res.status(400).json({ error: period.error }); return; }
    const prev = previousPeriod(period);

    const scope = auditScope(req.query, lob);
    const scopeSql = scope.conds.length ? ` AND ${scope.conds.join(' AND ')}` : '';
    const win = (p: { from: string; to: string }) => ({ sql: 'rda.roster_date BETWEEN ? AND ?', params: [p.from, p.to] });
    const cur = win(period);
    const prv = win(prev);

    const rs = runScope(req.query);
    const runScopeSql = rs.conds.length ? ` AND ${rs.conds.join(' AND ')}` : '';
    const runCur = runWindow(period.from, period.to);
    const runPrv = runWindow(prev.from, prev.to);

    const auditFrom = `FROM roster_decision_audit rda LEFT JOIN employees e ON rda.employee_id = e.id`;
    const runAgg = `SELECT rgr.run_type, rgr.status, COUNT(*) AS count,
                           SUM(rgr.assignments_created) AS assignments, SUM(rgr.conflicts_found) AS conflicts
                    FROM roster_generation_run rgr WHERE ${runCur.conds.join(' AND ')}${runScopeSql}
                    GROUP BY rgr.run_type, rgr.status`;

    const [[typeRows], [dailyRows], [actorRows], [prevRows], [runRows], [prevRunRows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT rda.decision_type, COALESCE(rda.rule_applied LIKE 'error:%', 0) AS is_error,
                COUNT(*) AS count, SUM(rda.override_by IS NOT NULL) AS overrides
         ${auditFrom}
         WHERE ${cur.sql}${scopeSql}
         GROUP BY rda.decision_type, is_error`,
        [...cur.params, ...scope.params],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT rda.roster_date AS d, COUNT(*) AS total, SUM(rda.override_by IS NOT NULL) AS overrides
         ${auditFrom}
         WHERE ${cur.sql} AND ${NOT_ENGINE_ERROR}${scopeSql}
         GROUP BY rda.roster_date ORDER BY rda.roster_date`,
        [...cur.params, ...scope.params],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT rda.override_by AS actorId, COUNT(*) AS count
         ${auditFrom}
         WHERE ${cur.sql} AND rda.override_by IS NOT NULL AND ${NOT_ENGINE_ERROR}${scopeSql}
         GROUP BY rda.override_by ORDER BY count DESC LIMIT 5`,
        [...cur.params, ...scope.params],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(rda.override_by IS NOT NULL), 0) AS overrides
         ${auditFrom}
         WHERE ${prv.sql} AND ${NOT_ENGINE_ERROR}${scopeSql}`,
        [...prv.params, ...scope.params],
      ),
      db.execute<RowDataPacket[]>(runAgg, [...runCur.params, ...rs.params]),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(rgr.conflicts_found), 0) AS conflicts
         FROM roster_generation_run rgr WHERE ${runPrv.conds.join(' AND ')}${runScopeSql}`,
        [...runPrv.params, ...rs.params],
      ),
    ]);

    const byType: Record<string, number> = {};
    const byTypeDetail: Array<{ code: string; label: string; count: number; overrides: number }> = [];
    let engineErrors = 0;
    let totalChanges = 0;
    let manualOverrides = 0;
    typeRows.forEach((r: RowDataPacket) => {
      const count = Number(r.count);
      if (Number(r.is_error) === 1) { engineErrors += count; return; }
      const label = formatDecisionType(r.decision_type);
      byType[label] = (byType[label] ?? 0) + count;
      byTypeDetail.push({ code: r.decision_type, label, count, overrides: Number(r.overrides ?? 0) });
      totalChanges += count;
      manualOverrides += Number(r.overrides ?? 0);
    });
    byTypeDetail.sort((a, b) => b.count - a.count);

    const runs = { auto: 0, manual: 0, total: 0, failed: 0, partial: 0, totalAssignments: 0, totalConflicts: 0 };
    runRows.forEach((r: RowDataPacket) => {
      const n = Number(r.count);
      if (r.run_type === 'auto') runs.auto += n; else runs.manual += n;
      if (r.status === 'failed') runs.failed += n;
      if (r.status === 'partial') runs.partial += n;
      runs.total += n;
      runs.totalAssignments += Number(r.assignments ?? 0);
      runs.totalConflicts += Number(r.conflicts ?? 0);
    });

    const actors = await resolveActors(actorRows.map((r) => r.actorId));
    const prevTotal = Number(prevRows[0]?.total ?? 0);
    const prevOverrides = Number(prevRows[0]?.overrides ?? 0);
    const prevRuns = Number(prevRunRows[0]?.count ?? 0);
    const prevConflicts = Number(prevRunRows[0]?.conflicts ?? 0);
    const overrideRate = pct(manualOverrides, totalChanges);

    res.json({
      period,
      previousPeriod: prev,
      totalChanges,
      manualOverrides,
      overrideRate,
      engineErrors,
      byType,
      byTypeDetail,
      daily: dailyRows.map((r: RowDataPacket) => ({ date: r.d, total: Number(r.total), overrides: Number(r.overrides ?? 0) })),
      topActors: actorRows.map((r: RowDataPacket) => ({ id: r.actorId, name: actorName(actors, r.actorId), count: Number(r.count) })),
      generationRuns: runs,
      previous: {
        totalChanges: prevTotal,
        manualOverrides: prevOverrides,
        overrideRate: pct(prevOverrides, prevTotal),
        runs: prevRuns,
        conflicts: prevConflicts,
      },
      deltas: {
        totalChanges: deltaPct(totalChanges, prevTotal),
        manualOverrides: deltaPct(manualOverrides, prevOverrides),
        runs: deltaPct(runs.total, prevRuns),
        conflicts: deltaPct(runs.totalConflicts, prevConflicts),
      },
      // Decisions are windowed by roster_date; runs by started_at. Runs have no LOB, so LOB is not applied to them.
      basis: { decisions: 'roster_date', runs: 'started_at', lobAppliedToRuns: false },
    });
  }),
);

/**
 * GET /api/roster-audit/generation-runs
 * Roster generation runs, filtered by branch/process/date window/status; paged (limit/offset, total).
 */
router.get(
  '/generation-runs',
  requireRole(...ROLES),
  wrap(async (req: AuthenticatedRequest, res: Response) => {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const { dateFrom, dateTo, status } = req.query;
    if ((dateFrom && !isIsoDate(dateFrom)) || (dateTo && !isIsoDate(dateTo))) {
      res.status(400).json({ error: 'dateFrom/dateTo must be YYYY-MM-DD' });
      return;
    }
    if (status && !RUN_STATUSES.includes(String(status))) {
      res.status(400).json({ error: 'Unknown status' });
      return;
    }

    const { conds, params } = runScope(req.query);
    if (dateFrom) { conds.push('rgr.started_at >= ?'); params.push(String(dateFrom)); }
    if (dateTo) { conds.push('rgr.started_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(String(dateTo)); }
    if (status) { conds.push('rgr.status = ?'); params.push(String(status)); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // limit/offset: clamped integers interpolated (see /trails for why they are not bound).
    const [[rows], [countRows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
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
           TIMESTAMPDIFF(SECOND, rgr.started_at, rgr.completed_at) AS durationSeconds,
           rgr.triggered_by AS triggeredById,
           wc.week_start_date AS weekStart,
           wc.week_end_date AS weekEnd
         FROM roster_generation_run rgr
         LEFT JOIN process_master p ON rgr.process_id = p.id
         LEFT JOIN branch_master b ON rgr.branch_id = b.id
         LEFT JOIN weekly_roster_cycle wc ON rgr.cycle_id = wc.id
         ${where}
         ORDER BY rgr.started_at DESC, rgr.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM roster_generation_run rgr ${where}`, params),
    ]);

    const actors = await resolveActors(rows.map((r) => r.triggeredById));

    res.json({
      total: Number(countRows[0]?.total ?? rows.length),
      limit,
      offset,
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
          employeesProcessed: Number(r.employeesProcessed ?? 0),
          assignmentsCreated: Number(r.assignmentsCreated ?? 0),
          weekoffsAllocated: Number(r.weekoffsAllocated ?? 0),
          conflictsFound: Number(r.conflictsFound ?? 0),
        },
        weekStart: r.weekStart ?? null,
        weekEnd: r.weekEnd ?? null,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        duration: r.durationSeconds === null || r.durationSeconds === undefined ? null : Math.max(0, Number(r.durationSeconds)),
        triggeredBy: actorName(actors, r.triggeredById),
      })),
    });
  }),
);

/**
 * GET /api/roster-audit/amendment-options?processId=&branchId=&cycleId=
 * Feeds the "Record Amendment" form with dropdown domains: amendable (post-publication) cycles and,
 * once a cycle is chosen, its employees and the shift templates valid for that cycle's process.
 */
router.get(
  '/amendment-options',
  requireRole(...ROLES),
  wrap(async (req: AuthenticatedRequest, res: Response) => {
    const { processId, branchId, cycleId } = req.query;
    const conds = [`c.status IN (${AMENDABLE_CYCLE_STATUSES.map(() => '?').join(',')})`];
    const params: string[] = [...AMENDABLE_CYCLE_STATUSES];
    if (processId) { conds.push('c.process_id = ?'); params.push(String(processId)); }
    if (branchId) { conds.push('c.branch_id = ?'); params.push(String(branchId)); }

    const [cycleRows] = await db.execute<RowDataPacket[]>(
      `SELECT c.id, c.status, c.week_start_date AS weekStart, c.week_end_date AS weekEnd,
              p.process_name AS processName, b.branch_name AS branchName
         FROM weekly_roster_cycle c
         LEFT JOIN process_master p ON c.process_id = p.id
         LEFT JOIN branch_master b ON c.branch_id = b.id
        WHERE ${conds.join(' AND ')}
        ORDER BY c.week_start_date DESC
        LIMIT 100`,
      params,
    );

    let employees: RowDataPacket[] = [];
    let shifts: RowDataPacket[] = [];
    if (cycleId) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT e.id, e.employee_code AS code, e.full_name AS name
           FROM roster_daily_assignment rda
           JOIN employees e ON e.id = rda.employee_id
          WHERE rda.cycle_id = ?
          ORDER BY e.full_name
          LIMIT 1000`,
        [String(cycleId)],
      );
      employees = empRows;
      const [cycleRow] = await db.execute<RowDataPacket[]>(
        `SELECT process_id FROM weekly_roster_cycle WHERE id = ? LIMIT 1`,
        [String(cycleId)],
      );
      const cycleProcessId = cycleRow[0]?.process_id ?? null;
      const [shiftRows] = await db.execute<RowDataPacket[]>(
        `SELECT st.id, st.shift_code AS code, st.shift_name AS name, st.start_time AS startTime, st.end_time AS endTime
           FROM wfm_shift_template st
          WHERE st.active_status = 1
            AND (st.process_id IS NULL OR st.process_id = ?)
          ORDER BY st.shift_code
          LIMIT 200`,
        [cycleProcessId],
      );
      shifts = shiftRows;
    }

    res.json({
      cycles: cycleRows.map((c) => ({
        id: c.id, status: c.status, weekStart: c.weekStart, weekEnd: c.weekEnd,
        processName: c.processName, branchName: c.branchName,
      })),
      employees,
      shifts,
    });
  }),
);

mountAuditDetailRoutes(router, wrap, ROLES);

// Re-exported for existing importers/tests.
export { formatDecisionType, isEngineErrorRule };
export const rosterAuditRouter = router;
