import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { attendanceEngineService, type CorrectionInput } from './attendance-engine.service.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import type { Response } from 'express';
import { z } from 'zod';
import { getEmployeeForUser, hasRole } from '../../shared/accessGuard.js';
import { toIST } from '../../shared/timezone.js';
import { getRealTimePunchesToday } from './attendance-realtime-ncosec.service.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const DB_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/;

router.use(requireAuth);

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
router.get('/daily', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, 'admin', 'hr', 'wfm', 'manager');
  // Validate pagination parameters to prevent NaN/negative values
  const rawPage = req.query.page ? Number(req.query.page) : 1;
  const rawLimit = req.query.limit ? Number(req.query.limit) : 50;
  const safePage = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;

  const filters: any = {
    processId:        req.query.processId as string | undefined,
    branchId:         req.query.branchId as string | undefined,
    fromDate:         req.query.fromDate as string | undefined,
    toDate:           req.query.toDate as string | undefined,
    attendanceStatus: req.query.attendanceStatus as string | undefined,
    page:             safePage,
    limit:            safeLimit,
  };
  if (isPrivileged) {
    const qEmpId = req.query.employeeId as string | undefined;
    if (qEmpId && !DB_ID_REGEX.test(qEmpId)) {
      return res.status(400).json({ success: false, error: 'Invalid employeeId' });
    }
    filters.employeeId = qEmpId;
  } else {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, error: 'No employee record' });
    filters.employeeId = emp.id;
  }
  const data = await attendanceEngineService.listRecords(filters);
  return res.json({ success: true, ...data });
}));

// GET /ncosec-monthly — compatibility alias used by the upgraded Attendance UI.
// It returns the same scoped attendance records as /daily without changing the
// attendance calculation source or approval rules.
router.get('/ncosec-monthly', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, 'admin', 'hr', 'wfm', 'manager');
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 500, 500);

  const filters: any = {
    processId:        req.query.processId as string | undefined,
    branchId:         req.query.branchId as string | undefined,
    fromDate:         req.query.fromDate as string | undefined,
    toDate:           req.query.toDate as string | undefined,
    attendanceStatus: req.query.attendanceStatus as string | undefined,
    page,
    limit,
  };

  if (isPrivileged) {
    const qEmpId = req.query.employeeId as string | undefined;
    if (qEmpId && !DB_ID_REGEX.test(qEmpId)) {
      return res.status(400).json({ success: false, error: 'Invalid employeeId' });
    }
    filters.employeeId = qEmpId;
  } else {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, error: 'No employee record' });
    filters.employeeId = emp.id;
  }

  const data = await attendanceEngineService.listRecords(filters);
  return res.json({ success: true, ...data });
}));

