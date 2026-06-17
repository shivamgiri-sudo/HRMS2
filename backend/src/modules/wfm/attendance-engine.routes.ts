import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { attendanceEngineService, type CorrectionInput } from './attendance-engine.service.js';
import { z } from 'zod';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Attendance Rules (Admin/HR CRUD + Simulator) ──────────────────────────────

// GET /rules — list all rule configs
router.get('/rules', h(async (req, res) => {
  const data = await attendanceEngineService.listRules();
  return res.json({ success: true, data });
}));

// GET /rules/resolve — simulate which rule applies
router.get('/rules/resolve', h(async (req, res) => {
  const { designationId, processId, branchId } = req.query as Record<string, string>;
  const date = (req.query.date as string) || new Date().toISOString().split('T')[0]!;
  const rule = await attendanceEngineService.resolveRule(
    designationId || null, processId || null, branchId || null, date
  );
  return res.json({ success: true, data: rule });
}));

// POST /rules — create new rule (admin only)
router.post('/rules', requireRole('admin'), h(async (req, res) => {
  const schema = z.object({
    rule_name:          z.string().min(1).max(255),
    scope_type:         z.enum(['designation','process','branch','process_designation','branch_process','global']),
    designation_id:     z.string().uuid().nullable().optional(),
    process_id:         z.string().uuid().nullable().optional(),
    branch_id:          z.string().uuid().nullable().optional(),
    attendance_source:  z.enum(['dialler','biometric']),
    full_day_minutes:   z.number().int().min(1).max(1440),
    half_day_minutes:   z.number().int().min(1).max(1440),
    grace_minutes:      z.number().int().min(0).max(120).default(15),
    effective_from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effective_to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes:              z.string().nullable().optional(),
  });
  const body = schema.parse(req.body);
  const data = await attendanceEngineService.createRule({
    ...body, created_by: (req as any).authUser?.id
  });
  return res.status(201).json({ success: true, data });
}));

// PATCH /rules/:id — update rule (admin only)
router.patch('/rules/:id', requireRole('admin'), h(async (req, res) => {
  const schema = z.object({
    rule_name:         z.string().min(1).max(255).optional(),
    attendance_source: z.enum(['dialler','biometric']).optional(),
    full_day_minutes:  z.number().int().min(1).max(1440).optional(),
    half_day_minutes:  z.number().int().min(1).max(1440).optional(),
    grace_minutes:     z.number().int().min(0).max(120).optional(),
    effective_from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    effective_to:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes:             z.string().nullable().optional(),
    active_status:     z.number().int().min(0).max(1).optional(),
  });
  const body = schema.parse(req.body);
  const data = await attendanceEngineService.updateRule(req.params.id, body);
  return res.json({ success: true, data });
}));

// DELETE /rules/:id — deactivate rule (admin only)
router.delete('/rules/:id', requireRole('admin'), h(async (req, res) => {
  await attendanceEngineService.deactivateRule(req.params.id);
  return res.status(204).send();
}));

// ── Attendance Processing ─────────────────────────────────────────────────────

// POST /process — manual trigger for a date (admin, hr, wfm)
router.post('/process', requireRole('admin', 'hr', 'wfm'), h(async (req, res) => {
  const { date } = req.body as { date?: string };
  const processDate = date || (() => {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]!;
  })();
  const data = await attendanceEngineService.processDateBatch(processDate, 50);
  return res.json({ success: true, data });
}));

// GET /daily — list records with filters
router.get('/daily', h(async (req, res) => {
  const filters = {
    employeeId:        req.query.employeeId as string | undefined,
    processId:         req.query.processId as string | undefined,
    fromDate:          req.query.fromDate as string | undefined,
    toDate:            req.query.toDate as string | undefined,
    attendanceStatus:  req.query.attendanceStatus as string | undefined,
    page:              req.query.page ? Number(req.query.page) : undefined,
    limit:             req.query.limit ? Number(req.query.limit) : undefined,
  };
  const data = await attendanceEngineService.listRecords(filters);
  return res.json({ success: true, ...data });
}));

// GET /daily/:employeeId/:date — single record
router.get('/daily/:employeeId/:date', h(async (req, res) => {
  const record = await attendanceEngineService.getRecord(req.params.employeeId, req.params.date);
  if (!record) return res.status(404).json({ success: false, error: 'Record not found' });
  return res.json({ success: true, data: record });
}));

// PATCH /daily/:employeeId/:date — WFM correction + lock
router.patch('/daily/:employeeId/:date', requireRole('admin', 'hr', 'wfm'), h(async (req, res) => {
  const schema = z.object({
    attendanceStatus: z.enum(['present','half_day','absent','leave_approved','holiday','week_off','unreconciled']),
    lwpValue:         z.number().multipleOf(0.5).min(0).max(1),
    overrideReason:   z.string().trim().min(5).max(500),
    isLocked:         z.boolean().optional(),
    regularizationId: z.string().uuid().nullable().optional(),
  });
  const body = schema.parse(req.body);

  // Cross-validate status + lwpValue consistency
  const VALID_LWP: Record<string, number> = {
    present: 0, leave_approved: 0, holiday: 0, week_off: 0,
    half_day: 0.5, absent: 1.0, unreconciled: 0
  };
  if (VALID_LWP[body.attendanceStatus] !== undefined &&
      body.lwpValue !== VALID_LWP[body.attendanceStatus]) {
    return res.status(400).json({
      success: false,
      error: `lwpValue must be ${VALID_LWP[body.attendanceStatus]} for status '${body.attendanceStatus}'`
    });
  }

  const input: CorrectionInput = {
    attendanceStatus: body.attendanceStatus,
    lwpValue: body.lwpValue,
    overrideReason: body.overrideReason,
    isLocked: body.isLocked,
    regularizationId: body.regularizationId,
  };
  const data = await attendanceEngineService.correctDailyRecord(
    req.params.employeeId, req.params.date, input, (req as any).authUser!.id
  );
  return res.json({ success: true, data, message: 'Attendance record corrected and locked' });
}));

