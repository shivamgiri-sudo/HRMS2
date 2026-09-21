// backend/src/modules/wfm/mismatch-review.routes.ts
// WFM queue for APR/biometric mismatch and week_off_worked review over
// `attendance_daily_record` — distinct from `attendance-exceptions.routes.ts`, which reads
// `attendance_reconciliation_issue` (see that file's header for the boundary).
//
// Read roles (GET /, GET /summary): the union of role_page_access grants for WFM_LIVE_TRACKER
// (super_admin, branch_head, branch_wfm, manager, process_manager, wfm) with the page's other
// org-wide viewers (hr, admin, ceo, payroll) — matching VIEW_ROLES in attendance-exceptions.routes.ts.
// Safe only because every one of these roles is now scoped via resolveUserBusinessScope +
// buildEmployeeScopeCondition below; a role widened without scoping would be a defect, not a fix.
//
// Queue definition: only days where APR and biometric disagree (both sources are compared only
// for APR-configured staff) or week-off worked with real data. See buildWhere().
//
// Escalation: WFM/HR can escalate a row to the employee's reporting manager (POST /:id/escalate);
// the manager records a recommendation (POST /:id/manager-response); WFM/HR still makes the final
// resolution. Backed by attendance_mismatch_escalation (migration 1832) — routes degrade to a
// 503 "not yet enabled" while the table is absent.
//
// Write role (PATCH /:id/resolve) is intentionally narrower: wfm, hr, admin, super_admin.
// Resolving a mismatch rewrites attendance_status and lwp_value, which payroll reads.

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { resolveUserBusinessScope, buildEmployeeScopeCondition } from '../../shared/enterpriseScope.js';
import { logger } from '../../logger.js';
import {
  EscalationError,
  attachEscalations,
  closeEscalations,
  escalateToManager,
  escalationHistory,
  recordManagerResponse,
} from './mismatch-escalation.service.js';

export const mismatchReviewRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

const VIEW_ROLES = [
  'wfm', 'branch_wfm', 'hr', 'admin', 'super_admin', 'ceo', 'payroll',
  'manager', 'process_manager', 'branch_head',
] as const;

mismatchReviewRouter.use(requireAuth);


// ── Payroll-closed months ─────────────────────────────────────────────────────
// Once a company-wide payroll run for a month is finalized/locked/disbursed, that month's
// attendance is settled and must not keep reappearing here. Per-row closure is already covered
// by `adr.is_locked = 0` (the payroll attendance freeze sets it); this catches the whole month.
// Scoped (cost-centre) and branch/process-filtered runs are ignored on purpose: a run covering
// one branch must not hide every other branch's open items.
const CLOSED_RUN_STATUSES_SQL = "('FINALIZED','LOCKED','DISBURSED')";
const CLOSED_MONTHS_CACHE_MS = 60_000;
let closedMonthsCache: { at: number; value: { start: string; end: string }[] } | null = null;

function monthBounds(runMonth: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(runMonth);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
}

