import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";

const BIOMETRIC_VIEW_SCOPE_ROLES = [
  "wfm",
  "hr",
  "payroll_hr",
  "payroll_branch",
  "branch_head",
  "manager",
  "assistant_manager",
  "tl",
  "process_manager",
];

type EmployeeRow = RowDataPacket & {
  id: string;
  employee_code: string;
  full_name?: string | null;
  biometric_code?: string | null;
  cosec_user_id?: string | null;
  branch_name?: string | null;
  process_name?: string | null;
  branch_id?: string | null;
  process_id?: string | null;
  department_id?: string | null;
  reporting_manager_id?: string | null;
  manager_id?: string | null;
};

type RawPunchRow = RowDataPacket & {
  cosec_index: number;
  user_id: string;
  punch_time: string;
  io_type: number;
  device_id: number | null;
  synced_at: string;
};

type BiometricSummaryRow = RowDataPacket & {
  punch_date: string;
  first_punch_in: string | null;
  last_punch_out: string | null;
  total_punches: number;
  raw_minutes: number | null;
  source_system: string | null;
};

type AttendanceSummaryRow = RowDataPacket & {
  record_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  attendance_status: string;
  biometric_minutes: number | null;
  attendance_source: string | null;
  source_system: string | null;
  processed_at: string | null;
  is_locked: number;
};

export type RawPunchLogItem = {
  cosecIndex: number;
  userId: string;
  punchTime: string;
  ioType: number;
  ioLabel: string;
  deviceId: number | null;
  syncedAt: string;
};

export type BiometricSummaryItem = {
  firstPunchIn: string | null;
  lastPunchOut: string | null;
  totalPunches: number;
  rawMinutes: number | null;
  sourceSystem: string | null;
};

export type AttendanceSummaryItem = {
  clockInTime: string | null;
  clockOutTime: string | null;
  attendanceStatus: string;
  biometricMinutes: number | null;
  attendanceSource: string | null;
  sourceSystem: string | null;
  processedAt: string | null;
  isLocked: number;
};

export type BiometricPunchLogDay = {
  date: string;
  biometricSummary: BiometricSummaryItem | null;
  attendanceSummary: AttendanceSummaryItem | null;
  rawPunches: RawPunchLogItem[];
};

export type EmployeeBiometricPunchLogResponse = {
  employee: {
    id: string;
    employeeCode: string;
    employeeName: string;
    biometricCode: string | null;
    cosecUserId: string | null;
    branchName: string | null;
    processName: string | null;
  };
  fromDate: string;
  toDate: string;
  days: BiometricPunchLogDay[];
};

function getDatePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(text)) return text.slice(0, 10);
  return null;
}

export function mapPunchIoLabel(ioType: number): string {
  if (Number(ioType) === 0) return "IN";
  if (Number(ioType) === 1) return "OUT";
  return "UNKNOWN";
}

