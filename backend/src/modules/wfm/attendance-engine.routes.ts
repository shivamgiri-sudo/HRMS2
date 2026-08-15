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
import { buildScopeWhereClause } from '../../shared/scopeAccess.js';
import { CLOSED_RUN_STATUSES_SQL } from '../payroll/run-status.js';
import { toIST } from '../../shared/timezone.js';
import { getAprMonthly, resolveAprUserIds } from './apr-attendance.service.js';
import {
  getBulkCosecMappings,
  getMonthlyAttendanceFromNcosec,
  getRealTimePunchesToday,
  type NcosecMonthlyRecord,
} from './attendance-realtime-ncosec.service.js';

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

function safeId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!DB_ID_REGEX.test(text)) {
    const error = new Error(`Invalid ${field}`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function istNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23', // NOT hour12:false — that selects h24 and renders midnight as '24'
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: Number(pick('hour') || '0'),
  };
}

function shiftDateByDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  const parts = istNowParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolveAttendanceShiftDate(): string {
  const parts = istNowParts();
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return parts.hour >= 5 ? today : shiftDateByDays(today, -1);
}

function chunkArray<T>(items: T[], size: number): T[][];
function chunkArray<T>(items: T[], size: number): Array<T[]> {
  if (size <= 0) return [items];
  const chunks: Array<T[]> = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type ScopedEmployeeRow = {
  id: string;
  employee_code: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  branch_id: string | null;
  process_id: string | null;
  department_id: string | null;
  cost_centre_id: string | null;
  reporting_manager_id: string | null;
  manager_id: string | null;
  working_hours_start: string | null;
  working_hours_end: string | null;
  department_name: string | null;
  branch_name: string | null;
  process_name: string | null;
  cost_centre_name: string | null;
  // APR/dialler identity + eligibility inputs
  call_centre_code: string | null;
  biometric_code: string | null;
  designation_id: string | null;
  designation_name: string | null;
};

type BreakSummaryRow = {
  employee_id: string;
  shift_date: string;
  total_break_minutes: number;
  total_break_count: number;
  mini_break_count: number;
  long_break_count: number;
  exceeded_break_count: number;
  exception_count: number;
  active_break_count: number;
  final_status: string | null;
};

async function listScopedEmployees(req: AuthenticatedRequest): Promise<ScopedEmployeeRow[]> {
  const userId = req.authUser!.id;

  // Single DB round-trip for all roles, then derive access flags in memory
  const [roleRows] = await (db as any).execute(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1
     UNION
     SELECT role_key FROM user_assignment_scope WHERE user_id = ? AND active_status = 1`,
    [userId, userId]
  ).catch(() => (db as any).execute(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId]
  ));
  const userRoleSet = new Set<string>(
    (roleRows as { role_key: string }[]).map((r) => String(r.role_key ?? '').trim().toLowerCase()).filter(Boolean)
  );
  const hasAdminBypass = userRoleSet.has('super_admin') || userRoleSet.has('admin');
  const isPlatformWide = hasAdminBypass || userRoleSet.has('ceo');
  const isScopedReader = hasAdminBypass || ['hr', 'wfm', 'manager', 'assistant_manager', 'tl', 'payroll_head', 'payroll_admin'].some((r) => userRoleSet.has(r));

  const callerEmp = await getEmployeeForUser(userId);

  const where: string[] = ['e.active_status = 1'];
  const params: unknown[] = [];

  const employeeId = safeId(req.query.employeeId, 'employeeId');
  const branchId = safeId(req.query.branchId, 'branchId');
  const processId = safeId(req.query.processId, 'processId');
  const departmentId = safeId(req.query.departmentId, 'departmentId');
  const costCentreId = safeId(req.query.costCentreId ?? req.query.costCenterId, 'costCentreId');
  const managerId = safeId(req.query.managerId, 'managerId');
  const search = String(req.query.search ?? '').trim();

  if (!isPlatformWide && !isScopedReader) {
    if (!callerEmp) {
      const error = new Error('No employee record') as Error & { statusCode?: number };
      error.statusCode = 403;
      throw error;
    }
    where.push('e.id = ?');
    params.push(callerEmp.id);
  } else if (!isPlatformWide) {
    const scoped = await buildScopeWhereClause(
      userId,
      ['hr', 'wfm', 'manager', 'assistant_manager', 'tl', 'payroll_head', 'payroll_admin'],
      {
        branchId: 'e.branch_id',
        processId: 'e.process_id',
        departmentId: 'e.department_id',
        managerEmployeeId: 'COALESCE(e.reporting_manager_id, e.manager_id)',
      },
      { allowAdminBypass: true, allowCeoAllRead: true },
    );
    where.push(`(${scoped.sql})`);
    params.push(...scoped.params);
  }

  if (employeeId) { where.push('e.id = ?'); params.push(employeeId); }
  if (branchId) { where.push('e.branch_id = ?'); params.push(branchId); }
  if (processId) { where.push('e.process_id = ?'); params.push(processId); }
  if (departmentId) { where.push('e.department_id = ?'); params.push(departmentId); }
  if (costCentreId) { where.push('e.cost_centre_id = ?'); params.push(costCentreId); }
  if (managerId) {
    where.push('(e.reporting_manager_id = ? OR e.manager_id = ?)');
    params.push(managerId, managerId);
  }
  if (search) {
    where.push(`(
      e.employee_code LIKE ?
      OR COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) LIKE ?
      OR bm.branch_name LIKE ?
      OR pm.process_name LIKE ?
      OR dm.dept_name LIKE ?
      OR ccm.cost_centre_name LIKE ?
    )`);
    const token = `%${search}%`;
    params.push(token, token, token, token, token, token);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.id,
        e.employee_code,
        e.first_name,
        e.last_name,
        e.full_name,
        e.branch_id,
        e.process_id,
        e.department_id,
        e.cost_centre_id,
        e.reporting_manager_id,
        e.manager_id,
        e.working_hours_start,
        e.working_hours_end,
        e.call_centre_code,
        e.biometric_code,
        e.designation_id,
        dsg.designation_name,
        dm.dept_name AS department_name,
        bm.branch_name,
        pm.process_name,
        ccm.cost_centre_name
       FROM employees e
       LEFT JOIN department_master dm ON dm.id = e.department_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
       LEFT JOIN designation_master dsg ON dsg.id = e.designation_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.employee_code ASC`,
    params,
  );

  return rows as ScopedEmployeeRow[];
}

