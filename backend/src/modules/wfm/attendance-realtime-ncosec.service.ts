/**
 * Real-time NCOSEC Attendance Display Service
 *
 * Purpose: Direct read-only queries to NCOSEC for real-time punch display and payroll pre-sync
 * - getRealTimePunchesToday / getRealTimePunchesRange: today/range display (Mx_ATDEventTrn)
 * - getMonthlyAttendanceFromNcosec: monthly display + payroll pre-sync (Mx_DATDTrn)
 *   Applies night shift merge, leave/holiday/regularization overrides, IST tag — no arithmetic.
 */

import sql from 'mssql';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getNcosecPool } from '../../db/ncosecDb.js';
import { env } from '../../config/env.js';
import { nowIST } from '../../shared/timezone.js';
import { classifyCosecMinutes } from './attendance-engine.service.js';
import { assessAggregatePunches } from './cosec-punch-interpretation.service.js';
import { type PunchGroup, mergeNightShiftRollover } from './cosec-sync.service.js';

interface RealTimePunch {
  punch_date: string;
  first_punch_in: string | null;   // already IST-tagged: "YYYY-MM-DDTHH:mm:ss+05:30"
  last_punch_out: string | null;   // already IST-tagged: "YYYY-MM-DDTHH:mm:ss+05:30"
  total_punches: number;
  raw_minutes: number;
  source: 'ncosec_realtime';
}

/**
 * NCOSEC stores IST times (wall-clock). We query with CONVERT(CHAR) to get
 * string values directly from MSSQL with NO driver conversion.
 * Result: "2026-06-27 15:38:29" (exact IST time from NCOSEC)
 * We just replace space with T and tag +05:30 - NO arithmetic, NO offset.
 */

interface EmployeeCosecMapping {
  employee_id: string;
  employee_code: string;
  cosec_user_id: string;
}

/**
 * Get employee's COSEC UserID mapping from HRMS database
 */
async function getEmployeeCosecMapping(employeeId: string): Promise<EmployeeCosecMapping | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id as employee_id, e.employee_code,
            COALESCE(em.external_id, e.employee_code) as cosec_user_id
     FROM employees e
     LEFT JOIN employee_external_mapping em ON em.employee_id = e.id AND em.system_name = 'ncosec' AND em.is_active = 1
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );

  if (rows.length === 0) return null;

  return {
    employee_id: rows[0].employee_id as string,
    employee_code: rows[0].employee_code as string,
    cosec_user_id: rows[0].cosec_user_id as string,
  };
}

/**
 * Query NCOSEC directly for today's punch events
 * READ-ONLY: Does not modify NCOSEC or HRMS data
 */
