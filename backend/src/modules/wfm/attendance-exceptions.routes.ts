// backend/src/modules/wfm/attendance-exceptions.routes.ts
// Read-only worklist over `attendance_reconciliation_issue` — the reconciliation /
// data-integrity exceptions produced nightly by the ncosec-attendance-reconciliation
// worker. Powers /wfm/attendance-exceptions.
//
// This is deliberately NOT the same store as `attendance_exception` (read by
// /api/attendance/exception-engine/*, which has never been populated) and NOT the same
// as `attendance_daily_record` mismatches (served by mismatch-review.routes.ts at
// /api/wfm/mismatches, which resolves individual attendance records).
//
// Accessible to: wfm, hr, admin, super_admin, ceo, payroll, process_manager, branch_head
// (payroll included because `salary_payable_days_mismatch` blocks a payroll run).

import { Router } from 'express';
import { requireAuth, requireWriteAccess } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { resolveUserBusinessScope, buildEmployeeScopeCondition } from '../../shared/enterpriseScope.js';

export const attendanceExceptionsRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// Aligned with the page gate: role_page_access grants WFM_LIVE_TRACKER (this route's
// pageCode) to super_admin, admin, wfm, branch_wfm, manager, process_manager and
// branch_head in the live DB. Any of those reaching a 403 here would be able to open the
// page but never see a row, so they are all included. hr / ceo / payroll are added on top
// because they are org-wide roles and payroll owns salary_payable_days_mismatch, which
// blocks a payroll run. Row-level scoping still applies to every one of them.
const VIEW_ROLES = [
  'wfm', 'branch_wfm', 'hr', 'admin', 'super_admin', 'ceo', 'payroll',
  'manager', 'process_manager', 'branch_head',
  // payroll_head is a distinct role_key from 'payroll' — requireRole does a literal match
  // with no alias expansion, so listing 'payroll' does not admit it. Added for the
  // Attendance Lookup drawer's Exceptions tab, which shows one employee's exceptions to
  // the person correcting their attendance.
  'payroll_head',
] as const;

/**
 * Who may close an exception. Deliberately narrower than VIEW_ROLES: resolving one is a
 * statement that the underlying data problem has been dealt with, and a payroll month is
 * signed off on the back of it. Payroll Head owns that call, Super Admin overrides.
 */
const RESOLVE_ROLES = ['super_admin', 'payroll_head'] as const;

const MIN_RESOLVE_REASON = 10;

// Mirrors the live ENUM (migrations 535 / 536 / 542 / 543).
const ISSUE_TYPES = new Set([
  'unmapped_cosec_user',
  'missing_ibd',
  'zero_minute_attendance',
  'missing_punch_with_usable_source',
  'missing_adr',
  'apr_missing_adr',
  'apr_minutes_mismatch',
  'apr_source_fallback_when_apr_exists',
  'approved_regularization_missing_adr',
  'salary_payable_days_mismatch',
  'dialler_source_without_evidence',
  'inactive_cosec_user_activity',
]);

// The ENUM has exactly two values — there is no 'info', despite what
// dashboard-drilldown.service.ts's ORDER BY suggests.
const SEVERITIES = new Set(['blocker', 'warning']);
const AUTO_FIX_STATUSES = new Set(['not_attempted', 'fixed', 'skipped', 'failed']);
const STATUSES = new Set(['open', 'resolved', 'all']);

const EXPORT_ROW_CAP = 5000;

function asArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => String(v)).filter(Boolean);
}

attendanceExceptionsRouter.use(requireAuth);

/**
 * Shared WHERE builder for list / summary / export so the three can never drift apart.
 *
 * Scoping goes through `buildEmployeeScopeCondition` against the LEFT-JOINed `employees`
 * row, because `attendance_reconciliation_issue` carries no branch_id/process_id of its
 * own. A consequence worth stating: `unmapped_cosec_user` rows have employee_id IS NULL,
 * so every scope predicate on emp.* evaluates to NULL and those rows drop out for any
 * scoped viewer. That is the desired behaviour — an unmapped biometric user cannot be
 * attributed to a branch, so it must not leak into a branch-scoped list.
 *
 * Note we deliberately do NOT filter on emp.active_status: an exception against a
 * since-deactivated employee is still a real payroll blocker.
 */