async function closedPayrollMonths(): Promise<{ start: string; end: string }[]> {
  if (closedMonthsCache && Date.now() - closedMonthsCache.at < CLOSED_MONTHS_CACHE_MS) {
    return closedMonthsCache.value;
  }
  let value: { start: string; end: string }[] = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT spr.run_month
         FROM salary_prep_run spr
        WHERE UPPER(spr.status) IN ${CLOSED_RUN_STATUSES_SQL}
          AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 6 MONTH), '%Y-%m')
          AND COALESCE(spr.scope_kind, 'company') <> 'scoped'
          AND COALESCE(spr.branch_filter, '') = ''
          AND COALESCE(spr.process_filter, '') = ''`,
    );
    value = (rows as RowDataPacket[])
      .map((r) => monthBounds(String(r.run_month)))
      .filter((b): b is { start: string; end: string } => b !== null);
  } catch (err) {
    // A failed lookup must not take the whole queue down; per-row is_locked still applies.
    logger.warn({ err: (err as Error).message }, '[mismatch-review] closed-month lookup failed');
  }
  closedMonthsCache = { at: Date.now(), value };
  return value;
}

/** Row-scope predicate against the LEFT-JOINed `employees` row (alias `e`). */
async function scopeConditionFor(req: any) {
  const scope = await resolveUserBusinessScope(req.authUser);
  return buildEmployeeScopeCondition(scope, {
    employeeId: 'e.id',
    branchId: 'e.branch_id',
    processId: 'e.process_id',
    departmentId: 'e.department_id',
    managerEmployeeId: 'e.reporting_manager_id',
  });
}

/**
 * Shared WHERE builder for list / count / summary so the three cannot drift apart (they did
 * before this fix: the list was unbounded while /summary was hard-coded to a 60-day window).
 *
 * Scoping goes through `buildEmployeeScopeCondition` against the LEFT-JOINed `employees` row
 * (alias `e`), exactly as attendance-exceptions.routes.ts does it. `branchId`/`processId` remain
 * optional filters on `adr.branch_id`/`adr.process_id` (attendance_daily_record carries its own
 * copies) — they narrow further; they do not replace the scope predicate.
 */
type QueueQuery = {
  /** `FROM (...) cand JOIN adr ... LEFT JOIN employees e` — its bound params come first. */
  from: string;
  fromParams: unknown[];
  /** Outer `WHERE ...` (filters, closed months, row scope) and its params. */
  sql: string;
  params: unknown[];
};

/** All bound params for a query built as `${q.from} ${q.sql}`, in placeholder order. */
const queueParams = (q: QueueQuery): unknown[] => [...q.fromParams, ...q.params];

async function buildWhere(req: any): Promise<QueueQuery> {
  const { fromDate, toDate, employeeId, branchId, processId, search } = req.query;

  const scopeCondition = await scopeConditionFor(req);

  // The queue is deliberately narrow — only days where the two attendance sources
  // genuinely disagree, or where someone worked their week-off:
  //  * biometric_status / apr_status are only written when that source has minutes (the engine
  //    sets apr_status inside the APR branch, biometric_status only when COSEC minutes > 0), so
  //    "both present and different" already excludes support staff (biometric-only, apr_status
  //    NULL) and days on which neither source produced data.
  //  * missing_punch / plain absent rows are NOT here: one-source problems live on the
  //    Exceptions tab. The old `attendance_status = 'missing_punch'` arm dumped every empty day
  //    into this queue.
  //  * anything payroll has frozen (is_locked) or whose month has a finalized company-wide run
  //    is closed, so last month disappears once payroll is done.
  // Two candidate arms, UNIONed, instead of one WHERE with an OR. With the OR MySQL could not use
  // any index for either arm and fell back to scanning every unlocked row (measured live on
  // 2026-09-21: 17.2s). Split, arm 1 uses idx_adr_mismatch_open (1.4s) and arm 2 uses
  // idx_adr_status (0.08s); the UNION is ~1.7s. Both arms carry the date window so the index
  // range is bounded. Filters that touch employees (search, scope) stay in the outer query, which
  // only ever sees the already-narrow candidate set.
  const dateConds: string[] = [];
  const dateParams: unknown[] = [];
  if (fromDate) {
    dateConds.push('adr.record_date >= ?');
    dateParams.push(fromDate);
  } else {
    // record_date leads idx_adr_date / idx_adr_record_date_status; an unbounded query scans the
    // whole table, so default to the same 30-day window the dashboard-style pages use.
    dateConds.push('adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)');
  }
  if (toDate) { dateConds.push('adr.record_date <= ?'); dateParams.push(toDate); }
  const dateSql = dateConds.join(' AND ');

  const from = `FROM (
      SELECT adr.id FROM attendance_daily_record adr
       WHERE adr.mismatch_flag = 1
         AND adr.mismatch_resolved_at IS NULL
         AND adr.is_locked = 0
         AND adr.biometric_status IS NOT NULL
         AND adr.apr_status IS NOT NULL
         AND adr.biometric_status <> adr.apr_status
         AND (COALESCE(adr.biometric_minutes, 0) > 0 OR COALESCE(adr.dialler_minutes, 0) > 0)
         AND ${dateSql}
      UNION
      SELECT adr.id FROM attendance_daily_record adr
       WHERE adr.attendance_status = 'week_off_worked' AND COALESCE(adr.raw_minutes, 0) > 0
         AND adr.mismatch_resolved_at IS NULL
         AND adr.is_locked = 0
         AND ${dateSql}
    ) cand
    JOIN attendance_daily_record adr ON adr.id = cand.id
    LEFT JOIN employees e ON e.id = adr.employee_id`;
  const fromParams: unknown[] = [...dateParams, ...dateParams];

  const conds: string[] = [];
  const params: unknown[] = [];

  if (employeeId) { conds.push('adr.employee_id = ?'); params.push(employeeId); }
  if (branchId)   { conds.push('adr.branch_id = ?'); params.push(branchId); }
  if (processId)  { conds.push('adr.process_id = ?'); params.push(processId); }
  if (search) {
    // Server-side on purpose: client-side filtering only ever sees the rows already on
    // the current page, which silently misses matches on every other page.
    const like = `%${String(search).trim()}%`;
    conds.push(`(
      e.employee_code LIKE ?
      OR CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) LIKE ?
    )`);
    params.push(like, like);
  }

  for (const { start, end } of await closedPayrollMonths()) {
    conds.push('(adr.record_date < ? OR adr.record_date > ?)');
    params.push(start, end);
  }

  conds.push(`(${scopeCondition.sql})`);
  params.push(...scopeCondition.params);

  return { from, fromParams, sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

/** Plain join for single-record loaders (not the queue). */
const FROM_JOIN = `
  FROM attendance_daily_record adr
  LEFT JOIN employees e ON e.id = adr.employee_id`;

// ── List unresolved mismatches and week_off_worked records ────────────────────

mismatchReviewRouter.get(
  '/',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const { page = '1', limit = '50' } = req.query;
    const pg = Math.max(1, Number(page) || 1);
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const offset = (pg - 1) * lim;

    const where = await buildWhere(req);

    const countSql = `SELECT COUNT(*) AS total ${where.from} ${where.sql}`;

    const dataSql = `
      SELECT
        adr.id, adr.employee_id, adr.record_date, adr.attendance_status,
        adr.attendance_source, adr.biometric_status, adr.apr_status,
        adr.mismatch_flag, adr.mismatch_resolved_at, adr.mismatch_resolved_by,
        adr.mismatch_resolution_reason,
        adr.biometric_minutes, adr.dialler_minutes, adr.raw_minutes,
        adr.lwp_value, adr.is_locked,
        CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
        e.employee_code,
        bm.branch_name, pm.process_name,
        dm.designation_code AS designation
      ${where.from}
      LEFT JOIN branch_master bm ON bm.id = adr.branch_id
      LEFT JOIN process_master pm ON pm.id = adr.process_id
      LEFT JOIN designation_master dm ON dm.id = e.designation_id
      ${where.sql}
      ORDER BY adr.record_date DESC, adr.employee_id
      LIMIT ${lim} OFFSET ${offset}`;
    // Count and page are independent reads; running them together roughly halves the wait.
    const [[countRows], [rows]] = await Promise.all([
      db.execute<RowDataPacket[]>(countSql, queueParams(where)),
      db.execute<RowDataPacket[]>(dataSql, queueParams(where)),
    ]);
    const total = Number((countRows[0] as any)?.total ?? 0);
    const data = await attachEscalations(rows as RowDataPacket[], req.authUser?.id);

    res.json({ success: true, data, total, page: pg, limit: lim });
  })
);

// ── Resolve a mismatch or missing_punch or week_off_worked record ─────────────

mismatchReviewRouter.patch(
  '/:id/resolve',
  requireRole('wfm', 'hr', 'admin', 'super_admin'),
  h(async (req, res) => {
    const { id } = req.params;
    const { final_status, lwp_value, reason } = req.body as {
      final_status: string;
      lwp_value: number;
      reason: string;
    };

    if (!final_status || !reason) {
      return res.status(400).json({ success: false, message: 'final_status and reason are required' });
    }

    const validStatuses = ['present', 'half_day', 'absent', 'leave_approved', 'holiday', 'week_off', 'week_off_worked'];
    if (!validStatuses.includes(final_status)) {
      return res.status(400).json({ success: false, message: `Invalid final_status: ${final_status}` });
    }

    const [check] = await db.execute<RowDataPacket[]>(
      `SELECT id, attendance_status, lwp_value, mismatch_flag, employee_id, record_date, is_locked
       FROM attendance_daily_record WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!(check as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    const rec = check[0] as any;

    if (rec.is_locked) {
      return res.status(409).json({ success: false, message: 'Record is locked by payroll. Use manual override for locked months.' });
    }

    const resolvedBy = req.authUser?.id as string;
    const newLwp = lwp_value !== undefined ? Number(lwp_value) : Number(rec.lwp_value);

    await db.execute(
      `UPDATE attendance_daily_record
       SET attendance_status         = ?,
           lwp_value                 = ?,
           mismatch_resolved_at      = NOW(),
           mismatch_resolved_by      = ?,
           mismatch_resolution_reason = ?,
           mismatch_flag             = 0,
           processed_at              = NOW()
       WHERE id = ?`,
      [final_status, newLwp, resolvedBy, reason, id]
    );

    await logSensitiveAction({
      actor_user_id: resolvedBy,
      actor_role: req.authUser?.role ?? 'unknown',
      action_type: 'ATTENDANCE_MISMATCH_RESOLVED',
      module_key: 'attendance',
      entity_type: 'attendance_daily_record',
      entity_id: id,
      employee_id: rec.employee_id,
      old_value_json: {
        attendance_status: rec.attendance_status,
        lwp_value: rec.lwp_value,
        mismatch_flag: rec.mismatch_flag,
      },
      new_value_json: {
        attendance_status: final_status,
        lwp_value: newLwp,
        mismatch_flag: 0,
        resolution_reason: reason,
      },
    });

    await closeEscalations(id, rec.employee_id);

    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_daily_record WHERE id = ? LIMIT 1`, [id]
    );
    res.json({ success: true, data: (updated as RowDataPacket[])[0] });
  })
);

// ── Summary counts for WFM dashboard ─────────────────────────────────────────

mismatchReviewRouter.get(
  '/summary',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const where = await buildWhere(req);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(CASE WHEN adr.attendance_status <> 'week_off_worked' THEN 1 END) AS unresolved_mismatches,
         COUNT(CASE WHEN adr.attendance_status = 'week_off_worked' THEN 1 END) AS week_off_worked,
         COUNT(*) AS total_open
       ${where.from}
       ${where.sql}`,
      queueParams(where)
    );
    res.json({ success: true, data: rows[0] });
  })
);

