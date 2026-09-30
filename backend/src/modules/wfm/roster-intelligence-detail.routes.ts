/**
 * Drill-down endpoints for the Roster Command Center "Live Monitoring" tab (Drill-Down Mandate).
 *   GET /api/roster-intelligence/live-detail/employee/:employeeId?date=YYYY-MM-DD
 *   GET /api/roster-intelligence/live-detail/manager/:managerId?date=YYYY-MM-DD
 * Same RBAC as the list endpoints (LIVE_MONITORING_ROLES) plus a row-scope check on the target.
 */
import type { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { todayLocalDateStr } from './shift-due.util.js';
import { generateSingleManagerDigest, type RosterIntelligenceScope } from './roster-intelligence.service.js';
import { shrinkagePct } from './roster-intelligence.calc.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFF_TYPES = "('WEEK_OFF','LEAVE','HOLIDAY','TRAINING')";

function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return todayLocalDateStr(new Date(y, m - 1, d + delta));
}

function inScope(scope: RosterIntelligenceScope | undefined, branchId: unknown, processId: unknown): boolean {
  if (!scope) return true;
  if (scope.branchIds && !scope.branchIds.includes(String(branchId))) return false;
  if (scope.processIds && !scope.processIds.includes(String(processId))) return false;
  return true;
}