async function buildWhere(req: any, opts: { ignoreStatus?: boolean } = {}): Promise<{
  sql: string;
  params: unknown[];
  scopeIsGlobal: boolean;
  from: string | null;
  to: string | null;
}> {
  const {
    fromDate, toDate, status = 'open', severity, autoFixStatus,
    branchId, processId, employeeId, search,
  } = req.query;

  const scope = await resolveUserBusinessScope(req.authUser);
  const scopeCondition = buildEmployeeScopeCondition(scope, {
    employeeId: 'emp.id',
    branchId: 'emp.branch_id',
    processId: 'emp.process_id',
    departmentId: 'emp.department_id',
    managerEmployeeId: 'emp.reporting_manager_id',
  });
  // Two distinct routes to an unrestricted view, and both must count as org-wide or the
  // "unassigned rows are excluded" footnote below tells the viewer something untrue:
  //   1. a bypass role (super_admin / admin / hr / ceo) → the literal "1=1";
  //   2. any user_assignment_scope row with scope_type='all' → addAssignmentPredicates
  //      short-circuits to "1=1" before it even looks at branch_id, so the condition is
  //      tautological but arrives here wrapped as "(1=1)".
  // Checking only the string missed case 2 (confirmed live: demo-manager-id sees all
  // 5,687 rows yet would have been reported as scoped).
  const scopeIsGlobal =
    scopeCondition.sql === '1=1' || scope.assignments.some((a) => a.scopeType === 'all');

  const conds: string[] = [];
  const params: unknown[] = [];

  // issue_date is the leading column of idx_att_recon_issue_date_status, so an unbounded
  // query would scan the whole table. Default to the same 30-day window the dashboard
  // metric uses, so tile counts and page counts agree.
  if (fromDate) {
    conds.push('ari.issue_date >= ?');
    params.push(fromDate);
  } else {
    conds.push('ari.issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)');
  }
  if (toDate) {
    conds.push('ari.issue_date <= ?');
    params.push(toDate);
  }

  const statusKey = String(status);
  if (!STATUSES.has(statusKey)) {
    const err: any = new Error(`Invalid status: ${statusKey}`);
    err.statusCode = 400;
    throw err;
  }
  // /summary passes ignoreStatus so its open_* and resolved_total buckets both describe
  // the whole range. Applying status here would make resolved_total permanently 0 under
  // the default status=open view, which reads as "nothing has ever been resolved".
  // open_total still equals the status=open list total, because that bucket is itself
  // defined as resolved_at IS NULL.
  if (!opts.ignoreStatus) {
    if (statusKey === 'open') conds.push('ari.resolved_at IS NULL');
    if (statusKey === 'resolved') conds.push('ari.resolved_at IS NOT NULL');
  }

  const issueTypes = asArray(req.query.issueType).filter((t) => ISSUE_TYPES.has(t));
  if (issueTypes.length) {
    conds.push(`ari.issue_type IN (${issueTypes.map(() => '?').join(',')})`);
    params.push(...issueTypes);
  }

  if (severity && SEVERITIES.has(String(severity))) {
    conds.push('ari.severity = ?');
    params.push(severity);
  }
  if (autoFixStatus && AUTO_FIX_STATUSES.has(String(autoFixStatus))) {
    conds.push('ari.auto_fix_status = ?');
    params.push(autoFixStatus);
  }
  if (branchId) {
    conds.push('emp.branch_id = ?');
    params.push(branchId);
  }
  if (processId) {
    conds.push('emp.process_id = ?');
    params.push(processId);
  }
  if (employeeId) {
    conds.push('ari.employee_id = ?');
    params.push(employeeId);
  }
  if (search) {
    // Server-side on purpose: the mismatch-queue page filters only the rows already on
    // screen, which silently misses matches on every other page.
    const like = `%${String(search).trim()}%`;
    conds.push(`(
      emp.employee_code LIKE ?
      OR ari.employee_code LIKE ?
      OR ari.cosec_user_id LIKE ?
      OR CONCAT(emp.first_name, ' ', COALESCE(emp.last_name, '')) LIKE ?
    )`);
    params.push(like, like, like, like);
  }

  conds.push(`(${scopeCondition.sql})`);
  params.push(...scopeCondition.params);

  return {
    sql: `WHERE ${conds.join(' AND ')}`,
    params,
    scopeIsGlobal,
    from: fromDate ? String(fromDate) : null,
    to: toDate ? String(toDate) : null,
  };
}

