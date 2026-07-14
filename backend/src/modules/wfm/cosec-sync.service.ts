import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNcosecPool } from "../../db/ncosecDb.js";
import { attendanceEngineService } from "./attendance-engine.service.js";
import { assessAggregatePunches } from "./cosec-punch-interpretation.service.js";
import { tableExists } from "../../shared/dbHelpers.js";

export type PunchGroup = {
  cosecUserId: string;
  punchDate: string;
  firstPunch: string;
  lastPunch: string;
  totalPunches: number;
  workingMinutes: number;
  sourceSystem: string;
  sourceTable: string;
};

type SyncResult = {
  success: boolean;
  from: string;
  to: string;
  sourceTable: string;
  pulledEvents: number;
  groupedDays: number;
  migratedDays: number;
  unmappedUsers: Array<{ cosecUserId: string; punchDate: string; totalPunches: number }>;
  failed: Array<{ cosecUserId: string; punchDate: string; error: string }>;
};

let lastSyncResult: SyncResult | null = null;
let running = false;

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for COSEC sync`);
  return value;
}

function assertIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} contains unsafe characters`);
  }
  return value;
}

function quoteTable(tableName: string): string {
  const parts = tableName.split(".").map((part) => assertIdentifier(part.trim(), "COSEC table name"));
  return parts.map((part) => `[${part}]`).join(".");
}

function quoteColumn(columnName: string): string {
  return `[${assertIdentifier(columnName, "COSEC column name")}]`;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Always derive calendar dates in IST — COSEC stores wall-clock IST times, so
// using UTC dates here would shift the sync window by up to ±5h30m.
function toISTDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function defaultFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toISTDateString(date);
}

function defaultToDate(): string {
  return toISTDateString(new Date());
}

function normalizeDateInput(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function getConfig() {
  return {
    host: requiredEnv("NCOSEC_DB_HOST"),
    port: numberEnv("NCOSEC_DB_PORT", 1433),
    user: requiredEnv("NCOSEC_DB_USER"),
    password: requiredEnv("NCOSEC_DB_PASSWORD"),
    database: process.env.NCOSEC_DB_NAME?.trim() || "NCOSEC",
    encrypt: boolEnv("NCOSEC_DB_ENCRYPT", false),
    trustServerCertificate: boolEnv("NCOSEC_DB_TRUST_CERT", true),
    table: process.env.NCOSEC_EVENT_TABLE?.trim() || "dbo.Mx_ATDEventTrn",
    userColumn: process.env.NCOSEC_USER_ID_COLUMN?.trim() || "UserID",
    datetimeColumn: process.env.NCOSEC_DATETIME_COLUMN?.trim() || "Edatetime",
    sourceMode: process.env.NCOSEC_SOURCE_MODE === "mssql" ? "mssql" : "mysql",
    batchDays: numberEnv("NCOSEC_SYNC_LOOKBACK_DAYS", 1),
  };
}

async function pullCosecAttendance(from: string, to: string): Promise<PunchGroup[]> {
  const cfg = getConfig();
  const table = quoteTable(cfg.table);
  const userColumn = quoteColumn(cfg.userColumn);
  const datetimeColumn = quoteColumn(cfg.datetimeColumn);
  const pool = await getNcosecPool();
  const request = pool.request();
  request.input("fromDate", sql.Date, from);
  request.input("toDate", sql.Date, to);
  const result = await request.query(`
      SELECT
        CAST(${userColumn} AS NVARCHAR(100)) AS user_id,
        CONVERT(CHAR(10), CAST(${datetimeColumn} AS DATE), 23) AS attendance_date,
        CONVERT(CHAR(19), MIN(${datetimeColumn}), 120) AS first_punch,
        CONVERT(CHAR(19), MAX(${datetimeColumn}), 120) AS last_punch,
        COUNT_BIG(*) AS total_punches,
        DATEDIFF(MINUTE, MIN(${datetimeColumn}), MAX(${datetimeColumn})) AS working_minutes
      FROM ${table}
      WHERE ${datetimeColumn} >= @fromDate
        AND ${datetimeColumn} < DATEADD(DAY, 1, @toDate)
        AND ${userColumn} IS NOT NULL
      GROUP BY ${userColumn}, CAST(${datetimeColumn} AS DATE)
      ORDER BY ${userColumn}, attendance_date
    `);
  return result.recordset
    .map((row: any) => ({
      cosecUserId: String(row.user_id ?? "").trim(),
      punchDate: String(row.attendance_date ?? "").trim(),
      firstPunch: String(row.first_punch ?? "").trim(),
      lastPunch: String(row.last_punch ?? "").trim(),
      totalPunches: Math.max(0, Number(row.total_punches ?? 0)),
      workingMinutes: Math.max(0, Number(row.working_minutes ?? 0)),
      sourceSystem: "cosec_sqlserver",
      sourceTable: cfg.table,
    }))
    .filter((row: PunchGroup) =>
      row.cosecUserId
      && /^\d{4}-\d{2}-\d{2}$/.test(row.punchDate)
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.firstPunch)
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.lastPunch)
      && Number.isFinite(row.totalPunches)
      && Number.isFinite(row.workingMinutes)
    );
}