async function getBreakSummaryRows(employeeIds: string[], fromDate: string, toDate: string): Promise<BreakSummaryRow[]> {
  if (employeeIds.length === 0) return [];
  const placeholders = employeeIds.map(() => '?').join(', ');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        bds.employee_id,
        DATE_FORMAT(bds.shift_date, '%Y-%m-%d') AS shift_date,
        COALESCE(bds.total_break_minutes, 0) AS total_break_minutes,
        COALESCE(bs.total_break_count, 0) AS total_break_count,
        COALESCE(bs.mini_break_count, 0) AS mini_break_count,
        COALESCE(bs.long_break_count, 0) AS long_break_count,
        COALESCE(bds.exceeded_break_count, 0) AS exceeded_break_count,
        COALESCE(bds.exception_count, 0) AS exception_count,
        COALESCE(bs.active_break_count, 0) AS active_break_count,
        bds.final_status
       FROM break_daily_summary bds
       LEFT JOIN (
         SELECT
           employee_id,
           shift_date,
           COUNT(*) AS total_break_count,
           SUM(CASE WHEN break_type = 'MINI' THEN 1 ELSE 0 END) AS mini_break_count,
           SUM(CASE WHEN break_type = 'LONG' THEN 1 ELSE 0 END) AS long_break_count,
           SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_break_count
         FROM break_sessions
         WHERE employee_id IN (${placeholders})
           AND shift_date BETWEEN ? AND ?
         GROUP BY employee_id, shift_date
       ) bs
         ON bs.employee_id = bds.employee_id
        AND bs.shift_date = bds.shift_date
      WHERE bds.employee_id IN (${placeholders})
        AND bds.shift_date BETWEEN ? AND ?`,
    [...employeeIds, fromDate, toDate, ...employeeIds, fromDate, toDate],
  );
  return rows as BreakSummaryRow[];
}

function attachBreakSummary(
  records: NcosecMonthlyRecord[],
  breakRows: BreakSummaryRow[],
) {
  const breakMap = new Map<string, BreakSummaryRow>();
  for (const row of breakRows) {
    breakMap.set(`${row.employee_id}:${row.shift_date}`, row);
  }

  return records.map((record) => {
    const summary = breakMap.get(`${record.employee_id}:${record.record_date}`);
    return {
      ...record,
      total_break_minutes: Number(summary?.total_break_minutes ?? 0),
      total_break_count: Number(summary?.total_break_count ?? 0),
      mini_break_count: Number(summary?.mini_break_count ?? 0),
      long_break_count: Number(summary?.long_break_count ?? 0),
      exceeded_break_count: Number(summary?.exceeded_break_count ?? 0),
      exception_count: Number(summary?.exception_count ?? 0),
      active_break_count: Number(summary?.active_break_count ?? 0),
      break_status: summary?.final_status ?? null,
    };
  });
}

async function getTodayBreakSummary(employeeId: string, shiftDate: string) {
  const rows = await getBreakSummaryRows([employeeId], shiftDate, shiftDate);
  const row = rows[0];
  if (!row) return null;
  return {
    shift_date: row.shift_date,
    total_break_minutes: Number(row.total_break_minutes ?? 0),
    total_break_count: Number(row.total_break_count ?? 0),
    mini_break_count: Number(row.mini_break_count ?? 0),
    long_break_count: Number(row.long_break_count ?? 0),
    exceeded_break_count: Number(row.exceeded_break_count ?? 0),
    exception_count: Number(row.exception_count ?? 0),
    active_break: Number(row.active_break_count ?? 0) > 0,
    final_status: row.final_status ?? null,
  };
}

function parseWorkingDays(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
      }
    } catch {
      return value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
    }
  }
  return [1, 2, 3, 4, 5];
}

function formatMonthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function minDateText(left: string, right: string): string {
  return left <= right ? left : right;
}

function nextDateText(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + 1);
  const parts = istNowParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function computeNcosecMonthlySummary(employeeId: string, month: string) {
  const monthStart = `${month}-01`;
  const monthEnd = formatMonthEnd(month);
  const currentShiftDate = resolveAttendanceShiftDate();
  const periodEnd = month === currentShiftDate.slice(0, 7)
    ? minDateText(monthEnd, currentShiftDate)
    : monthEnd;

  if (periodEnd < monthStart) {
    return {
      presentDays: 0,
      halfDays: 0,
      absentDays: 0,
      leaveDays: 0,
      holidayDays: 0,
      weekOffDays: 0,
      totalLwp: 0,
      lateMarks: 0,
      totalWorkingDays: 0,
      totalHours: 0,
      wfoDays: 0,
    };
  }

  const [employeeRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, working_days
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  const employee = employeeRows[0] as { id: string; working_days: unknown } | undefined;
  if (!employee) {
    throw new Error('Employee not found');
  }

  const mappings = await getBulkCosecMappings([employeeId]);
  if (mappings.length === 0) {
    return attendanceEngineService.getMonthlySummary(employeeId, month);
  }

  const rows = await getMonthlyAttendanceFromNcosec(mappings, monthStart, periodEnd);
  const rowMap = new Map(rows.map((row) => [row.record_date, row]));
  const workingDays = parseWorkingDays(employee.working_days);

  const summary = {
    presentDays: 0,
    halfDays: 0,
    absentDays: 0,
    leaveDays: 0,
    holidayDays: 0,
    weekOffDays: 0,
    totalLwp: 0,
    lateMarks: 0,
    totalWorkingDays: 0,
    totalHours: 0,
    wfoDays: 0,
  };

  for (let dateText = monthStart; dateText <= periodEnd; dateText = nextDateText(dateText)) {
    const row = rowMap.get(dateText);
    if (row) {
      const status = String(row.attendance_status ?? '').toLowerCase();
      if (status === 'present') summary.presentDays += 1;
      else if (status === 'half_day') summary.halfDays += 1;
      else if (status === 'absent') summary.absentDays += 1;
      else if (status === 'leave_approved') summary.leaveDays += 1;
      else if (status === 'holiday') summary.holidayDays += 1;
      else if (status === 'week_off') summary.weekOffDays += 1;

      summary.totalLwp += Number(row.lwp_value ?? 0);
      summary.lateMarks += Number(row.late_mark ?? 0);
      summary.totalHours += Number(row.total_hours ?? (Number(row.raw_minutes ?? 0) / 60));
      if (row.clock_in_time || row.clock_out_time) summary.wfoDays += 1;
      if (!['holiday', 'week_off'].includes(status)) summary.totalWorkingDays += 1;
      continue;
    }

    const dayOfWeek = new Date(`${dateText}T12:00:00+05:30`).getUTCDay();
    const isWorkingDay = workingDays.includes(dayOfWeek);
    if (isWorkingDay) {
      summary.absentDays += 1;
      summary.totalLwp += 1;
      summary.totalWorkingDays += 1;
    } else {
      summary.weekOffDays += 1;
    }
  }

  summary.totalHours = Math.round(summary.totalHours * 100) / 100;
  summary.totalLwp = Math.round(summary.totalLwp * 100) / 100;
  return summary;
}

// Attendance Rules (Admin/HR CRUD + Simulator)

// GET /rules - list all rule configs
router.get('/rules', h(async (req, res) => {
  const data = await attendanceEngineService.listRules();
  return res.json({ success: true, data });
}));

// GET /rules/resolve - simulate which rule applies
router.get('/rules/resolve', h(async (req, res) => {
  const { designationId, processId, branchId } = req.query as Record<string, string>;
  const date = (req.query.date as string) || new Date().toISOString().split('T')[0]!;
  const rule = await attendanceEngineService.resolveRule(
    designationId || null, processId || null, branchId || null, date
  );
  return res.json({ success: true, data: rule });
}));

// POST /rules - create new rule (admin only)
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

// PATCH /rules/:id - update rule (admin only)
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

// DELETE /rules/:id - deactivate rule (admin only)
router.delete('/rules/:id', requireRole('admin'), h(async (req, res) => {
  await attendanceEngineService.deactivateRule(req.params.id);
  return res.status(204).send();
}));

// Attendance Processing

// POST /process - manual trigger for a date (admin, hr, wfm)
router.post('/process', requireRole('admin', 'hr', 'wfm'), h(async (req, res) => {
  const { date } = req.body as { date?: string };
  const processDate = date || (() => {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]!;
  })();
  const data = await attendanceEngineService.processDateBatch(processDate, 50);
  return res.json({ success: true, data });
}));

// GET /daily - list records with filters
router.get('/daily', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, 'super_admin', 'admin', 'hr', 'wfm', 'manager', 'payroll_head', 'payroll_admin');
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

// GET /ncosec-monthly - direct COSEC monthly view with HRMS scope and break enrichment.
router.get('/ncosec-monthly', h(async (req: AuthenticatedRequest, res: Response) => {
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 500, 500);
  const fromDate = String(req.query.fromDate ?? '').trim();
  const toDate = String(req.query.toDate ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return res.status(400).json({ success: false, error: 'fromDate and toDate are required in YYYY-MM-DD format' });
  }

  const employees = await listScopedEmployees(req);
  if (employees.length === 0) {
    return res.json({ success: true, data: [], total: 0, page, limit });
  }

  const mappings = await getBulkCosecMappings(employees.map((employee) => employee.id));
  // Chunks were fetched strictly one after another, so a wide scope paid the
  // full upstream latency per 200 employees. Run them with bounded concurrency:
  // fast for large scopes, while still capping simultaneous load on the COSEC
  // MSSQL box (unbounded Promise.all over every chunk could swamp it).
  const chunks = chunkArray(mappings, 200);
  const records: NcosecMonthlyRecord[] = [];
  const NCOSEC_CONCURRENCY = 4;
  for (let i = 0; i < chunks.length; i += NCOSEC_CONCURRENCY) {
    const batch = chunks.slice(i, i + NCOSEC_CONCURRENCY);
    const results = await Promise.all(
      batch.map((chunk) => getMonthlyAttendanceFromNcosec(chunk, fromDate, toDate)),
    );
    for (const result of results) records.push(...result);
  }

  const attendanceStatus = String(req.query.attendanceStatus ?? '').trim().toLowerCase();
  const filteredByStatus = attendanceStatus
    ? records.filter((record) => String(record.attendance_status ?? '').toLowerCase() === attendanceStatus)
    : records;
  const breakRows = await getBreakSummaryRows(
    Array.from(new Set(filteredByStatus.map((record) => record.employee_id))),
    fromDate,
    toDate,
  );
  const enriched = attachBreakSummary(filteredByStatus, breakRows);
  const offset = (page - 1) * limit;

  return res.json({
    success: true,
    data: enriched.slice(offset, offset + limit),
    total: enriched.length,
    page,
    limit,
  });
}));

// GET /apr-monthly — dialler (APR) monthly view read from mas_hrms.apr.
// Counterpart of /ncosec-monthly for employees whose attendance source is the
// dialler rather than biometric. Same scope guard, same response shape.
router.get('/apr-monthly', h(async (req: AuthenticatedRequest, res: Response) => {
  const fromDate = String(req.query.fromDate ?? '').trim();
  const toDate = String(req.query.toDate ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return res.status(400).json({ success: false, error: 'fromDate and toDate are required in YYYY-MM-DD format' });
  }

  // Reuses the existing scope/role enforcement — an unauthorised caller is
  // narrowed to their own record or rejected there.
  const employees = await listScopedEmployees(req);
  if (employees.length === 0) {
    return res.json({ success: true, data: [], total: 0, source: 'apr' });
  }
  if (employees.length > 1) {
    return res.status(400).json({ success: false, error: 'apr-monthly requires a single employeeId' });
  }

  const emp = employees[0];
  const records = await getAprMonthly(emp, fromDate, toDate);

  return res.json({
    success: true,
    data: records.map((r) => ({ ...r, employee_id: emp.id, employee_code: emp.employee_code })),
    total: records.length,
    source: 'apr',
  });
}));

// GET /attendance-source/:employeeId — which source drives this employee's attendance.
// The UI uses this to pick between the APR and biometric views instead of guessing.
router.get('/attendance-source/:employeeId', h(async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = safeId(req.params.employeeId, 'employeeId');
  if (!employeeId) return res.status(400).json({ success: false, error: 'Invalid employeeId' });

  // Force the scope query onto this employee so access rules still apply.
  (req.query as Record<string, unknown>).employeeId = employeeId;
  const employees = await listScopedEmployees(req);
  if (employees.length === 0) {
    return res.status(403).json({ success: false, error: 'Employee not in scope' });
  }

  const emp = employees[0];
  const isApr = await attendanceEngineService.isAprEligible(
    emp.designation_id ?? null,
    emp.department_id ?? null,
    emp.process_id ?? null,
    String(emp.department_name ?? '').toLowerCase(),
    String(emp.designation_name ?? '').toLowerCase(),
  );

  return res.json({
    success: true,
    data: {
      employee_id: emp.id,
      employee_code: emp.employee_code,
      attendance_source: isApr ? 'dialler' : 'biometric',
      source_label: isApr ? 'APR / Dialler' : 'Direct COSEC',
      apr_user_ids: isApr ? resolveAprUserIds(emp) : [],
      // Surfaced so the UI can show how fresh the data actually is.
      sync_interval_note: isApr ? 'APR syncs hourly from ViciDial' : 'COSEC syncs every 5 minutes',
    },
  });
}));

// GET /today-live - lightweight live punch + break summary lookup for the current user.
router.get('/today-live', h(async (req: AuthenticatedRequest, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, error: 'No employee record' });
  const shiftDate = resolveAttendanceShiftDate();
  const breakSummary = await getTodayBreakSummary(emp.id, shiftDate);
  const nowParts = istNowParts();
  const calendarDate = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;

  if (shiftDate !== calendarDate) {
    const mappings = await getBulkCosecMappings([emp.id]);
    const overnightRecords = await getMonthlyAttendanceFromNcosec(mappings, shiftDate, calendarDate);
    const liveOvernight = overnightRecords.find((record) => record.record_date === shiftDate) ?? null;
    if (liveOvernight) {
      return res.json({
        success: true,
        data: {
          punch_date: liveOvernight.record_date,
          first_punch_in: liveOvernight.clock_in_time,
          last_punch_out: liveOvernight.clock_out_time,
          raw_minutes: Number(liveOvernight.raw_minutes ?? 0),
          total_punches: liveOvernight.clock_out_time ? 2 : liveOvernight.clock_in_time ? 1 : 0,
          source: 'biometric_live',
          break_summary: breakSummary,
        },
      });
    }
  }

  try {
    const live = await withTimeout(getRealTimePunchesToday(emp.id), 5000, 'today-live realtime lookup');
    if (live) {
      return res.json({
        success: true,
        data: {
          ...live,
          punch_date: shiftDate,
          source: 'biometric_live',
          break_summary: breakSummary,
        },
      });
    }
  } catch (error) {
    console.warn('[attendance] today-live realtime lookup failed, falling back to local biometric log:', error instanceof Error ? error.message : String(error));
  }

  try {
    const mappings = await getBulkCosecMappings([emp.id]);
    const monthlyRecords = await getMonthlyAttendanceFromNcosec(mappings, shiftDate, shiftDate);
    const directRecord = monthlyRecords.find((record) => record.record_date === shiftDate) ?? null;
    if (directRecord) {
      return res.json({
        success: true,
        data: {
          punch_date: directRecord.record_date,
          first_punch_in: directRecord.clock_in_time,
          last_punch_out: directRecord.clock_out_time,
          raw_minutes: Number(directRecord.raw_minutes ?? 0),
          total_punches: directRecord.clock_out_time ? 2 : directRecord.clock_in_time ? 1 : 0,
          source: 'biometric_live',
          break_summary: breakSummary,
        },
      });
    }
  } catch (error) {
    console.warn('[attendance] today-live monthly fallback failed, falling back to local biometric log:', error instanceof Error ? error.message : String(error));
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(punch_date, '%Y-%m-%d') AS punch_date,
            first_punch_in,
            last_punch_out,
            COALESCE(total_punches, CASE WHEN first_punch_in IS NULL THEN 0 WHEN last_punch_out IS NULL THEN 1 ELSE 2 END) AS total_punches,
            COALESCE(raw_minutes, 0) AS raw_minutes
       FROM biometric_attendance_log
      WHERE employee_id = ? AND punch_date = ?
      ORDER BY migrated_at DESC
      LIMIT 1`,
    [emp.id, shiftDate],
  );
  const row = rows[0] as any;
  if (row) {
    return res.json({
      success: true,
      data: {
        punch_date: row.punch_date,
        first_punch_in: toIST(row.first_punch_in),
        last_punch_out: toIST(row.last_punch_out),
        raw_minutes: Number(row.raw_minutes ?? 0),
        total_punches: Number(row.total_punches ?? 0),
        source: 'biometric_live',
        break_summary: breakSummary,
      },
    });
  }

  if (breakSummary) {
    return res.json({
      success: true,
      data: {
        punch_date: shiftDate,
        first_punch_in: null,
        last_punch_out: null,
        raw_minutes: 0,
        total_punches: 0,
        source: 'biometric_live',
        break_summary: breakSummary,
      },
    });
  }

  return res.json({ success: true, data: null });
}));

