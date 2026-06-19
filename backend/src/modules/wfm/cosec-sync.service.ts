import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNcosecPool } from "../../db/ncosecDb.js";
import { attendanceEngineService } from "./attendance-engine.service.js";

type PunchGroup = {
  cosecUserId: string;
  punchDate: string;
  firstPunch: Date;
  lastPunch: Date;
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

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Format Date as 'YYYY-MM-DD HH:mm:ss' string preserving the raw value
// (prevents mysql2 from applying timezone conversion on Date objects)
function toMySQLDatetime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function defaultFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toIsoDate(date);
}

function defaultToDate(): string {
  return toIsoDate(new Date());
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
        MIN(${datetimeColumn}) AS first_punch,
        MAX(${datetimeColumn}) AS last_punch,
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
      firstPunch: new Date(row.first_punch),
      lastPunch: new Date(row.last_punch),
      totalPunches: Math.max(0, Number(row.total_punches ?? 0)),
      workingMinutes: Math.max(0, Number(row.working_minutes ?? 0)),
      sourceSystem: "cosec_sqlserver",
      sourceTable: cfg.table,
    }))
    .filter((row: PunchGroup) =>
      row.cosecUserId
      && /^\d{4}-\d{2}-\d{2}$/.test(row.punchDate)
      && !Number.isNaN(row.firstPunch.getTime())
      && !Number.isNaN(row.lastPunch.getTime())
      && Number.isFinite(row.totalPunches)
      && Number.isFinite(row.workingMinutes)
    );
}

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1`,
    [tableName],
  );
  return rows.length > 0;
}

async function pullMysqlAttendance(from: string, to: string): Promise<PunchGroup[]> {
  const groups = new Map<string, PunchGroup>();
  const add = (row: any, sourceSystem: string, sourceTable: string) => {
    const cosecUserId = String(row.user_id ?? "").trim();
    const punchDate = String(row.attendance_date ?? "").trim();
    const firstPunch = new Date(row.first_punch);
    const lastPunch = new Date(row.last_punch);
    const totalPunches = Math.max(0, Number(row.total_punches ?? 0));
    const workingMinutes = Math.max(0, Number(row.working_minutes ?? 0));
    if (
      !cosecUserId
      || !/^\d{4}-\d{2}-\d{2}$/.test(punchDate)
      || Number.isNaN(firstPunch.getTime())
      || Number.isNaN(lastPunch.getTime())
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

async function migratePunchGroup(group: PunchGroup): Promise<"migrated" | "unmapped"> {
  const employee = await resolveEmployee(group.cosecUserId);
  if (!employee) return "unmapped";

  const rawMinutes = Math.round(group.workingMinutes);
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
    [employee.employee_id, group.cosecUserId, group.punchDate, toMySQLDatetime(group.firstPunch), toMySQLDatetime(group.lastPunch), group.totalPunches, rawMinutes, group.sourceSystem],
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
    [group.sourceSystem, group.sourceTable, employee.employee_code, group.punchDate, toMySQLDatetime(group.firstPunch), toMySQLDatetime(group.lastPunch), group.totalPunches, rawMinutes],
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
      toMySQLDatetime(group.firstPunch),
      toMySQLDatetime(group.lastPunch),
      rawMinutes,
      rawMinutes >= 540 ? "Logged Out" : "Partial",
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
    [toMySQLDatetime(group.firstPunch), toMySQLDatetime(group.lastPunch), employee.employee_id, group.punchDate],
  );
  await attendanceEngineService.checkAndNotifyBiometricMismatch(employee.employee_id, group.punchDate, attendance);

  return "migrated";
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
      const groups = config.sourceMode === "mysql"
        ? await pullMysqlAttendance(from, to)
        : await pullCosecAttendance(from, to);
      result.pulledEvents = groups.reduce((total, group) => total + group.totalPunches, 0);
      result.groupedDays = groups.length;

      for (const group of groups) {
        try {
          const status = await migratePunchGroup(group);
          if (status === "migrated") result.migratedDays += 1;
          else result.unmappedUsers.push({ cosecUserId: group.cosecUserId, punchDate: group.punchDate, totalPunches: group.totalPunches });
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
