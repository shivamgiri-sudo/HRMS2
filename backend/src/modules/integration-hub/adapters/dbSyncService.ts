import { db } from "../../../db/mysql.js";
import {
  assertSafeIdentifier,
  buildCdrAggregateQuery,
  buildDialerAggregateQuery,
  fetchFromDatabase,
  type DbDialect,
} from "./databaseAdapter.js";
import type { IntegrationConfig } from "../integration.types.js";

interface DbConfig {
  db_type?: "mysql" | "mssql" | "sqlserver";
  host: string;
  port?: number;
  database: string;
  source_tables: string[];
  target_table: string;
  agent_code_column?: string;
  agent_name_column?: string;
  date_column?: string;
  talk_col?: string;
  pause_col?: string;
  campaign_col?: string;
  disposition_col?: string;
  encrypt?: boolean;
  trust_server_certificate?: boolean;
  sync_mode?: "daily_aggregate" | "daily_snapshot" | "incremental";
}

interface SyncResult {
  rows_fetched: number;
  rows_inserted: number;
  rows_skipped: number;
  duration_ms: number;
  errors: string[];
}

function parseConfig(value: IntegrationConfig["config_json"]): DbConfig {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as DbConfig;
    } catch {
      throw new Error("Connector config_json is not valid JSON");
    }
  }
  return (value ?? {}) as unknown as DbConfig;
}

function getDbCredentials(secretName: string): { user: string; password: string } {
  const prefix = String(secretName ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  if (!prefix) throw new Error("Database connector secret_name is required");

  const user = process.env[`${prefix}_USER`];
  const password = process.env[`${prefix}_PASS`] ?? process.env[`${prefix}_PASSWORD`];
  if (!user || !password) {
    throw new Error(`Missing connector credentials: ${prefix}_USER and ${prefix}_PASS/PASSWORD`);
  }

  return { user, password };
}

function dialectFor(config: DbConfig): DbDialect {
  return config.db_type === "mssql" || config.db_type === "sqlserver" ? "mssql" : "mysql";
}

export async function syncDatabaseConnector(
  connector: IntegrationConfig,
  opts: { fromDate?: string; toDate?: string; userId?: string } = {},
): Promise<SyncResult> {
  const result: SyncResult = {
    rows_fetched: 0,
    rows_inserted: 0,
    rows_skipped: 0,
    duration_ms: 0,
    errors: [],
  };
  const startedAt = Date.now();

  try {
    if (connector.integration_type !== "database") throw new Error("Not a database connector");
    if (!connector.active_status) throw new Error("Database connector is inactive");

    const config = parseConfig(connector.config_json);
    if (!config.host || !config.database) throw new Error("Missing host or database in config_json");
    if (!Array.isArray(config.source_tables) || config.source_tables.length === 0) {
      throw new Error("At least one approved source table is required");
    }

    // The legacy dialer connector currently promotes only into this controlled table.
    // Generic HRMS master-data mappings must use the staged Data Tunnel engine.
    if (config.target_table !== "dialer_session_log") {
      throw new Error("Unsupported target table. Use an approved staged mapping for HRMS master data");
    }

    assertSafeIdentifier(config.target_table, "target table");
    const credentials = getDbCredentials(connector.secret_name ?? "");
    const dialect = dialectFor(config);
    const fromDate = opts.fromDate ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const toDate = opts.toDate ?? new Date().toISOString().slice(0, 10);

    for (const sourceTable of config.source_tables) {
      try {
        assertSafeIdentifier(sourceTable, "source table");
        const plainTableName = sourceTable.split(".").at(-1) ?? sourceTable;
        const isVicidial = plainTableName.startsWith("vicidial_agent_log");
        const isCdr = plainTableName.startsWith("cdr_");

        let query: string;
        if (isVicidial) {
          query = buildDialerAggregateQuery(sourceTable, {
            dialect,
            agentCodeCol: config.agent_code_column ?? "user",
            dateCol: config.date_column ?? "event_time",
            talkCol: config.talk_col ?? "talk_sec",
            pauseCol: config.pause_col ?? "pause_sec",
            campaignCol: config.campaign_col ?? "campaign_id",
            fromDate,
            toDate,
          });
        } else if (isCdr) {
          query = buildCdrAggregateQuery(sourceTable, {
            dialect,
            agentIdCol: config.agent_code_column ?? "AgentId",
            agentNameCol: config.agent_name_column ?? "AgentName",
            dateCol: config.date_column ?? "CallDate",
            talkCol: config.talk_col ?? "CallDurationSecond",
            campaignCol: config.campaign_col ?? "CampaignName",
            dispositionCol: config.disposition_col ?? "Disposition",
            fromDate,
            toDate,
          });
        } else {
          throw new Error("Source table is not an approved dialer/CDR pattern; configure it through staged mapping");
        }

        const fetched = await fetchFromDatabase({
          host: config.host,
          port: config.port ?? (dialect === "mssql" ? 1433 : 3306),
          database: config.database,
          user: credentials.user,
          password: credentials.password,
          db_type: dialect,
          encrypt: config.encrypt ?? false,
          trustServerCertificate: config.trust_server_certificate ?? true,
        }, query);

        result.rows_fetched += fetched.rowCount;

        for (const row of fetched.rows) {
          const employeeCode = String(row.employee_code ?? "").trim();
          const sessionDate = String(row.session_date ?? toDate).slice(0, 10);
          if (!employeeCode || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
            result.rows_skipped++;
            continue;
          }

          try {
            await db.execute(
              `INSERT INTO dialer_session_log
                 (id, integration_key, employee_code, session_date, login_minutes, process_name, source_system)
               VALUES (UUID(), ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 login_minutes = VALUES(login_minutes),
                 process_name = VALUES(process_name),
                 source_system = VALUES(source_system)`,
              [
                connector.integration_key,
                employeeCode,
                sessionDate,
                Number(row.login_minutes ?? 0),
                String(row.process_name ?? "").trim(),
                `${config.database}.${sourceTable}`,
              ],
            );
            result.rows_inserted++;
          } catch (error) {
            result.rows_skipped++;
            if (result.errors.length < 25) {
              result.errors.push(`${sourceTable}/${employeeCode}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      } catch (error) {
        result.errors.push(`${sourceTable}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    result.duration_ms = Date.now() - startedAt;
  }

  return result;
}