// ── Escalation to the reporting manager ──────────────────────────────────────

const ESCALATE_ROLES = ['wfm', 'hr', 'admin', 'super_admin'] as const;

/** One queue row, visible to the caller under the same scope predicate as the list. */
async function loadScopedRecord(req: any, id: string) {
  const scope = await scopeConditionFor(req);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.id, adr.employee_id, adr.is_locked, adr.mismatch_resolved_at,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
            e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name
       ${FROM_JOIN}
      WHERE adr.id = ? AND (${scope.sql})
      LIMIT 1`,
    [id, ...scope.params],
  );
  return (rows as RowDataPacket[])[0] as any | undefined;
}

function sendEscalationError(res: any, err: unknown) {
  if (err instanceof EscalationError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  throw err;
}

mismatchReviewRouter.post(
  '/:id/escalate',
  requireRole(...ESCALATE_ROLES),
  h(async (req, res) => {
    const rec = await loadScopedRecord(req, req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Record not found' });
    if (rec.is_locked || rec.mismatch_resolved_at) {
      return res.status(409).json({ success: false, message: 'Record is already resolved or locked by payroll.' });
    }
    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    try {
      const result = await escalateToManager({
        adrId: rec.id,
        employeeId: rec.employee_id,
        employeeLabel: `${String(rec.employee_name).trim()} (${rec.employee_code})`,
        recordDate: rec.record_date,
        actorUserId: req.authUser?.id as string,
        actorRole: req.authUser?.role ?? 'unknown',
        note,
      });
      await logSensitiveAction({
        actor_user_id: req.authUser?.id as string,
        actor_role: req.authUser?.role ?? 'unknown',
        action_type: 'ATTENDANCE_MISMATCH_ESCALATED',
        module_key: 'attendance',
        entity_type: 'attendance_daily_record',
        entity_id: rec.id,
        employee_id: rec.employee_id,
        new_value_json: { level: result.level, escalated_to_employee_id: result.escalated_to_employee_id, note },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      return sendEscalationError(res, err);
    }
  })
);

mismatchReviewRouter.post(
  '/:id/manager-response',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const { recommended_status, note } = (req.body ?? {}) as { recommended_status?: string; note?: string };
    if (!recommended_status || !note || !String(note).trim()) {
      return res.status(400).json({ success: false, message: 'recommended_status and note are required' });
    }
    const rec = await loadScopedRecord(req, req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Record not found' });
    try {
      const result = await recordManagerResponse({
        adrId: rec.id,
        employeeId: rec.employee_id,
        employeeLabel: `${String(rec.employee_name).trim()} (${rec.employee_code})`,
        recordDate: rec.record_date,
        actorUserId: req.authUser?.id as string,
        recommendedStatus: recommended_status,
        note: String(note),
      });
      await logSensitiveAction({
        actor_user_id: req.authUser?.id as string,
        actor_role: req.authUser?.role ?? 'unknown',
        action_type: 'ATTENDANCE_MISMATCH_MANAGER_RECOMMENDED',
        module_key: 'attendance',
        entity_type: 'attendance_daily_record',
        entity_id: rec.id,
        employee_id: rec.employee_id,
        new_value_json: { recommended_status, note: String(note) },
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendEscalationError(res, err);
    }
  })
);

// ── Drill-down: one record in full, with its escalation history ──────────────
// Declared last so it cannot shadow GET /summary.

mismatchReviewRouter.get(
  '/:id',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const scope = await scopeConditionFor(req);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT adr.*,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              e.employee_code,
              bm.branch_name, pm.process_name,
              CONCAT(rb.first_name, ' ', COALESCE(rb.last_name, '')) AS resolved_by_name
         FROM attendance_daily_record adr
         LEFT JOIN employees e ON e.id = adr.employee_id
         LEFT JOIN branch_master bm ON bm.id = adr.branch_id
         LEFT JOIN process_master pm ON pm.id = adr.process_id
         LEFT JOIN employees rb ON rb.user_id = adr.mismatch_resolved_by
        WHERE adr.id = ? AND (${scope.sql})
        LIMIT 1`,
      [req.params.id, ...scope.params],
    );
    const record = (rows as RowDataPacket[])[0];
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    const escalations = await escalationHistory(String(record.id));
    res.json({ success: true, data: { record, escalations } });
  })
);