export async function getRealTimePunchesToday(employeeId: string): Promise<RealTimePunch | null> {
  // Get COSEC mapping
  const mapping = await getEmployeeCosecMapping(employeeId);
  if (!mapping) {
    console.warn(`[realtime-ncosec] No COSEC mapping found for employee ${employeeId}`);
    return null;
  }

  const todayStr = nowIST().slice(0, 10);

  try {
    const pool = await getNcosecPool();
    const result = await pool.request()
      .input('userId', mapping.cosec_user_id)
      .input('dateStart', `${todayStr} 00:00:00`)
      .input('dateEnd', `${todayStr} 23:59:59`)
      .query(`
        SELECT
          UserID,
          CONVERT(CHAR(19), MIN(Edatetime), 120) as first_punch,
          CONVERT(CHAR(19), MAX(Edatetime), 120) as last_punch,
          COUNT(*) as total_punches,
          DATEDIFF(MINUTE, MIN(Edatetime), MAX(Edatetime)) as raw_minutes
        FROM ${env.NCOSEC_EVENT_TABLE || 'dbo.Mx_ATDEventTrn'}
        WHERE UserID = @userId
          AND Edatetime >= @dateStart
          AND Edatetime <= @dateEnd
        GROUP BY UserID
      `);

    if (result.recordset.length === 0) {
      return null;
    }

    const row = result.recordset[0];

    // NCOSEC stores IST wall-clock. CONVERT(CHAR) returns IST string directly.
    // Just tag with +05:30, no arithmetic needed.
    const tagIST = (str: string | null) => str ? str.replace(' ', 'T') + '+05:30' : null;

    const assessed = assessAggregatePunches({
      firstPunch: row.first_punch,
      lastPunch: row.last_punch,
      totalPunches: row.total_punches,
      workingMinutes: row.raw_minutes,
    });

    return {
      punch_date: todayStr,
      first_punch_in: tagIST(assessed.effectivePunchIn),
      last_punch_out: tagIST(assessed.effectivePunchOut),
      total_punches: assessed.effectivePunchCount,
      raw_minutes: assessed.effectiveWorkingMinutes,
      source: 'ncosec_realtime',
    };
  } catch (error) {
    console.error('[realtime-ncosec] Query failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Get real-time punch data for a date range (max 7 days for performance)
 */
export async function getRealTimePunchesRange(
  employeeId: string,
  fromDate: string,
  toDate: string
): Promise<RealTimePunch[]> {
  const mapping = await getEmployeeCosecMapping(employeeId);
  if (!mapping) {
    return [];
  }

  // Cap at 7 days for performance
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const daysDiff = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff > 7) {
    throw new Error('Date range limited to 7 days for real-time queries');
  }

  try {
    const pool = await getNcosecPool();
    const result = await pool.request()
      .input('userId', mapping.cosec_user_id)
      .input('dateStart', `${fromDate} 00:00:00`)
      .input('dateEnd', `${toDate} 23:59:59`)
      .query(`
        SELECT
          CONVERT(CHAR(10), CAST(Edatetime AS DATE), 23) as punch_date,
          CONVERT(CHAR(19), MIN(Edatetime), 120) as first_punch,
          CONVERT(CHAR(19), MAX(Edatetime), 120) as last_punch,
          COUNT(*) as total_punches,
          DATEDIFF(MINUTE, MIN(Edatetime), MAX(Edatetime)) as raw_minutes
        FROM ${env.NCOSEC_EVENT_TABLE || 'dbo.Mx_ATDEventTrn'}
        WHERE UserID = @userId
          AND Edatetime >= @dateStart
          AND Edatetime <= @dateEnd
        GROUP BY CAST(Edatetime AS DATE)
        ORDER BY CAST(Edatetime AS DATE) DESC
      `);

    const tagIST = (str: string | null) => str ? str.replace(' ', 'T') + '+05:30' : null;

    return result.recordset.map(row => {
      const assessed = assessAggregatePunches({
        firstPunch: row.first_punch,
        lastPunch: row.last_punch,
        totalPunches: row.total_punches,
        workingMinutes: row.raw_minutes,
      });
      return {
        punch_date: String(row.punch_date),
        first_punch_in: tagIST(assessed.effectivePunchIn),
        last_punch_out: tagIST(assessed.effectivePunchOut),
        total_punches: assessed.effectivePunchCount,
        raw_minutes: assessed.effectiveWorkingMinutes,
        source: 'ncosec_realtime' as const,
      };
    });
  } catch (error) {
    console.error('[realtime-ncosec] Range query failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// ─── Monthly direct NCOSEC query (Mx_DATDTrn) ────────────────────────────────

export interface NcosecMonthlyRecord {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  branch_name: string | null;
  process_name: string | null;
  cost_centre_name: string | null;
  record_date: string;
  date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  clock_in: string | null;
  clock_out: string | null;
  raw_minutes: number;
  biometric_minutes: number;
  total_hours: number;
  attendance_status: string;
  status: string;
  lwp_value: number;
  late_mark: 0;
  is_locked: number;
  attendance_source: 'biometric';
  source_system: string;
  override_note: string | null;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
    working_hours_start: string | null;
    working_hours_end: string | null;
  };
}

interface CosecMapping {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  cosec_user_id: string;
  branch_id: string | null;
  process_id: string | null;
  department_id: string | null;
  cost_centre_id: string | null;
  department_name: string | null;
  branch_name: string | null;
  process_name: string | null;
  cost_centre_name: string | null;
  working_hours_start: string | null;
  working_hours_end: string | null;
  first_name: string;
  last_name: string;
}

interface AttendanceOverride {
  override_status: string;
  lwp_value: number;
  is_locked: number;
  override_note: string | null;
  regularization_id: string | null;
}

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: Number(pick('hour') || '0'),
  };
}

function shiftDateByDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  const parts = istParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolveMonthlyOverlayShiftDate() {
  const now = istParts();
  const today = `${now.year}-${now.month}-${now.day}`;
  return now.hour >= 5 ? today : shiftDateByDays(today, -1);
}

function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Bulk-fetch COSEC UserID + employee metadata for a set of employee IDs.
 */
export async function getBulkCosecMappings(employeeIds: string[]): Promise<CosecMapping[]> {
  if (employeeIds.length === 0) return [];
  const placeholders = employeeIds.map(() => '?').join(', ');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       COALESCE(NULLIF(e.full_name,''), CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,''))) AS employee_name,
       COALESCE(e.first_name, '') AS first_name,
       COALESCE(e.last_name, '') AS last_name,
       COALESCE(em.external_id, e.employee_code) AS cosec_user_id,
       e.branch_id,
       e.process_id,
       e.department_id,
       e.cost_centre_id,
       dm.dept_name AS department_name,
       bm.branch_name,
       pm.process_name,
       ccm.cost_centre_name,
       e.working_hours_start,
       e.working_hours_end
     FROM employees e
     LEFT JOIN employee_external_mapping em
       ON em.employee_id = e.id AND em.system_name = 'ncosec' AND em.is_active = 1
     LEFT JOIN department_master dm ON dm.id = e.department_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
     WHERE e.id IN (${placeholders})`,
    employeeIds,
  );
  return rows as CosecMapping[];
}

/**
 * Build a Map of "employeeId:YYYY-MM-DD" → override for approved leaves,
 * holidays, and locked (regularized) attendance records.
 * Priority in the map: regularization (locked) > leave_approved > holiday
 */
async function getAttendanceOverrides(
  employeeIds: string[],
  fromDate: string,
  toDate: string,
): Promise<Map<string, AttendanceOverride>> {
  if (employeeIds.length === 0) return new Map();
  const ph = employeeIds.map(() => '?').join(', ');
  const overrides = new Map<string, AttendanceOverride>();

  // --- Holidays (lowest priority — apply first so higher priority can overwrite) ---
  // Apply branch, cost centre, and designation scope checks (same logic as attendance-engine.service.ts)
  const [holidays] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT
       e.id AS employee_id,
       DATE_FORMAT(lhm.holiday_date, '%Y-%m-%d') AS record_date,
       lhm.holiday_name AS override_note
     FROM leave_holiday_master lhm
     JOIN employees e ON e.id IN (${ph})
       AND (lhm.branch_id IS NULL OR lhm.branch_id = e.branch_id)
     WHERE lhm.holiday_date BETWEEN ? AND ?
       AND lhm.active_status = 1
       AND (
         NOT EXISTS (SELECT 1 FROM holiday_cost_centre_mapping WHERE holiday_id = lhm.id)
         OR EXISTS (
           SELECT 1 FROM holiday_cost_centre_mapping hccm
           WHERE hccm.holiday_id = lhm.id AND hccm.cost_centre_id = e.cost_centre_id
         )
       )
       AND (
         NOT EXISTS (SELECT 1 FROM holiday_designation_mapping WHERE holiday_id = lhm.id)
         OR EXISTS (
           SELECT 1 FROM holiday_designation_mapping hdm
           WHERE hdm.holiday_id = lhm.id AND hdm.designation_id = e.designation_id
         )
       )`,
    [...employeeIds, fromDate, toDate],
  );
  for (const row of holidays as any[]) {
    overrides.set(`${row.employee_id}:${row.record_date}`, {
      override_status: 'holiday',
      lwp_value: 0,
      is_locked: 0,
      override_note: row.override_note ?? null,
      regularization_id: null,
    });
  }

  // --- Approved leave (overrides holiday) ---
  // Expand each leave request across its date range using a recursive CTE
  const [leaves] = await db.execute<RowDataPacket[]>(
    `WITH RECURSIVE cal AS (
       SELECT lr.employee_id, lr.from_date AS d, lr.to_date,
              lt.leave_name
       FROM leave_request lr
       JOIN leave_type_master lt ON lt.id = lr.leave_type_id
       WHERE lr.employee_id IN (${ph})
         AND lr.status = 'approved'
         AND lr.from_date <= ? AND lr.to_date >= ?
       UNION ALL
       SELECT employee_id, DATE_ADD(d, INTERVAL 1 DAY), to_date, leave_name
       FROM cal WHERE d < to_date
     )
     SELECT employee_id,
            DATE_FORMAT(d, '%Y-%m-%d') AS record_date,
            leave_name AS override_note
     FROM cal
     WHERE d BETWEEN ? AND ?`,
    [...employeeIds, toDate, fromDate, fromDate, toDate],
  );
  for (const row of leaves as any[]) {
    overrides.set(`${row.employee_id}:${row.record_date}`, {
      override_status: 'leave_approved',
      lwp_value: 0,
      is_locked: 0,
      override_note: row.override_note ?? null,
      regularization_id: null,
    });
  }

  // --- Week-off from roster (overrides holiday, overridden by leave) ---
  const [weekoffs] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id,
            DATE_FORMAT(roster_date, '%Y-%m-%d') AS record_date
     FROM wfm_roster_assignment
     WHERE employee_id IN (${ph})
       AND roster_date BETWEEN ? AND ?
       AND roster_status = 'Week Off'`,
    [...employeeIds, fromDate, toDate],
  );
  for (const row of weekoffs as any[]) {
    const key = `${row.employee_id}:${row.record_date}`;
    // Only set week_off if no leave_approved or holiday already
    if (!overrides.has(key)) {
      overrides.set(key, {
        override_status: 'week_off',
        lwp_value: 0,
        is_locked: 0,
        override_note: null,
        regularization_id: null,
      });
    }
  }

  // --- Locked (regularized) records — highest priority, always wins ---
  const [locked] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id,
            DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date,
            attendance_status,
            lwp_value,
            regularization_id,
            override_reason
     FROM attendance_daily_record
     WHERE employee_id IN (${ph})
       AND record_date BETWEEN ? AND ?
       AND is_locked = 1`,
    [...employeeIds, fromDate, toDate],
  );
  for (const row of locked as any[]) {
    overrides.set(`${row.employee_id}:${row.record_date}`, {
      override_status: row.attendance_status,
      lwp_value: Number(row.lwp_value ?? 0),
      is_locked: 1,
      override_note: row.override_reason ?? null,
      regularization_id: row.regularization_id ?? null,
    });
  }

  return overrides;
}