async function pullMysqlAttendance(from: string, to: string): Promise<PunchGroup[]> {
  const groups = new Map<string, PunchGroup>();
  const add = (row: any, sourceSystem: string, sourceTable: string) => {
    const cosecUserId = String(row.user_id ?? "").trim();
    const punchDate = String(row.attendance_date ?? "").trim();
    const rawFirst = row.first_punch;
    const rawLast = row.last_punch;
    const firstPunch = rawFirst instanceof Date
      ? `${rawFirst.getFullYear()}-${String(rawFirst.getMonth()+1).padStart(2,"0")}-${String(rawFirst.getDate()).padStart(2,"0")} ${String(rawFirst.getHours()).padStart(2,"0")}:${String(rawFirst.getMinutes()).padStart(2,"0")}:${String(rawFirst.getSeconds()).padStart(2,"0")}`
      : String(rawFirst ?? "").trim();
    const lastPunch = rawLast instanceof Date
      ? `${rawLast.getFullYear()}-${String(rawLast.getMonth()+1).padStart(2,"0")}-${String(rawLast.getDate()).padStart(2,"0")} ${String(rawLast.getHours()).padStart(2,"0")}:${String(rawLast.getMinutes()).padStart(2,"0")}:${String(rawLast.getSeconds()).padStart(2,"0")}`
      : String(rawLast ?? "").trim();
    const totalPunches = Math.max(0, Number(row.total_punches ?? 0));
    const workingMinutes = Math.max(0, Number(row.working_minutes ?? 0));
    if (
      !cosecUserId
      || !/^\d{4}-\d{2}-\d{2}$/.test(punchDate)
      || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(firstPunch)
      || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(lastPunch)
    ) return;
    const key = `${cosecUserId}__${punchDate}`;
    if (!groups.has(key)) {
      groups.set(key, {
        cosecUserId,
        punchDate,
        firstPunch,
        lastPunch,
        totalPunches,
        workingMinutes,
        sourceSystem,
        sourceTable,
      });
    }
  };

  if (await tableExists("integration_biometric_daily")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code AS user_id,
              DATE_FORMAT(activity_date, '%Y-%m-%d') AS attendance_date,
              first_punch,
              last_punch,
              COALESCE(total_punches, CASE WHEN first_punch IS NULL THEN 0 WHEN first_punch = last_punch THEN 1 ELSE 2 END) AS total_punches,
              biometric_minutes AS working_minutes
         FROM integration_biometric_daily
        WHERE activity_date >= ?
          AND activity_date <= ?
          AND employee_code IS NOT NULL
        ORDER BY activity_date DESC, updated_at DESC`,
      [from, to],
    );
    for (const row of rows) add(row, "cosec_mysql", "mas_hrms.integration_biometric_daily");
  }

  if (await tableExists("wfm_external_punch_staging")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code AS user_id,
              DATE_FORMAT(MIN(DATE(punch_time)), '%Y-%m-%d') AS attendance_date,
              MIN(punch_time) AS first_punch,
              MAX(punch_time) AS last_punch,
              COUNT(*) AS total_punches,
              TIMESTAMPDIFF(MINUTE, MIN(punch_time), MAX(punch_time)) AS working_minutes
         FROM wfm_external_punch_staging
        WHERE DATE(punch_time) >= ?
          AND DATE(punch_time) <= ?
          AND employee_code IS NOT NULL
        GROUP BY employee_code, DATE(punch_time)`,
      [from, to],
    );
    for (const row of rows) add(row, "cosec_mysql", "mas_hrms.wfm_external_punch_staging");
  }

  if (await tableExists("stg_legacy_attendance")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code AS user_id,
              DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
              in_time AS first_punch,
              out_time AS last_punch,
              CASE WHEN in_time IS NULL THEN 0 WHEN in_time = out_time THEN 1 ELSE 2 END AS total_punches,
              COALESCE(ROUND(total_hours * 60), TIMESTAMPDIFF(MINUTE, in_time, out_time), 0) AS working_minutes
         FROM stg_legacy_attendance
        WHERE attendance_date >= ?
          AND attendance_date <= ?
          AND employee_code IS NOT NULL`,
      [from, to],
    );
    for (const row of rows) add(row, "cosec_mysql", "mas_hrms.stg_legacy_attendance");
  }

  return [...groups.values()];
}

async function resolveEmployee(cosecUserId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            e.employee_code,
            e.branch_id,
            e.process_id,
            b.branch_name,
            p.process_name
       FROM employees e
       LEFT JOIN employee_biometric_enrollment ebe
         ON ebe.employee_id = e.id
        AND ebe.is_active = 1
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE (
          ebe.cosec_user_id = ?
          OR e.biometric_code = ?
          OR e.employee_code = ?
        )
        AND e.active_status = 1
      ORDER BY CASE
        WHEN ebe.cosec_user_id = ? THEN 0
        WHEN e.biometric_code = ? THEN 1
        ELSE 2
      END
      LIMIT 1`,
    [cosecUserId, cosecUserId, cosecUserId, cosecUserId, cosecUserId],
  );
  return rows[0] as any | undefined;
}

