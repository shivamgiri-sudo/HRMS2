import { getCredentialsForKey } from "../external-db/external-db.service.js";
import { db } from "../../db/mysql.js";
import { fetchFromDatabase, quoteIdentifier, type DbDialect } from "./adapters/databaseAdapter.js";
import { runConnector, type ConnectorRunSummary } from "./connectorService.js";
import { integrationService } from "./integration.service.js";
import type { IntegrationConfig } from "./integration.types.js";
import { syncDatabaseConnector } from "./adapters/dbSyncService.js";

interface ConnectorConfig {
  method?: "GET" | "POST";
  connector_kind?: string;
  source_tables?: string[];
  tables?: string[];
  syncTables?: string[];
  target_table?: string;
  date_column?: string;
  pagination?: string;
  request_body?: Record<string, unknown>;
}

function parseConfig(value: IntegrationConfig["config_json"]): ConnectorConfig {
  if (typeof value === "string") return JSON.parse(value) as ConnectorConfig;
  return (value ?? {}) as ConnectorConfig;
}

function normalizeRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["data", "results", "items", "records", "rows"]) {
    if (Array.isArray(object[key])) {
      return (object[key] as unknown[]).filter((item) => item && typeof item === "object") as Record<string, unknown>[];
    }
  }
  return [object];
}

function safeDate(value: string | undefined, field: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  return value;
}

async function readDatabaseRows(
  connector: IntegrationConfig,
  config: ConnectorConfig,
  fromDate?: string,
  toDate?: string
): Promise<Record<string, unknown>[]> {
  const credentials = await getCredentialsForKey(connector.integration_key);
  if (!credentials) throw new Error("Database credentials are not configured");

  const dialect: DbDialect = credentials.db_type === "mssql" ? "mssql" : "mysql";
  const tables = config.source_tables ?? config.tables ?? config.syncTables ?? credentials.tables ?? [];
  if (tables.length === 0) throw new Error("At least one approved source table is required");

  const rows: Record<string, unknown>[] = [];
  const safeFromDate = safeDate(fromDate, "fromDate");
  const safeToDate = safeDate(toDate, "toDate");
  for (const tableName of tables) {
    const table = quoteIdentifier(tableName, dialect);
    const dateColumnName = config.date_column ?? credentials.date_column;
    let where = "";
    if (dateColumnName && (safeFromDate || safeToDate)) {
      const dateColumn = quoteIdentifier(dateColumnName, dialect);
      const conditions: string[] = [];
      if (safeFromDate) conditions.push(`${dateColumn} >= '${safeFromDate}'`);
      if (safeToDate) conditions.push(`${dateColumn} < '${safeToDate} 23:59:59'`);
      where = ` WHERE ${conditions.join(" AND ")}`;
    }
    const query = dialect === "mssql"
      ? `SELECT TOP (5000) * FROM ${table}${where}`
      : `SELECT * FROM ${table}${where} LIMIT 5000`;
    const result = await fetchFromDatabase({
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.username,
      password: credentials.password,
      db_type: dialect,
      encrypt: credentials.encrypt,
      trustServerCertificate: credentials.trust_server_certificate,
    }, query);
    rows.push(...result.rows.map((row) => ({ __source_table: tableName, ...row })));
  }
  return rows;
}

