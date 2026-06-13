import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

/**
 * POST /api/wfm/biometric-punch
 *
 * Live webhook — Matrix Cosec calls this on every punch event.
 * Accumulates first-in and last-out per employee per day.
 *
 * Headers:  X-Biometric-Token: <BIOMETRIC_WEBHOOK_SECRET env var>
 * Body:     { user_id: string, event_datetime: string (ISO 8601) }
 * Response: { success: true, employee_id, punch_date, raw_minutes }
 */
router.post(
  '/',
  h(async (req: Request, res: Response) => {
    const secret = process.env.BIOMETRIC_WEBHOOK_SECRET;
    if (secret && req.headers['x-biometric-token'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { user_id, event_datetime } = req.body as { user_id?: string; event_datetime?: string };
    if (!user_id || !event_datetime) {
      return res.status(400).json({ error: 'user_id and event_datetime are required' });
    }

    const punchTime = new Date(event_datetime);
    if (isNaN(punchTime.getTime())) {
      return res.status(400).json({ error: 'Invalid event_datetime — use ISO 8601 format' });
    }

    const punchDate = punchTime.toISOString().slice(0, 10);

    // Resolve employee from enrollment table
    const [enrollRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM employee_biometric_enrollment
       WHERE cosec_user_id = ? AND is_active = 1 LIMIT 1`,
      [user_id]
    );
    const employeeId = (enrollRows[0] as any)?.employee_id;
    if (!employeeId) {
      return res.status(404).json({ error: `No HRMS employee mapped to Cosec UserID: ${user_id}` });
    }

    // Upsert biometric log — keep MIN as first_punch_in, MAX as last_punch_out
    await db.execute(`
      INSERT INTO biometric_attendance_log
        (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out, raw_minutes, source_system)
      VALUES (UUID(), ?, ?, ?, ?, ?, 0, 'ncosec_live')
      ON DUPLICATE KEY UPDATE
        first_punch_in = CASE WHEN first_punch_in IS NULL OR VALUES(first_punch_in) < first_punch_in
                              THEN VALUES(first_punch_in) ELSE first_punch_in END,
        last_punch_out = CASE WHEN last_punch_out IS NULL OR VALUES(last_punch_out) > last_punch_out
                              THEN VALUES(last_punch_out) ELSE last_punch_out END
    `, [employeeId, user_id, punchDate, punchTime, punchTime]);

    // Recalculate raw_minutes and update
    const [logRow] = await db.execute<RowDataPacket[]>(
      `SELECT first_punch_in, last_punch_out FROM biometric_attendance_log
       WHERE employee_id = ? AND punch_date = ? LIMIT 1`,
      [employeeId, punchDate]
    );
    const log = logRow[0] as any;
    if (!log?.first_punch_in || !log?.last_punch_out) {
      return res.json({ success: true, message: 'Punch logged, waiting for paired event' });
    }

    const rawMinutes = Math.max(0, Math.floor(
      (new Date(log.last_punch_out).getTime() - new Date(log.first_punch_in).getTime()) / 60000
    ));

    await db.execute(
      `UPDATE biometric_attendance_log SET raw_minutes = ? WHERE employee_id = ? AND punch_date = ?`,
      [rawMinutes, employeeId, punchDate]
    );

    const attendanceStatus = rawMinutes >= 360 ? 'present' : 'half_day';
    const [empInfo] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id, process_id, branch_name, process_name FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       WHERE e.id = ? LIMIT 1`, [employeeId]
    );
    const emp = (empInfo[0] as any) ?? {};

    // 1. Upsert attendance_daily_record (clock_in/out are biometric first_in/last_out)
    await db.execute(`
      INSERT INTO attendance_daily_record
        (id, employee_id, record_date, clock_in_time, clock_out_time, raw_minutes,
         biometric_minutes, attendance_status, attendance_source, branch_id, process_id, created_by)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'biometric', ?, ?, 'ncosec_live')
      ON DUPLICATE KEY UPDATE
        clock_in_time      = IF(is_locked = 0, LEAST(COALESCE(clock_in_time, VALUES(clock_in_time)), VALUES(clock_in_time)), clock_in_time),
        clock_out_time     = IF(is_locked = 0, GREATEST(COALESCE(clock_out_time, VALUES(clock_out_time)), VALUES(clock_out_time)), clock_out_time),
        biometric_minutes  = IF(is_locked = 0, VALUES(biometric_minutes), biometric_minutes),
        raw_minutes        = IF(is_locked = 0, VALUES(raw_minutes), raw_minutes),
        attendance_status  = IF(is_locked = 0, VALUES(attendance_status), attendance_status),
        attendance_source  = IF(is_locked = 0, 'biometric', attendance_source)
    `, [employeeId, punchDate, log.first_punch_in, log.last_punch_out, rawMinutes,
        rawMinutes, attendanceStatus, emp.branch_id ?? null, emp.process_id ?? null]);

    // 2. Sync wfm_attendance_session so legacy queries stay consistent with biometric data
    await db.execute(`
      INSERT INTO wfm_attendance_session
        (id, employee_id, session_date, login_time, logout_time, total_login_minutes,
         current_status, punch_source, branch_name, process_name)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'BIOMETRIC', ?, ?)
      ON DUPLICATE KEY UPDATE
        login_time          = LEAST(COALESCE(login_time, VALUES(login_time)), VALUES(login_time)),
        logout_time         = GREATEST(COALESCE(logout_time, VALUES(logout_time)), VALUES(logout_time)),
        total_login_minutes = VALUES(total_login_minutes),
        current_status      = VALUES(current_status),
        punch_source        = 'BIOMETRIC'
    `, [employeeId, punchDate, log.first_punch_in, log.last_punch_out, rawMinutes,
        rawMinutes >= 360 ? 'Logged Out' : 'Partial',
        emp.branch_name ?? null, emp.process_name ?? null]);

    res.json({ success: true, employee_id: employeeId, punch_date: punchDate, raw_minutes: rawMinutes });
  })
);

export { router as biometricPunchRouter };