export function registerLiveDetailRoutes(
  router: Router,
  roles: string[],
  resolveScope: (req: AuthenticatedRequest) => Promise<RosterIntelligenceScope | undefined>,
): void {
  router.get('/live-detail/employee/:employeeId', requireRole(...roles), async (req, res) => {
    try {
      const date = req.query.date ? String(req.query.date) : todayLocalDateStr();
      if (!DATE_RE.test(date)) { res.status(400).json({ error: 'date must be YYYY-MM-DD' }); return; }
      const scope = await resolveScope(req as AuthenticatedRequest);
      const [emp] = await db.execute<RowDataPacket[]>(
        `SELECT e.id, e.employee_code, e.full_name, e.official_email, e.branch_id, e.process_id, e.lob_id,
                e.employment_status, e.date_of_joining, bm.branch_name, pm.process_name,
                mgr.id AS manager_id, mgr.full_name AS manager_name
           FROM employees e
           LEFT JOIN branch_master bm ON bm.id = e.branch_id
           LEFT JOIN process_master pm ON pm.id = e.process_id
           LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
          WHERE e.id = ? LIMIT 1`,
        [req.params.employeeId],
      );
      if (!emp.length) { res.status(404).json({ error: 'Employee not found' }); return; }
      const e = emp[0];
      if (!inScope(scope, e.branch_id, e.process_id)) { res.status(403).json({ error: 'Employee is outside your scope' }); return; }

      const from = shiftDate(date, -13);
      const [history] = await db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS day, ra.assignment_type,
                COALESCE(st.start_time, ra.shift_start_time) AS shift_start,
                COALESCE(st.end_time, ra.shift_end_time) AS shift_end,
                att.clock_in_time, att.clock_out_time, att.raw_minutes, att.attendance_status
           FROM wfm_roster_assignment ra
           LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
           LEFT JOIN attendance_daily_record att ON att.employee_id = ra.employee_id AND att.record_date = ra.roster_date
          WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ?
          ORDER BY ra.roster_date DESC`,
        [e.id, from, date],
      );
      const [regs] = await db.execute<RowDataPacket[]>(
        `SELECT r.id, DATE_FORMAT(r.session_date, '%Y-%m-%d') AS session_date, r.reason, r.status,
                r.reviewer_note, r.reviewed_at, r.created_at, rv.full_name AS reviewer_name
           FROM attendance_regularization r
           LEFT JOIN employees rv ON rv.id = r.reviewed_by
          WHERE r.employee_id = ? ORDER BY r.created_at DESC LIMIT 10`,
        [e.id],
      );
      const days = history.map((h) => {
        const off = ['WEEK_OFF', 'LEAVE', 'HOLIDAY', 'TRAINING'].includes(String(h.assignment_type ?? '').toUpperCase());
        return {
          date: String(h.day),
          rosterType: off ? String(h.assignment_type).toUpperCase() : 'SHIFT',
          shiftTime: h.shift_start && h.shift_end ? `${String(h.shift_start).slice(0, 5)}-${String(h.shift_end).slice(0, 5)}` : null,
          clockIn: h.clock_in_time ? String(h.clock_in_time) : null,
          clockOut: h.clock_out_time ? String(h.clock_out_time) : null,
          workedHours: h.raw_minutes != null ? Math.round((Number(h.raw_minutes) / 60) * 10) / 10 : null,
          status: h.attendance_status ? String(h.attendance_status) : null,
        };
      });
      const shiftDays = days.filter((d) => d.rosterType === 'SHIFT' && d.date < date);
      res.json({
        employee: {
          id: String(e.id), code: String(e.employee_code), name: String(e.full_name),
          email: e.official_email ? String(e.official_email) : null,
          branchName: e.branch_name ? String(e.branch_name) : null,
          processName: e.process_name ? String(e.process_name) : null,
          managerId: e.manager_id ? String(e.manager_id) : null,
          managerName: e.manager_name ? String(e.manager_name) : null,
          employmentStatus: e.employment_status ? String(e.employment_status) : null,
          dateOfJoining: e.date_of_joining ? String(e.date_of_joining) : null,
        },
        date,
        today: days.find((d) => d.date === date) ?? null,
        history: days,
        summary: {
          plannedDays: shiftDays.length,
          presentDays: shiftDays.filter((d) => d.clockIn).length,
          absentDays: shiftDays.filter((d) => !d.clockIn).length,
        },
        regularizations: regs.map((r) => ({
          id: String(r.id), date: String(r.session_date), reason: String(r.reason), status: String(r.status),
          reviewer: r.reviewer_name ? String(r.reviewer_name) : null,
          remarks: r.reviewer_note ? String(r.reviewer_note) : null,
          reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
          createdAt: String(r.created_at),
        })),
      });
    } catch (err: any) {
      console.error('[roster-intelligence] live-detail employee error:', err);
      res.status(500).json({ error: `Failed to load employee detail: ${err.message}` });
    }
  });

  router.get('/live-detail/manager/:managerId', requireRole(...roles), async (req, res) => {
    try {
      const date = req.query.date ? String(req.query.date) : todayLocalDateStr();
      if (!DATE_RE.test(date)) { res.status(400).json({ error: 'date must be YYYY-MM-DD' }); return; }
      const scope = await resolveScope(req as AuthenticatedRequest);
      const [mgr] = await db.execute<RowDataPacket[]>(
        `SELECT id, full_name, official_email FROM employees WHERE id = ? LIMIT 1`, [req.params.managerId]);
      if (!mgr.length) { res.status(404).json({ error: 'Manager not found' }); return; }

      // Team scope conditions mirror the list endpoint (scope applied to team members).
      const conds: string[] = []; const params: unknown[] = [];
      if (scope?.branchIds) { if (!scope.branchIds.length) { res.status(403).json({ error: 'Outside scope' }); return; } conds.push(`e.branch_id IN (${scope.branchIds.map(() => '?').join(',')})`); params.push(...scope.branchIds); }
      if (scope?.processIds) { if (!scope.processIds.length) { res.status(403).json({ error: 'Outside scope' }); return; } conds.push(`e.process_id IN (${scope.processIds.map(() => '?').join(',')})`); params.push(...scope.processIds); }

      const digest = await generateSingleManagerDigest(
        String(mgr[0].id), String(mgr[0].full_name), mgr[0].official_email ? String(mgr[0].official_email) : null, date,
        { conds, params },
      );
      const [trendRows] = await db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS day,
                COUNT(*) AS planned, SUM(att.clock_in_time IS NOT NULL) AS present
           FROM employees e
           JOIN wfm_roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date BETWEEN ? AND ?
           LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
          WHERE e.reporting_manager_id = ? AND e.active_status = 1 AND e.employment_status = 'Active'
            AND ra.assignment_type NOT IN ${OFF_TYPES}
            ${conds.map((c) => `AND ${c}`).join(' ')}
          GROUP BY ra.roster_date ORDER BY ra.roster_date`,
        [shiftDate(date, -13), shiftDate(date, -1), mgr[0].id, ...params],
      );
      const trend = trendRows.map((r) => ({
        date: String(r.day), planned: Number(r.planned), present: Number(r.present ?? 0),
        shrinkagePct: shrinkagePct(Number(r.planned), Number(r.present ?? 0)),
      }));
      trend.push({ date, planned: digest.planned, present: digest.present, shrinkagePct: digest.shrinkagePct });
      res.json({ digest, trend });
    } catch (err: any) {
      console.error('[roster-intelligence] live-detail manager error:', err);
      res.status(500).json({ error: `Failed to load manager detail: ${err.message}` });
    }
  });
}