// GET /summary/:employeeId/:month — monthly summary
router.get('/summary/:employeeId/:month', h(async (req, res) => {
  const data = await attendanceEngineService.getMonthlySummary(req.params.employeeId, req.params.month);
  return res.json({ success: true, data });
}));

// GET /day-detail/:employeeId/:date — full biometric detail for one day
// Returns attendance_record + cosec_daily_agg (COSEC's own summary) + raw punches
router.get('/day-detail/:employeeId/:date', h(async (req, res) => {
  const { employeeId, date } = req.params;

  // 1. Attendance record + biometric log
  // DATE_FORMAT returns plain string to avoid mysql2 timezone-shifting DATE columns
  const [adrRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       adr.id,
       DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
       DATE_FORMAT(adr.clock_in_time,  '%Y-%m-%d %H:%i:%s') AS clock_in_time,
       DATE_FORMAT(adr.clock_out_time, '%Y-%m-%d %H:%i:%s') AS clock_out_time,
       adr.raw_minutes, adr.biometric_minutes, adr.attendance_status,
       adr.lwp_value, adr.late_mark, adr.late_by_minutes, adr.is_locked,
       adr.source_system, adr.attendance_source,
       DATE_FORMAT(adr.processed_at, '%Y-%m-%d %H:%i:%s') AS processed_at,
       DATE_FORMAT(b.first_punch_in,  '%Y-%m-%d %H:%i:%s') AS bio_first_punch_in,
       DATE_FORMAT(b.last_punch_out,  '%Y-%m-%d %H:%i:%s') AS bio_last_punch_out,
       b.total_punches, b.cosec_user_id, b.source_system AS bio_source
     FROM attendance_daily_record adr
     LEFT JOIN biometric_attendance_log b
       ON b.employee_id = adr.employee_id
       AND b.punch_date = adr.record_date
       AND b.source_system = 'ncosec'
     WHERE adr.employee_id = ? AND adr.record_date = ?
     LIMIT 1`,
    [employeeId, date]
  );

  // 2. cosec_daily_agg — COSEC's authoritative daily summary (night-shift-aware)
  // CONVERT() is required: cosec_daily_agg.user_id=utf8mb4_0900_ai_ci, employees=utf8mb4_unicode_ci
  const [aggRows] = await db.execute<RowDataPacket[]>(
    `SELECT cda.user_id,
            DATE_FORMAT(cda.shift_date,     '%Y-%m-%d')          AS shift_date,
            DATE_FORMAT(cda.first_punch_in, '%Y-%m-%d %H:%i:%s') AS first_punch_in,
            DATE_FORMAT(cda.last_punch_out, '%Y-%m-%d %H:%i:%s') AS last_punch_out,
            cda.work_minutes,
            DATE_FORMAT(cda.synced_at,      '%Y-%m-%d %H:%i:%s') AS synced_at
     FROM cosec_daily_agg cda
     JOIN employees e ON CONVERT(e.employee_code USING utf8mb4) = CONVERT(cda.user_id USING utf8mb4)
                     OR CONVERT(e.biometric_code USING utf8mb4) = CONVERT(cda.user_id USING utf8mb4)
     WHERE e.id = ? AND cda.shift_date = ?
     LIMIT 1`,
    [employeeId, date]
  );

  // 3. Raw individual punch events (night-shift-aware window: after 6 AM on date, or before 6 AM next day)
  const [punchRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(cps.punch_time, '%Y-%m-%d %H:%i:%s') AS punch_time,
            cps.io_type, cps.device_id
     FROM cosec_punch_sync cps
     JOIN employees e ON CONVERT(e.employee_code USING utf8mb4) = CONVERT(cps.user_id USING utf8mb4)
                     OR CONVERT(e.biometric_code USING utf8mb4) = CONVERT(cps.user_id USING utf8mb4)
     WHERE e.id = ?
       AND (
         (HOUR(cps.punch_time) >= 6 AND DATE(cps.punch_time) = ?)
         OR
         (HOUR(cps.punch_time) < 6  AND DATE(cps.punch_time) = DATE_ADD(?, INTERVAL 1 DAY))
       )
     ORDER BY cps.punch_time ASC`,
    [employeeId, date, date]
  );

  const adr = (adrRows as RowDataPacket[])[0] ?? null;
  const agg = (aggRows as RowDataPacket[])[0] ?? null;
  const punches = (punchRows as RowDataPacket[]).map((p: RowDataPacket) => ({
    punch_time: p.punch_time,
    io_type:    p.io_type,
    io_label:   p.io_type === 0 ? 'IN' : 'OUT',
    device_id:  p.device_id,
  }));

  return res.json({
    success: true,
    data: {
      date,
      attendance_record: adr,
      cosec_daily_agg:   agg,
      raw_punches:       punches,
      punch_count:       punches.length,
    },
  });
}));

export { router as attendanceEngineRouter };
