import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

/**
 * Format a Date as "YYYY-MM-DD HH:mm:ss" in IST (Asia/Kolkata).
 * This is used INSTEAD of passing Date objects to mysql2 to avoid
 * timezone-dependent serialization. Passing a Date object lets mysql2
 * format it using the OS local timezone, which differs between servers.
 * An explicit IST string ensures the DB stores the correct wall-clock time.
 */
function fmtISTDatetime(dt: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Parses event_datetime from COSEC, tagging IST offset if no timezone is present.
 * COSEC sends ISO 8601 without timezone (e.g. "2026-07-04T10:15:04").
 * Without a timezone suffix, JS's `new Date()` treats it as UTC,
 * which causes mysql2 (with timezone:'local' = IST) to store IST+5:30 = 15:45.
 * We add +05:30 explicitly so JS parses it correctly as IST.
 */
function parseCosecEventDatetime(raw: string): Date | null {
  const trimmed = raw.trim();
  const hasTimezone = /[+-]\d{2}:\d{2}$/.test(trimmed) || trimmed.endsWith('Z');
  const isoStr = hasTimezone ? trimmed : trimmed.endsWith('Z') ? trimmed : trimmed + '+05:30';
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
}

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

    const punchTime = parseCosecEventDatetime(event_datetime);
    if (!punchTime) {
      return res.status(400).json({ error: 'Invalid event_datetime — use ISO 8601 format' });
    }

    // Format as IST string for DB storage — explicit, timezone-independent
    const punchTimeIST = fmtISTDatetime(punchTime);
    const punchDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(punchTime);

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

    const [empInfo] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code, branch_id, process_id, branch_name, process_name FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       WHERE e.id = ? LIMIT 1`, [employeeId]
    );
    const emp = (empInfo[0] as any) ?? {};

    // Store one deduplicated biometric row per employee/date.
    // Uses punchTimeIST (explicit IST string) instead of the Date object to
    // avoid timezone-dependent serialization by mysql2.
    await db.execute(`
      INSERT INTO integration_biometric_daily
        (id, integration_key, source_table, employee_code, activity_date,
         first_punch, last_punch, biometric_minutes)
      VALUES (UUID(), 'cosec_live', 'webhook', ?, ?, ?, ?, 0)
      ON DUPLICATE KEY UPDATE
        first_punch = LEAST(COALESCE(first_punch, VALUES(first_punch)), VALUES(first_punch)),
        last_punch = GREATEST(COALESCE(last_punch, VALUES(last_punch)), VALUES(last_punch)),
        biometric_minutes = GREATEST(
          0,
          TIMESTAMPDIFF(
            MINUTE,
            LEAST(COALESCE(first_punch, VALUES(first_punch)), VALUES(first_punch)),
            GREATEST(COALESCE(last_punch, VALUES(last_punch)), VALUES(last_punch))
          )
        ),
        updated_at = NOW()
    `, [emp.employee_code, punchDate, punchTimeIST, punchTimeIST]);

    const [logRow] = await db.execute<RowDataPacket[]>(
      `SELECT first_punch, last_punch, biometric_minutes
       FROM integration_biometric_daily
       WHERE integration_key = 'cosec_live' AND source_table = 'webhook'
         AND employee_code = ? AND activity_date = ?
       LIMIT 1`,
      [emp.employee_code, punchDate]
    );
    const log = logRow[0] as any;
    const rawMinutes = Number(log?.biometric_minutes ?? 0);

    // Keep the legacy session table consistent with the imported COSEC evidence.
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
    `, [employeeId, punchDate, log.first_punch, log.last_punch, rawMinutes,
        rawMinutes >= 540 ? 'Logged Out' : 'Partial',
        emp.branch_name ?? null, emp.process_name ?? null]);

    // Apply the same Operations/COSEC policy used by batch and calendar processing.
    const { attendanceEngineService } = await import('./attendance-engine.service.js');
    const attendance = await attendanceEngineService.processEmployee(employeeId, punchDate);
    await attendanceEngineService.upsertDailyRecord(attendance, 'ncosec_live');
    await db.execute(
      `UPDATE attendance_daily_record
       SET clock_in_time = ?, clock_out_time = ?
       WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
      [log.first_punch, log.last_punch, employeeId, punchDate]
    );
    await attendanceEngineService.checkAndNotifyBiometricMismatch(employeeId, punchDate, attendance);

    res.json({
      success: true,
      employee_id: employeeId,
      punch_date: punchDate,
      raw_minutes: rawMinutes,
      attendance_status: attendance.status,
    });
  })
);

export { router as biometricPunchRouter };