async function readRestRows(
  connector: IntegrationConfig,
  config: ConnectorConfig
): Promise<Record<string, unknown>[]> {
  if (!connector.base_url) throw new Error("REST connector base_url is required");

  const headers = new Headers({ Accept: "application/json" });
  if (connector.secret_name) {
    const envKey = connector.secret_name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const secret = process.env[envKey];
    if (!secret) throw new Error(`Missing API credential in environment variable ${envKey}`);
    if (connector.auth_type === "bearer") headers.set("Authorization", `Bearer ${secret}`);
    else if (connector.auth_type === "basic") headers.set("Authorization", `Basic ${secret}`);
    else headers.set("X-API-Key", secret);
  }

  const method = config.method === "POST" ? "POST" : "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(connector.base_url, {
      method,
      headers: method === "POST"
        ? new Headers({ ...Object.fromEntries(headers.entries()), "Content-Type": "application/json" })
        : headers,
      body: method === "POST" ? JSON.stringify(config.request_body ?? {}) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Source API returned HTTP ${response.status}`);
    return normalizeRows(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export async function executeConnector(
  connector: IntegrationConfig,
  userId: string | null,
  input: { fromDate?: string; toDate?: string } = {},
  triggeredBy = "manual",
): Promise<ConnectorRunSummary> {
  if (!connector.active_status) {
    throw Object.assign(new Error("Integration is inactive. Activate and configure it before running sync."), {
      statusCode: 400,
    });
  }
  const config = parseConfig(connector.config_json);

  if (connector.integration_key === "cosec_biometric") {
    const run = await integrationService.createRun(connector.integration_key, triggeredBy, userId);
    const startedAt = Date.now();
    try {
      const { cosecSyncService } = await import("../wfm/cosec-sync.service.js");
      const result = await cosecSyncService.sync({
        from: input.fromDate,
        to: input.toDate,
      });
      const failedCount = result.failed.length + result.unmappedUsers.length;
      const status = result.success ? "complete" : "failed";
      await db.execute(
        `UPDATE integration_connector_run
            SET status = ?, rows_fetched = ?, rows_promoted = ?, rows_failed = ?,
                duration_ms = ?, error_message = ?, completed_at = NOW()
          WHERE id = ?`,
        [
          status,
          result.pulledEvents,
          result.migratedDays,
          failedCount,
          Date.now() - startedAt,
          failedCount > 0
            ? `${result.unmappedUsers.length} unmapped user(s); ${result.failed.length} failed day(s)`
            : null,
          run.id,
        ],
      );
      return {
        run_id: run.id,
        rows_fetched: result.pulledEvents,
        rows_promoted: result.migratedDays,
        rows_failed: failedCount,
        status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.execute(
        `UPDATE integration_connector_run
            SET status = 'failed', rows_failed = 1, duration_ms = ?,
                error_message = ?, completed_at = NOW()
          WHERE id = ?`,
        [Date.now() - startedAt, message, run.id],
      );
      return {
        run_id: run.id,
        rows_fetched: 0,
        rows_promoted: 0,
        rows_failed: 1,
        status: "failed",
      };
    }
  }

  if (connector.integration_type === "database") {
    const tableMaps = await integrationService.listTableMaps(connector.integration_key);
    if (tableMaps.length > 0 || config.target_table === "dialer_session_log") {
      const run = await integrationService.createRun(connector.integration_key, triggeredBy, userId);
      const result = await syncDatabaseConnector(connector, {
        fromDate: input.fromDate,
        toDate: input.toDate,
        userId: userId ?? undefined,
      });
      if (result.affected_dates.length > 0) {
        const { attendanceEngineService } = await import("../wfm/attendance-engine.service.js");
        const {
          syncAttendanceMetrics,
          syncIntegrationCallMetrics,
        } = await import("../kpi/kpi-data-connector.service.js");
        for (const date of result.affected_dates) {
          const attendance = await attendanceEngineService.processDateBatch(date, 50);
          await Promise.all([
            syncIntegrationCallMetrics(date),
            syncAttendanceMetrics(date),
          ]);
          if (attendance.failed > 0) {
            result.errors.push(
              `Attendance rebuild ${date}: ${attendance.failed} employee record(s) failed`,
            );
          }
        }
      }
      const completed = result.rows_inserted > 0 || (result.rows_fetched === 0 && result.errors.length === 0);
      const status = completed ? "complete" : "failed";
      await db.execute(
        `UPDATE integration_connector_run
            SET status = ?, rows_fetched = ?, rows_promoted = ?, rows_failed = ?,
                duration_ms = ?, error_message = ?, completed_at = NOW()
          WHERE id = ?`,
        [
          status,
          result.rows_fetched,
          result.rows_inserted,
          result.rows_skipped,
          result.duration_ms,
          result.errors.length > 0 ? result.errors.slice(0, 10).join("; ") : null,
          run.id,
        ],
      );
      return {
        run_id: run.id,
        rows_fetched: result.rows_fetched,
        rows_promoted: result.rows_inserted,
        rows_failed: result.rows_skipped,
        status,
      };
    }
  }

  let rows: Record<string, unknown>[];
  try {
    if (connector.integration_type === "database") {
      rows = await readDatabaseRows(connector, config, input.fromDate, input.toDate);
    } else if (connector.integration_type === "rest_pull") {
      rows = await readRestRows(connector, config);
    } else {
      throw Object.assign(
        new Error(`No live executor is configured for connector type ${connector.integration_type}`),
        { statusCode: 400 }
      );
    }
  } catch (error) {
    const run = await integrationService.createRun(connector.integration_key, triggeredBy, userId);
    const message = error instanceof Error ? error.message : String(error);
    await db.execute(
      `UPDATE integration_connector_run
          SET status = 'failed', error_message = ?, completed_at = NOW(), duration_ms = 0
        WHERE id = ?`,
      [message, run.id]
    );
    throw error;
  }

  return runConnector(connector.integration_key, rows, userId, triggeredBy);
}
