import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
router.use(requireAuth);

const manualMarkSchema = z.object({
  employee_id:       z.string().uuid(),
  attendance_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  attendance_status: z.enum(['present', 'half_day', 'absent', 'leave_approved', 'holiday', 'week_off']),
  override_reason:   z.string().min(5).max(500),
  clock_in_time:     z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional().nullable(),
  clock_out_time:    z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional().nullable(),
});

const LWP_MAP: Record<string, number> = {
  present: 0.0, leave_approved: 0.0, holiday: 0.0, week_off: 0.0,
  half_day: 0.5, absent: 1.0,
};

router.post(
  '/',
  requireRole('payroll_head', 'super_admin', 'admin'),
  async (req: any, res: any) => {
    const parsed = manualMarkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: parsed.error.flatten().fieldErrors });
    }

    const { employee_id, attendance_date, attendance_status, override_reason, clock_in_time, clock_out_time } = parsed.data;
    const actorId = (req.authUser as any).id;
    const lwpValue = LWP_MAP[attendance_status] ?? 0;

    // Verify employee exists
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE id = ? LIMIT 1`,
      [employee_id],
    );
    if (!(empRows as any[]).length) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // Capture old status for audit
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, attendance_status, is_locked FROM attendance_daily_record
       WHERE employee_id = ? AND record_date = ? LIMIT 1`,
      [employee_id, attendance_date],
    );
    const existing = (existingRows as any[])[0] ?? null;
    const previousStatus = existing?.attendance_status ?? null;
    const recordId = existing?.id ?? randomUUID();

    // Upsert — admin manual marks are always locked
    await db.execute(
      `INSERT INTO attendance_daily_record
         (id, employee_id, record_date,
          attendance_source, source_system,
          attendance_status, lwp_value,
          clock_in_time, clock_out_time,
          override_by, override_reason,
          is_locked, processed_at, created_by)
       VALUES (?, ?, ?,
               'biometric', 'manual_admin',
               ?, ?,
               ?, ?,
               ?, ?,
               1, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         attendance_source = 'biometric',
         source_system     = 'manual_admin',
         attendance_status = VALUES(attendance_status),
         lwp_value         = VALUES(lwp_value),
         clock_in_time     = COALESCE(VALUES(clock_in_time), clock_in_time),
         clock_out_time    = COALESCE(VALUES(clock_out_time), clock_out_time),
         override_by       = VALUES(override_by),
         override_reason   = VALUES(override_reason),
         is_locked         = 1,
         processed_at      = NOW()`,
      [
        recordId, employee_id, attendance_date,
        attendance_status, lwpValue,
        clock_in_time ?? null, clock_out_time ?? null,
        actorId, override_reason,
        actorId,
      ],
    );

    // Audit log
    try {
      const { writeAuditLog } = await import('../../shared/auditLog.js');
      await writeAuditLog({
        actor_user_id: actorId,
        actor_role: (req.authUser as any).role ?? 'unknown',
        action_type: 'MANUAL_ATTENDANCE_MARK',
        module_key: 'attendance',
        entity_type: 'attendance_daily_record',
        entity_id: recordId,
        employee_id,
        metadata: {
          attendance_date,
          previous_status: previousStatus,
          new_status: attendance_status,
          override_reason,
        },
      });
    } catch {
      // audit failure must not block the response
    }

    return res.json({
      success: true,
      record_id: recordId,
      previous_status: previousStatus,
      new_status: attendance_status,
    });
  },
);

export { router as attendanceManualMarkRouter };