async function getRealtimePunchMapForMappings(
  mappings: CosecMapping[],
  shiftDate: string,
): Promise<Map<string, RealTimePunch>> {
  if (mappings.length === 0 || !env.NCOSEC_DB_HOST) return new Map();

  const currentShiftDate = resolveMonthlyOverlayShiftDate();
  if (shiftDate !== currentShiftDate) return new Map();

  const userIdsByEmployee = new Map<string, string[]>();
  for (const mapping of mappings) {
    const userId = String(mapping.cosec_user_id ?? '').trim();
    if (!userId) continue;
    const bucket = userIdsByEmployee.get(userId) ?? [];
    bucket.push(mapping.employee_id);
    userIdsByEmployee.set(userId, bucket);
  }

  const userIds = Array.from(userIdsByEmployee.keys());
  if (userIds.length === 0) return new Map();

  const dateStart = `${shiftDate} 00:00:00`;
  const dateEnd = shiftDate === currentShiftDate ? `${shiftDate} 23:59:59` : `${currentShiftDate} 23:59:59`;
  const userIdColumn = env.NCOSEC_USER_ID_COLUMN || 'UserID';
  const dateTimeColumn = env.NCOSEC_DATETIME_COLUMN || 'Edatetime';
  const eventTable = env.NCOSEC_EVENT_TABLE || 'dbo.Mx_ATDEventTrn';

  const pool = await getNcosecPool();
  const request = pool.request();
  request.input('dateStart', dateStart);
  request.input('dateEnd', dateEnd);

  const idParams: string[] = [];
  userIds.forEach((userId, index) => {
    const key = `userId${index}`;
    request.input(key, userId);
    idParams.push(`@${key}`);
  });

  const result = await queryWithTimeout(
    request.query(`
      SELECT
        CAST(${userIdColumn} AS NVARCHAR(100)) AS user_id,
        CONVERT(CHAR(19), MIN(${dateTimeColumn}), 120) AS first_punch,
        CONVERT(CHAR(19), MAX(${dateTimeColumn}), 120) AS last_punch,
        COUNT(*) AS total_punches,
        DATEDIFF(MINUTE, MIN(${dateTimeColumn}), MAX(${dateTimeColumn})) AS raw_minutes
      FROM ${eventTable}
      WHERE ${dateTimeColumn} >= @dateStart
        AND ${dateTimeColumn} <= @dateEnd
        AND CAST(${userIdColumn} AS NVARCHAR(100)) IN (${idParams.join(', ')})
      GROUP BY CAST(${userIdColumn} AS NVARCHAR(100))
    `),
    5000,
    'monthly live COSEC overlay',
  );

  const tagIST = (value: string | null | undefined) => (value ? value.replace(' ', 'T') + '+05:30' : null);
  const livePunches = new Map<string, RealTimePunch>();
  for (const row of result.recordset ?? []) {
    const userId = String((row as any).user_id ?? '').trim();
    if (!userId) continue;

    const assessed = assessAggregatePunches({
      firstPunch: String((row as any).first_punch ?? ''),
      lastPunch: String((row as any).last_punch ?? ''),
      totalPunches: Number((row as any).total_punches ?? 0),
      workingMinutes: Number((row as any).raw_minutes ?? 0),
    });

    const snapshot: RealTimePunch = {
      punch_date: shiftDate,
      first_punch_in: tagIST(assessed.effectivePunchIn),
      last_punch_out: tagIST(assessed.effectivePunchOut),
      total_punches: assessed.effectivePunchCount,
      raw_minutes: assessed.effectiveWorkingMinutes,
      source: 'ncosec_realtime',
    };

    for (const employeeId of userIdsByEmployee.get(userId) ?? []) {
      livePunches.set(employeeId, snapshot);
    }
  }

  return livePunches;
}