// COSEC stores IST wall-clock times as bare "YYYY-MM-DD HH:mm:ss" strings.
// mysql2 pool timezone:"+05:30" only shifts JavaScript Date objects — bare
// string values are written to DATETIME columns as-is. Do not append "+05:30".
function tagIST(val: string): string {
  return val; // pass bare string through unchanged
}

async function migratePunchGroup(group: PunchGroup): Promise<"migrated" | "unmapped"> {
  const employee = await resolveEmployee(group.cosecUserId);
  if (!employee) return "unmapped";

  const assessed = assessAggregatePunches({
    firstPunch: group.firstPunch,
    lastPunch: group.lastPunch,
    totalPunches: group.totalPunches,
    workingMinutes: group.workingMinutes,
  });
  const rawMinutes = Math.round(assessed.effectiveWorkingMinutes);
  const firstPunchIST = tagIST(assessed.effectivePunchIn ?? group.firstPunch);
  const lastPunchIST  = assessed.effectivePunchOut ? tagIST(assessed.effectivePunchOut) : null;
  await db.execute(
    `INSERT INTO employee_biometric_enrollment
       (id, employee_id, cosec_user_id, is_active, last_sync_at)
     VALUES (UUID(), ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE is_active = 1, last_sync_at = NOW()`,
    [employee.employee_id, group.cosecUserId],
  );

  await db.execute(
    `INSERT INTO biometric_attendance_log
       (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out,
        total_punches, raw_minutes, source_system, migrated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       cosec_user_id = VALUES(cosec_user_id),
       first_punch_in = VALUES(first_punch_in),
       last_punch_out = VALUES(last_punch_out),
       total_punches = VALUES(total_punches),
       raw_minutes = VALUES(raw_minutes),
       migrated_at = NOW()`,
    [employee.employee_id, group.cosecUserId, group.punchDate, firstPunchIST, lastPunchIST, assessed.effectivePunchCount, rawMinutes, group.sourceSystem],
  );

  await db.execute(
    `INSERT INTO integration_biometric_daily
       (id, integration_key, source_table, employee_code, activity_date,
        first_punch, last_punch, total_punches, biometric_minutes)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       first_punch = VALUES(first_punch),
       last_punch = VALUES(last_punch),
       total_punches = VALUES(total_punches),
       biometric_minutes = VALUES(biometric_minutes),
       updated_at = NOW()`,
    [group.sourceSystem, group.sourceTable, employee.employee_code, group.punchDate, firstPunchIST, lastPunchIST, assessed.effectivePunchCount, rawMinutes],
  );

  await db.execute(
    `INSERT INTO wfm_attendance_session
       (id, employee_id, session_date, login_time, logout_time, total_login_minutes,
        current_status, punch_source, branch_name, process_name)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'BIOMETRIC', ?, ?)
     ON DUPLICATE KEY UPDATE
       login_time = VALUES(login_time),
       logout_time = VALUES(logout_time),
       total_login_minutes = VALUES(total_login_minutes),
       current_status = VALUES(current_status),
       punch_source = 'BIOMETRIC'`,
    [
      employee.employee_id,
      group.punchDate,
      firstPunchIST,
      lastPunchIST,
      rawMinutes,
      assessed.effectivePunchOut ? (rawMinutes >= 540 ? "Logged Out" : "Partial") : "Logged In",
      employee.branch_name ?? null,
      employee.process_name ?? null,
    ],
  );

  await db.execute(
    `UPDATE employee_biometric_enrollment SET last_sync_at = NOW() WHERE employee_id = ? AND cosec_user_id = ?`,
    [employee.employee_id, group.cosecUserId],
  );

  const attendance = await attendanceEngineService.processEmployee(employee.employee_id, group.punchDate);
  await attendanceEngineService.upsertDailyRecord(attendance, `${group.sourceSystem}_sync`);
  await db.execute(
    `UPDATE attendance_daily_record
        SET clock_in_time = ?, clock_out_time = ?
      WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
    [firstPunchIST, lastPunchIST, employee.employee_id, group.punchDate],
  );
  await attendanceEngineService.checkAndNotifyBiometricMismatch(employee.employee_id, group.punchDate, attendance);

  return "migrated";
}

function diffMinutes(a: string, b: string): number {
  const da = new Date(a.replace(" ", "T") + "+05:30");
  const db = new Date(b.replace(" ", "T") + "+05:30");
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 60000));
}

function nextCalendarDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+05:30");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

type RosterDay = { isNightShift: boolean; isWeekOff: boolean };

/**
 * Pre-fetch roster info for all cosec-user/date combinations in the sync window
 * in a single query. Returns a map keyed "cosecUserId__YYYY-MM-DD".
 * Only published/approved_final rows are used; missing key = no roster data.
 * A shift is a night shift when end_time < start_time (crosses midnight).
 */
async function fetchRosterMap(groups: PunchGroup[]): Promise<Map<string, RosterDay>> {
  if (!groups.length) return new Map();

  const userIds = [...new Set(groups.map(g => g.cosecUserId))];
  const dates   = [...new Set(groups.flatMap(g => [g.punchDate, nextCalendarDate(g.punchDate)]))];

  const up = userIds.map(() => "?").join(",");
  const dp = dates.map(() => "?").join(",");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(ebe.cosec_user_id, e.biometric_code, e.employee_code) AS cosec_user_id,
       ra.roster_date,
       ra.shift_start_time,
       ra.shift_end_time,
       ra.is_week_off
     FROM wfm_roster_assignment ra
     JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
     LEFT JOIN employee_biometric_enrollment ebe
       ON ebe.employee_id = e.id AND ebe.is_active = 1
     WHERE ra.roster_date IN (${dp})
       AND ra.publish_status IN ('published','approved_final')
       AND (
         ebe.cosec_user_id IN (${up})
         OR e.biometric_code  IN (${up})
         OR e.employee_code   IN (${up})
       )`,
    [...dates, ...userIds, ...userIds, ...userIds],
  );

  const map = new Map<string, RosterDay>();
  for (const row of rows) {
    const key   = `${row.cosec_user_id}__${String(row.roster_date).slice(0, 10)}`;
    const start = row.shift_start_time ?? "";
    const end   = row.shift_end_time   ?? "";
    map.set(key, {
      isNightShift: !!start && !!end && end < start,
      isWeekOff: !!row.is_week_off,
    });
  }
  return map;
}