const FROM_JOIN = `
  FROM attendance_reconciliation_issue ari
  LEFT JOIN employees      emp ON emp.id = ari.employee_id
  LEFT JOIN branch_master  bm  ON bm.id  = emp.branch_id
  LEFT JOIN process_master pm  ON pm.id  = emp.process_id`;

// source_payload_json is deliberately excluded — it is a JSON blob per row and would
// bloat every list response.
const ROW_COLUMNS = `
  ari.id, ari.issue_date, ari.issue_type, ari.severity,
  ari.employee_id,
  COALESCE(emp.employee_code, ari.employee_code) AS employee_code,
  CONCAT(emp.first_name, ' ', COALESCE(emp.last_name, '')) AS employee_name,
  ari.cosec_user_id, ari.source_minutes, ari.hrms_minutes, ari.adr_status,
  ari.auto_fix_status, ari.auto_fix_reason,
  ari.first_detected_at, ari.last_detected_at, ari.resolved_at,
  DATEDIFF(CURDATE(), ari.issue_date) AS age_days,
  bm.branch_name, pm.process_name`;

const ROW_ORDER = `ORDER BY FIELD(ari.severity, 'blocker', 'warning'), ari.issue_date DESC, ari.issue_type`;

// ── List individual exceptions ────────────────────────────────────────────────

attendanceExceptionsRouter.get(
  '/',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const { page = '1', limit = '50' } = req.query;
    const pg = Math.max(1, Number(page) || 1);
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const offset = (pg - 1) * lim;

    const where = await buildWhere(req);

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total ${FROM_JOIN} ${where.sql}`,
      where.params,
    );
    const total = Number((countRows[0] as any)?.total ?? 0);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${ROW_COLUMNS} ${FROM_JOIN} ${where.sql} ${ROW_ORDER} LIMIT ${lim} OFFSET ${offset}`,
      where.params,
    );

    return res.json({ success: true, data: rows, total, page: pg, limit: lim });
  }),
);

// ── KPI summary + per-type breakdown ──────────────────────────────────────────