/**
 * Query NCOSEC Mx_DATDTrn directly for a date range, apply night-shift merge,
 * apply leave/holiday/regularization overrides, and return display records.
 *
 * TIMEZONE RULE: CONVERT(CHAR) returns IST strings. tagIST just appends +05:30.
 * Zero arithmetic. Zero offset. Exact NCOSEC time shown to user.
 */
export async function getMonthlyAttendanceFromNcosec(
  mappings: CosecMapping[],
  fromDate: string,
  toDate: string,
): Promise<NcosecMonthlyRecord[]> {
  if (mappings.length === 0) return [];

  const tagIST = (s: string | null | undefined): string | null =>
    s ? s.replace(' ', 'T') + '+05:30' : null;

  // Build cosecUserId → mapping lookup and employeeId → mapping lookup
  const cosecToMapping = new Map<string, CosecMapping>();
  const empIdToMapping = new Map<string, CosecMapping>();
  for (const m of mappings) {
    cosecToMapping.set(m.cosec_user_id, m);
    empIdToMapping.set(m.employee_id, m);
  }

  const employeeIds = mappings.map(m => m.employee_id);
  const cosecUserIds = mappings.map(m => m.cosec_user_id);

  // Fetch overrides (leave, holiday, week-off, regularization)
  const overrides = await getAttendanceOverrides(employeeIds, fromDate, toDate);

  // Query NCOSEC Mx_DATDTrn
  const pool = await getNcosecPool();
  const request = pool.request();
  request.input('fromDate', sql.Date, fromDate);
  request.input('toDate', sql.Date, toDate);

  // Build individual named params per user ID — avoids STRING_SPLIT compatibility issues
  const userConditions: string[] = [];
  for (let i = 0; i < cosecUserIds.length; i++) {
    request.input(`u${i}`, sql.NVarChar(100), cosecUserIds[i]);
    userConditions.push(`@u${i}`);
  }
  const dailyTable = env.NCOSEC_DAILY_TABLE || 'dbo.Mx_DATDTrn';

  const result = await request.query(`
    SELECT
      CAST([UserID] AS NVARCHAR(100))       AS user_id,
      CONVERT(CHAR(10), [PDate], 23)        AS attendance_date,
      CONVERT(CHAR(19), [Punch1], 120)      AS first_punch,
      CONVERT(CHAR(19), [OutPunch], 120)    AS last_punch,
      ISNULL([WorkTime], 0)                 AS working_minutes
    FROM ${dailyTable}
    WHERE [PDate] >= @fromDate
      AND [PDate] < DATEADD(DAY, 1, @toDate)
      AND [UserID] IN (${userConditions.join(', ')})
      AND [Punch1] IS NOT NULL
    ORDER BY [UserID], [PDate]
  `);

  // Map to PunchGroup format for night-shift merge
  const rawGroups: PunchGroup[] = result.recordset
    .map((row: any) => {
      const cosecUserId = String(row.user_id ?? '').trim();
      const attendanceDate = String(row.attendance_date ?? '').trim();
      const firstPunch = String(row.first_punch ?? '').trim();
      const lastPunch = String(row.last_punch ?? '').trim();
      const workingMinutes = Math.max(0, Number(row.working_minutes ?? 0));
      return {
        cosecUserId,
        punchDate: attendanceDate,
        firstPunch,
        lastPunch: lastPunch || firstPunch,
        totalPunches: (lastPunch && lastPunch !== firstPunch) ? 2 : 1,
        workingMinutes,
        sourceSystem: 'ncosec_direct',
        sourceTable: dailyTable,
      };
    })
    .filter((g: PunchGroup) =>
      g.cosecUserId &&
      /^\d{4}-\d{2}-\d{2}$/.test(g.punchDate) &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(g.firstPunch),
    );

  // Apply night-shift merge (same logic as cosec-sync)
  const merged = await mergeNightShiftRollover(rawGroups);

  const results: NcosecMonthlyRecord[] = [];
  const resultKeys = new Set<string>();

  for (const group of merged) {
    const mapping = cosecToMapping.get(group.cosecUserId);
    if (!mapping) continue;

    const key = `${mapping.employee_id}:${group.punchDate}`;
    resultKeys.add(key);

    const clockIn = tagIST(group.firstPunch);
    const clockOut = (group.lastPunch && group.lastPunch !== group.firstPunch)
      ? tagIST(group.lastPunch)
      : null;
    const totalHours = Math.round((group.workingMinutes / 60) * 100) / 100;

    const override = overrides.get(key);
    let finalStatus: string;
    let finalLwp: number;
    let finalLocked: number;
    let finalSource: string;
    let finalNote: string | null;

    if (override) {
      finalStatus = override.override_status;
      finalLwp = override.lwp_value;
      finalLocked = override.is_locked;
      finalSource = override.is_locked ? 'regularization' : 'ncosec_with_override';
      finalNote = override.override_note;
    } else if (!clockOut && clockIn) {
      finalStatus = 'present';
      finalLwp = 0;
      finalLocked = 0;
      finalSource = 'ncosec_direct_live_open';
      finalNote = null;
    } else {
      const cls = classifyCosecMinutes(group.workingMinutes);
      finalStatus = cls.status;
      finalLwp = cls.lwpValue;
      finalLocked = 0;
      finalSource = 'ncosec_direct';
      finalNote = null;
    }

    results.push({
      employee_id: mapping.employee_id,
      employee_code: mapping.employee_code,
      employee_name: mapping.employee_name,
      department_name: mapping.department_name,
      branch_name: mapping.branch_name,
      process_name: mapping.process_name,
      cost_centre_name: mapping.cost_centre_name,
      record_date: group.punchDate,
      date: group.punchDate,
      clock_in_time: clockIn,
      clock_out_time: clockOut,
      clock_in: clockIn,
      clock_out: clockOut,
      raw_minutes: group.workingMinutes,
      biometric_minutes: group.workingMinutes,
      total_hours: totalHours,
      attendance_status: finalStatus,
      status: finalStatus,
      lwp_value: finalLwp,
      late_mark: 0,
      is_locked: finalLocked,
      attendance_source: 'biometric',
      source_system: finalSource,
      override_note: finalNote,
      employee: {
        first_name: mapping.first_name,
        last_name: mapping.last_name,
        employee_code: mapping.employee_code,
        working_hours_start: mapping.working_hours_start,
        working_hours_end: mapping.working_hours_end,
      },
    });
  }

  // Add override-only records (leave/holiday/regularization with no NCOSEC punch)
  for (const [key, override] of overrides) {
    if (resultKeys.has(key)) continue;
    const colonIdx = key.indexOf(':');
    const empId = key.slice(0, colonIdx);
    const recDate = key.slice(colonIdx + 1);
    const mapping = empIdToMapping.get(empId);
    if (!mapping) continue;

    results.push({
      employee_id: mapping.employee_id,
      employee_code: mapping.employee_code,
      employee_name: mapping.employee_name,
      department_name: mapping.department_name,
      branch_name: mapping.branch_name,
      process_name: mapping.process_name,
      cost_centre_name: mapping.cost_centre_name,
      record_date: recDate,
      date: recDate,
      clock_in_time: null,
      clock_out_time: null,
      clock_in: null,
      clock_out: null,
      raw_minutes: 0,
      biometric_minutes: 0,
      total_hours: 0,
      attendance_status: override.override_status,
      status: override.override_status,
      lwp_value: override.lwp_value,
      late_mark: 0,
      is_locked: override.is_locked,
      attendance_source: 'biometric',
      source_system: override.is_locked ? 'regularization' : 'ncosec_with_override',
      override_note: override.override_note,
      employee: {
        first_name: mapping.first_name,
        last_name: mapping.last_name,
        employee_code: mapping.employee_code,
        working_hours_start: mapping.working_hours_start,
        working_hours_end: mapping.working_hours_end,
      },
    });
  }

  const currentShiftDate = resolveMonthlyOverlayShiftDate();
  if (currentShiftDate >= fromDate && currentShiftDate <= toDate) {
    const livePunches = await getRealtimePunchMapForMappings(mappings, currentShiftDate);
    for (const [employeeId, livePunch] of livePunches) {
      const key = `${employeeId}:${currentShiftDate}`;
      const override = overrides.get(key);
      if (override?.is_locked) continue;
      if (override && ['leave_approved', 'holiday', 'week_off'].includes(override.override_status)) continue;

      const mapping = empIdToMapping.get(employeeId);
      if (!mapping) continue;

      const liveClockIn = livePunch.first_punch_in;
      const liveClockOut = livePunch.last_punch_out;
      const liveMinutes = Math.max(0, Number(livePunch.raw_minutes ?? 0));
      const liveStatus = liveClockIn
        ? (liveClockOut ? classifyCosecMinutes(liveMinutes).status : 'present')
        : 'absent';
      const liveLwp = liveClockIn
        ? (liveClockOut ? classifyCosecMinutes(liveMinutes).lwpValue : 0)
        : 1;
      const liveTotalHours = Math.round((liveMinutes / 60) * 100) / 100;
      const liveRecord: NcosecMonthlyRecord = {
        employee_id: mapping.employee_id,
        employee_code: mapping.employee_code,
        employee_name: mapping.employee_name,
        department_name: mapping.department_name,
        branch_name: mapping.branch_name,
        process_name: mapping.process_name,
        cost_centre_name: mapping.cost_centre_name,
        record_date: currentShiftDate,
        date: currentShiftDate,
        clock_in_time: liveClockIn,
        clock_out_time: liveClockOut,
        clock_in: liveClockIn,
        clock_out: liveClockOut,
        raw_minutes: liveMinutes,
        biometric_minutes: liveMinutes,
        total_hours: liveTotalHours,
        attendance_status: override?.override_status ?? liveStatus,
        status: override?.override_status ?? liveStatus,
        lwp_value: override ? override.lwp_value : liveLwp,
        late_mark: 0,
        is_locked: override?.is_locked ?? 0,
        attendance_source: 'biometric',
        source_system: override?.is_locked ? 'regularization' : 'ncosec_realtime',
        override_note: override?.override_note ?? null,
        employee: {
          first_name: mapping.first_name,
          last_name: mapping.last_name,
          employee_code: mapping.employee_code,
          working_hours_start: mapping.working_hours_start,
          working_hours_end: mapping.working_hours_end,
        },
      };

      const existingIndex = results.findIndex((record) => record.employee_id === employeeId && record.record_date === currentShiftDate);
      if (existingIndex >= 0) {
        results[existingIndex] = liveRecord;
      } else {
        results.push(liveRecord);
      }
    }
  }

  // Sort by record_date DESC, employee_code ASC
  results.sort((a, b) => {
    const d = b.record_date.localeCompare(a.record_date);
    return d !== 0 ? d : a.employee_code.localeCompare(b.employee_code);
  });

  return results;
}
