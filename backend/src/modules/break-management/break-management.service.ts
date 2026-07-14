import { createHash, randomBytes, randomUUID } from "crypto";
import type { Request } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { getNcosecPool } from "../../db/ncosecDb.js";
import { emailService } from "../communication/email.service.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { assessAggregatePunches } from "../wfm/cosec-punch-interpretation.service.js";
import { getRealTimePunchesToday } from "../wfm/attendance-realtime-ncosec.service.js";

type KioskDevice = {
  id: string;
  kiosk_code: string;
  kiosk_name: string;
  branch_id: string | null;
  branch_name: string | null;
  process_id: string | null;
  process_name: string | null;
  allowed_process_ids: string | null;
  token_hash: string;
  allowed_ip_list: string | null;
  allowed_device_fingerprints: string | null;
  is_active: number;
};

type BreakSettingsRow = {
  id: string;
  branch_id: string | null;
  process_id: string | null;
  mini_break_max_minutes: number;
  long_break_min_minutes: number;
  active_break_alert_minutes: number;
  daily_total_allowed_minutes: number;
  max_long_break_count: number;
  escalation_after_minutes: number;
  auto_close_on_biometric_punch_out: number;
  allow_break_without_biometric: number;
  require_exception_reason: number;
  alert_reporting_manager: number;
  alert_hr: number;
  alert_wfm: number;
  alert_cc_list_json: string | null;
};

type DeskFilters = {
  search?: string;
  employee_id?: string;
  branch_id?: string;
  process_id?: string;
  department_id?: string;
  designation_id?: string;
  manager_id?: string;
  shift?: string;
  status?: string;
  date?: string;
  limit?: number;
};

type EmployeeContext = {
  id: string;
  employee_code: string;
  branch_id: string | null;
  process_id: string | null;
  department_id: string | null;
  manager_id: string | null;
  employee_name: string;
};

type LivePunchSnapshot = {
  punchIn: string | null;
  punchOut: string | null;
  biometricMinutes: number;
  sourceSystem: "ncosec_realtime";
};

const BREAK_REASONS = [
  "Tea / Washroom",
  "Lunch",
  "Meeting",
  "Training",
  "Medical",
  "System Issue",
  "Manager Approved",
  "Other",
];

const STATUS_OPTIONS = [
  "On Duty",
  "On Break",
  "Break Exceeded",
  "No Punch Found",
  "W/O",
  "Leave",
  "Shift Completed",
];

const AUTO_CLOSE_CHECK_INTERVAL_MS = 15_000;
const autoCloseState = new Map<string, { lastRunAt: number; promise: Promise<void> | null }>();
const HARD_MAX_DAILY_BREAK_MINUTES = 60;
const HARD_MAX_SINGLE_BREAK_MINUTES = 30;
const MINIMUM_SHIFT_COMPLETION_MINUTES = 9 * 60;

function normalizeJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function getIstParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function currentIstDateTime() {
  const parts = getIstParts();
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dateTime: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    hour: Number(parts.hour),
  };
}

function resolveShiftDate(explicitDate?: string | null) {
  if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) return explicitDate;
  const now = currentIstDateTime();
  if (now.hour >= 5) return now.date;
  const previous = new Date(`${now.date}T00:00:00+05:30`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const parts = getIstParts(previous);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateByDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  const parts = getIstParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizePunchStamp(value: unknown) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.replace("T", " ").replace(/\+05:30$/, "").slice(0, 19);
}

function resolveRealtimePunchWindow(shiftDate: string) {
  const now = currentIstDateTime();
  if (shiftDate === now.date) {
    return {
      dateStart: `${shiftDate} 00:00:00`,
      dateEnd: `${shiftDate} 23:59:59`,
    };
  }

  const previousShiftDate = shiftDateByDays(now.date, -1);
  if (now.hour < 5 && shiftDate === previousShiftDate) {
    return {
      dateStart: `${shiftDate} 00:00:00`,
      dateEnd: `${now.date} 23:59:59`,
    };
  }

  return null;
}

function hashToken(token: string) {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function generateDeskToken() {
  return `bd_${randomBytes(24).toString("base64url")}`;
}

function requestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0]!.trim();
  if (Array.isArray(forwarded) && forwarded[0]) return String(forwarded[0]).split(",")[0]!.trim();
  return req.ip ?? "";
}

function requestFingerprint(req: Request) {
  const raw = `${requestIp(req)}|${String(req.headers["user-agent"] ?? "")}`;
  return createHash("sha256").update(raw).digest("hex");
}

function minutesBetween(start: string, end: string) {
  const startMs = new Date(start.replace(" ", "T") + "+05:30").getTime();
  const endMs = new Date(end.replace(" ", "T") + "+05:30").getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return { seconds: 0, minutes: 0 };
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  return {
    seconds,
    minutes: Math.ceil(seconds / 60),
  };
}

function safeLimit(value: unknown, fallback = 120) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 500);
}

