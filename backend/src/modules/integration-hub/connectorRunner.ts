import { createSign } from "node:crypto";
import * as XLSX from "xlsx";
import { getCredentialsForKey } from "../external-db/external-db.service.js";
import { db } from "../../db/mysql.js";
import { fetchFromDatabase, quoteIdentifier, type DbDialect } from "./adapters/databaseAdapter.js";
import { runConnector, type ConnectorRunSummary } from "./connectorService.js";
import { integrationService } from "./integration.service.js";
import type { IntegrationConfig } from "./integration.types.js";
import { syncDatabaseConnector } from "./adapters/dbSyncService.js";
import { assertSafeOutboundUrl } from "../../shared/outboundUrlGuard.js";

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
  spreadsheet_id?: string;
  sheet_name?: string;
  range?: string;
  sheet_range?: string;
  header_row?: number | string;
  auth_mode?: "service_account" | "oauth" | "public";
  sync_direction?: "pull" | "push";
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

function normalizeHeader(value: unknown, index: number): string {
  const header = String(value ?? "").trim();
  return header || `column_${index + 1}`;
}

function rowsFromWorkbook(workbook: XLSX.WorkBook, headerRow: number): Record<string, unknown>[] {
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!worksheet) return [];

  const cells = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });
  const headerIndex = Math.max(0, headerRow - 1);
  const headerCells = cells[headerIndex] ?? [];
  const seen = new Map<string, number>();
  const headers = headerCells.map((cell, index) => {
    const base = normalizeHeader(cell, index);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  return cells.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

function parseServiceAccountSecret(secret: string): { client_email: string; private_key: string; token_uri?: string } {
  const trimmed = secret.trim();
  const decoded = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as Record<string, unknown>;
  const clientEmail = String(parsed.client_email ?? "");
  const privateKey = String(parsed.private_key ?? "").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error("Google Sheets service account secret must include client_email and private_key");
  }
  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: typeof parsed.token_uri === "string" ? parsed.token_uri : undefined,
  };
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function getGoogleSheetsBearerToken(connector: IntegrationConfig): Promise<string> {
  if (!connector.secret_name) {
    throw new Error("Google Sheets private access requires a credential secret reference");
  }
  const envKey = connector.secret_name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const secret = process.env[envKey];
  if (!secret) throw new Error(`Missing Google Sheets credential in environment variable ${envKey}`);

  if (connector.auth_type === "oauth") return secret;

  const serviceAccount = parseServiceAccountSecret(secret);
  const now = Math.floor(Date.now() / 1000);
  const tokenUrl = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const assertion = `${header}.${claim}.${signer.sign(serviceAccount.private_key).toString("base64url")}`;

  const sourceUrl = await assertSafeOutboundUrl(tokenUrl, "Google OAuth token");
  const response = await fetch(sourceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth token request returned HTTP ${response.status}`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google OAuth token response did not include an access token");
  return payload.access_token;
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

async function readGoogleSheetRows(
  connector: IntegrationConfig,
  config: ConnectorConfig
): Promise<Record<string, unknown>[]> {
  if (config.sync_direction === "push") {
    throw Object.assign(
      new Error("Google Sheets push is not configured. Set sync direction to pull for live imports."),
      { statusCode: 400 },
    );
  }

  const spreadsheetId = String(config.spreadsheet_id ?? "").trim();
  if (!spreadsheetId) throw new Error("Google Sheets connector requires spreadsheet_id");
  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) throw new Error("Google Sheets spreadsheet_id is invalid");

  const sheetName = String(config.sheet_name ?? "Sheet1").trim() || "Sheet1";
  const range = String(config.range ?? config.sheet_range ?? "A:Z").trim() || "A:Z";
  const headerRow = Math.max(1, Number(config.header_row ?? 1) || 1);
  const authMode = config.auth_mode ?? (connector.auth_type === "public" ? "public" : "service_account");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    if (authMode === "public") {
      const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
      url.searchParams.set("tqx", "out:csv");
      url.searchParams.set("sheet", sheetName);
      if (range) url.searchParams.set("range", range);
      const sourceUrl = await assertSafeOutboundUrl(url.toString(), "Google Sheets public export");
      const response = await fetch(sourceUrl, {
        headers: { Accept: "text/csv" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Google Sheets public export returned HTTP ${response.status}`);
      const csv = await response.text();
      const workbook = XLSX.read(csv, { type: "string", raw: false });
      return rowsFromWorkbook(workbook, headerRow);
    }

    const bearerToken = await getGoogleSheetsBearerToken(connector);
    const a1Range = sheetName.includes("!")
      ? sheetName
      : `'${sheetName.replace(/'/g, "''")}'!${range}`;
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(a1Range)}`,
    );
    const sourceUrl = await assertSafeOutboundUrl(url.toString(), "Google Sheets API");
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Google Sheets API returned HTTP ${response.status}`);
    const payload = await response.json() as { values?: unknown[][] };
    const values = payload.values ?? [];
    const worksheet = XLSX.utils.aoa_to_sheet(values);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    return rowsFromWorkbook(workbook, headerRow);
  } finally {
    clearTimeout(timer);
  }
}

async function readRestRows(
  connector: IntegrationConfig,
  config: ConnectorConfig
): Promise<Record<string, unknown>[]> {
  if (!connector.base_url) throw new Error("REST connector base_url is required");
  const sourceUrl = await assertSafeOutboundUrl(connector.base_url, "REST connector");

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
    const response = await fetch(sourceUrl, {
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
    } else if (connector.integration_type === "rest_pull" && config.connector_kind === "google_sheets") {
      rows = await readGoogleSheetRows(connector, config);
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