attendanceExceptionsRouter.get(
  '/summary',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const where = await buildWhere(req, { ignoreStatus: true });

    // Every aggregate is COALESCE-wrapped: SUM() over an empty set returns NULL, and a
    // null KPI is exactly what made the previous version of this page render blank tiles.
    const [summaryRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_in_range,
         COALESCE(SUM(ari.resolved_at IS NULL), 0)                            AS open_total,
         COALESCE(SUM(ari.resolved_at IS NULL AND ari.severity = 'blocker'), 0) AS open_blockers,
         COALESCE(SUM(ari.resolved_at IS NULL AND ari.severity = 'warning'), 0) AS open_warnings,
         COALESCE(SUM(ari.resolved_at IS NOT NULL), 0)                        AS resolved_total,
         COALESCE(SUM(ari.auto_fix_status = 'failed'), 0)                     AS auto_fix_failed,
         COALESCE(MAX(CASE WHEN ari.resolved_at IS NULL
                           THEN DATEDIFF(CURDATE(), ari.issue_date) END), 0)  AS oldest_open_age_days,
         COALESCE(SUM(ari.employee_id IS NULL), 0)                            AS unassigned_total
       ${FROM_JOIN} ${where.sql}`,
      where.params,
    );

    const [byType] = await db.execute<RowDataPacket[]>(
      `SELECT ari.issue_type, ari.severity,
              COUNT(*) AS total,
              COALESCE(SUM(ari.resolved_at IS NULL), 0) AS open_count
       ${FROM_JOIN} ${where.sql}
       GROUP BY ari.issue_type, ari.severity
       ORDER BY open_count DESC, total DESC`,
      where.params,
    );

    const r = (summaryRows[0] ?? {}) as any;

    return res.json({
      success: true,
      data: {
        total_in_range: Number(r.total_in_range ?? 0),
        open_total: Number(r.open_total ?? 0),
        open_blockers: Number(r.open_blockers ?? 0),
        open_warnings: Number(r.open_warnings ?? 0),
        resolved_total: Number(r.resolved_total ?? 0),
        auto_fix_failed: Number(r.auto_fix_failed ?? 0),
        oldest_open_age_days: Number(r.oldest_open_age_days ?? 0),
        // Unmapped biometric users have no employee and therefore no branch. Reporting
        // the figure to a scoped viewer would leak an org-wide count they cannot see
        // rows for, so it is exposed only to roles that already see everything.
        unassigned_total: where.scopeIsGlobal ? Number(r.unassigned_total ?? 0) : null,
        scope_is_global: where.scopeIsGlobal,
        by_type: (byType as any[]).map((row) => ({
          issue_type: row.issue_type,
          severity: row.severity,
          total: Number(row.total ?? 0),
          open_count: Number(row.open_count ?? 0),
        })),
      },
    });
  }),
);

// ── CSV export ────────────────────────────────────────────────────────────────

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

attendanceExceptionsRouter.get(
  ['/export', '/export.csv'],
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const where = await buildWhere(req);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${ROW_COLUMNS} ${FROM_JOIN} ${where.sql} ${ROW_ORDER} LIMIT ${EXPORT_ROW_CAP + 1}`,
      where.params,
    );

    const all = rows as any[];
    const truncated = all.length > EXPORT_ROW_CAP;
    const out = truncated ? all.slice(0, EXPORT_ROW_CAP) : all;

    const header = [
      'issue_date', 'employee_code', 'employee_name', 'branch_name', 'process_name',
      'issue_type', 'severity', 'age_days', 'cosec_user_id',
      'source_minutes', 'hrms_minutes', 'adr_status',
      'auto_fix_status', 'auto_fix_reason',
      'first_detected_at', 'last_detected_at', 'resolved_at',
    ].join(',');

    const body = out.map((row) => [
      escapeCSV(row.issue_date), escapeCSV(row.employee_code), escapeCSV(row.employee_name),
      escapeCSV(row.branch_name), escapeCSV(row.process_name),
      escapeCSV(row.issue_type), escapeCSV(row.severity), escapeCSV(row.age_days),
      escapeCSV(row.cosec_user_id),
      escapeCSV(row.source_minutes), escapeCSV(row.hrms_minutes), escapeCSV(row.adr_status),
      escapeCSV(row.auto_fix_status), escapeCSV(row.auto_fix_reason),
      escapeCSV(row.first_detected_at), escapeCSV(row.last_detected_at), escapeCSV(row.resolved_at),
    ].join(',')).join('\n');

    // A silently truncated export reads as complete, so say so in a header the UI shows.
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.setHeader('X-Export-Row-Count', String(out.length));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Truncated, X-Export-Row-Count');

    void logSensitiveAction({
      actor_user_id: req.authUser?.id,
      actor_role: req.authUser?.role ?? 'unknown',
      action_type: 'ATTENDANCE_EXCEPTIONS_EXPORTED',
      module_key: 'attendance',
      entity_type: 'attendance_reconciliation_issue',
      entity_id: `export_${Date.now()}`,
      reason: `Exported ${out.length} attendance exception rows${truncated ? ` (truncated at ${EXPORT_ROW_CAP})` : ''}`,
      new_value_json: { row_count: out.length, truncated, filters: req.query },
      req,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-exceptions-${stamp}.csv"`);
    return res.send(`${header}\n${body}`);
  }),
);

// ── Resolve / reopen one exception ────────────────────────────────────────────
// The only write endpoints on this store. Until now the table was append-only from the
// nightly reconciliation worker's point of view: `resolved_at` was set by the worker's own
// auto-fix and by nothing else, so a human who had dealt with an issue had no way to say
// so and it stayed on the worklist forever. 18,038 rows, ~6,000 of them open.
//
// Resolving does NOT correct attendance. The correction goes through
// /api/attendance/manual-overrides (which rewrites attendance_daily_record under approval)
// or through a regularization; this only records that a human has closed the exception,
// with their reason. Keeping the two apart is deliberate — one audit trail per kind of
// change, rather than a resolve that silently edits payable days.