/**
 * Write a missing_punch record for a night-shift employee whose spill-over day
 * had no COSEC punches (week-off boundary with no exit scan).
 * Sets attendance_status='missing_punch' + lwp=1.00 + mismatch_flag=1 so HR
 * can review and regularise rather than payroll silently treating it as absent.
 */
async function writeMissingPunchRecord(
  employeeId: string,
  date: string,
  punchIn: string,
  branchId: string | null,
  processId: string | null,
  reason: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO attendance_daily_record
       (id, employee_id, record_date, clock_in_time, clock_out_time,
        raw_minutes, biometric_minutes, attendance_status, lwp_value,
        attendance_source, source_system, source_record_date,
        mismatch_flag, late_mark, late_by_minutes, is_locked,
        branch_id, process_id, created_by, created_at, updated_at,
        status_change_reason)
     VALUES (UUID(), ?, ?, ?, NULL, 0, 0, 'missing_punch', 1.00,
             'biometric', 'cosec_sqlserver', ?,
             1, 0, 0, 0, ?, ?, 'cosec_night_shift_guard', NOW(), NOW(), ?)
     ON DUPLICATE KEY UPDATE
       attendance_status    = IF(is_locked = 0, 'missing_punch',          attendance_status),
       clock_in_time        = IF(is_locked = 0, VALUES(clock_in_time),     clock_in_time),
       lwp_value            = IF(is_locked = 0, 1.00,                      lwp_value),
       mismatch_flag        = IF(is_locked = 0, 1,                         mismatch_flag),
       status_change_reason = IF(is_locked = 0, VALUES(status_change_reason), status_change_reason),
       source_system        = IF(is_locked = 0, 'cosec_sqlserver',         source_system),
       updated_at           = IF(is_locked = 0, NOW(),                     updated_at)`,
    [employeeId, date, punchIn, date, branchId, processId, reason],
  );

  // Best-effort audit log — table created by migration 099; not fatal if absent
  await db.execute(
    `INSERT IGNORE INTO night_shift_incomplete_punch_log
       (id, employee_id, punch_date, punch_in_time, reason, created_at)
     VALUES (UUID(), ?, ?, ?, ?, NOW())`,
    [employeeId, date, punchIn, reason],
  ).catch(() => {});
}

/**
 * Night shift rollover: merge COSEC day N and day N+1 when an employee's shift
 * crosses midnight, attributing the full shift to the roster start date.
 *
 * Guards:
 * 1. Roster-aware: prefer published roster (end_time < start_time = night shift)
 *    over the punch heuristic (firstPunch >= 18:00) so day-shift workers who
 *    occasionally punch in late are not misclassified.
 * 2. Week-off spill-over merge: if day N+1 is week_off but COSEC has early-morning
 *    exit punches, merge proceeds — employee worked through the boundary.
 * 3. Missing spill-over: night shift start on day N + rostered week_off on day N+1
 *    with zero COSEC punches → flag as missing_punch for HR review.
 * 4. Shift change: day N+1 last punch >= 10:00 → employee switched to day shift,
 *    do not merge, keep each day as its own record.
 */
export async function mergeNightShiftRollover(
  groups: PunchGroup[],
  rosterMap?: Map<string, RosterDay>,
): Promise<PunchGroup[]> {
  const map = rosterMap ?? await fetchRosterMap(groups);

  const byUser = new Map<string, PunchGroup[]>();
  for (const g of groups) {
    const arr = byUser.get(g.cosecUserId) ?? [];
    arr.push(g);
    byUser.set(g.cosecUserId, arr);
  }

  const merged: PunchGroup[] = [];
  for (const [userId, userGroups] of byUser) {
    userGroups.sort((a, b) => a.punchDate.localeCompare(b.punchDate));
    const consumed = new Set<number>();

    for (let i = 0; i < userGroups.length; i++) {
      if (consumed.has(i)) continue;
      const current = userGroups[i];
      const firstHour = parseInt(current.firstPunch.substring(11, 13), 10);

      // Guard 1: prefer roster confirmation, fall back to punch heuristic
      const rosterCurrent = map.get(`${userId}__${current.punchDate}`);
      const isNightShiftStart = rosterCurrent
        ? rosterCurrent.isNightShift
        : firstHour >= 18;

      if (!isNightShiftStart) {
        merged.push(current);
        continue;
      }

      const expectedNextDate = nextCalendarDate(current.punchDate);
      const nextIdx = (i + 1 < userGroups.length && userGroups[i + 1].punchDate === expectedNextDate)
        ? i + 1 : -1;

      if (nextIdx !== -1) {
        const next = userGroups[nextIdx];
        const nextLastHour = parseInt(next.lastPunch.substring(11, 13), 10);

        if (nextLastHour < 10) {
          // Guards 2 + normal merge: day N+1 ended before 10:00 → full merge.
          // Week-off on day N+1 is fine — employee worked through it.
          consumed.add(nextIdx);
          const gap = diffMinutes(current.lastPunch, next.firstPunch);
          merged.push({
            ...current,
            lastPunch:    next.lastPunch,
            totalPunches: current.totalPunches + next.totalPunches,
            workingMinutes: current.workingMinutes + next.workingMinutes + gap,
          });
        } else {
          // Guard 4: day N+1 last punch >= 10:00 → shift changed, do not merge
          merged.push(current);
        }
      } else {
        // Day N+1 has no COSEC punches in this sync window.
        const rosterNext = map.get(`${userId}__${expectedNextDate}`);
        if (rosterNext?.isWeekOff) {
          // Guard 3: rostered week-off with no exit scan → missing_punch
          merged.push({ ...current, missingPunch: true } as PunchGroup & { missingPunch: boolean });
        } else {
          // Spill-over date outside sync range — next sync run will merge
          merged.push(current);
        }
      }
    }
  }
  return merged;
}

export const cosecSyncService = {
  getLastSyncResult() {
    return lastSyncResult;
  },

  isRunning() {
    return running;
  },

  async sync(options: { from?: string; to?: string } = {}): Promise<SyncResult> {
    if (running) throw new Error("COSEC sync is already running");
    running = true;
    const from = normalizeDateInput(options.from, defaultFromDate());
    const to = normalizeDateInput(options.to, defaultToDate());
    const config = getConfig();
    const sourceTable = config.sourceMode === "mysql"
      ? "mas_hrms.integration_biometric_daily,wfm_external_punch_staging,stg_legacy_attendance"
      : config.table;

    const result: SyncResult = {
      success: true,
      from,
      to,
      sourceTable,
      pulledEvents: 0,
      groupedDays: 0,
      migratedDays: 0,
      unmappedUsers: [],
      failed: [],
    };

    try {
      const rawGroups = config.sourceMode === "mysql"
        ? await pullMysqlAttendance(from, to)
        : await pullCosecAttendance(from, to);
      const groups = await mergeNightShiftRollover(rawGroups);
      result.pulledEvents = groups.reduce((total, group) => total + group.totalPunches, 0);
      result.groupedDays = groups.length;

      for (const group of groups) {
        const isMissingPunch = !!(group as any).missingPunch;
        try {
          if (isMissingPunch) {
            // Guard 3: night-shift start with rostered week-off and no exit punch
            const employee = await resolveEmployee(group.cosecUserId);
            if (employee) {
              await writeMissingPunchRecord(
                employee.employee_id,
                group.punchDate,
                group.firstPunch,
                employee.branch_id ?? null,
                employee.process_id ?? null,
                `Night shift started ${group.firstPunch} but no exit punch found; day N+1 is week_off`,
              );
              result.migratedDays += 1;
            } else {
              result.unmappedUsers.push({ cosecUserId: group.cosecUserId, punchDate: group.punchDate, totalPunches: group.totalPunches });
            }
          } else {
            const status = await migratePunchGroup(group);
            if (status === "migrated") result.migratedDays += 1;
            else result.unmappedUsers.push({ cosecUserId: group.cosecUserId, punchDate: group.punchDate, totalPunches: group.totalPunches });
          }
        } catch (error) {
          result.success = false;
          result.failed.push({
            cosecUserId: group.cosecUserId,
            punchDate: group.punchDate,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      lastSyncResult = result;
      return result;
    } finally {
      running = false;
    }
  },

  async testConnection() {
    const cfg = getConfig();
    if (cfg.sourceMode === "mysql") {
      const tables = [
        "integration_biometric_daily",
        "wfm_external_punch_staging",
        "stg_legacy_attendance",
        "attendance_daily_record",
      ];
      const counts: Record<string, number> = {};
      for (const table of tables) {
        if (!(await tableExists(table))) {
          counts[table] = 0;
          continue;
        }
        const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM ??", [table]);
        counts[table] = Number(rows[0]?.total ?? 0);
      }
      return {
        ok: true,
        source: "mas_hrms",
        accessMode: "MYSQL_HRMS_OWNED_TABLES",
        tables: counts,
        latestUserId: null,
        latestEventAt: null,
      };
    }
    const table = quoteTable(cfg.table);
    const userColumn = quoteColumn(cfg.userColumn);
    const datetimeColumn = quoteColumn(cfg.datetimeColumn);
    const pool = await getNcosecPool();
    const result = await pool.request().query(`
        SELECT TOP (1)
          CAST(${userColumn} AS NVARCHAR(100)) AS user_id,
          ${datetimeColumn} AS event_datetime
        FROM ${table}
        WHERE ${userColumn} IS NOT NULL
          AND ${datetimeColumn} IS NOT NULL
        ORDER BY ${datetimeColumn} DESC
      `);
      const row = result.recordset[0];
      return {
        ok: true,
        source: `${cfg.database}.${cfg.table}`,
        accessMode: "SELECT_ONLY",
        latestUserId: row?.user_id ? String(row.user_id) : null,
        latestEventAt: row?.event_datetime ?? null,
      };
  },
};