// GET /today-live — lightweight live punch lookup for the current user.
router.get('/today-live', h(async (req: AuthenticatedRequest, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, error: 'No employee record' });

  try {
    const live = await withTimeout(getRealTimePunchesToday(emp.id), 2500, 'today-live realtime lookup');
    if (live) return res.json({ success: true, data: { ...live, source: 'biometric_live' } });
  } catch (error) {
    console.warn('[attendance] today-live realtime lookup failed, falling back to local biometric log:', error instanceof Error ? error.message : String(error));
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(punch_date, '%Y-%m-%d') AS punch_date,
            first_punch_in,
            last_punch_out,
            COALESCE(total_punches, CASE WHEN first_punch_in IS NULL THEN 0 WHEN last_punch_out IS NULL THEN 1 ELSE 2 END) AS total_punches,
            COALESCE(raw_minutes, 0) AS raw_minutes
       FROM biometric_attendance_log
      WHERE employee_id = ? AND punch_date = CURDATE()
      ORDER BY migrated_at DESC
      LIMIT 1`,
    [emp.id],
  );
  const row = rows[0] as any;
  return res.json({
    success: true,
    data: row ? {
      punch_date: row.punch_date,
      first_punch_in: toIST(row.first_punch_in),
      last_punch_out: toIST(row.last_punch_out),
      raw_minutes: Number(row.raw_minutes ?? 0),
      total_punches: Number(row.total_punches ?? 0),
      source: 'biometric_live',
    } : null,
  });
}));

// GET /daily/:employeeId/:date — single record
router.get('/daily/:employeeId/:date', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const targetId = req.params.employeeId;
  const isPrivileged = await hasRole(userId, 'admin', 'hr', 'wfm', 'manager');
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== targetId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
  }
  const record = await attendanceEngineService.getRecord(targetId, req.params.date);
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
router.get('/summary/:employeeId/:month', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const targetId = req.params.employeeId;
  const isPrivileged = await hasRole(userId, 'admin', 'hr', 'wfm', 'manager');
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== targetId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
  }
  const data = await attendanceEngineService.getMonthlySummary(targetId, req.params.month);
  return res.json({ success: true, data });
}));

// POST /clock-in
router.post('/clock-in', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  // Security: always derive employee_id from auth token — never trust body
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, error: 'No employee record for authenticated user' });
  const employee_id = emp.id;

  const { work_mode, latitude, longitude, location_name } = req.body;
  const nowDate = new Date();
  // Use explicit IST format instead of .toISOString() (UTC) to avoid depending
  // on MySQL session timezone for DATETIME conversion.
  const nowIST = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(nowDate);
  const g = (t: string) => nowIST.find(p => p.type === t)!.value;
  const today = `${g('year')}-${g('month')}-${g('day')}`;
  const now   = `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
  const id = randomUUID();
  const [existing] = await db.execute<RowDataPacket[]>(
    'SELECT id FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1',
    [employee_id, today]
  );
  if ((existing as RowDataPacket[]).length > 0) {
    return res.status(409).json({ success: false, error: 'Already clocked in today' });
  }
  await db.execute(
    `INSERT INTO attendance_daily_record
       (id, employee_id, record_date, clock_in_time, work_mode, clock_in_lat, clock_in_lng, clock_in_location, attendance_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')`,
    [id, employee_id, today, now, work_mode ?? 'office', latitude ?? null, longitude ?? null, location_name ?? null]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.*,
       adr.record_date AS date, adr.clock_in_time AS clock_in, adr.clock_out_time AS clock_out,
       ROUND(adr.raw_minutes / 60, 2) AS total_hours, adr.attendance_status AS status,
       adr.clock_in_location AS clock_in_location_name, adr.clock_out_location AS clock_out_location_name
     FROM attendance_daily_record adr WHERE adr.id = ? LIMIT 1`, [id]
  );
  const row = (rows as RowDataPacket[])[0] as any;
  if (row) {
    row.clock_in_time  = toIST(row.clock_in_time);
    row.clock_out_time = toIST(row.clock_out_time);
    row.clock_in       = toIST(row.clock_in);
    row.clock_out      = toIST(row.clock_out);
  }
  res.status(201).json({ success: true, data: row });
}));

// POST /clock-out
router.post('/clock-out', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { record_id, latitude, longitude, location_name } = req.body;
  if (!record_id) return res.status(400).json({ success: false, error: 'record_id required' });

  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, error: 'No employee record' });

  // Ownership check: verify this record belongs to the caller
  const [check] = await db.execute<RowDataPacket[]>(
    'SELECT id FROM attendance_daily_record WHERE id = ? AND employee_id = ? LIMIT 1',
    [record_id, emp.id]
  );
  if ((check as RowDataPacket[]).length === 0) {
    return res.status(403).json({ success: false, error: 'Forbidden: record does not belong to you' });
  }

  const nowDate = new Date();
  const now = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(nowDate);
  const g = (t: string) => now.find(p => p.type === t)!.value;
  const nowStr = `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
  await db.execute(
    `UPDATE attendance_daily_record
     SET clock_out_time = ?, clock_out_lat = ?, clock_out_lng = ?, clock_out_location = ?
     WHERE id = ?`,
    [nowStr, latitude ?? null, longitude ?? null, location_name ?? null, record_id]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.*,
       adr.record_date AS date, adr.clock_in_time AS clock_in, adr.clock_out_time AS clock_out,
       ROUND(adr.raw_minutes / 60, 2) AS total_hours, adr.attendance_status AS status,
       adr.clock_in_location AS clock_in_location_name, adr.clock_out_location AS clock_out_location_name
     FROM attendance_daily_record adr WHERE adr.id = ? LIMIT 1`, [record_id]
  );
  const out = (rows as RowDataPacket[])[0] as any;
  if (out) {
    out.clock_in_time  = toIST(out.clock_in_time);
    out.clock_out_time = toIST(out.clock_out_time);
    out.clock_in       = toIST(out.clock_in);
    out.clock_out      = toIST(out.clock_out);
  }
  res.json({ success: true, data: out });
}));

export { router as attendanceEngineRouter };