export function mergeBiometricPunchLogDays(input: {
  rawPunches: RawPunchRow[];
  biometricSummaries: BiometricSummaryRow[];
  attendanceSummaries: AttendanceSummaryRow[];
}): BiometricPunchLogDay[] {
  const days = new Map<string, BiometricPunchLogDay>();

  const ensureDay = (date: string): BiometricPunchLogDay => {
    let existing = days.get(date);
    if (!existing) {
      existing = {
        date,
        biometricSummary: null,
        attendanceSummary: null,
        rawPunches: [],
      };
      days.set(date, existing);
    }
    return existing;
  };

  for (const row of input.biometricSummaries) {
    const date = getDatePart(row.punch_date);
    if (!date) continue;
    ensureDay(date).biometricSummary = {
      firstPunchIn: row.first_punch_in,
      lastPunchOut: row.last_punch_out,
      totalPunches: Number(row.total_punches ?? 0),
      rawMinutes: row.raw_minutes == null ? null : Number(row.raw_minutes),
      sourceSystem: row.source_system ?? null,
    };
  }

  for (const row of input.attendanceSummaries) {
    const date = getDatePart(row.record_date);
    if (!date) continue;
    ensureDay(date).attendanceSummary = {
      clockInTime: row.clock_in_time,
      clockOutTime: row.clock_out_time,
      attendanceStatus: String(row.attendance_status ?? ""),
      biometricMinutes: row.biometric_minutes == null ? null : Number(row.biometric_minutes),
      attendanceSource: row.attendance_source ?? null,
      sourceSystem: row.source_system ?? null,
      processedAt: row.processed_at,
      isLocked: Number(row.is_locked ?? 0),
    };
  }

  for (const row of input.rawPunches) {
    const date = getDatePart(row.punch_time);
    if (!date) continue;
    ensureDay(date).rawPunches.push({
      cosecIndex: Number(row.cosec_index),
      userId: String(row.user_id ?? ""),
      punchTime: String(row.punch_time ?? ""),
      ioType: Number(row.io_type ?? -1),
      ioLabel: mapPunchIoLabel(Number(row.io_type ?? -1)),
      deviceId: row.device_id == null ? null : Number(row.device_id),
      syncedAt: String(row.synced_at ?? ""),
    });
  }

  return [...days.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((day) => ({
      ...day,
      rawPunches: [...day.rawPunches].sort((a, b) => a.punchTime.localeCompare(b.punchTime)),
    }));
}

async function getTargetEmployee(employeeId: string): Promise<EmployeeRow | null> {
  const [rows] = await db.execute<EmployeeRow[]>(
    `SELECT
        e.id,
        e.employee_code,
        COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
        e.biometric_code,
        ebe.cosec_user_id,
        b.branch_name,
        p.process_name,
        e.branch_id,
        e.process_id,
        e.department_id,
        e.reporting_manager_id,
        e.manager_id
       FROM employees e
       LEFT JOIN employee_biometric_enrollment ebe
         ON ebe.employee_id = e.id
        AND ebe.is_active = 1
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] ?? null;
}

async function canAccessEmployee(userId: string, employee: EmployeeRow): Promise<boolean> {
  if (await hasAnyRole(userId, "super_admin", "admin", "hr", "wfm", "ceo")) return true;
  const callerEmployee = await getEmployeeForUser(userId);
  if (callerEmployee?.id === employee.id) return true;
  return hasScopedAccess(
    userId,
    BIOMETRIC_VIEW_SCOPE_ROLES,
    {
      branchId: employee.branch_id ?? null,
      processId: employee.process_id ?? null,
      departmentId: employee.department_id ?? null,
      managerEmployeeId: employee.reporting_manager_id ?? employee.manager_id ?? null,
      employeeId: employee.id,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

function assertDateInput(value: string, fieldName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${fieldName} must be YYYY-MM-DD`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export const biometricLogsService = {
  async getEmployeePunchLogs(
    userId: string,
    employeeId: string,
    fromDate: string,
    toDate: string,
  ): Promise<EmployeeBiometricPunchLogResponse> {
    const safeFromDate = assertDateInput(fromDate, "fromDate");
    const safeToDate = assertDateInput(toDate, "toDate");
    const employee = await getTargetEmployee(employeeId);

    if (!employee) {
      const error = new Error("Employee not found") as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }

    if (!(await canAccessEmployee(userId, employee))) {
      const error = new Error("Forbidden") as Error & { statusCode?: number };
      error.statusCode = 403;
      throw error;
    }

    const [rawPunches, biometricSummaries, attendanceSummaries] = await Promise.all([
      db.execute<RawPunchRow[]>(
        `SELECT
            cps.cosec_index,
            cps.user_id,
            DATE_FORMAT(cps.punch_time, '%Y-%m-%d %H:%i:%s') AS punch_time,
            cps.io_type,
            cps.device_id,
            DATE_FORMAT(cps.synced_at, '%Y-%m-%d %H:%i:%s') AS synced_at
           FROM cosec_punch_sync cps
          WHERE cps.punch_time >= ?
            AND cps.punch_time < DATE_ADD(?, INTERVAL 1 DAY)
            AND (
              cps.user_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
              OR (? IS NOT NULL AND cps.user_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci)
              OR (? IS NOT NULL AND cps.user_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci)
            )
          ORDER BY cps.punch_time ASC`,
        [
          safeFromDate,
          safeToDate,
          employee.employee_code,
          employee.biometric_code ?? null,
          employee.biometric_code ?? null,
          employee.cosec_user_id ?? null,
          employee.cosec_user_id ?? null,
        ],
      ).then(([rows]) => rows),
      db.execute<BiometricSummaryRow[]>(
        `SELECT
            DATE_FORMAT(bal.punch_date, '%Y-%m-%d') AS punch_date,
            DATE_FORMAT(bal.first_punch_in, '%Y-%m-%d %H:%i:%s') AS first_punch_in,
            DATE_FORMAT(bal.last_punch_out, '%Y-%m-%d %H:%i:%s') AS last_punch_out,
            bal.total_punches,
            bal.raw_minutes,
            bal.source_system
           FROM biometric_attendance_log bal
          WHERE bal.employee_id = ?
            AND bal.punch_date >= ?
            AND bal.punch_date <= ?
          ORDER BY bal.punch_date DESC`,
        [employee.id, safeFromDate, safeToDate],
      ).then(([rows]) => rows),
      db.execute<AttendanceSummaryRow[]>(
        `SELECT
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
            DATE_FORMAT(adr.clock_in_time, '%Y-%m-%d %H:%i:%s') AS clock_in_time,
            DATE_FORMAT(adr.clock_out_time, '%Y-%m-%d %H:%i:%s') AS clock_out_time,
            adr.attendance_status,
            adr.biometric_minutes,
            adr.attendance_source,
            adr.source_system,
            DATE_FORMAT(adr.processed_at, '%Y-%m-%d %H:%i:%s') AS processed_at,
            adr.is_locked
           FROM attendance_daily_record adr
          WHERE adr.employee_id = ?
            AND adr.record_date >= ?
            AND adr.record_date <= ?
          ORDER BY adr.record_date DESC`,
        [employee.id, safeFromDate, safeToDate],
      ).then(([rows]) => rows),
    ]);

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employee_code,
        employeeName: String(employee.full_name ?? employee.employee_code),
        biometricCode: employee.biometric_code ?? null,
        cosecUserId: employee.cosec_user_id ?? null,
        branchName: employee.branch_name ?? null,
        processName: employee.process_name ?? null,
      },
      fromDate: safeFromDate,
      toDate: safeToDate,
      days: mergeBiometricPunchLogDays({
        rawPunches,
        biometricSummaries,
        attendanceSummaries,
      }),
    };
  },
};
