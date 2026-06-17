import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type {
  IntegrationConfig,
  IntegrationConnectorRun,
  IntegrationFieldMap,
  IntegrationFieldMapSuggestion,
  IntegrationListFilters,
  IntegrationTableMap,
  PaginatedResult,
} from "./integration.types.js";
import type {
  ConfirmFieldMapInput,
  CreateIntegrationInput,
  RunFilters,
  UpdateIntegrationInput,
  UpsertTableMapInput,
  UpsertScheduleInput,
} from "./integration.validation.js";
import type { IntegrationSchedule } from "./integration.types.js";
import { DEFAULT_INTEGRATION_CRON, nextCronRun } from "./cronSchedule.js";
import { env } from "../../config/env.js";
import { getCredentialsForKey } from "../external-db/external-db.service.js";
import {
  fetchFromDatabase,
  quoteIdentifier,
  type DbDialect,
} from "./adapters/databaseAdapter.js";

const APPROVED_MAPPING_TARGETS = {
  dialer_session_log: [
    "employee_code",
    "session_date",
    "login_minutes",
    "process_name",
    "branch_name",
  ],
  integration_call_daily: [
    "employee_code",
    "activity_date",
    "total_calls",
    "talk_minutes",
    "process_name",
  ],
  integration_biometric_daily: [
    "employee_code",
    "activity_date",
    "punch_time",
    "first_punch",
    "last_punch",
    "total_punches",
    "biometric_minutes",
  ],
} as const;

function configObject(value: IntegrationConfig["config_json"]): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (value ?? {}) as Record<string, unknown>;
}

function configuredSourceTables(config: Record<string, unknown>, credentialTables: string[] = []): string[] {
  const candidates = [
    config.source_tables,
    config.tables,
    config.syncTables,
    credentialTables,
  ];
  const tables = candidates.find((value) => Array.isArray(value)) as unknown[] | undefined;
  return [...new Set((tables ?? []).map(String).map((value) => value.trim()).filter(Boolean))];
}

