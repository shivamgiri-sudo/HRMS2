import type { RowDataPacket } from "mysql2";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import {
  encryptCredentials,
  invalidatePool,
} from "../external-db/external-db.service.js";
import { nextCronRun } from "../integration-hub/cronSchedule.js";

const INTEGRATION_KEY = "cosec_biometric";
const TARGET_TABLE = "integration_biometric_daily";

function configured(): boolean {
  if (env.NCOSEC_SOURCE_MODE === "mysql") return true;
  return Boolean(env.NCOSEC_DB_HOST && env.NCOSEC_DB_USER && env.NCOSEC_DB_PASSWORD);
}

export async function bootstrapCosecIntegration(): Promise<boolean> {
  const explicitlyDisabled = env.NCOSEC_SYNC_ENABLED === "false" && env.NCOSEC_SOURCE_MODE === "mssql";
  if (explicitlyDisabled || !configured()) {
    console.log("[cosec-sync] automatic Integration Hub schedule is disabled or not configured");
    return false;
  }

  const config = {
    db_type: "mssql",
    connector_kind: "cosec_attendance",
    host: env.NCOSEC_DB_HOST,
    port: env.NCOSEC_DB_PORT,
    database: env.NCOSEC_DB_NAME,
    source_tables: [env.NCOSEC_EVENT_TABLE],
    tables: [env.NCOSEC_EVENT_TABLE],
    target_table: TARGET_TABLE,
    date_column: env.NCOSEC_DATETIME_COLUMN,
    employee_code_column: env.NCOSEC_USER_ID_COLUMN,
    encrypt: env.NCOSEC_DB_ENCRYPT === "true",
    trust_server_certificate: env.NCOSEC_DB_TRUST_CERT === "true",
    source_access: "SELECT_ONLY",
    source_mode: env.NCOSEC_SOURCE_MODE,
  };
  const encryptedCredentials = encryptCredentials({
    host: env.NCOSEC_DB_HOST,
    port: env.NCOSEC_DB_PORT,
    database: env.NCOSEC_DB_NAME,
    username: env.NCOSEC_DB_USER,
    password: env.NCOSEC_DB_PASSWORD,
    table: env.NCOSEC_EVENT_TABLE,
    tables: [env.NCOSEC_EVENT_TABLE],
    date_column: env.NCOSEC_DATETIME_COLUMN,
    employee_code_column: env.NCOSEC_USER_ID_COLUMN,
    db_type: "mssql",
    encrypt: env.NCOSEC_DB_ENCRYPT === "true",
    trust_server_certificate: env.NCOSEC_DB_TRUST_CERT === "true",
  });
  const nextRunAt = nextCronRun(
    env.NCOSEC_SYNC_CRON,
    new Date(),
    env.INTEGRATION_SCHEDULER_TIMEZONE,
  );

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO integration_config
         (id, integration_key, integration_name, integration_type, vendor_name,
          auth_type, config_json, encrypted_credentials, active_status, notes)
       VALUES (UUID(), ?, 'COSEC Biometric Attendance', 'database', 'Matrix COSEC',
               'basic', ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         integration_name = VALUES(integration_name),
         integration_type = VALUES(integration_type),
         vendor_name = VALUES(vendor_name),
         auth_type = VALUES(auth_type),
         config_json = VALUES(config_json),
         encrypted_credentials = VALUES(encrypted_credentials),
         active_status = 1,
         notes = VALUES(notes),
         updated_at = NOW()`,
      [
        INTEGRATION_KEY,
        JSON.stringify(config),
        encryptedCredentials,
        env.NCOSEC_SOURCE_MODE === "mysql"
          ? "Automatic attendance sync reads HRMS-owned MySQL attendance/staging tables and writes payroll-ready attendance_daily_record."
          : "Read-only SELECT from NCOSEC.dbo.Mx_ATDEventTrn; processed attendance is stored only in HRMS tables.",
      ],
    );
    await connection.execute(
      `INSERT INTO integration_table_map
         (id, integration_key, source_table, target_table, sync_mode,
          active_status, confirmed_at)
       VALUES (UUID(), ?, ?, ?, 'daily_aggregate', 1, NOW())
       ON DUPLICATE KEY UPDATE
         target_table = VALUES(target_table),
         sync_mode = VALUES(sync_mode),
         active_status = 1,
         confirmed_at = NOW()`,
      [INTEGRATION_KEY, env.NCOSEC_EVENT_TABLE, TARGET_TABLE],
    );

    const fieldMaps = [
      [env.NCOSEC_USER_ID_COLUMN, "employee_code"],
      [env.NCOSEC_DATETIME_COLUMN, "punch_time"],
    ] as const;
    for (const [sourceField, targetColumn] of fieldMaps) {
      await connection.execute(
        `INSERT INTO integration_field_map
           (id, integration_key, source_table, source_field, target_table,
            target_column, transform, confirmed_at, active_status)
         VALUES (UUID(), ?, ?, ?, ?, ?, 'daily_aggregate', NOW(), 1)
         ON DUPLICATE KEY UPDATE
           target_table = VALUES(target_table),
           target_column = VALUES(target_column),
           transform = VALUES(transform),
           confirmed_at = NOW(),
           active_status = 1`,
        [
          INTEGRATION_KEY,
          env.NCOSEC_EVENT_TABLE,
          sourceField,
          TARGET_TABLE,
          targetColumn,
        ],
      );
    }

    await connection.execute(
      `INSERT INTO integration_schedule
         (id, integration_key, cron_expression, enabled, next_run_at)
       VALUES (UUID(), ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         cron_expression = VALUES(cron_expression),
         enabled = 1,
         next_run_at = COALESCE(next_run_at, VALUES(next_run_at)),
         updated_at = NOW()`,
      [INTEGRATION_KEY, env.NCOSEC_SYNC_CRON, nextRunAt],
    );
    await connection.execute(
      `INSERT INTO integration_event_log
         (id, integration_key, event_type, description, metadata)
       VALUES (UUID(), ?, 'auto_sync_bootstrapped', ?, ?)`,
      [
        INTEGRATION_KEY,
        "COSEC read-only automatic attendance sync is active",
        JSON.stringify({
          source: env.NCOSEC_SOURCE_MODE === "mysql"
            ? "mas_hrms.integration_biometric_daily/wfm_external_punch_staging/stg_legacy_attendance"
            : `${env.NCOSEC_DB_NAME}.${env.NCOSEC_EVENT_TABLE}`,
          target: TARGET_TABLE,
          cron: env.NCOSEC_SYNC_CRON,
          access: "SELECT_ONLY",
        }),
      ],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  invalidatePool(INTEGRATION_KEY);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT enabled
       FROM integration_schedule
      WHERE integration_key = ?
      LIMIT 1`,
    [INTEGRATION_KEY],
  );
  return Number(rows[0]?.enabled ?? 0) === 1;
}
