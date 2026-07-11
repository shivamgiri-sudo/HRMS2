// backend/src/modules/wfm/mismatch-review.routes.ts
// WFM queue for APR/biometric mismatch and week_off_worked review.
// Accessible to: wfm, hr, admin, super_admin

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';

export const mismatchReviewRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

mismatchReviewRouter.use(requireAuth);

// ── List unresolved mismatches and week_off_worked records ────────────────────

mismatchReviewRouter.get(
  '/',
  requireRole('wfm', 'hr', 'admin', 'super_admin'),
  h(async (req, res) => {
    const { fromDate, toDate, employeeId, branchId, processId, page = '1', limit = '50' } = req.query;
    const pg = Math.max(1, Number(page));
    const lim = Math.min(200, Math.max(1, Number(limit)));
    const offset = (pg - 1) * lim;

    let where = `WHERE (
      (adr.mismatch_flag = 1 AND adr.mismatch_resolved_at IS NULL)
      OR adr.attendance_status = 'missing_punch'
      OR adr.attendance_status = 'week_off_worked'
    )`;
    const params: unknown[] = [];

    if (fromDate) { where += ' AND adr.record_date >= ?'; params.push(fromDate); }
    if (toDate)   { where += ' AND adr.record_date <= ?'; params.push(toDate); }
    if (employeeId) { where += ' AND adr.employee_id = ?'; params.push(employeeId); }
    if (branchId)   { where += ' AND adr.branch_id = ?'; params.push(branchId); }
    if (processId)  { where += ' AND adr.process_id = ?'; params.push(processId); }

    const countSql = `SELECT COUNT(*) AS total FROM attendance_daily_record adr ${where}`;
    const [countRows] = await db.execute<RowDataPacket[]>(countSql, params);
    const total = Number((countRows[0] as any).total ?? 0);

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
      FROM attendance_daily_record adr
      LEFT JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master bm ON bm.id = adr.branch_id
      LEFT JOIN process_master pm ON pm.id = adr.process_id
      LEFT JOIN designation_master dm ON dm.id = e.designation_id
      ${where}
      ORDER BY adr.record_date DESC, e.employee_code
      LIMIT ${lim} OFFSET ${offset}`;
    const [rows] = await db.execute<RowDataPacket[]>(dataSql, params);

    res.json({ success: true, data: rows, total, page: pg, limit: lim });
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
      `SELECT id, attendance_status, lwp_value, mismatch_flag, employee_id, record_date
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

    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_daily_record WHERE id = ? LIMIT 1`, [id]
    );
    res.json({ success: true, data: (updated as RowDataPacket[])[0] });
  })
);

// ── Summary counts for WFM dashboard ─────────────────────────────────────────

mismatchReviewRouter.get(
  '/summary',
  requireRole('wfm', 'hr', 'admin', 'super_admin'),
  h(async (_req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(CASE WHEN mismatch_flag = 1 AND mismatch_resolved_at IS NULL THEN 1 END) AS unresolved_mismatches,
         COUNT(CASE WHEN attendance_status = 'missing_punch' THEN 1 END) AS missing_punches,
         COUNT(CASE WHEN attendance_status = 'week_off_worked' THEN 1 END) AS week_off_worked
       FROM attendance_daily_record
       WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)`
    );
    res.json({ success: true, data: rows[0] });
  })
);
