import { db } from "../../../db/mysql.js";
import {
  assertSafeIdentifier,
  buildBiometricAggregateQuery,
  buildCdrAggregateQuery,
  buildDialerAggregateQuery,
  fetchFromDatabase,
  type DbDialect,
} from "./databaseAdapter.js";
import type { IntegrationConfig } from "../integration.types.js";
import { integrationService } from "../integration.service.js";
import { getCredentialsForKey } from "../../external-db/external-db.service.js";

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
  wait_col?: string;
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
  affected_dates: string[];
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

function dialectFor(config: DbConfig): DbDialect {
  return config.db_type === "mssql" || config.db_type === "sqlserver" ? "mssql" : "mysql";
}

function sqlDate(value: unknown, fallback: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? fallback;
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
    affected_dates: [],
  };
  const startedAt = Date.now();

  try {
    if (connector.integration_type !== "database") throw new Error("Not a database connector");
    if (!connector.active_status) throw new Error("Database connector is inactive");

    const config = parseConfig(connector.config_json);
    if (!config.host || !config.database) throw new Error("Missing host or database in config_json");
    const credentials = await getCredentialsForKey(connector.integration_key);
    if (!credentials) throw new Error("Database credentials are not configured");
    const tableMaps = await integrationService.listTableMaps(connector.integration_key);
    const effectiveMaps = tableMaps.length > 0
      ? tableMaps
      : (config.source_tables ?? []).map((sourceTable) => ({
          source_table: sourceTable,
          target_table: config.target_table,
          sync_mode: "daily_aggregate",
        }));
    if (effectiveMaps.length === 0) {
      throw new Error("At least one approved source table is required");
    }

    const approvedTargets = new Set([
      "dialer_session_log",
      "integration_call_daily",
      "integration_biometric_daily",
    ]);
    if (effectiveMaps.some((mapping) => !mapping.target_table || !approvedTargets.has(mapping.target_table))) {
      throw new Error("Unsupported target table. Select an approved Integration Hub destination");
    }

    const fieldMaps = await integrationService.listFieldMaps(connector.integration_key);
    const dialect = dialectFor(config);
    const fromDate = opts.fromDate ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const toDate = opts.toDate ?? new Date().toISOString().slice(0, 10);

    for (const tableMap of effectiveMaps) {
      const sourceTable = tableMap.source_table;
      const targetTable = tableMap.target_table;
      try {
        assertSafeIdentifier(sourceTable, "source table");
        assertSafeIdentifier(targetTable, "target table");
        const plainTableName = sourceTable.split(".").at(-1) ?? sourceTable;
        const isVicidial = plainTableName.startsWith("vicidial_agent_log");
        const isCdr = plainTableName.startsWith("cdr_");
        const isGenericCallLog = plainTableName === "call_logs";
        const tableFieldMaps = fieldMaps.filter(
          (mapping) => mapping.source_table === sourceTable || mapping.source_table === "*",
        );
        const sourceFor = (targetColumn: string, fallback: string): string =>
          tableFieldMaps.find(
            (mapping) => mapping.target_table === targetTable && mapping.target_column === targetColumn,
          )?.source_field ?? fallback;
        const isBiometric = targetTable === "integration_biometric_daily";
        const dateTarget = targetTable === "dialer_session_log" ? "session_date" : "activity_date";
        const minutesTarget = targetTable === "integration_call_daily"
          ? "talk_minutes"
          : isBiometric ? "biometric_minutes" : "login_minutes";

        let query: string;
        if (isBiometric) {
          const mapped = (targetColumn: string) =>
            tableFieldMaps.find(
              (mapping) => mapping.target_table === targetTable && mapping.target_column === targetColumn,
            )?.source_field;
          query = buildBiometricAggregateQuery(sourceTable, {
            dialect,
            employeeCodeCol: sourceFor("employee_code", config.agent_code_column ?? "employee_code"),
            dateCol: sourceFor(dateTarget, config.date_column ?? "event_time"),
            punchTimeCol: mapped("punch_time"),
            firstPunchCol: mapped("first_punch"),
            lastPunchCol: mapped("last_punch"),
            minutesCol: mapped(minutesTarget),
            fromDate,
            toDate,
          });
        } else if (isVicidial) {
          query = buildDialerAggregateQuery(sourceTable, {
            dialect,
            agentCodeCol: sourceFor("employee_code", config.agent_code_column ?? "user"),
            dateCol: sourceFor(dateTarget, config.date_column ?? "event_time"),
            talkCol: sourceFor(minutesTarget, config.talk_col ?? "talk_sec"),
            pauseCol: config.pause_col ?? "pause_sec",
            waitCol: config.wait_col ?? "wait_sec",
            campaignCol: sourceFor("process_name", config.campaign_col ?? "campaign_id"),
            groupByCampaign: targetTable !== "dialer_session_log",
            includePauseWait: targetTable === "dialer_session_log",
            fromDate,
            toDate,
          });
        } else if (isCdr || isGenericCallLog) {
          const outbound = plainTableName.startsWith("cdr_ob");
          query = buildCdrAggregateQuery(sourceTable, {
            dialect,
            agentIdCol: sourceFor("employee_code", isGenericCallLog ? "agent_id" : outbound ? "Agent" : "AgentId"),
            agentNameCol: config.agent_name_column ?? (
              isGenericCallLog ? "agent_id" : outbound ? "Agent" : "AgentName"
            ),
            dateCol: sourceFor(dateTarget, isGenericCallLog ? "start_time" : "CallDate"),
            talkCol: sourceFor(minutesTarget, isGenericCallLog ? "duration" : outbound ? "talk_sec" : "CallDurationSecond"),
            campaignCol: sourceFor("process_name", isGenericCallLog ? "campaign_id" : outbound ? "campaign_id" : "CampaignName"),
            dispositionCol: config.disposition_col ?? (
              isGenericCallLog ? "call_type" : outbound ? "CallStatus" : "Disposition"
            ),
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
          user: credentials.username,
          password: credentials.password,
          db_type: dialect,
          encrypt: config.encrypt ?? false,
          trustServerCertificate: config.trust_server_certificate ?? true,
        }, query);

        result.rows_fetched += fetched.rowCount;

        for (const row of fetched.rows) {
          const employeeCode = String(row.employee_code ?? "").trim();
          const sessionDate = sqlDate(row.session_date, toDate);
          if (!employeeCode || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
            result.rows_skipped++;
            if (result.errors.length < 25) {
              result.errors.push(`${sourceTable}: invalid employee code or session date`);
            }
            continue;
          }

          try {
            const processName = String(row.process_name ?? "").trim();
            if (targetTable === "dialer_session_log") {
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
                  processName,
                  `${config.database}.${sourceTable}`,
                ],
              );
            } else if (targetTable === "integration_call_daily") {
              await db.execute(
                `INSERT INTO integration_call_daily
                   (id, integration_key, source_table, employee_code, activity_date,
                    process_name, total_calls, talk_minutes, run_id)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NULL)
                 ON DUPLICATE KEY UPDATE
                   total_calls = VALUES(total_calls),
                   talk_minutes = VALUES(talk_minutes),
                   updated_at = NOW()`,
                [
                  connector.integration_key,
                  sourceTable,
                  employeeCode,
                  sessionDate,
                  processName,
                  Number(row.total_calls ?? row.event_count ?? 0),
                  Number(row.login_minutes ?? 0),
                ],
              );
            } else {
              await db.execute(
                `INSERT INTO integration_biometric_daily
                   (id, integration_key, source_table, employee_code, activity_date,
                    first_punch, last_punch, biometric_minutes, run_id)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NULL)
                 ON DUPLICATE KEY UPDATE
                   first_punch = VALUES(first_punch),
                   last_punch = VALUES(last_punch),
                   biometric_minutes = VALUES(biometric_minutes),
                   updated_at = NOW()`,
                [
                  connector.integration_key,
                  sourceTable,
                  employeeCode,
                  sessionDate,
                  row.first_punch ?? null,
                  row.last_punch ?? null,
                  Math.max(0, Number(row.login_minutes ?? 0)),
                ],
              );
              if (!result.affected_dates.includes(sessionDate)) {
                result.affected_dates.push(sessionDate);
              }
            }
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