// GET /daily/:employeeId/:date - single record
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

// PATCH /daily/:employeeId/:date - WFM correction + lock
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

// GET /summary/:employeeId/:month - monthly summary
router.get('/summary/:employeeId/:month', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const targetId = req.params.employeeId;
  const isPrivileged = await hasRole(userId, 'super_admin', 'admin', 'hr', 'wfm', 'manager', 'payroll_head', 'payroll_admin');
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== targetId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
  }
  const data = await computeNcosecMonthlySummary(targetId, req.params.month);
  return res.json({ success: true, data });
}));

// POST /clock-in
router.post('/clock-in', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  // Security: always derive employee_id from auth token - never trust body
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
    hourCycle: 'h23', // NOT hour12:false — that selects h24 and renders midnight as '24'
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
    hourCycle: 'h23', // NOT hour12:false — that selects h24 and renders midnight as '24'
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

// FIX: POST /engine/trigger-batch - Manual trigger for attendance engine (Admin/WFM only)
// Allows admin to manually run the attendance engine for a specific date
router.post('/engine/trigger-batch', requireRole('admin', 'wfm', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const date = req.body.date || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid date format. Use YYYY-MM-DD.'
    });
  }

  console.log(`[AttendanceEngine] Manual trigger by user ${req.authUser!.id} for date: ${date}`);

  try {
    const result = await attendanceEngineService.processDateBatch(date);
    return res.json({
      success: true,
      data: result,
      message: `Processed ${result.processed} employees, skipped ${result.skipped}, failed ${result.failed}`
    });
  } catch (error) {
    console.error('[AttendanceEngine] Manual trigger failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Engine processing failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}));

// FIX: POST /:employeeId/:date/unlock - Unlock attendance record (Admin/WFM only)
// Allows admin to unlock a locked attendance record for re-processing
router.post('/:employeeId/:date/unlock', requireRole('admin', 'wfm', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId, date } = req.params;

  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid employeeId or date format'
    });
  }

  // Check if record exists
  const [checkRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, is_locked, attendance_status, override_reason
     FROM attendance_daily_record
     WHERE employee_id = ? AND record_date = ? LIMIT 1`,
    [employeeId, date]
  );

  if ((checkRows as RowDataPacket[]).length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Attendance record not found'
    });
  }

  const record = checkRows[0] as any;
  const wasLocked = Number(record.is_locked) === 1;

  // A reason is mandatory, matching the reason-still-required->400 half of the Part A.3
  // manager-override contract (2026-08-13 business-decision sign-off). Unlocking a day
  // payroll has consumed is exactly the action that most needs a recorded justification,
  // and this endpoint previously took none at all.
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10) {
    return res.status(400).json({
      success: false,
      error: 'A reason of at least 10 characters is required to unlock an attendance record',
    });
  }

  // Refuse when the day belongs to a payroll run that is already closed.
  //
  // attendance_daily_record.is_locked is the signal the whole Part A.3 lock-guard family
  // keys on (roster-lock-guard.ts: isRosterDateLocked / checkAssignmentDateNotLocked /
  // checkEmployeeDateNotLocked), which refuses roster writes above the lock and tells the
  // caller to use "the payroll correction/reopen workflow instead". This endpoint is what
  // clears that flag - so with no closure check it was the one call that neutralises every
  // one of those guards at once, after which the ordinary write paths accept edits to a
  // month already finalised, paid and filed.
  //
  // run_month is VARCHAR 'YYYY-MM', not DATE, so it is compared string-to-string via
  // DATE_FORMAT - comparing it against a DATE matches zero rows and merely raises a warning.
  const [closedRuns] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status
       FROM salary_prep_run
      WHERE run_month = DATE_FORMAT(?, '%Y-%m')
        AND LOWER(COALESCE(status,'')) IN (${CLOSED_RUN_STATUSES_SQL})
      LIMIT 1`,
    [date]
  );
  const closedRun = (closedRuns as RowDataPacket[])[0] as any;
  if (closedRun) {
    return res.status(409).json({
      success: false,
      error:
        `Attendance for ${date} belongs to payroll run ${closedRun.run_month}, which is ` +
        `already ${closedRun.status}. A closed run cannot be reopened by unlocking a day it ` +
        `has already paid — use the payroll correction/reopen workflow instead.`,
    });
  }

  // Unlock the record
  await db.execute(
    `UPDATE attendance_daily_record
     SET is_locked = 0,
         updated_at = NOW()
     WHERE employee_id = ? AND record_date = ?`,
    [employeeId, date]
  );

  // Durable audit. This previously wrote only a console.log, which is not an audit trail:
  // it is not queryable, not retained, and invisible to the screens that read
  // sensitive_action_log. Awaited, matching payroll.service.ts's own pattern — for a
  // control action the record is part of the action, not a side effect of it.
  const { logSensitiveAction } = await import("../../shared/auditLog.js");
  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "ATTENDANCE_RECORD_UNLOCKED",
    module_key: "wfm",
    entity_type: "attendance_daily_record",
    entity_id: String(record.id),
    employee_id: employeeId,
    reason,
    old_value_json: { is_locked: wasLocked ? 1 : 0, attendance_status: record.attendance_status },
    new_value_json: { is_locked: 0 },
    change_summary: { employee_id: employeeId, record_date: date, was_locked: wasLocked },
  });

  console.log(`[AttendanceEngine] Record unlocked by user ${req.authUser!.id}: ${employeeId}/${date} (was_locked=${wasLocked})`);

  return res.json({
    success: true,
    message: wasLocked ? 'Record unlocked successfully' : 'Record was already unlocked',
    data: {
      employeeId,
      date,
      wasLocked,
      previousStatus: record.attendance_status,
      canReprocess: true
    }
  });
}));

export { router as attendanceEngineRouter };