function csvEscape(value: unknown) {
  if (value == null) return "";
  const normalized = Array.isArray(value)
    ? value.join(", ")
    : typeof value === "boolean"
      ? (value ? "Yes" : "No")
      : String(value);
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function buildCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

function formatCsvDateTime(value: unknown) {
  const normalized = normalizePunchStamp(value);
  if (!normalized) return "";
  return normalized;
}

function normalizeStringArrayInput(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

function kioskProcessIds(kiosk: Pick<KioskDevice, "allowed_process_ids" | "process_id">): string[] {
  const mapped = normalizeJsonArray(kiosk.allowed_process_ids);
  return mapped.length > 0 ? mapped : [kiosk.process_id].filter(Boolean).map(String);
}

function normalizeBreakSettings(settings: BreakSettingsRow) {
  const perBreakLimit = Math.min(
    HARD_MAX_SINGLE_BREAK_MINUTES,
    Math.max(1, Number(settings.active_break_alert_minutes ?? HARD_MAX_SINGLE_BREAK_MINUTES)),
  );
  const dailyLimit = Math.min(
    HARD_MAX_DAILY_BREAK_MINUTES,
    Math.max(1, Number(settings.daily_total_allowed_minutes ?? HARD_MAX_DAILY_BREAK_MINUTES)),
  );
  const longBreakThreshold = Math.min(
    perBreakLimit,
    Math.max(1, Number(settings.long_break_min_minutes ?? HARD_MAX_SINGLE_BREAK_MINUTES)),
  );
  const miniBreakMax = Math.min(
    Math.max(1, perBreakLimit - 1),
    Math.max(1, Number(settings.mini_break_max_minutes ?? Math.max(1, perBreakLimit - 1))),
  );

  return {
    ...settings,
    mini_break_max_minutes: miniBreakMax,
    long_break_min_minutes: longBreakThreshold,
    active_break_alert_minutes: perBreakLimit,
    daily_total_allowed_minutes: dailyLimit,
  } as BreakSettingsRow;
}

function assertEmployeeWithinKioskScope(kiosk: KioskDevice, employee: EmployeeContext) {
  if (kiosk.branch_id && employee.branch_id && kiosk.branch_id !== employee.branch_id) {
    throw new Error("This kiosk cannot act on employees from another branch");
  }
  const allowedProcesses = kioskProcessIds(kiosk);
  if (allowedProcesses.length > 0 && (!employee.process_id || !allowedProcesses.includes(employee.process_id))) {
    throw new Error("This kiosk cannot act on employees from another process");
  }
}

async function writeBreakAudit(params: {
  entityType: string;
  entityId: string;
  action: string;
  employeeId?: string | null;
  performedByType: "KIOSK" | "ADMIN" | "SYSTEM";
  performedById?: string | null;
  kioskDeviceId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  req?: Request;
}) {
  try {
    await db.execute(
      `INSERT INTO break_audit_logs
         (id, entity_type, entity_id, action, employee_id, performed_by_type, performed_by_id,
          kiosk_device_id, old_value_json, new_value_json, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        params.entityType,
        params.entityId,
        params.action,
        params.employeeId ?? null,
        params.performedByType,
        params.performedById ?? null,
        params.kioskDeviceId ?? null,
        params.oldValue ? JSON.stringify(params.oldValue) : null,
        params.newValue ? JSON.stringify(params.newValue) : null,
        params.req ? requestIp(params.req) : null,
        params.req ? String(params.req.headers["user-agent"] ?? "").slice(0, 512) : null,
      ],
    );
  } catch (error) {
    console.error("[break-management] audit insert failed:", error);
  }

  if (params.performedById) {
    await writeAuditLog({
      actor_user_id: params.performedById,
      action_type: params.action,
      module_key: "break_management",
      entity_type: params.entityType,
      entity_id: params.entityId,
      employee_id: params.employeeId ?? undefined,
      metadata: params.newValue ?? undefined,
      req: params.req,
    });
  }
}

async function getSettings(branchId: string | null, processId: string | null) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *
       FROM break_settings
      WHERE (branch_id = ? OR branch_id IS NULL)
        AND (process_id = ? OR process_id IS NULL)
      ORDER BY (branch_id IS NOT NULL) DESC, (process_id IS NOT NULL) DESC
      LIMIT 1`,
    [branchId, processId],
  );
  const raw = ((rows as unknown[]) as BreakSettingsRow[])[0] ?? {
    mini_break_max_minutes: 10,
    long_break_min_minutes: 30,
    active_break_alert_minutes: 30,
    daily_total_allowed_minutes: 60,
    max_long_break_count: 2,
    escalation_after_minutes: 10,
    auto_close_on_biometric_punch_out: 1,
    allow_break_without_biometric: 0,
    require_exception_reason: 1,
    alert_reporting_manager: 1,
    alert_hr: 0,
    alert_wfm: 0,
    alert_cc_list_json: null,
  };
  return normalizeBreakSettings(raw as BreakSettingsRow);
}

async function getBreakUsageSummary(employeeId: string, shiftDate: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        SUM(COALESCE(duration_minutes, 0)) AS total_break_minutes,
        SUM(CASE WHEN break_type = 'LONG' THEN 1 ELSE 0 END) AS long_break_count
       FROM break_sessions
      WHERE employee_id = ?
        AND shift_date = ?
        AND status IN ('COMPLETED', 'AUTO_CLOSED', 'EXCEPTION')`,
    [employeeId, shiftDate],
  );
  const row = (rows as any[])[0] ?? {};
  return {
    totalBreakMinutes: Number(row.total_break_minutes ?? 0),
    longBreakCount: Number(row.long_break_count ?? 0),
  };
}

async function getBiometricSnapshot(employeeId: string, employeeCode: string, shiftDate: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        COALESCE(ibd.first_punch, bal.first_punch_in) AS punch_in,
        COALESCE(ibd.last_punch, bal.last_punch_out) AS punch_out,
        COALESCE(ibd.biometric_minutes, bal.raw_minutes, 0) AS biometric_minutes
       FROM employees e
       LEFT JOIN integration_biometric_daily ibd
         ON ibd.employee_code = ?
        AND ibd.activity_date = ?
       LEFT JOIN biometric_attendance_log bal
         ON bal.employee_id = ?
        AND bal.punch_date = ?
      WHERE e.id = ?
      LIMIT 1`,
    [employeeCode, shiftDate, employeeId, shiftDate, employeeId],
  );
  const row = (rows as any[])[0] ?? {};
  const fallback = {
    punchIn: normalizePunchStamp(row.punch_in),
    punchOut: normalizePunchStamp(row.punch_out),
    biometricMinutes: Number(row.biometric_minutes ?? 0),
  };

  if (shiftDate === currentIstDateTime().date && env.NCOSEC_DB_HOST) {
    try {
      const realtime = await getRealTimePunchesToday(employeeId);
      if (realtime?.first_punch_in) {
        return {
          punchIn: normalizePunchStamp(realtime.first_punch_in),
          punchOut: normalizePunchStamp(realtime.last_punch_out),
          biometricMinutes: Number(realtime.raw_minutes ?? fallback.biometricMinutes ?? 0),
        };
      }
    } catch (error) {
      console.error("[break-management] realtime biometric snapshot fallback:", error instanceof Error ? error.message : String(error));
    }
  }

  return fallback;
}

async function getRealtimeNcosecPunchMap(
  employees: Array<{ employeeId: string; employeeCode: string; cosecUserId?: string | null }>,
  shiftDate: string,
) {
  const window = resolveRealtimePunchWindow(shiftDate);
  if (!window || !env.NCOSEC_DB_HOST) return new Map<string, LivePunchSnapshot>();

  const employeeIdsByUserId = new Map<string, string[]>();
  for (const employee of employees) {
    const rawUserId = String(employee.cosecUserId ?? employee.employeeCode ?? "").trim();
    if (!rawUserId) continue;
    const bucket = employeeIdsByUserId.get(rawUserId) ?? [];
    bucket.push(employee.employeeId);
    employeeIdsByUserId.set(rawUserId, bucket);
  }

  const userIds = Array.from(employeeIdsByUserId.keys());
  if (userIds.length === 0) return new Map<string, LivePunchSnapshot>();

  const userIdColumn = env.NCOSEC_USER_ID_COLUMN || "UserID";
  const dateTimeColumn = env.NCOSEC_DATETIME_COLUMN || "Edatetime";
  const eventTable = env.NCOSEC_EVENT_TABLE || "dbo.Mx_ATDEventTrn";

  try {
    const pool = await getNcosecPool();
    const request = pool.request();
    request.input("dateStart", window.dateStart);
    request.input("dateEnd", window.dateEnd);

    const idParams: string[] = [];
    userIds.forEach((userId, index) => {
      const key = `userId${index}`;
      request.input(key, userId);
      idParams.push(`@${key}`);
    });

    const result = await request.query(`
      SELECT
        CAST(${userIdColumn} AS NVARCHAR(100)) AS user_id,
        CONVERT(CHAR(19), MIN(${dateTimeColumn}), 120) AS first_punch,
        CONVERT(CHAR(19), MAX(${dateTimeColumn}), 120) AS last_punch,
        COUNT(*) AS total_punches,
        DATEDIFF(MINUTE, MIN(${dateTimeColumn}), MAX(${dateTimeColumn})) AS raw_minutes
      FROM ${eventTable}
      WHERE ${dateTimeColumn} >= @dateStart
        AND ${dateTimeColumn} <= @dateEnd
        AND CAST(${userIdColumn} AS NVARCHAR(100)) IN (${idParams.join(", ")})
      GROUP BY CAST(${userIdColumn} AS NVARCHAR(100))
    `);

    const livePunches = new Map<string, LivePunchSnapshot>();
    for (const row of result.recordset ?? []) {
      const userId = String((row as any).user_id ?? "").trim();
      if (!userId) continue;

      const assessed = assessAggregatePunches({
        firstPunch: String((row as any).first_punch ?? ""),
        lastPunch: String((row as any).last_punch ?? ""),
        totalPunches: Number((row as any).total_punches ?? 0),
        workingMinutes: Number((row as any).raw_minutes ?? 0),
      });

      const snapshot: LivePunchSnapshot = {
        punchIn: normalizePunchStamp(assessed.effectivePunchIn),
        punchOut: normalizePunchStamp(assessed.effectivePunchOut),
        biometricMinutes: assessed.effectiveWorkingMinutes,
        sourceSystem: "ncosec_realtime",
      };

      for (const employeeId of employeeIdsByUserId.get(userId) ?? []) {
        livePunches.set(employeeId, snapshot);
      }
    }

    return livePunches;
  } catch (error) {
    console.error("[break-management] realtime NCOSEC overlay failed:", error instanceof Error ? error.message : String(error));
    return new Map<string, LivePunchSnapshot>();
  }
}

function classifyBreak(durationMinutes: number, settings: BreakSettingsRow) {
  return durationMinutes >= Number(settings.long_break_min_minutes ?? 10) ? "LONG" : "MINI";
}

function resolveCompletedBreakStatus(input: {
  durationMinutes: number;
  totalBreakMinutesAfterClose: number;
  noBiometricPunchFlag: boolean;
  settings: BreakSettingsRow;
}) {
  if (input.noBiometricPunchFlag) return "EXCEPTION" as const;
  if (input.durationMinutes > Number(input.settings.active_break_alert_minutes ?? HARD_MAX_SINGLE_BREAK_MINUTES)) return "EXCEPTION" as const;
  if (input.totalBreakMinutesAfterClose > Number(input.settings.daily_total_allowed_minutes ?? HARD_MAX_DAILY_BREAK_MINUTES)) return "EXCEPTION" as const;
  return "COMPLETED" as const;
}

function resolveShiftWorkedMinutes(row: {
  biometric_minutes?: unknown;
  biometric_punch_in_time?: unknown;
  biometric_punch_out_time?: unknown;
}) {
  const biometricMinutes = Number(row.biometric_minutes ?? 0);
  if (Number.isFinite(biometricMinutes) && biometricMinutes > 0) {
    return biometricMinutes;
  }
  return 0;
}

function deriveStatus(row: any, settings: BreakSettingsRow) {
  const activeMinutes = row.active_break_start_time
    ? minutesBetween(row.active_break_start_time, currentIstDateTime().dateTime).minutes
    : 0;
  const isExceeded = Boolean(row.active_break_id) && activeMinutes >= Number(settings.active_break_alert_minutes ?? 10);
  const workedMinutes = resolveShiftWorkedMinutes(row);

  if (row.leave_name) {
    return { label: "Leave", tone: "leave", activeMinutes, isExceeded };
  }
  if (String(row.roster_status ?? "").toLowerCase().includes("week off")) {
    return { label: "W/O", tone: "weekoff", activeMinutes, isExceeded };
  }
  if (row.active_break_id) {
    return { label: isExceeded ? "Break Exceeded" : "On Break", tone: isExceeded ? "danger" : "warning", activeMinutes, isExceeded };
  }
  if (row.biometric_punch_in_time && row.biometric_punch_out_time && workedMinutes >= MINIMUM_SHIFT_COMPLETION_MINUTES) {
    return { label: "Shift Completed", tone: "completed", activeMinutes, isExceeded };
  }
  if (row.biometric_punch_in_time) {
    return { label: "On Duty", tone: "active", activeMinutes, isExceeded };
  }
  return { label: "No Punch Found", tone: "muted", activeMinutes, isExceeded };
}

async function rebuildDailySummary(employeeId: string, employeeCode: string, shiftDate: string, branchId: string | null, processId: string | null, managerId: string | null) {
  const biometric = await getBiometricSnapshot(employeeId, employeeCode, shiftDate);
  const [sessionRows] = await db.execute<RowDataPacket[]>(
    `SELECT
        SUM(COALESCE(duration_seconds, 0)) AS total_break_seconds,
        SUM(COALESCE(duration_minutes, 0)) AS total_break_minutes,
        SUM(CASE WHEN break_type = 'MINI' THEN 1 ELSE 0 END) AS mini_break_count,
        SUM(CASE WHEN break_type = 'LONG' THEN 1 ELSE 0 END) AS long_break_count,
        SUM(CASE WHEN status IN ('COMPLETED','AUTO_CLOSED','EXCEPTION') AND break_type = 'LONG' THEN 1 ELSE 0 END) AS exceeded_break_count,
        SUM(CASE WHEN no_biometric_punch_flag = 1 THEN 1 ELSE 0 END) AS exception_count,
        MIN(break_start_time) AS first_break_start,
        MAX(break_end_time) AS last_break_end,
        MAX(CASE WHEN status = 'ACTIVE' THEN id ELSE NULL END) AS active_break_id
       FROM break_sessions
      WHERE employee_id = ?
        AND shift_date = ?`,
    [employeeId, shiftDate],
  );

  const [rosterRows] = await db.execute<RowDataPacket[]>(
    `SELECT roster_status
       FROM wfm_roster_assignment
      WHERE employee_id = ?
        AND roster_date = ?
      LIMIT 1`,
    [employeeId, shiftDate],
  ).catch(() => [[] as RowDataPacket[], []]);

  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT lt.leave_name
       FROM leave_request lr
       LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = ?
        AND lr.status = 'approved'
        AND ? BETWEEN lr.from_date AND lr.to_date
      LIMIT 1`,
    [employeeId, shiftDate],
  ).catch(() => [[] as RowDataPacket[], []]);

  const totals = (sessionRows as any[])[0] ?? {};
  const rosterStatus = (rosterRows as any[])[0]?.roster_status ?? null;
  const leaveName = (leaveRows as any[])[0]?.leave_name ?? null;
  const workedMinutes = resolveShiftWorkedMinutes({
    biometric_minutes: biometric.biometricMinutes,
    biometric_punch_in_time: biometric.punchIn,
    biometric_punch_out_time: biometric.punchOut,
  });
  const attendanceStatus = leaveName
    ? "Leave"
    : String(rosterStatus ?? "").toLowerCase().includes("week off")
      ? "W/O"
      : biometric.punchIn && biometric.punchOut && workedMinutes >= MINIMUM_SHIFT_COMPLETION_MINUTES
        ? "Shift Completed"
        : biometric.punchIn
          ? "On Duty"
          : "No Punch Found";

  await db.execute(
    `INSERT INTO break_daily_summary
       (id, employee_id, employee_code, shift_date, branch_id, process_id, manager_id,
        biometric_punch_in_time, biometric_punch_out_time, roster_status, attendance_status,
        total_break_seconds, total_break_minutes, mini_break_count, long_break_count,
        exceeded_break_count, exception_count, first_break_start, last_break_end, active_break_id, final_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       branch_id = VALUES(branch_id),
       process_id = VALUES(process_id),
       manager_id = VALUES(manager_id),
       biometric_punch_in_time = VALUES(biometric_punch_in_time),
       biometric_punch_out_time = VALUES(biometric_punch_out_time),
       roster_status = VALUES(roster_status),
       attendance_status = VALUES(attendance_status),
       total_break_seconds = VALUES(total_break_seconds),
       total_break_minutes = VALUES(total_break_minutes),
       mini_break_count = VALUES(mini_break_count),
       long_break_count = VALUES(long_break_count),
       exceeded_break_count = VALUES(exceeded_break_count),
       exception_count = VALUES(exception_count),
       first_break_start = VALUES(first_break_start),
       last_break_end = VALUES(last_break_end),
       active_break_id = VALUES(active_break_id),
       final_status = VALUES(final_status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      randomUUID(),
      employeeId,
      employeeCode,
      shiftDate,
      branchId,
      processId,
      managerId,
      biometric.punchIn,
      biometric.punchOut,
      rosterStatus,
      attendanceStatus,
      Number(totals.total_break_seconds ?? 0),
      Number(totals.total_break_minutes ?? 0),
      Number(totals.mini_break_count ?? 0),
      Number(totals.long_break_count ?? 0),
      Number(totals.exceeded_break_count ?? 0),
      Number(totals.exception_count ?? 0),
      totals.first_break_start ?? null,
      totals.last_break_end ?? null,
      totals.active_break_id ?? null,
      attendanceStatus,
    ],
  );
}

async function sendBreakAlertIfNeeded(sessionId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        bs.id,
        bs.employee_id,
        bs.employee_code,
        bs.break_reason,
        bs.break_start_time,
        bs.break_end_time,
        bs.duration_minutes,
        bs.branch_id,
        bs.process_id,
        bs.department_id,
        bs.manager_id,
        bs.biometric_punch_in_time,
        bs.biometric_punch_out_time,
        COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
        bm.branch_name,
        pm.process_name,
        dm.dept_name AS department_name,
        COALESCE(NULLIF(TRIM(mgr.full_name), ''), TRIM(CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')))) AS manager_name,
        COALESCE(NULLIF(TRIM(mgr.official_email), ''), NULLIF(TRIM(mgr.email), '')) AS manager_email
       FROM break_sessions bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN branch_master bm ON bm.id = bs.branch_id
       LEFT JOIN process_master pm ON pm.id = bs.process_id
       LEFT JOIN department_master dm ON dm.id = bs.department_id
       LEFT JOIN employees mgr ON mgr.id = bs.manager_id
      WHERE bs.id = ?
      LIMIT 1`,
    [sessionId],
  );
  const session = (rows as any[])[0];
  if (!session) return;

  const settings = await getSettings(session.branch_id ?? null, session.process_id ?? null);
  const threshold = Number(settings.active_break_alert_minutes ?? 10);
  const actual = Number(session.duration_minutes ?? 0);
  if (actual < threshold) return;

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM break_alert_logs WHERE break_session_id = ? AND alert_type = 'ACTIVE_BREAK_EXCEEDED' LIMIT 1`,
    [sessionId],
  );
  if ((existing as any[]).length > 0) return;

  const exceededBy = Math.max(0, actual - threshold);
  const subject = `Break Alert: ${session.employee_name} exceeded break limit by ${exceededBy} mins`;
  const ccList = normalizeJsonArray(settings.alert_cc_list_json);
  let emailStatus = "SKIPPED";
  let errorMessage: string | null = null;
  let sentAt: string | null = null;

  if (session.manager_email && settings.alert_reporting_manager) {
    try {
      if (emailService.isConfigured()) {
        await emailService.send({
          to: session.manager_email,
          subject,
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
              <h2 style="margin:0 0 12px;color:#145da0">HRMS2 Break Management Alert</h2>
              <p><strong>Employee:</strong> ${session.employee_name} (${session.employee_code})</p>
              <p><strong>Branch / Process:</strong> ${session.branch_name ?? "—"} / ${session.process_name ?? "—"}</p>
              <p><strong>Department:</strong> ${session.department_name ?? "—"}</p>
              <p><strong>Manager:</strong> ${session.manager_name ?? "—"}</p>
              <p><strong>Break reason:</strong> ${session.break_reason}</p>
              <p><strong>Break start:</strong> ${session.break_start_time ?? "—"}</p>
              <p><strong>Break end:</strong> ${session.break_end_time ?? "—"}</p>
              <p><strong>Break duration:</strong> ${actual} mins</p>
              <p><strong>Allowed threshold:</strong> ${threshold} mins</p>
              <p><strong>Exceeded by:</strong> ${exceededBy} mins</p>
              <p><strong>Biometric punch-in:</strong> ${session.biometric_punch_in_time ?? "—"}</p>
              <p><strong>Biometric punch-out:</strong> ${session.biometric_punch_out_time ?? "—"}</p>
              <p><strong>Kiosk/source:</strong> Break Management Desk</p>
              <p style="margin-top:16px;color:#475569">This is an automated alert from HRMS2 Break Management.</p>
            </div>
          `,
        });
        emailStatus = "SENT";
        sentAt = currentIstDateTime().dateTime;
      } else {
        errorMessage = "SMTP not configured";
      }
    } catch (error) {
      emailStatus = "FAILED";
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  await db.execute(
    `INSERT INTO break_alert_logs
       (id, break_session_id, employee_id, manager_id, alert_type, alert_level, threshold_minutes,
        actual_minutes, exceeded_by_minutes, email_to, email_cc, email_subject, email_status, sent_at, error_message)
     VALUES (?, ?, ?, ?, 'ACTIVE_BREAK_EXCEEDED', 'WARNING', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      sessionId,
      session.employee_id,
      session.manager_id ?? null,
      threshold,
      actual,
      exceededBy,
      session.manager_email ?? null,
      ccList.join(",") || null,
      subject,
      emailStatus,
      sentAt,
      errorMessage,
    ],
  );
}

async function autoCloseEligibleBreaks(shiftDate: string, force = false) {
  const currentState = autoCloseState.get(shiftDate);
  if (currentState?.promise) {
    await currentState.promise;
    return;
  }

  const now = Date.now();
  if (!force && currentState && now - currentState.lastRunAt < AUTO_CLOSE_CHECK_INTERVAL_MS) {
    return;
  }

  const task = (async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          bs.id,
          bs.employee_id,
          bs.employee_code,
          bs.branch_id,
          bs.process_id,
          bs.manager_id,
          bs.break_start_time,
          COALESCE(ibd.last_punch, bal.last_punch_out) AS punch_out
         FROM break_sessions bs
         LEFT JOIN integration_biometric_daily ibd
           ON ibd.employee_code = bs.employee_code
          AND ibd.activity_date = bs.shift_date
         LEFT JOIN biometric_attendance_log bal
           ON bal.employee_id = bs.employee_id
          AND bal.punch_date = bs.shift_date
        WHERE bs.shift_date = ?
          AND bs.status = 'ACTIVE'`,
      [shiftDate],
    );

    for (const row of rows as any[]) {
      if (!row.punch_out || !row.break_start_time) continue;
      const start = new Date(String(row.break_start_time).replace(" ", "T") + "+05:30").getTime();
      const end = new Date(String(row.punch_out).replace(" ", "T") + "+05:30").getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const settings = await getSettings(row.branch_id ?? null, row.process_id ?? null);
      if (!Number(settings.auto_close_on_biometric_punch_out ?? 1)) continue;
      const duration = minutesBetween(String(row.break_start_time), String(row.punch_out));
      const usage = await getBreakUsageSummary(String(row.employee_id), shiftDate);
      const completedStatus = resolveCompletedBreakStatus({
        durationMinutes: duration.minutes,
        totalBreakMinutesAfterClose: usage.totalBreakMinutes + duration.minutes,
        noBiometricPunchFlag: false,
        settings,
      });
      await db.execute(
        `UPDATE break_sessions
            SET break_end_time = ?,
                duration_seconds = ?,
                duration_minutes = ?,
                break_type = ?,
                status = ?,
                end_source = 'AUTO_BIOMETRIC_PUNCH_OUT',
                biometric_punch_out_time = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'ACTIVE'`,
        [
          row.punch_out,
          duration.seconds,
          duration.minutes,
          classifyBreak(duration.minutes, settings),
          completedStatus === "EXCEPTION" ? "EXCEPTION" : "AUTO_CLOSED",
          row.punch_out,
          row.id,
        ],
      );
      await rebuildDailySummary(row.employee_id, row.employee_code, shiftDate, row.branch_id ?? null, row.process_id ?? null, row.manager_id ?? null);
      await sendBreakAlertIfNeeded(row.id);
      await writeBreakAudit({
        entityType: "break_session",
        entityId: row.id,
        action: "AUTO_CLOSED_ON_PUNCH_OUT",
        employeeId: row.employee_id,
        performedByType: "SYSTEM",
        newValue: { biometric_punch_out_time: row.punch_out },
      });
    }
  })();

  autoCloseState.set(shiftDate, { lastRunAt: currentState?.lastRunAt ?? 0, promise: task });
  try {
    await task;
  } finally {
    autoCloseState.set(shiftDate, { lastRunAt: Date.now(), promise: null });
  }
}

async function recordManualDeskPunch(employee: EmployeeContext, shiftDate: string, mode: "IN" | "OUT") {
  const now = currentIstDateTime().dateTime;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, cosec_user_id, first_punch_in, last_punch_out, total_punches, raw_minutes, source_system
       FROM biometric_attendance_log
      WHERE employee_id = ?
        AND punch_date = ?
      ORDER BY migrated_at DESC
      LIMIT 1`,
    [employee.id, shiftDate],
  );
  const existing = (rows as any[])[0] ?? null;

  if (mode === "IN") {
    if (existing?.first_punch_in) {
      throw new Error("Punch in is already available for this employee");
    }

    if (existing?.id) {
      await db.execute(
        `UPDATE biometric_attendance_log
            SET employee_code = COALESCE(NULLIF(employee_code, ''), ?),
                cosec_user_id = COALESCE(NULLIF(cosec_user_id, ''), ?),
                first_punch_in = ?,
                total_punches = GREATEST(COALESCE(total_punches, 0), 1),
                source_system = COALESCE(NULLIF(source_system, ''), 'manual_kiosk'),
                migrated_at = NOW(),
                updated_at = NOW()
          WHERE id = ?`,
        [employee.employee_code, employee.employee_code, now, existing.id],
      );
    } else {
      await db.execute(
        `INSERT INTO biometric_attendance_log
           (id, employee_id, employee_code, cosec_user_id, punch_date, first_punch_in, last_punch_out,
            total_punches, raw_minutes, source_system, migrated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 0, 'manual_kiosk', NOW(), NOW())`,
        [randomUUID(), employee.id, employee.employee_code, employee.employee_code, shiftDate, now],
      );
    }
    return { actionTime: now, action: "PUNCH_IN" as const };
  }

  const currentPunchIn = String(existing?.first_punch_in ?? "").trim();
  if (!currentPunchIn) throw new Error("Punch in is not available for this employee");
  if (existing?.last_punch_out) throw new Error("Punch out is already available for this employee");

  const duration = minutesBetween(currentPunchIn, now);
  await db.execute(
    `UPDATE biometric_attendance_log
        SET last_punch_out = ?,
            total_punches = GREATEST(COALESCE(total_punches, 0), 2),
            raw_minutes = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [now, duration.minutes, existing.id],
  );
  await autoCloseEligibleBreaks(shiftDate, true);
  return { actionTime: now, action: "PUNCH_OUT" as const };
}

async function validateKiosk(kioskCode: string, token: string, req: Request) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        kd.*,
        bm.branch_name,
        pm.process_name
       FROM break_kiosk_devices kd
       LEFT JOIN branch_master bm ON bm.id = kd.branch_id
       LEFT JOIN process_master pm ON pm.id = kd.process_id
      WHERE kd.kiosk_code = ?
      LIMIT 1`,
    [kioskCode],
  );
  const device = ((rows as unknown[]) as KioskDevice[])[0];
  if (!device || !device.is_active) {
    throw new Error("Kiosk device is not active");
  }
  if (device.token_hash !== hashToken(token)) {
    throw new Error("Invalid kiosk token");
  }

  const allowedIps = normalizeJsonArray(device.allowed_ip_list);
  const ip = requestIp(req);
  if (allowedIps.length > 0 && !allowedIps.includes(ip)) {
    throw new Error("This IP is not allowed for the selected kiosk");
  }

  const allowedFingerprints = normalizeJsonArray(device.allowed_device_fingerprints);
  const fingerprint = requestFingerprint(req);
  if (allowedFingerprints.length > 0 && !allowedFingerprints.includes(fingerprint)) {
    throw new Error("This device fingerprint is not allowed for the selected kiosk");
  }

  await db.execute(
    `UPDATE break_kiosk_devices
        SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (last_used_at IS NULL OR last_used_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE))`,
    [device.id],
  );

  return device;
}

async function fetchDeskRows(kiosk: KioskDevice, filters: DeskFilters, includeAll = false, includeRealtime = false) {
  const shiftDate = resolveShiftDate(filters.date ?? null);
  await autoCloseEligibleBreaks(shiftDate);

  const where: string[] = [
    "e.active_status = 1",
    "LOWER(COALESCE(e.employment_status, 'active')) = 'active'",
  ];
  const params: unknown[] = [shiftDate, shiftDate, shiftDate, shiftDate, shiftDate, shiftDate, shiftDate, shiftDate, shiftDate];

  if (kiosk.branch_id) {
    where.push("e.branch_id = ?");
    params.push(kiosk.branch_id);
  } else if (filters.branch_id) {
    where.push("e.branch_id = ?");
    params.push(filters.branch_id);
  }

  const allowedProcesses = kioskProcessIds(kiosk);
  if (allowedProcesses.length > 0) {
    where.push(`e.process_id IN (${allowedProcesses.map(() => "?").join(", ")})`);
    params.push(...allowedProcesses);
  } else if (filters.process_id) {
    where.push("e.process_id = ?");
    params.push(filters.process_id);
  }

  if (filters.department_id) {
    where.push("e.department_id = ?");
    params.push(filters.department_id);
  }
  if (filters.designation_id) {
    where.push("e.designation_id = ?");
    params.push(filters.designation_id);
  }
  if (filters.manager_id) {
    where.push("e.reporting_manager_id = ?");
    params.push(filters.manager_id);
  }
  if (filters.shift) {
    where.push("COALESCE(NULLIF(sm.shift_name, ''), NULLIF(CONCAT(COALESCE(ra.shift_start_time, ''), CASE WHEN ra.shift_end_time IS NOT NULL AND ra.shift_end_time <> '' THEN CONCAT(' - ', ra.shift_end_time) ELSE '' END), ''), '') = ?");
    params.push(filters.shift);
  }
  if (filters.search) {
    const query = `%${filters.search.trim()}%`;
    where.push(`(
      COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) LIKE ?
      OR e.employee_code LIKE ?
      OR COALESCE(map.cosec_user_id, e.employee_code) LIKE ?
    )`);
    params.push(query, query, query);
  }
  if (filters.employee_id) {
    where.push("e.id = ?");
    params.push(filters.employee_id);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.id,
        e.employee_code,
        COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
        COALESCE(NULLIF(e.avatar_url, ''), NULLIF(e.photo_url, '')) AS avatar_url,
        e.branch_id,
        e.process_id,
        e.department_id,
        e.designation_id,
        e.reporting_manager_id,
        bm.branch_name,
        pm.process_name,
        dm.dept_name AS department_name,
        des.designation_name,
        COALESCE(NULLIF(TRIM(mgr.full_name), ''), TRIM(CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')))) AS manager_name,
        COALESCE(NULLIF(TRIM(mgr.official_email), ''), NULLIF(TRIM(mgr.email), '')) AS manager_email,
        COALESCE(ibd.first_punch, bal.first_punch_in) AS biometric_punch_in_time,
        COALESCE(ibd.last_punch, bal.last_punch_out) AS biometric_punch_out_time,
        COALESCE(ibd.biometric_minutes, bal.raw_minutes, 0) AS biometric_minutes,
        COALESCE(NULLIF(bal.source_system, ''), CASE WHEN ibd.first_punch IS NOT NULL THEN 'biometric_sync' ELSE NULL END) AS attendance_source_system,
        ra.shift_start_time,
        ra.shift_end_time,
        COALESCE(NULLIF(sm.shift_name, ''), NULLIF(CONCAT(COALESCE(ra.shift_start_time, ''), CASE WHEN ra.shift_end_time IS NOT NULL AND ra.shift_end_time <> '' THEN CONCAT(' - ', ra.shift_end_time) ELSE '' END), '')) AS shift_name,
        ra.roster_status,
        lt.leave_name,
        agg.total_break_minutes,
        agg.mini_break_count,
        agg.long_break_count,
        agg.last_break_reason,
        active.id AS active_break_id,
        active.break_start_time AS active_break_start_time,
        active.break_reason AS active_break_reason,
        active.no_biometric_punch_flag,
        active.manager_approval_required,
        active.kiosk_device_id,
        map.cosec_user_id
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN department_master dm ON dm.id = e.department_id
       LEFT JOIN designation_master des ON des.id = e.designation_id
       LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
       LEFT JOIN (
         SELECT
           ebe.employee_id,
           SUBSTRING_INDEX(
             GROUP_CONCAT(ebe.cosec_user_id ORDER BY COALESCE(ebe.last_sync_at, ebe.enrolled_at) DESC, ebe.id DESC SEPARATOR '||'),
             '||',
             1
           ) AS cosec_user_id
         FROM employee_biometric_enrollment ebe
         WHERE ebe.is_active = 1
         GROUP BY ebe.employee_id
       ) map ON map.employee_id = e.id
       LEFT JOIN (
         SELECT
           employee_code,
           activity_date,
           MIN(first_punch) AS first_punch,
           MAX(last_punch) AS last_punch,
           MAX(COALESCE(biometric_minutes, 0)) AS biometric_minutes
         FROM integration_biometric_daily
         WHERE activity_date = ?
         GROUP BY employee_code, activity_date
       ) ibd
         ON ibd.employee_code = e.employee_code
        AND ibd.activity_date = ?
       LEFT JOIN (
         SELECT
           employee_id,
           punch_date,
           MIN(first_punch_in) AS first_punch_in,
           MAX(last_punch_out) AS last_punch_out,
           MAX(COALESCE(raw_minutes, 0)) AS raw_minutes,
           SUBSTRING_INDEX(
             GROUP_CONCAT(source_system ORDER BY migrated_at DESC, id DESC SEPARATOR '||'),
             '||',
             1
           ) AS source_system
         FROM biometric_attendance_log
         WHERE punch_date = ?
         GROUP BY employee_id, punch_date
       ) bal
         ON bal.employee_id = e.id
        AND bal.punch_date = ?
       LEFT JOIN (
         SELECT
           ra0.employee_id,
           ra0.roster_date,
           SUBSTRING_INDEX(
             GROUP_CONCAT(ra0.id ORDER BY COALESCE(ra0.updated_at, ra0.created_at) DESC, ra0.id DESC SEPARATOR '||'),
             '||',
             1
           ) AS roster_id
         FROM wfm_roster_assignment ra0
         WHERE ra0.roster_date = ?
         GROUP BY ra0.employee_id, ra0.roster_date
       ) ra_pick
         ON ra_pick.employee_id = e.id
        AND ra_pick.roster_date = ?
       LEFT JOIN wfm_roster_assignment ra
          ON ra.id = ra_pick.roster_id
       LEFT JOIN wfm_shift_master sm
         ON sm.id = ra.shift_id
       LEFT JOIN (
         SELECT
           lr0.employee_id,
           SUBSTRING_INDEX(
             GROUP_CONCAT(lr0.leave_type_id ORDER BY COALESCE(lr0.applied_at, lr0.created_at) DESC, lr0.id DESC SEPARATOR '||'),
             '||',
             1
           ) AS leave_type_id
         FROM leave_request lr0
         WHERE lr0.status = 'approved'
           AND ? BETWEEN lr0.from_date AND lr0.to_date
         GROUP BY lr0.employee_id
       ) lr
         ON lr.employee_id = e.id
       LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
       LEFT JOIN (
         SELECT
           bs.employee_id,
           SUM(COALESCE(bs.duration_minutes, 0)) AS total_break_minutes,
           SUM(CASE WHEN bs.break_type = 'MINI' THEN 1 ELSE 0 END) AS mini_break_count,
           SUM(CASE WHEN bs.break_type = 'LONG' THEN 1 ELSE 0 END) AS long_break_count,
           SUBSTRING_INDEX(GROUP_CONCAT(bs.break_reason ORDER BY bs.break_start_time DESC SEPARATOR '||'), '||', 1) AS last_break_reason
         FROM break_sessions bs
         WHERE bs.shift_date = ?
           AND bs.status IN ('COMPLETED', 'AUTO_CLOSED', 'EXCEPTION')
         GROUP BY bs.employee_id
       ) agg ON agg.employee_id = e.id
       LEFT JOIN (
         SELECT
           bs0.employee_id,
           SUBSTRING_INDEX(
             GROUP_CONCAT(bs0.id ORDER BY bs0.break_start_time DESC, COALESCE(bs0.updated_at, bs0.created_at) DESC, bs0.id DESC SEPARATOR '||'),
             '||',
             1
           ) AS active_break_id
         FROM break_sessions bs0
         WHERE bs0.shift_date = ?
           AND bs0.status = 'ACTIVE'
         GROUP BY bs0.employee_id
       ) active_pick
         ON active_pick.employee_id = e.id
       LEFT JOIN break_sessions active
         ON active.id = active_pick.active_break_id
      WHERE ${where.join(" AND ")}
      ORDER BY employee_name ASC
      LIMIT ${includeAll ? 500 : safeLimit(filters.limit)}`,
    params,
  );

  const realtimePunches = includeRealtime
    ? await getRealtimeNcosecPunchMap(
        (rows as any[]).map((row) => ({
          employeeId: String(row.id),
          employeeCode: String(row.employee_code ?? ""),
          cosecUserId: row.cosec_user_id ?? row.employee_code ?? null,
        })),
        shiftDate,
      )
    : new Map<string, LivePunchSnapshot>();

  const employeeIds = (rows as any[]).map((row) => row.id).filter(Boolean);
  const sessionsByEmployee = new Map<string, any[]>();
  if (employeeIds.length > 0) {
    const placeholders = employeeIds.map(() => "?").join(", ");
    const [sessionRows] = await db.execute<RowDataPacket[]>(
      `SELECT
          id,
          employee_id,
          break_start_time,
          break_end_time,
          duration_minutes,
          break_type,
          break_reason,
          status,
          no_biometric_punch_flag,
          exception_reason
         FROM break_sessions
        WHERE shift_date = ?
          AND employee_id IN (${placeholders})
        ORDER BY break_start_time DESC`,
      [shiftDate, ...employeeIds],
    );
    for (const row of sessionRows as any[]) {
      const bucket = sessionsByEmployee.get(String(row.employee_id)) ?? [];
      bucket.push(row);
      sessionsByEmployee.set(String(row.employee_id), bucket);
    }
  }

  const settings = await getSettings(kiosk.branch_id, kiosk.process_id);
  const mapped = (rows as any[]).map((row) => {
    const livePunch = realtimePunches.get(String(row.id));
    const punchIn = livePunch?.punchIn ?? normalizePunchStamp(row.biometric_punch_in_time);
    const punchOut = livePunch?.punchOut ?? normalizePunchStamp(row.biometric_punch_out_time);
    const biometricMinutes = livePunch?.biometricMinutes ?? Number(row.biometric_minutes ?? 0);
    const attendanceSourceSystem = livePunch?.sourceSystem
      ?? row.attendance_source_system
      ?? (punchIn ? "biometric_sync" : null);
    const status = deriveStatus({
      ...row,
      biometric_punch_in_time: punchIn,
      biometric_punch_out_time: punchOut,
      biometric_minutes: biometricMinutes,
    }, settings);
    const completedBreakMinutes = Number(row.total_break_minutes ?? 0);
    const currentBreakMinutes = row.active_break_id ? status.activeMinutes : 0;
    const totalBreakMinutesOverall = completedBreakMinutes + currentBreakMinutes;
    const dailyBreakLimitMinutes = Number(settings.daily_total_allowed_minutes ?? HARD_MAX_DAILY_BREAK_MINUTES);
    const remainingDailyBreakMinutes = Math.max(0, dailyBreakLimitMinutes - totalBreakMinutesOverall);
    const shiftDurationMinutes = punchIn
      ? minutesBetween(String(punchIn), String(punchOut ?? currentIstDateTime().dateTime)).minutes
      : 0;
    const todaySessions = sessionsByEmployee.get(String(row.id)) ?? [];
    return {
      employee_id: row.id,
      employee_code: row.employee_code,
      employee_name: row.employee_name,
      avatar_url: row.avatar_url,
      branch_id: row.branch_id ?? null,
      process_id: row.process_id ?? null,
      department_id: row.department_id ?? null,
      designation_id: row.designation_id ?? null,
      manager_id: row.reporting_manager_id ?? null,
      branch_name: row.branch_name,
      process_name: row.process_name,
      department_name: row.department_name,
      designation_name: row.designation_name,
      manager_name: row.manager_name,
      manager_email: row.manager_email,
      biometric_id: row.cosec_user_id ?? row.employee_code,
      biometric_punch_in_time: punchIn,
      biometric_punch_out_time: punchOut,
      biometric_minutes: biometricMinutes,
      attendance_source_system: attendanceSourceSystem,
      shift_name: row.shift_name,
      shift_start_time: row.shift_start_time ?? null,
      shift_end_time: row.shift_end_time ?? null,
      shift_duration_minutes: shiftDurationMinutes,
      roster_status: row.roster_status,
      leave_name: row.leave_name,
      total_break_minutes: completedBreakMinutes,
      mini_break_count: Number(row.mini_break_count ?? 0),
      long_break_count: Number(row.long_break_count ?? 0),
      total_break_count: todaySessions.filter((session) => session?.status !== "CANCELLED").length,
      total_break_minutes_overall: totalBreakMinutesOverall,
      remaining_daily_break_minutes: remainingDailyBreakMinutes,
      daily_break_limit_minutes: dailyBreakLimitMinutes,
      per_break_limit_minutes: Number(settings.active_break_alert_minutes ?? HARD_MAX_SINGLE_BREAK_MINUTES),
      last_break_reason: row.active_break_reason ?? row.last_break_reason ?? null,
      active_break_id: row.active_break_id ?? null,
      active_break_start_time: row.active_break_start_time ?? null,
      active_break_minutes: status.activeMinutes,
      no_biometric_punch_flag: Boolean(row.no_biometric_punch_flag ?? 0),
      manager_approval_required: Boolean(row.manager_approval_required ?? 0),
      current_status: status.label,
      current_status_tone: status.tone,
      exceeded_minutes: status.isExceeded
        ? Math.max(0, status.activeMinutes - Number(settings.active_break_alert_minutes ?? 10))
        : 0,
      today_sessions: todaySessions,
      safe_actions: {
        can_punch_in: !punchIn,
        can_punch_out: Boolean(punchIn) && !Boolean(punchOut),
        can_start_break: status.label === "On Duty" && remainingDailyBreakMinutes > 0,
        can_end_break: Boolean(row.active_break_id),
        exception_start_allowed: !punchIn && Boolean(settings.allow_break_without_biometric),
      },
    };
  });

  const counters = {
    entered: mapped.filter((row) => Boolean(row.biometric_punch_in_time)).length,
    onDuty: mapped.filter((row) => row.current_status === "On Duty").length,
    onBreak: mapped.filter((row) => row.current_status === "On Break").length,
    breakExceeded: mapped.filter((row) => row.current_status === "Break Exceeded").length,
    miniBreaksToday: mapped.reduce((sum, row) => sum + Number(row.mini_break_count ?? 0), 0),
    longBreaksToday: mapped.reduce((sum, row) => sum + Number(row.long_break_count ?? 0), 0),
    totalBreaksToday: mapped.reduce((sum, row) => sum + Number(row.total_break_count ?? 0), 0),
    totalBreakMinutesToday: mapped.reduce((sum, row) => sum + Number((row as any).total_break_minutes_overall ?? row.total_break_minutes ?? 0), 0),
    totalShiftMinutesToday: mapped.reduce((sum, row) => sum + Number(row.shift_duration_minutes ?? 0), 0),
    noPunchFound: mapped.filter((row) => row.current_status === "No Punch Found").length,
    shiftCompleted: mapped.filter((row) => row.current_status === "Shift Completed").length,
  };

  const filteredByStatus = filters.status
    ? mapped.filter((row) => row.current_status === filters.status)
    : mapped;

  const [syncRows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(updated_at) AS last_sync_time FROM integration_biometric_daily`,
  ).catch(() => [[] as RowDataPacket[], []]);

  return {
    shiftDate,
    settings,
    counters,
    employees: filteredByStatus,
    lastSyncTime: (syncRows as any[])[0]?.last_sync_time ?? null,
  };
}

async function fetchSingleDeskEmployee(kiosk: KioskDevice, employeeId: string, shiftDate: string, includeRealtime = true) {
  const data = await fetchDeskRows(kiosk, { date: shiftDate, employee_id: employeeId, limit: 1 }, false, includeRealtime);
  return data.employees.find((row) => row.employee_id === employeeId) ?? null;
}

async function filterOptionsForKiosk(kiosk: KioskDevice, shiftDate: string) {
  const branchWhere = kiosk.branch_id ? "AND e.branch_id = ?" : "";
  const allowedProcesses = kioskProcessIds(kiosk);
  const processWhere = allowedProcesses.length > 0 ? `AND e.process_id IN (${allowedProcesses.map(() => "?").join(", ")})` : "";
  const scopeParams = [kiosk.branch_id, ...allowedProcesses].filter(Boolean);

  const [branchRows, processRows, departmentRows, designationRows, managerRows, shiftRows] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT e.branch_id AS value, bm.branch_name AS label
         FROM employees e
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
          ${branchWhere}
          ${processWhere}
          AND e.branch_id IS NOT NULL
        ORDER BY bm.branch_name ASC`,
      scopeParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT e.process_id AS value, pm.process_name AS label
         FROM employees e
         LEFT JOIN process_master pm ON pm.id = e.process_id
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
          AND COALESCE(pm.active_status, 1) = 1
          ${branchWhere}
          ${processWhere}
          AND e.process_id IS NOT NULL
        ORDER BY pm.process_name ASC`,
      scopeParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT e.department_id AS value, dm.dept_name AS label
         FROM employees e
         LEFT JOIN department_master dm ON dm.id = e.department_id
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
          ${branchWhere}
          ${processWhere}
          AND e.department_id IS NOT NULL
        ORDER BY dm.dept_name ASC`,
      scopeParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT e.designation_id AS value, des.designation_name AS label
         FROM employees e
         LEFT JOIN designation_master des ON des.id = e.designation_id
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
          ${branchWhere}
          ${processWhere}
          AND e.designation_id IS NOT NULL
        ORDER BY des.designation_name ASC`,
      scopeParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT e.reporting_manager_id AS value,
              COALESCE(NULLIF(TRIM(mgr.full_name), ''), TRIM(CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')))) AS label
         FROM employees e
         LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
          ${branchWhere}
          ${processWhere}
          AND e.reporting_manager_id IS NOT NULL
        ORDER BY label ASC`,
      scopeParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT
          COALESCE(NULLIF(sm.shift_name, ''), NULLIF(CONCAT(COALESCE(ra.shift_start_time, ''), CASE WHEN ra.shift_end_time IS NOT NULL AND ra.shift_end_time <> '' THEN CONCAT(' - ', ra.shift_end_time) ELSE '' END), '')) AS label,
          COALESCE(NULLIF(sm.shift_name, ''), NULLIF(CONCAT(COALESCE(ra.shift_start_time, ''), CASE WHEN ra.shift_end_time IS NOT NULL AND ra.shift_end_time <> '' THEN CONCAT(' - ', ra.shift_end_time) ELSE '' END), '')) AS value
         FROM wfm_roster_assignment ra
         JOIN employees e ON e.id = ra.employee_id
         LEFT JOIN wfm_shift_master sm ON sm.id = ra.shift_id
         WHERE ra.roster_date = ?
           AND e.active_status = 1
           AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
           ${branchWhere}
           ${processWhere}
           AND COALESCE(NULLIF(sm.shift_name, ''), NULLIF(CONCAT(COALESCE(ra.shift_start_time, ''), CASE WHEN ra.shift_end_time IS NOT NULL AND ra.shift_end_time <> '' THEN CONCAT(' - ', ra.shift_end_time) ELSE '' END), '')) <> ''
         ORDER BY label ASC`,
      [shiftDate, ...scopeParams],
    ).catch(() => [[] as RowDataPacket[], []]),
  ]);

  const mapRows = (value: any) => (value[0] as any[]).filter((row) => row?.value && row?.label);
  return {
    branches: mapRows(branchRows),
    processes: mapRows(processRows),
    departments: mapRows(departmentRows),
    designations: mapRows(designationRows),
    managers: mapRows(managerRows),
    shifts: mapRows(shiftRows),
    statuses: STATUS_OPTIONS.map((status) => ({ value: status, label: status })),
    breakReasons: BREAK_REASONS.map((reason) => ({ value: reason, label: reason })),
  };
}

async function getEmployeeContext(employeeId: string): Promise<EmployeeContext | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.id,
        e.employee_code,
        e.branch_id,
        e.process_id,
        e.department_id,
        e.reporting_manager_id AS manager_id,
        COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name
      FROM employees e
      WHERE e.id = ?
        AND e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
      LIMIT 1`,
    [employeeId],
  );
  return ((rows as any[])[0] ?? null) as EmployeeContext | null;
}

export const breakManagementService = {
  async validatePublicKioskAccess(kioskCode: string, token: string, req: Request) {
    return validateKiosk(kioskCode, token, req);
  },

  async getDeskBootstrap(kioskCode: string, token: string, req: Request, date?: string | null) {
    const kiosk = await validateKiosk(kioskCode, token, req);
    const rows = await fetchDeskRows(kiosk, { date: date ?? undefined, limit: 500 }, true);
    return {
      kiosk: {
        kiosk_code: kiosk.kiosk_code,
        kiosk_name: kiosk.kiosk_name,
        branch_name: kiosk.branch_name,
        process_name: kiosk.process_name,
        branch_id: kiosk.branch_id,
        process_id: kiosk.process_id,
      },
      shift_date: rows.shiftDate,
      last_sync_time: rows.lastSyncTime,
      counters: rows.counters,
      settings: rows.settings,
      filters: await filterOptionsForKiosk(kiosk, rows.shiftDate),
    };
  },

  async listDeskEmployees(kioskCode: string, token: string, req: Request, filters: DeskFilters) {
    const kiosk = await validateKiosk(kioskCode, token, req);
    const data = await fetchDeskRows(kiosk, filters, false, false);
    return {
      shift_date: data.shiftDate,
      last_sync_time: data.lastSyncTime,
      counters: data.counters,
      employees: data.employees,
    };
  },

  async startBreak(kioskCode: string, token: string, req: Request, payload: {
    employee_id: string;
    break_reason: string;
    exception_reason?: string | null;
    manager_approval_required?: boolean;
    date?: string | null;
  }) {
    const kiosk = await validateKiosk(kioskCode, token, req);
    const employee = await getEmployeeContext(payload.employee_id);
    if (!employee) throw new Error("Employee not found or inactive");
    assertEmployeeWithinKioskScope(kiosk, employee);

    const shiftDate = resolveShiftDate(payload.date ?? null);
    const settings = await getSettings(employee.branch_id ?? kiosk.branch_id, employee.process_id ?? kiosk.process_id);
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM break_sessions WHERE employee_id = ? AND shift_date = ? AND status = 'ACTIVE' LIMIT 1`,
      [employee.id, shiftDate],
    );
    if ((existingRows as any[]).length > 0) throw new Error("This employee already has an active break");

    const biometric = await getBiometricSnapshot(employee.id, employee.employee_code, shiftDate);
    const usage = await getBreakUsageSummary(employee.id, shiftDate);
    if (!biometric.punchIn && !Number(settings.allow_break_without_biometric ?? 0)) {
      throw new Error("No biometric punch found. Exception start is disabled for this kiosk.");
    }
    if (!biometric.punchIn && Number(settings.require_exception_reason ?? 1) && !String(payload.exception_reason ?? "").trim()) {
      throw new Error("Exception reason is required when biometric punch is missing");
    }
    if (usage.totalBreakMinutes >= Number(settings.daily_total_allowed_minutes ?? HARD_MAX_DAILY_BREAK_MINUTES)) {
      throw new Error(`Daily break limit of ${settings.daily_total_allowed_minutes} minutes has already been used`);
    }

    const now = currentIstDateTime().dateTime;
    const sessionId = randomUUID();
    await db.execute(
      `INSERT INTO break_sessions
         (id, employee_id, employee_code, branch_id, process_id, department_id, manager_id,
          shift_date, break_start_time, break_reason, status, start_source, kiosk_device_id,
          biometric_punch_in_time, biometric_punch_out_time, no_biometric_punch_flag,
          exception_reason, manager_approval_required)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'KIOSK', ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        employee.id,
        employee.employee_code,
        employee.branch_id ?? kiosk.branch_id,
        employee.process_id ?? kiosk.process_id,
        employee.department_id ?? null,
        employee.manager_id ?? null,
        shiftDate,
        now,
        payload.break_reason,
        kiosk.id,
        biometric.punchIn,
        biometric.punchOut,
        biometric.punchIn ? 0 : 1,
        payload.exception_reason?.trim() || null,
        payload.manager_approval_required || !biometric.punchIn ? 1 : 0,
      ],
    );

    await rebuildDailySummary(
      employee.id,
      employee.employee_code,
      shiftDate,
      employee.branch_id ?? kiosk.branch_id,
      employee.process_id ?? kiosk.process_id,
      employee.manager_id ?? null,
    );

    await writeBreakAudit({
      entityType: "break_session",
      entityId: sessionId,
      action: "START_BREAK",
      employeeId: employee.id,
      performedByType: "KIOSK",
      kioskDeviceId: kiosk.id,
      newValue: {
        break_reason: payload.break_reason,
        no_biometric_punch_flag: !biometric.punchIn,
        exception_reason: payload.exception_reason ?? null,
      },
      req,
    });

    const latestEmployee = await fetchSingleDeskEmployee(kiosk, employee.id, shiftDate, true);
    return {
      session_id: sessionId,
      shift_date: shiftDate,
      employee: latestEmployee,
    };
  },

  async endBreak(kioskCode: string, token: string, req: Request, payload: {
    break_session_id?: string | null;
    employee_id: string;
    date?: string | null;
  }) {
    const kiosk = await validateKiosk(kioskCode, token, req);
    const shiftDate = resolveShiftDate(payload.date ?? null);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT *
         FROM break_sessions
        WHERE employee_id = ?
          AND shift_date = ?
          AND status = 'ACTIVE'
          ${payload.break_session_id ? "AND id = ?" : ""}
        ORDER BY break_start_time DESC
        LIMIT 1`,
      payload.break_session_id
        ? [payload.employee_id, shiftDate, payload.break_session_id]
        : [payload.employee_id, shiftDate],
    );
    const session = (rows as any[])[0];
    if (!session) throw new Error("No active break found for this employee");

    const employee = await getEmployeeContext(payload.employee_id);
    if (!employee) throw new Error("Employee not found");
    assertEmployeeWithinKioskScope(kiosk, employee);
    const settings = await getSettings(employee.branch_id ?? kiosk.branch_id, employee.process_id ?? kiosk.process_id);
    const endedAt = currentIstDateTime().dateTime;
    const duration = minutesBetween(String(session.break_start_time), endedAt);
    const breakType = classifyBreak(duration.minutes, settings);
    const biometric = await getBiometricSnapshot(employee.id, employee.employee_code, shiftDate);
    const usage = await getBreakUsageSummary(employee.id, shiftDate);
    const completedStatus = resolveCompletedBreakStatus({
      durationMinutes: duration.minutes,
      totalBreakMinutesAfterClose: usage.totalBreakMinutes + duration.minutes,
      noBiometricPunchFlag: Boolean(session.no_biometric_punch_flag),
      settings,
    });

    await db.execute(
      `UPDATE break_sessions
          SET break_end_time = ?,
              duration_seconds = ?,
              duration_minutes = ?,
              break_type = ?,
              status = ?,
              end_source = 'KIOSK',
              biometric_punch_out_time = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        endedAt,
        duration.seconds,
        duration.minutes,
        breakType,
        completedStatus,
        biometric.punchOut,
        session.id,
      ],
    );

    await rebuildDailySummary(
      employee.id,
      employee.employee_code,
      shiftDate,
      employee.branch_id ?? kiosk.branch_id,
      employee.process_id ?? kiosk.process_id,
      employee.manager_id ?? null,
    );
    await sendBreakAlertIfNeeded(session.id);

    await writeBreakAudit({
      entityType: "break_session",
      entityId: session.id,
      action: "END_BREAK",
      employeeId: employee.id,
      performedByType: "KIOSK",
      kioskDeviceId: kiosk.id,
      oldValue: { status: "ACTIVE" },
      newValue: {
        break_end_time: endedAt,
        duration_minutes: duration.minutes,
        break_type: breakType,
      },
      req,
    });

    const latestEmployee = await fetchSingleDeskEmployee(kiosk, employee.id, shiftDate, true);
    return {
      session_id: session.id,
      shift_date: shiftDate,
      duration_minutes: duration.minutes,
      break_type: breakType,
      employee: latestEmployee,
    };
  },

  async punchIn(kioskCode: string, token: string, req: Request, payload: {
    employee_id: string;
    date?: string | null;
  }) {
    const kiosk = await validateKiosk(kioskCode, token, req);
    const employee = await getEmployeeContext(payload.employee_id);
    if (!employee) throw new Error("Employee not found or inactive");
    assertEmployeeWithinKioskScope(kiosk, employee);
    const shiftDate = resolveShiftDate(payload.date ?? null);
    const result = await recordManualDeskPunch(employee, shiftDate, "IN");
    await rebuildDailySummary(
      employee.id,
      employee.employee_code,
      shiftDate,
      employee.branch_id ?? kiosk.branch_id,
      employee.process_id ?? kiosk.process_id,
      employee.manager_id ?? null,
    );
    await writeBreakAudit({
      entityType: "attendance_manual_punch",
      entityId: randomUUID(),
      action: "PUNCH_IN",
      employeeId: employee.id,
      performedByType: "KIOSK",
      kioskDeviceId: kiosk.id,
      newValue: { punch_in_time: result.actionTime, source: "manual_kiosk" },
      req,
    });
    const latestEmployee = await fetchSingleDeskEmployee(kiosk, employee.id, shiftDate, true);
    return {
      shift_date: shiftDate,
      action_time: result.actionTime,
      employee: latestEmployee,
    };
  },

  async punchOut(kioskCode: string, token: string, req: Request, payload: {
    employee_id: string;
    date?: string | null;
  }) {
    const kiosk = await validateKiosk(kioskCode, token, req);
    const employee = await getEmployeeContext(payload.employee_id);
    if (!employee) throw new Error("Employee not found or inactive");
    assertEmployeeWithinKioskScope(kiosk, employee);
    const shiftDate = resolveShiftDate(payload.date ?? null);
    const result = await recordManualDeskPunch(employee, shiftDate, "OUT");
    await rebuildDailySummary(
      employee.id,
      employee.employee_code,
      shiftDate,
      employee.branch_id ?? kiosk.branch_id,
      employee.process_id ?? kiosk.process_id,
      employee.manager_id ?? null,
    );
    await writeBreakAudit({
      entityType: "attendance_manual_punch",
      entityId: randomUUID(),
      action: "PUNCH_OUT",
      employeeId: employee.id,
      performedByType: "KIOSK",
      kioskDeviceId: kiosk.id,
      newValue: { punch_out_time: result.actionTime, source: "manual_kiosk" },
      req,
    });
    const latestEmployee = await fetchSingleDeskEmployee(kiosk, employee.id, shiftDate, true);
    return {
      shift_date: shiftDate,
      action_time: result.actionTime,
      employee: latestEmployee,
    };
  },

  async getLiveStatus(kioskCode: string, token: string, req: Request, filters: DeskFilters) {
    const kiosk = await validateKiosk(kioskCode, token, req);
    const data = await fetchDeskRows(kiosk, filters, false, true);
    return {
      shift_date: data.shiftDate,
      last_sync_time: data.lastSyncTime,
      counters: data.counters,
      employees: data.employees,
    };
  },

  async getDashboard(filters: { date?: string; branch_id?: string; process_id?: string }) {
    const shiftDate = resolveShiftDate(filters.date ?? null);
    const params: unknown[] = [shiftDate];
    let where = "WHERE bds.shift_date = ?";
    if (filters.branch_id) {
      where += " AND bds.branch_id = ?";
      params.push(filters.branch_id);
    }
    if (filters.process_id) {
      where += " AND bds.process_id = ?";
      params.push(filters.process_id);
    }

    const [summaryRows, topRows, managerRows] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT
            COUNT(*) AS total_employees_on_duty,
            SUM(final_status = 'On Break') AS currently_on_break,
            SUM(final_status = 'Break Exceeded') AS break_exceeded_now,
            SUM(mini_break_count) AS total_mini_breaks_today,
            SUM(long_break_count) AS total_long_breaks_today,
            SUM(total_break_minutes) AS total_break_minutes_today,
            ROUND(AVG(NULLIF(total_break_minutes, 0)), 2) AS average_break_duration,
            SUM(final_status = 'No Punch Found') AS no_biometric_punch_count,
            SUM(final_status = 'Shift Completed') AS shift_completed
           FROM break_daily_summary bds
           ${where}`,
        params,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
            bds.employee_id,
            bds.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
            bds.total_break_minutes,
            bds.long_break_count
           FROM break_daily_summary bds
           JOIN employees e ON e.id = bds.employee_id
           ${where}
           ORDER BY bds.total_break_minutes DESC, bds.long_break_count DESC
           LIMIT 10`,
        params,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
            COALESCE(NULLIF(TRIM(mgr.full_name), ''), TRIM(CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')))) AS manager_name,
            COUNT(bal.id) AS alert_count
           FROM break_alert_logs bal
           LEFT JOIN employees mgr ON mgr.id = bal.manager_id
           LEFT JOIN break_sessions bs ON bs.id = bal.break_session_id
          WHERE bs.shift_date = ?
          GROUP BY manager_name
          ORDER BY alert_count DESC
          LIMIT 10`,
        [shiftDate],
      ),
    ]);

    return {
      shift_date: shiftDate,
      summary: (summaryRows[0] as any[])[0] ?? {},
      top_employees: topRows[0] ?? [],
      manager_alerts: managerRows[0] ?? [],
    };
  },

  async getReports(filters: {
    date_from?: string;
    date_to?: string;
    branch_id?: string;
    process_id?: string;
    department_id?: string;
    manager_id?: string;
    employee_id?: string;
    break_type?: string;
    exception_status?: string;
    status?: string;
    limit?: number;
  }) {
    const where: string[] = ["bs.shift_date BETWEEN ? AND ?"];
    const params: unknown[] = [
      resolveShiftDate(filters.date_from ?? null),
      resolveShiftDate(filters.date_to ?? filters.date_from ?? null),
    ];
    if (filters.branch_id) { where.push("bs.branch_id = ?"); params.push(filters.branch_id); }
    if (filters.process_id) { where.push("bs.process_id = ?"); params.push(filters.process_id); }
    if (filters.department_id) { where.push("bs.department_id = ?"); params.push(filters.department_id); }
    if (filters.manager_id) { where.push("bs.manager_id = ?"); params.push(filters.manager_id); }
    if (filters.employee_id) { where.push("bs.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.break_type) { where.push("bs.break_type = ?"); params.push(filters.break_type); }
    if (filters.status) { where.push("bs.status = ?"); params.push(filters.status); }
    if (filters.exception_status === "yes") where.push("bs.no_biometric_punch_flag = 1");
    if (filters.exception_status === "no") where.push("bs.no_biometric_punch_flag = 0");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          bs.*,
          COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
          bm.branch_name,
          pm.process_name,
          dm.dept_name AS department_name,
          COALESCE(NULLIF(TRIM(mgr.full_name), ''), TRIM(CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')))) AS manager_name
         FROM break_sessions bs
         JOIN employees e ON e.id = bs.employee_id
         LEFT JOIN branch_master bm ON bm.id = bs.branch_id
         LEFT JOIN process_master pm ON pm.id = bs.process_id
         LEFT JOIN department_master dm ON dm.id = bs.department_id
         LEFT JOIN employees mgr ON mgr.id = bs.manager_id
        WHERE ${where.join(" AND ")}
        ORDER BY bs.shift_date DESC, bs.break_start_time DESC
        LIMIT ${safeLimit(filters.limit ?? 200, 200)}`,
      params,
    );
    return { rows };
  },

  async getSettingsView() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM break_settings ORDER BY (branch_id IS NULL) DESC, (process_id IS NULL) DESC, updated_at DESC`,
    );
    return { rows };
  },

  async listKioskDevices(filters: {
    search?: string;
    branch_id?: string;
    process_id?: string;
    status?: "active" | "inactive" | "all";
    limit?: number;
  }) {
    const where: string[] = ["1 = 1"];
    const params: unknown[] = [];

    if (filters.search?.trim()) {
      const query = `%${filters.search.trim()}%`;
      where.push("(kd.kiosk_code LIKE ? OR kd.kiosk_name LIKE ? OR bm.branch_name LIKE ? OR pm.process_name LIKE ?)");
      params.push(query, query, query, query);
    }
    if (filters.branch_id) {
      where.push("kd.branch_id = ?");
      params.push(filters.branch_id);
    }
    if (filters.process_id) {
      where.push("(kd.process_id = ? OR JSON_CONTAINS(COALESCE(kd.allowed_process_ids, JSON_ARRAY()), JSON_QUOTE(?)))");
      params.push(filters.process_id, filters.process_id);
    }
    if (filters.status === "active") where.push("kd.is_active = 1");
    if (filters.status === "inactive") where.push("kd.is_active = 0");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          kd.id,
          kd.kiosk_code,
          kd.kiosk_name,
          kd.branch_id,
          kd.process_id,
          kd.allowed_process_ids,
          kd.allowed_ip_list,
          kd.allowed_device_fingerprints,
          kd.is_active,
          kd.last_used_at,
          kd.created_by,
          kd.created_at,
          kd.updated_at,
          bm.branch_name,
          pm.process_name,
          (
            SELECT GROUP_CONCAT(pm2.process_name ORDER BY pm2.process_name SEPARATOR ', ')
              FROM process_master pm2
             WHERE COALESCE(pm2.active_status, 1) = 1
               AND JSON_CONTAINS(kd.allowed_process_ids, JSON_QUOTE(pm2.id))
          ) AS allowed_process_names,
          COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), ''), au.email) AS created_by_name,
          (
            SELECT COUNT(*)
              FROM employees e
             WHERE e.active_status = 1
               AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
               AND (kd.branch_id IS NULL OR e.branch_id = kd.branch_id)
               AND (
                 JSON_LENGTH(COALESCE(kd.allowed_process_ids, JSON_ARRAY())) = 0
                 OR JSON_CONTAINS(kd.allowed_process_ids, JSON_QUOTE(e.process_id))
               )
          ) AS scoped_employee_count
         FROM break_kiosk_devices kd
         LEFT JOIN branch_master bm ON bm.id = kd.branch_id
         LEFT JOIN process_master pm ON pm.id = kd.process_id
         LEFT JOIN auth_user au ON au.id = kd.created_by
         LEFT JOIN employees u ON u.user_id = au.id
        WHERE ${where.join(" AND ")}
        ORDER BY kd.is_active DESC, kd.updated_at DESC
        LIMIT ${safeLimit(filters.limit ?? 100, 100)}`,
      params,
    );

    return {
      rows: (rows as any[]).map((row) => ({
        ...row,
        allowed_process_ids: normalizeJsonArray(row.allowed_process_ids),
        allowed_ip_list: normalizeJsonArray(row.allowed_ip_list),
        allowed_device_fingerprints: normalizeJsonArray(row.allowed_device_fingerprints),
        token_configured: true,
        desk_url: `/break-desk?kiosk=${encodeURIComponent(String(row.kiosk_code ?? ""))}`,
      })),
    };
  },

  async exportKioskDevices(filters: {
    search?: string;
    branch_id?: string;
    process_id?: string;
    status?: "active" | "inactive" | "all";
    mode?: "summary" | "detailed";
    limit?: number;
  }) {
    const mode = filters.mode === "summary" ? "summary" : "detailed";
    const kioskData = await this.listKioskDevices({ ...filters, limit: safeLimit(filters.limit ?? 250, 250) });
    const generatedAtIst = currentIstDateTime().dateTime;
    const generatedOnDate = currentIstDateTime().date;

    if (mode === "summary") {
      const rows = kioskData.rows.map((row: any) => ({
        report_generated_at_ist: generatedAtIst,
        kiosk_code: row.kiosk_code,
        kiosk_name: row.kiosk_name,
        kiosk_status: row.is_active ? "Active" : "Inactive",
        mapping_status: row.branch_id && (row.allowed_process_ids?.length || row.process_id) ? "Branch + Process locked" : "Mapping incomplete",
        branch_name: row.branch_name ?? "",
        primary_process_name: row.process_name ?? "",
        allowed_process_names: row.allowed_process_names ?? "",
        scoped_employee_count: Number(row.scoped_employee_count ?? 0),
        allowed_ip_count: Array.isArray(row.allowed_ip_list) ? row.allowed_ip_list.length : 0,
        allowed_ip_list: row.allowed_ip_list ?? [],
        device_lock_count: Array.isArray(row.allowed_device_fingerprints) ? row.allowed_device_fingerprints.length : 0,
        device_fingerprints: row.allowed_device_fingerprints ?? [],
        last_used_at_ist: formatCsvDateTime(row.last_used_at),
        created_by_name: row.created_by_name ?? "",
        desk_url: row.desk_url ?? "",
      }));
      return {
        fileName: `break-desk-kiosk-summary-${generatedOnDate}.csv`,
        csv: buildCsv([
          "report_generated_at_ist",
          "kiosk_code",
          "kiosk_name",
          "kiosk_status",
          "mapping_status",
          "branch_name",
          "primary_process_name",
          "allowed_process_names",
          "scoped_employee_count",
          "allowed_ip_count",
          "allowed_ip_list",
          "device_lock_count",
          "device_fingerprints",
          "last_used_at_ist",
          "created_by_name",
          "desk_url",
        ], rows),
      };
    }

    const kioskIds = kioskData.rows.map((row: any) => String(row.id ?? "")).filter(Boolean);
    const employeeRowsByKiosk = new Map<string, any[]>();

    if (kioskIds.length > 0) {
      const placeholders = kioskIds.map(() => "?").join(", ");
      const [employeeRows] = await db.execute<RowDataPacket[]>(
        `SELECT
            kd.id AS kiosk_id,
            kd.kiosk_code,
            kd.kiosk_name,
            kd.is_active,
            bm.branch_name AS kiosk_branch_name,
            pm.process_name AS primary_process_name,
            (
              SELECT GROUP_CONCAT(pm2.process_name ORDER BY pm2.process_name SEPARATOR ', ')
                FROM process_master pm2
               WHERE COALESCE(pm2.active_status, 1) = 1
                 AND JSON_CONTAINS(kd.allowed_process_ids, JSON_QUOTE(pm2.id))
            ) AS allowed_process_names,
            COALESCE(NULLIF(TRIM(e.full_name), ''), NULLIF(TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), '')) AS employee_name,
            e.employee_code,
            e.branch_id AS employee_branch_id,
            eb.branch_name AS employee_branch_name,
            e.process_id AS employee_process_id,
            ep.process_name AS employee_process_name,
            e.department_id,
            dm.dept_name AS department_name,
            e.reporting_manager_id AS manager_id,
            COALESCE(NULLIF(TRIM(mgr.full_name), ''), NULLIF(TRIM(CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, ''))), '')) AS manager_name,
            e.employment_status,
            e.active_status
         FROM break_kiosk_devices kd
         LEFT JOIN branch_master bm ON bm.id = kd.branch_id
         LEFT JOIN process_master pm ON pm.id = kd.process_id
         LEFT JOIN employees e
           ON e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
          AND (kd.branch_id IS NULL OR e.branch_id = kd.branch_id)
          AND (
            JSON_LENGTH(COALESCE(kd.allowed_process_ids, JSON_ARRAY())) = 0
            OR JSON_CONTAINS(kd.allowed_process_ids, JSON_QUOTE(e.process_id))
          )
         LEFT JOIN branch_master eb ON eb.id = e.branch_id
         LEFT JOIN process_master ep ON ep.id = e.process_id
         LEFT JOIN department_master dm ON dm.id = e.department_id
         LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
        WHERE kd.id IN (${placeholders})
        ORDER BY kd.kiosk_code ASC, employee_name ASC, e.employee_code ASC`,
        kioskIds,
      );

      for (const row of employeeRows as any[]) {
        const kioskId = String(row.kiosk_id ?? "");
        const bucket = employeeRowsByKiosk.get(kioskId) ?? [];
        bucket.push(row);
        employeeRowsByKiosk.set(kioskId, bucket);
      }
    }

    const detailedRows: Array<Record<string, unknown>> = [];
    for (const kiosk of kioskData.rows as any[]) {
      const scopedEmployees = employeeRowsByKiosk.get(String(kiosk.id)) ?? [];
      if (scopedEmployees.length === 0) {
        detailedRows.push({
          report_generated_at_ist: generatedAtIst,
          kiosk_code: kiosk.kiosk_code,
          kiosk_name: kiosk.kiosk_name,
          kiosk_status: kiosk.is_active ? "Active" : "Inactive",
          branch_name: kiosk.branch_name ?? "",
          allowed_process_names: kiosk.allowed_process_names ?? kiosk.process_name ?? "",
          scoped_employee_count: Number(kiosk.scoped_employee_count ?? 0),
          employee_in_scope: "No",
          employee_code: "",
          employee_name: "",
          employee_branch_name: "",
          employee_process_name: "",
          department_name: "",
          manager_name: "",
          employment_status: "",
          employee_active_status: "",
          allowed_ip_list: kiosk.allowed_ip_list ?? [],
          device_fingerprints: kiosk.allowed_device_fingerprints ?? [],
          last_used_at_ist: formatCsvDateTime(kiosk.last_used_at),
          desk_url: kiosk.desk_url ?? "",
        });
        continue;
      }

      for (const scoped of scopedEmployees) {
        detailedRows.push({
          report_generated_at_ist: generatedAtIst,
          kiosk_code: kiosk.kiosk_code,
          kiosk_name: kiosk.kiosk_name,
          kiosk_status: kiosk.is_active ? "Active" : "Inactive",
          branch_name: scoped.kiosk_branch_name ?? kiosk.branch_name ?? "",
          allowed_process_names: scoped.allowed_process_names ?? kiosk.allowed_process_names ?? kiosk.process_name ?? "",
          scoped_employee_count: Number(kiosk.scoped_employee_count ?? 0),
          employee_in_scope: scoped.employee_code ? "Yes" : "No",
          employee_code: scoped.employee_code ?? "",
          employee_name: scoped.employee_name ?? "",
          employee_branch_name: scoped.employee_branch_name ?? "",
          employee_process_name: scoped.employee_process_name ?? "",
          department_name: scoped.department_name ?? "",
          manager_name: scoped.manager_name ?? "",
          employment_status: scoped.employment_status ?? "",
          employee_active_status: Number(scoped.active_status ?? 0) ? "Active" : "Inactive",
          allowed_ip_list: kiosk.allowed_ip_list ?? [],
          device_fingerprints: kiosk.allowed_device_fingerprints ?? [],
          last_used_at_ist: formatCsvDateTime(kiosk.last_used_at),
          desk_url: kiosk.desk_url ?? "",
        });
      }
    }

    return {
      fileName: `break-desk-kiosk-detailed-${generatedOnDate}.csv`,
      csv: buildCsv([
        "report_generated_at_ist",
        "kiosk_code",
        "kiosk_name",
        "kiosk_status",
        "branch_name",
        "allowed_process_names",
        "scoped_employee_count",
        "employee_in_scope",
        "employee_code",
        "employee_name",
        "employee_branch_name",
        "employee_process_name",
        "department_name",
        "manager_name",
        "employment_status",
        "employee_active_status",
        "allowed_ip_list",
        "device_fingerprints",
        "last_used_at_ist",
        "desk_url",
      ], detailedRows),
    };
  },

  async createKioskDevice(input: Record<string, unknown>, performedById: string, req: Request) {
    const id = randomUUID();
    const token = String(input.token ?? generateDeskToken()).trim();
    const branchId = String(input.branch_id ?? "") || null;
    const allowedProcessIds = normalizeStringArrayInput(input.allowed_process_ids);
    const processId = String(input.process_id ?? allowedProcessIds[0] ?? "") || null;
    const allowedIps = normalizeStringArrayInput(input.allowed_ip_list);
    const allowedFingerprints = normalizeStringArrayInput(input.allowed_device_fingerprints);

    await db.execute(
      `INSERT INTO break_kiosk_devices
         (id, kiosk_code, kiosk_name, branch_id, process_id, token_hash,
          allowed_process_ids, allowed_ip_list, allowed_device_fingerprints, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(input.kiosk_code).trim().toUpperCase(),
        String(input.kiosk_name).trim(),
        branchId,
        processId,
        hashToken(token),
        JSON.stringify(allowedProcessIds.length > 0 ? allowedProcessIds : (processId ? [processId] : [])),
        JSON.stringify(allowedIps),
        JSON.stringify(allowedFingerprints),
        input.is_active === false ? 0 : 1,
        performedById,
      ],
    );

    await writeBreakAudit({
      entityType: "break_kiosk_device",
      entityId: id,
      action: "CREATE_BREAK_KIOSK",
      performedByType: "ADMIN",
      performedById,
      newValue: {
        kiosk_code: String(input.kiosk_code).trim().toUpperCase(),
        kiosk_name: String(input.kiosk_name).trim(),
        branch_id: branchId,
        process_id: processId,
        allowed_process_ids: allowedProcessIds.length > 0 ? allowedProcessIds : (processId ? [processId] : []),
        allowed_ip_list: allowedIps,
        allowed_device_fingerprints: allowedFingerprints,
        is_active: input.is_active !== false,
      },
      req,
    });

    return {
      id,
      kiosk_code: String(input.kiosk_code).trim().toUpperCase(),
      token,
      desk_url: `/break-desk?kiosk=${encodeURIComponent(String(input.kiosk_code).trim().toUpperCase())}&token=${encodeURIComponent(token)}`,
    };
  },

  async updateKioskDevice(id: string, input: Record<string, unknown>, performedById: string, req: Request) {
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM break_kiosk_devices WHERE id = ? LIMIT 1`,
      [id],
    );
    const existing = (existingRows as any[])[0];
    if (!existing) throw new Error("Break desk ID not found");

    const branchId = String(input.branch_id ?? "") || null;
    const allowedProcessIds = normalizeStringArrayInput(input.allowed_process_ids);
    const processId = String(input.process_id ?? allowedProcessIds[0] ?? "") || null;
    const allowedIps = normalizeStringArrayInput(input.allowed_ip_list);
    const allowedFingerprints = normalizeStringArrayInput(input.allowed_device_fingerprints);

    await db.execute(
      `UPDATE break_kiosk_devices
          SET kiosk_code = ?,
              kiosk_name = ?,
              branch_id = ?,
              process_id = ?,
              allowed_process_ids = ?,
              allowed_ip_list = ?,
              allowed_device_fingerprints = ?,
              is_active = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        String(input.kiosk_code).trim().toUpperCase(),
        String(input.kiosk_name).trim(),
        branchId,
        processId,
        JSON.stringify(allowedProcessIds.length > 0 ? allowedProcessIds : (processId ? [processId] : [])),
        JSON.stringify(allowedIps),
        JSON.stringify(allowedFingerprints),
        input.is_active === false ? 0 : 1,
        id,
      ],
    );

    await writeBreakAudit({
      entityType: "break_kiosk_device",
      entityId: id,
      action: "UPDATE_BREAK_KIOSK",
      performedByType: "ADMIN",
      performedById,
      oldValue: {
        kiosk_code: existing.kiosk_code,
        kiosk_name: existing.kiosk_name,
        branch_id: existing.branch_id,
        process_id: existing.process_id,
        allowed_process_ids: normalizeJsonArray(existing.allowed_process_ids),
        allowed_ip_list: normalizeJsonArray(existing.allowed_ip_list),
        allowed_device_fingerprints: normalizeJsonArray(existing.allowed_device_fingerprints),
        is_active: Boolean(existing.is_active),
      },
      newValue: {
        kiosk_code: String(input.kiosk_code).trim().toUpperCase(),
        kiosk_name: String(input.kiosk_name).trim(),
        branch_id: branchId,
        process_id: processId,
        allowed_process_ids: allowedProcessIds.length > 0 ? allowedProcessIds : (processId ? [processId] : []),
        allowed_ip_list: allowedIps,
        allowed_device_fingerprints: allowedFingerprints,
        is_active: input.is_active !== false,
      },
      req,
    });

    return { id };
  },

  async rotateKioskToken(id: string, tokenInput: string | undefined, performedById: string, req: Request) {
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, kiosk_code FROM break_kiosk_devices WHERE id = ? LIMIT 1`,
      [id],
    );
    const existing = (existingRows as any[])[0];
    if (!existing) throw new Error("Break desk ID not found");

    const token = String(tokenInput ?? generateDeskToken()).trim();
    await db.execute(
      `UPDATE break_kiosk_devices
          SET token_hash = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [hashToken(token), id],
    );

    await writeBreakAudit({
      entityType: "break_kiosk_device",
      entityId: id,
      action: "ROTATE_BREAK_KIOSK_TOKEN",
      performedByType: "ADMIN",
      performedById,
      newValue: { kiosk_code: existing.kiosk_code, token_rotated: true },
      req,
    });

    return {
      id,
      kiosk_code: existing.kiosk_code,
      token,
      desk_url: `/break-desk?kiosk=${encodeURIComponent(String(existing.kiosk_code ?? ""))}&token=${encodeURIComponent(token)}`,
    };
  },

  async deleteKioskDevice(id: string, performedById: string, req: Request) {
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM break_kiosk_devices WHERE id = ? LIMIT 1`,
      [id],
    );
    const existing = (existingRows as any[])[0];
    if (!existing) throw new Error("Break desk ID not found");

    const [activeRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active_count
         FROM break_sessions
        WHERE kiosk_device_id = ?
          AND status = 'ACTIVE'`,
      [id],
    );
    const activeCount = Number((activeRows as any[])[0]?.active_count ?? 0);
    if (activeCount > 0) {
      throw new Error("This desk ID cannot be deleted while active break sessions are running");
    }

    await db.execute(`DELETE FROM break_kiosk_devices WHERE id = ?`, [id]);

    await writeBreakAudit({
      entityType: "break_kiosk_device",
      entityId: id,
      action: "DELETE_BREAK_KIOSK",
      performedByType: "ADMIN",
      performedById,
      oldValue: {
        kiosk_code: existing.kiosk_code,
        kiosk_name: existing.kiosk_name,
        branch_id: existing.branch_id,
        process_id: existing.process_id,
        is_active: existing.is_active,
      },
      req,
    });

    return {
      id,
      kiosk_code: existing.kiosk_code,
    };
  },

  async saveSettings(input: Record<string, unknown>, performedById: string, req: Request) {
    const id = String(input.id ?? randomUUID());
    const branchId = String(input.branch_id ?? "") || null;
    const processId = String(input.process_id ?? "") || null;
    const normalizedInput = normalizeBreakSettings({
      id,
      branch_id: branchId,
      process_id: processId,
      mini_break_max_minutes: Number(input.mini_break_max_minutes ?? 10),
      long_break_min_minutes: Number(input.long_break_min_minutes ?? HARD_MAX_SINGLE_BREAK_MINUTES),
      active_break_alert_minutes: Number(input.active_break_alert_minutes ?? HARD_MAX_SINGLE_BREAK_MINUTES),
      daily_total_allowed_minutes: Number(input.daily_total_allowed_minutes ?? HARD_MAX_DAILY_BREAK_MINUTES),
      max_long_break_count: Number(input.max_long_break_count ?? 2),
      escalation_after_minutes: Number(input.escalation_after_minutes ?? 10),
      auto_close_on_biometric_punch_out: input.auto_close_on_biometric_punch_out ? 1 : 0,
      allow_break_without_biometric: input.allow_break_without_biometric ? 1 : 0,
      require_exception_reason: input.require_exception_reason !== false ? 1 : 0,
      alert_reporting_manager: input.alert_reporting_manager !== false ? 1 : 0,
      alert_hr: input.alert_hr ? 1 : 0,
      alert_wfm: input.alert_wfm ? 1 : 0,
      alert_cc_list_json: JSON.stringify(Array.isArray(input.alert_cc_list) ? input.alert_cc_list : []),
    } as BreakSettingsRow);
    await db.execute(
      `INSERT INTO break_settings
         (id, branch_id, process_id, mini_break_max_minutes, long_break_min_minutes,
          active_break_alert_minutes, daily_total_allowed_minutes, max_long_break_count,
          escalation_after_minutes, auto_close_on_biometric_punch_out, allow_break_without_biometric,
          require_exception_reason, alert_reporting_manager, alert_hr, alert_wfm, alert_cc_list_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         mini_break_max_minutes = VALUES(mini_break_max_minutes),
         long_break_min_minutes = VALUES(long_break_min_minutes),
         active_break_alert_minutes = VALUES(active_break_alert_minutes),
         daily_total_allowed_minutes = VALUES(daily_total_allowed_minutes),
         max_long_break_count = VALUES(max_long_break_count),
         escalation_after_minutes = VALUES(escalation_after_minutes),
         auto_close_on_biometric_punch_out = VALUES(auto_close_on_biometric_punch_out),
         allow_break_without_biometric = VALUES(allow_break_without_biometric),
         require_exception_reason = VALUES(require_exception_reason),
         alert_reporting_manager = VALUES(alert_reporting_manager),
         alert_hr = VALUES(alert_hr),
         alert_wfm = VALUES(alert_wfm),
         alert_cc_list_json = VALUES(alert_cc_list_json),
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        branchId,
        processId,
        normalizedInput.mini_break_max_minutes,
        normalizedInput.long_break_min_minutes,
        normalizedInput.active_break_alert_minutes,
        normalizedInput.daily_total_allowed_minutes,
        normalizedInput.max_long_break_count,
        normalizedInput.escalation_after_minutes,
        normalizedInput.auto_close_on_biometric_punch_out,
        normalizedInput.allow_break_without_biometric,
        normalizedInput.require_exception_reason,
        normalizedInput.alert_reporting_manager,
        normalizedInput.alert_hr,
        normalizedInput.alert_wfm,
        normalizedInput.alert_cc_list_json,
      ],
    );

    await writeBreakAudit({
      entityType: "break_settings",
      entityId: id,
      action: "UPSERT_BREAK_SETTINGS",
      performedByType: "ADMIN",
      performedById,
      newValue: normalizedInput,
      req,
    });

    return { id };
  },

  async getExceptions(filters: { date?: string; limit?: number }) {
    const shiftDate = resolveShiftDate(filters.date ?? null);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          bs.*,
          COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
          bm.branch_name,
          pm.process_name
         FROM break_sessions bs
         JOIN employees e ON e.id = bs.employee_id
         LEFT JOIN branch_master bm ON bm.id = bs.branch_id
         LEFT JOIN process_master pm ON pm.id = bs.process_id
        WHERE bs.shift_date = ?
          AND (bs.no_biometric_punch_flag = 1 OR bs.status = 'EXCEPTION')
        ORDER BY bs.break_start_time DESC
        LIMIT ${safeLimit(filters.limit ?? 100, 100)}`,
      [shiftDate],
    );
    return { shift_date: shiftDate, rows };
  },

  async syncBiometricNow() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(updated_at) AS last_sync_time, COUNT(*) AS imported_days FROM integration_biometric_daily`,
    ).catch(() => [[] as RowDataPacket[], []]);
    return {
      status: "accepted",
      message: "Break module linked to existing biometric sync pipeline. Current page refreshed from the latest imported biometric snapshot.",
      snapshot: (rows as any[])[0] ?? {},
    };
  },

  // Bulk action: Start breaks for multiple employees
  async bulkStartBreak(kiosk: string, token: string, req: any, body: { employee_ids: string[]; break_reason: string; date?: string }) {
    const { kioskData, shiftDate } = await this.validateKiosk(kiosk, token, body.date);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const results = [];

      for (const employeeId of body.employee_ids) {
        try {
          // Use existing startBreak logic for each employee
          const data = await this.startBreak(kiosk, token, req, {
            employee_id: employeeId,
            break_reason: body.break_reason,
            date: body.date,
          });
          results.push(data.employee);
        } catch (err) {
          // Continue with other employees if one fails
          console.error(`Failed to start break for employee ${employeeId}:`, err);
        }
      }

      await connection.commit();

      return {
        employees: results,
        count: results.length,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Bulk action: End breaks for multiple employees
  async bulkEndBreak(kiosk: string, token: string, req: any, body: { employee_ids: string[]; date?: string }) {
    const { kioskData, shiftDate } = await this.validateKiosk(kiosk, token, body.date);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const results = [];

      for (const employeeId of body.employee_ids) {
        try {
          const data = await this.endBreak(kiosk, token, req, {
            employee_id: employeeId,
            date: body.date,
          });
          results.push(data.employee);
        } catch (err) {
          console.error(`Failed to end break for employee ${employeeId}:`, err);
        }
      }

      await connection.commit();

      return {
        employees: results,
        count: results.length,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Bulk action: Punch in multiple employees
  async bulkPunchIn(kiosk: string, token: string, req: any, body: { employee_ids: string[]; date?: string }) {
    const { kioskData, shiftDate } = await this.validateKiosk(kiosk, token, body.date);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const results = [];

      for (const employeeId of body.employee_ids) {
        try {
          const data = await this.punchIn(kiosk, token, req, {
            employee_id: employeeId,
            date: body.date,
          });
          results.push(data.employee);
        } catch (err) {
          console.error(`Failed to punch in employee ${employeeId}:`, err);
        }
      }

      await connection.commit();

      return {
        employees: results,
        count: results.length,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Bulk action: Punch out multiple employees
  async bulkPunchOut(kiosk: string, token: string, req: any, body: { employee_ids: string[]; date?: string }) {
    const { kioskData, shiftDate } = await this.validateKiosk(kiosk, token, body.date);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const results = [];

      for (const employeeId of body.employee_ids) {
        try {
          const data = await this.punchOut(kiosk, token, req, {
            employee_id: employeeId,
            date: body.date,
          });
          results.push(data.employee);
        } catch (err) {
          console.error(`Failed to punch out employee ${employeeId}:`, err);
        }
      }

      await connection.commit();

      return {
        employees: results,
        count: results.length,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
