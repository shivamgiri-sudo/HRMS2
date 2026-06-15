import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { attendanceEngineService } from "./attendance-engine.service.js";

type PunchRow = {
  user_id: string;
  event_datetime: Date;
};

type PunchGroup = {
  cosecUserId: string;
  punchDate: string;
  firstPunch: Date;
  lastPunch: Date;
  totalPunches: number;
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

function formatDateInIndia(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
    datetimeColumn: process.env.NCOSEC_DATETIME_COLUMN?.trim() || "EventDateTime",
    batchDays: numberEnv("NCOSEC_SYNC_LOOKBACK_DAYS", 1),
  };
}

async function getPool() {
  const cfg = getConfig();
  return sql.connect({
    server: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    options: {
      encrypt: cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  });
}

async function pullCosecPunches(from: string, to: string): Promise<PunchRow[]> {
  const cfg = getConfig();
  const table = quoteTable(cfg.table);
  const userColumn = quoteColumn(cfg.userColumn);
  const datetimeColumn = quoteColumn(cfg.datetimeColumn);
  const pool = await getPool();
  try {
    const request = pool.request();
    request.input("fromDate", sql.DateTime2, new Date(`${from}T00:00:00+05:30`));
    request.input("toDate", sql.DateTime2, new Date(`${to}T23:59:59+05:30`));
    const result = await request.query(`
      SELECT
        CAST(${userColumn} AS NVARCHAR(100)) AS user_id,
        ${datetimeColumn} AS event_datetime
      FROM ${table}
      WHERE ${datetimeColumn} >= @fromDate
        AND ${datetimeColumn} <= @toDate
        AND ${userColumn} IS NOT NULL
      ORDER BY ${userColumn}, ${datetimeColumn}
    `);
    return result.recordset
      .map((row: any) => ({ user_id: String(row.user_id ?? "").trim(), event_datetime: new Date(row.event_datetime) }))
      .filter((row: PunchRow) => row.user_id && !Number.isNaN(row.event_datetime.getTime()));
  } finally {
    await pool.close();
  }
}

function groupPunches(rows: PunchRow[]): PunchGroup[] {
  const map = new Map<string, PunchGroup>();
  for (const row of rows) {
    const punchDate = formatDateInIndia(row.event_datetime);
    const key = `${row.user_id}__${punchDate}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        cosecUserId: row.user_id,
        punchDate,
        firstPunch: row.event_datetime,
        lastPunch: row.event_datetime,
        totalPunches: 1,
      });
      continue;
    }
    if (row.event_datetime < existing.firstPunch) existing.firstPunch = row.event_datetime;
    if (row.event_datetime > existing.lastPunch) existing.lastPunch = row.event_datetime;
    existing.totalPunches += 1;
  }
  return Array.from(map.values());
}

async function resolveEmployee(cosecUserId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ebe.employee_id,
            e.employee_code,
            e.branch_id,
            e.process_id,
            b.branch_name,
            p.process_name
       FROM employee_biometric_enrollment ebe
       JOIN employees e ON e.id = ebe.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE ebe.cosec_user_id = ?
        AND ebe.is_active = 1
        AND e.active_status = 1
      LIMIT 1`,
    [cosecUserId],
  );
  return rows[0] as any | undefined;
}

async function migratePunchGroup(group: PunchGroup): Promise<"migrated" | "unmapped"> {
  const employee = await resolveEmployee(group.cosecUserId);
  if (!employee) return "unmapped";

  const rawMinutes = Math.max(0, Math.round((group.lastPunch.getTime() - group.firstPunch.getTime()) / 60000));

  await db.execute(
    `INSERT INTO biometric_attendance_log
       (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out, raw_minutes, source_system, migrated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'cosec_sqlserver', NOW())
     ON DUPLICATE KEY UPDATE
       cosec_user_id = VALUES(cosec_user_id),
       first_punch_in = LEAST(COALESCE(first_punch_in, VALUES(first_punch_in)), VALUES(first_punch_in)),
       last_punch_out = GREATEST(COALESCE(last_punch_out, VALUES(last_punch_out)), VALUES(last_punch_out)),
       raw_minutes = GREATEST(raw_minutes, VALUES(raw_minutes)),
       migrated_at = NOW()`,
    [employee.employee_id, group.cosecUserId, group.punchDate, group.firstPunch, group.lastPunch, rawMinutes],
  );

  await db.execute(
    `INSERT INTO integration_biometric_daily
       (id, integration_key, source_table, employee_code, activity_date, first_punch, last_punch, biometric_minutes)
     VALUES (UUID(), 'cosec_sqlserver', 'Mx_ATDEventTrn', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       first_punch = LEAST(COALESCE(first_punch, VALUES(first_punch)), VALUES(first_punch)),
       last_punch = GREATEST(COALESCE(last_punch, VALUES(last_punch)), VALUES(last_punch)),
       biometric_minutes = GREATEST(biometric_minutes, VALUES(biometric_minutes)),
       updated_at = NOW()`,
    [employee.employee_code, group.punchDate, group.firstPunch, group.lastPunch, rawMinutes],
  );

  await db.execute(
    `INSERT INTO wfm_attendance_session
       (id, employee_id, session_date, login_time, logout_time, total_login_minutes,
        current_status, punch_source, branch_name, process_name)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'BIOMETRIC', ?, ?)
     ON DUPLICATE KEY UPDATE
       login_time = LEAST(COALESCE(login_time, VALUES(login_time)), VALUES(login_time)),
       logout_time = GREATEST(COALESCE(logout_time, VALUES(logout_time)), VALUES(logout_time)),
       total_login_minutes = GREATEST(total_login_minutes, VALUES(total_login_minutes)),
       current_status = VALUES(current_status),
       punch_source = 'BIOMETRIC'`,
    [
      employee.employee_id,
      group.punchDate,
      group.firstPunch,
      group.lastPunch,
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
  await attendanceEngineService.upsertDailyRecord(attendance, "cosec_sqlserver_sync");
  await db.execute(
    `UPDATE attendance_daily_record
        SET clock_in_time = ?, clock_out_time = ?
      WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
    [group.firstPunch, group.lastPunch, employee.employee_id, group.punchDate],
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
    const sourceTable = getConfig().table;

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
      const rows = await pullCosecPunches(from, to);
      result.pulledEvents = rows.length;
      const groups = groupPunches(rows);
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
};