/** Load one exception with the same employee joins the list uses, for scope + audit. */
async function getExceptionForWrite(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ari.id, ari.issue_type, ari.severity, ari.issue_date, ari.employee_id,
            ari.resolved_at, ari.review_notes, ari.reviewed_by,
            COALESCE(emp.employee_code, ari.employee_code) AS employee_code,
            emp.branch_id, emp.process_id, emp.department_id, emp.reporting_manager_id
       FROM attendance_reconciliation_issue ari
       LEFT JOIN employees emp ON emp.id = ari.employee_id
      WHERE ari.id = ?
      LIMIT 1`,
    [id],
  );
  return (rows as any[])[0] ?? null;
}

/**
 * Row scope for a single exception, mirroring buildWhere's list scoping.
 *
 * An `unmapped_cosec_user` row has employee_id IS NULL — there is no employee to scope
 * against, so only a caller with a global scope may touch it. Failing closed here matches
 * the list, which surfaces those rows to global viewers only.
 */
async function callerMayWrite(req: any, row: any): Promise<boolean> {
  const scope = await resolveUserBusinessScope(req.authUser);
  const condition = buildEmployeeScopeCondition(scope, {
    employeeId: 'emp.id',
    branchId: 'emp.branch_id',
    processId: 'emp.process_id',
    departmentId: 'emp.department_id',
    managerEmployeeId: 'emp.reporting_manager_id',
  });
  const isGlobal = condition.sql === '1=1' || scope.assignments.some((a) => a.scopeType === 'all');
  if (isGlobal) return true;
  if (!row.employee_id) return false;

  // Re-run the caller's own scope predicate against this one employee rather than
  // reimplementing it — a scope rule that changes shape stays enforced here for free.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM employees emp WHERE emp.id = ? AND (${condition.sql}) LIMIT 1`,
    [row.employee_id, ...condition.params],
  );
  return (rows as any[]).length > 0;
}

attendanceExceptionsRouter.post(
  '/:id/resolve',
  requireWriteAccess,
  requireRole(...RESOLVE_ROLES),
  h(async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < MIN_RESOLVE_REASON) {
      return res.status(400).json({
        success: false,
        error: `A reason of at least ${MIN_RESOLVE_REASON} characters is required to resolve an exception.`,
      });
    }

    const row = await getExceptionForWrite(String(req.params.id));
    if (!row) return res.status(404).json({ success: false, error: 'Exception not found' });
    if (row.resolved_at) {
      return res.status(409).json({ success: false, error: 'This exception is already resolved.' });
    }
    if (!(await callerMayWrite(req, row))) {
      return res.status(403).json({ success: false, error: 'This employee is outside your assigned scope.' });
    }

    await db.execute(
      `UPDATE attendance_reconciliation_issue
          SET resolved_at = NOW(), reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
        WHERE id = ? AND resolved_at IS NULL`,
      [req.authUser.id, reason, row.id],
    );

    void logSensitiveAction({
      actor_user_id: req.authUser?.id,
      actor_role: req.authUser?.role ?? 'unknown',
      action_type: 'ATTENDANCE_EXCEPTION_RESOLVED',
      module_key: 'attendance',
      entity_type: 'attendance_reconciliation_issue',
      entity_id: row.id,
      reason,
      old_value_json: { resolved_at: null, issue_type: row.issue_type, severity: row.severity },
      new_value_json: { resolved_at: 'now', employee_code: row.employee_code, issue_date: row.issue_date },
      req,
    });

    return res.json({ success: true, data: { id: row.id, resolved: true } });
  }),
);

attendanceExceptionsRouter.post(
  '/:id/reopen',
  requireWriteAccess,
  requireRole(...RESOLVE_ROLES),
  h(async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < MIN_RESOLVE_REASON) {
      return res.status(400).json({
        success: false,
        error: `A reason of at least ${MIN_RESOLVE_REASON} characters is required to reopen an exception.`,
      });
    }

    const row = await getExceptionForWrite(String(req.params.id));
    if (!row) return res.status(404).json({ success: false, error: 'Exception not found' });
    if (!row.resolved_at) {
      return res.status(409).json({ success: false, error: 'This exception is already open.' });
    }
    if (!(await callerMayWrite(req, row))) {
      return res.status(403).json({ success: false, error: 'This employee is outside your assigned scope.' });
    }

    await db.execute(
      `UPDATE attendance_reconciliation_issue
          SET resolved_at = NULL, reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
        WHERE id = ?`,
      [req.authUser.id, reason, row.id],
    );

    void logSensitiveAction({
      actor_user_id: req.authUser?.id,
      actor_role: req.authUser?.role ?? 'unknown',
      action_type: 'ATTENDANCE_EXCEPTION_REOPENED',
      module_key: 'attendance',
      entity_type: 'attendance_reconciliation_issue',
      entity_id: row.id,
      reason,
      old_value_json: { resolved_at: row.resolved_at, review_notes: row.review_notes },
      new_value_json: { resolved_at: null },
      req,
    });

    return res.json({ success: true, data: { id: row.id, resolved: false } });
  }),
);