export const integrationService = {
  async list(filters?: IntegrationListFilters): Promise<IntegrationConfig[]> {
    let sql = `
      SELECT ic.*,
             (SELECT MAX(icr.started_at)
                FROM integration_connector_run icr
               WHERE icr.integration_key = ic.integration_key) AS last_run_at
        FROM integration_config ic`;
    const params: unknown[] = [];

    if (filters?.activeStatus === "active") {
      sql += " WHERE ic.active_status = 1";
    } else if (filters?.activeStatus === "inactive") {
      sql += " WHERE ic.active_status = 0";
    }

    sql += " ORDER BY ic.integration_name ASC";

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows as IntegrationConfig[];
  },

  async getByKey(integrationKey: string): Promise<IntegrationConfig> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ic.*,
              (SELECT MAX(icr.started_at)
                 FROM integration_connector_run icr
                WHERE icr.integration_key = ic.integration_key) AS last_run_at
         FROM integration_config ic
        WHERE ic.integration_key = ?
        LIMIT 1`,
      [integrationKey],
    );

    const record = (rows as IntegrationConfig[])[0];
    if (!record) throw Object.assign(new Error("Integration not found"), { statusCode: 404 });
    return record;
  },

  async create(input: CreateIntegrationInput, _userId: string): Promise<IntegrationConfig> {
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM integration_config WHERE integration_key = ? LIMIT 1",
      [input.integrationKey],
    );

    if ((existing as RowDataPacket[]).length > 0) {
      throw Object.assign(new Error("Integration key already exists"), { statusCode: 409 });
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO integration_config
         (id, integration_key, integration_name, integration_type,
          vendor_name, base_url, auth_type, secret_name, config_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.integrationKey,
        input.integrationName,
        input.integrationType,
        input.vendorName ?? null,
        input.baseUrl ?? null,
        input.authType ?? null,
        input.secretName ?? null,
        input.configJson ? JSON.stringify(input.configJson) : null,
        input.notes ?? null,
      ],
    );

    return this.getByKey(input.integrationKey);
  },

  async update(
    integrationKey: string,
    input: UpdateIntegrationInput,
    _userId: string,
  ): Promise<IntegrationConfig> {
    await this.getByKey(integrationKey);

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (input.integrationName !== undefined) { setClauses.push("integration_name = ?"); params.push(input.integrationName); }
    if (input.integrationType !== undefined) { setClauses.push("integration_type = ?"); params.push(input.integrationType); }
    if (input.vendorName !== undefined) { setClauses.push("vendor_name = ?"); params.push(input.vendorName ?? null); }
    if (input.baseUrl !== undefined) { setClauses.push("base_url = ?"); params.push(input.baseUrl ?? null); }
    if (input.authType !== undefined) { setClauses.push("auth_type = ?"); params.push(input.authType ?? null); }
    if (input.secretName !== undefined) { setClauses.push("secret_name = ?"); params.push(input.secretName ?? null); }
    if (input.notes !== undefined) { setClauses.push("notes = ?"); params.push(input.notes ?? null); }
    if (input.activeStatus !== undefined) { setClauses.push("active_status = ?"); params.push(input.activeStatus ? 1 : 0); }
    if (input.configJson !== undefined) { setClauses.push("config_json = ?"); params.push(input.configJson ? JSON.stringify(input.configJson) : null); }

    if (setClauses.length > 0) {
      setClauses.push("updated_at = NOW()");
      params.push(integrationKey);
      await db.execute(
        `UPDATE integration_config SET ${setClauses.join(", ")} WHERE integration_key = ?`,
        params,
      );
    }

    return this.getByKey(integrationKey);
  },

  async listRuns(filters: RunFilters): Promise<PaginatedResult<IntegrationConnectorRun>> {
    const { page, limit, integrationKey, status } = filters;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (integrationKey) { conditions.push("icr.integration_key = ?"); params.push(integrationKey); }
    if (status) { conditions.push("icr.status = ?"); params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT icr.*, ic.integration_name, ic.integration_type
         FROM integration_connector_run icr
         LEFT JOIN integration_config ic ON ic.integration_key = icr.integration_key
         ${where}
         ORDER BY icr.started_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM integration_connector_run icr
         ${where}`,
      params,
    );

    const total = Number((countRows as { total: number }[])[0]?.total ?? 0);
    return { data: rows as IntegrationConnectorRun[], total, page, limit };
  },

  async createRun(
    integrationKey: string,
    triggeredBy: string,
    triggeredUser: string | null,
  ): Promise<IntegrationConnectorRun> {
    const connector = await this.getByKey(integrationKey);
    if (!connector.active_status) {
      throw Object.assign(new Error("Integration is inactive"), { statusCode: 400 });
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO integration_connector_run
         (id, integration_key, triggered_by, triggered_user, status)
       VALUES (?, ?, ?, ?, 'running')`,
      [id, integrationKey, triggeredBy, triggeredUser],
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM integration_connector_run WHERE id = ? LIMIT 1",
      [id],
    );
    return (rows as IntegrationConnectorRun[])[0];
  },

  async listFieldMaps(integrationKey: string): Promise<IntegrationFieldMap[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM integration_field_map WHERE integration_key = ? AND active_status = 1 ORDER BY source_field ASC",
      [integrationKey],
    );
    return rows as IntegrationFieldMap[];
  },

  async confirmFieldMap(input: ConfirmFieldMapInput, userId: string): Promise<IntegrationFieldMap> {
    await this.getByKey(input.integrationKey);
    await db.execute(
      `INSERT INTO integration_field_map
         (id, integration_key, source_table, source_field, target_table, target_column, transform, confirmed_by, confirmed_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         target_table = VALUES(target_table),
         target_column = VALUES(target_column),
         transform = VALUES(transform),
         confirmed_by = VALUES(confirmed_by),
         confirmed_at = NOW(),
         active_status = 1`,
      [
        input.integrationKey,
        input.sourceTable,
        input.sourceField,
        input.targetTable,
        input.targetColumn,
        input.transform ?? null,
        userId,
      ],
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM integration_field_map WHERE integration_key = ? AND source_table = ? AND source_field = ? LIMIT 1",
      [input.integrationKey, input.sourceTable, input.sourceField],
    );
    return (rows as IntegrationFieldMap[])[0];
  },

  async confirmSuggestion(suggestionId: string, userId: string): Promise<IntegrationFieldMap> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT *
         FROM integration_field_map_suggestion
        WHERE id = ? AND status = 'pending'
        LIMIT 1`,
      [suggestionId],
    );
    const suggestion = rows[0] as IntegrationFieldMapSuggestion | undefined;

    if (!suggestion) throw Object.assign(new Error("Pending mapping suggestion not found"), { statusCode: 404 });
    if (!suggestion.suggested_table || !suggestion.suggested_column) {
      throw Object.assign(new Error("Suggestion does not contain a complete target mapping"), { statusCode: 400 });
    }

    const mapping = await this.confirmFieldMap({
      integrationKey: suggestion.integration_key,
      sourceTable: suggestion.source_table ?? "*",
      sourceField: suggestion.source_field,
      targetTable: suggestion.suggested_table,
      targetColumn: suggestion.suggested_column,
      transform: null,
    }, userId);

    await db.execute(
      "UPDATE integration_field_map_suggestion SET status = 'confirmed' WHERE id = ?",
      [suggestionId],
    );

    return mapping;
  },

  async listSuggestions(integrationKey: string): Promise<IntegrationFieldMapSuggestion[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM integration_field_map_suggestion WHERE integration_key = ? AND status = 'pending' ORDER BY source_field ASC",
      [integrationKey],
    );
    return rows as IntegrationFieldMapSuggestion[];
  },

  async listTableMaps(integrationKey: string): Promise<IntegrationTableMap[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT *
         FROM integration_table_map
        WHERE integration_key = ? AND active_status = 1
        ORDER BY source_table`,
      [integrationKey],
    );
    return rows as IntegrationTableMap[];
  },

  async upsertTableMap(
    integrationKey: string,
    input: UpsertTableMapInput,
    userId: string,
  ): Promise<IntegrationTableMap> {
    const connector = await this.getByKey(integrationKey);
    const config = configObject(connector.config_json);
    const currentSources = configuredSourceTables(config);
    const sourceTables = [...new Set([...currentSources, input.sourceTable])];

    await db.execute(
      `INSERT INTO integration_table_map
         (id, integration_key, source_table, target_table, sync_mode, confirmed_by, confirmed_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         target_table = VALUES(target_table),
         sync_mode = VALUES(sync_mode),
         confirmed_by = VALUES(confirmed_by),
         confirmed_at = NOW(),
         active_status = 1`,
      [
        integrationKey,
        input.sourceTable,
        input.targetTable,
        input.syncMode,
        userId,
      ],
    );
    await db.execute(
      "UPDATE integration_config SET config_json = ?, updated_at = NOW() WHERE integration_key = ?",
      [JSON.stringify({ ...config, source_tables: sourceTables, tables: sourceTables }), integrationKey],
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT *
         FROM integration_table_map
        WHERE integration_key = ? AND source_table = ?
        LIMIT 1`,
      [integrationKey, input.sourceTable],
    );
    return (rows as IntegrationTableMap[])[0];
  },

  getMappingCatalog() {
    return Object.entries(APPROVED_MAPPING_TARGETS).map(([table, columns]) => ({
      table,
      columns: [...columns],
      sync_modes: ["daily_aggregate"],
    }));
  },

  async inspectSourceSchema(integrationKey: string) {
    const connector = await this.getByKey(integrationKey);
    if (connector.integration_type !== "database") {
      const [snapshots] = await db.execute<RowDataPacket[]>(
        `SELECT detected_fields
           FROM integration_schema_snapshot
          WHERE integration_key = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [integrationKey],
      );
      const fields = (snapshots[0]?.detected_fields ?? []) as Array<{ name?: string; type?: string }>;
      return [{
        table: "*",
        columns: fields.map((field) => ({ name: String(field.name ?? ""), type: String(field.type ?? "unknown") })),
      }];
    }

    const config = configObject(connector.config_json);
    if (
      integrationKey === "cosec_biometric"
      && String(config.source_mode ?? process.env.NCOSEC_SOURCE_MODE ?? "mysql") !== "mssql"
    ) {
      const tables = [
        "integration_biometric_daily",
        "wfm_external_punch_staging",
        "stg_legacy_attendance",
        "attendance_daily_record",
      ];
      const result: Array<{ table: string; columns: Array<{ name: string; type: string }> }> = [];
      for (const table of tables) {
        const [columns] = await db.execute<RowDataPacket[]>(
          `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION`,
          [table],
        );
        if (columns.length > 0) {
          result.push({
            table: `mas_hrms.${table}`,
            columns: columns.map((column) => ({
              name: String(column.name ?? ""),
              type: String(column.type ?? "unknown"),
            })),
          });
        }
      }
      return result;
    }

    const credentials = await getCredentialsForKey(integrationKey);
    if (!credentials) throw Object.assign(new Error("Database credentials are not configured"), { statusCode: 400 });
    const tables = configuredSourceTables(config, credentials.tables ?? []);
    if (tables.length === 0) {
      throw Object.assign(new Error("No source tables are configured for this connector"), { statusCode: 400 });
    }

    const dialect: DbDialect = credentials.db_type === "mssql" ? "mssql" : "mysql";
    const result: Array<{ table: string; columns: Array<{ name: string; type: string }> }> = [];
    for (const table of tables) {
      const parts = table.split(".");
      if (parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) continue;
      const tableName = parts.at(-1)!;
      const schemaName = parts.length > 1 ? parts.at(-2)! : null;
      const query = dialect === "mssql"
        ? `SELECT COLUMN_NAME AS name, DATA_TYPE AS type
             FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = '${tableName}'
              ${schemaName ? `AND TABLE_SCHEMA = '${schemaName}'` : ""}
            ORDER BY ORDINAL_POSITION`
        : `SHOW COLUMNS FROM ${quoteIdentifier(table, dialect)}`;
      const fetched = await fetchFromDatabase({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.username,
        password: credentials.password,
        db_type: dialect,
        encrypt: credentials.encrypt,
        trustServerCertificate: credentials.trust_server_certificate,
      }, query);
      result.push({
        table,
        columns: fetched.rows.map((row) => ({
          name: String(row.name ?? row.Field ?? ""),
          type: String(row.type ?? row.Type ?? "unknown"),
        })).filter((column) => column.name),
      });
    }
    return result;
  },

  async getSchedule(integrationKey: string): Promise<IntegrationSchedule> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM integration_schedule WHERE integration_key = ? LIMIT 1",
      [integrationKey],
    );
    const record = (rows as IntegrationSchedule[])[0];

    if (record) return record;
    return {
      id: "",
      integration_key: integrationKey,
      cron_expression: DEFAULT_INTEGRATION_CRON,
      enabled: 0,
      last_run_at: null,
      next_run_at: null,
    };
  },

  async upsertSchedule(integrationKey: string, input: UpsertScheduleInput): Promise<IntegrationSchedule> {
    await this.getByKey(integrationKey);
    const current = await this.getSchedule(integrationKey);
    const cronExpression = input.cronExpression ?? current.cron_expression;
    const enabled = input.enabled !== undefined ? input.enabled : Boolean(current.enabled);
    const nextRunAt = enabled
      ? nextCronRun(cronExpression, new Date(), env.INTEGRATION_SCHEDULER_TIMEZONE)
      : null;

    await db.execute(
      `INSERT INTO integration_schedule
         (id, integration_key, cron_expression, enabled, next_run_at)
       VALUES (UUID(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cron_expression = VALUES(cron_expression),
         enabled = VALUES(enabled),
         next_run_at = VALUES(next_run_at)`,
      [integrationKey, cronExpression, enabled ? 1 : 0, nextRunAt],
    );
    return this.getSchedule(integrationKey);
  },
};
