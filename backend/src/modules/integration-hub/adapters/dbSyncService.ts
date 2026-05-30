import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { fetchFromDatabase, buildDialerAggregateQuery, buildCdrAggregateQuery } from "./databaseAdapter.js";
import type { IntegrationConfig } from "../integration.types.js";

interface DbConfig {
  db_type?: string;
  host: string;
  port: number;
  database: string;
  source_tables: string[];
  target_table: string;
  agent_code_column?: string;
  date_column?: string;
  talk_col?: string;
  pause_col?: string;
  campaign_col?: string;
  sync_mode?: "daily_aggregate" | "daily_snapshot" | "incremental";
}

interface SyncResult {
  rows_fetched: number;
  rows_inserted: number;
  rows_skipped: number;
  duration_ms: number;
  errors: string[];
}

/**
 * Get DB credentials from environment using the secret_name as key prefix.
 * Convention: secret_name = "dialer_db_creds"
 *   → env vars: DIALER_DB_CREDS_USER, DIALER_DB_CREDS_PASS
 * Falls back to the shared shivam_user credentials for the 122.184.128.90 server.
 */
function getDbCredentials(secretName: string): { user: string; password: string } {
  const prefix = (secretName ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const user     = process.env[`${prefix}_USER`]     ?? process.env.DB_USER ?? "shivam_user";
  const password = process.env[`${prefix}_PASS`]     ?? process.env.DB_PASSWORD ?? "";
  return { user, password };
}

export async function syncDatabaseConnector(
  connector: IntegrationConfig,
  opts: { fromDate?: string; toDate?: string; userId?: string } = {}
): Promise<SyncResult> {
  const result: SyncResult = { rows_fetched: 0, rows_inserted: 0, rows_skipped: 0, duration_ms: 0, errors: [] };
  const start = Date.now();

  if (connector.integration_type !== "database") {
    result.errors.push("Not a database connector");
    return result;
  }

  const cfg = (connector.config_json ?? {}) as unknown as DbConfig;
  if (!cfg.host || !cfg.database) {
    result.errors.push("Missing host or database in config_json");
    return result;
  }

  const creds = getDbCredentials(connector.secret_name ?? "");

  const fromDate = opts.fromDate ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const toDate   = opts.toDate   ?? new Date().toISOString().slice(0, 10);

  for (const sourceTable of (cfg.source_tables ?? [])) {
    try {
      // Build appropriate query based on table naming pattern
      let query: string;
      const isVicidial = sourceTable.startsWith("vicidial_agent_log");
      const isCdr = sourceTable.startsWith("cdr_");

      if (isVicidial) {
        query = buildDialerAggregateQuery(sourceTable, {
          agentCodeCol: cfg.agent_code_column ?? "user",
          dateCol:      cfg.date_column       ?? "event_time",
          talkCol:      cfg.talk_col          ?? "talk_sec",
          campaignCol:  cfg.campaign_col      ?? "campaign_id",
          fromDate,
          toDate,
        });
      } else if (isCdr) {
        query = buildCdrAggregateQuery(sourceTable, {
          agentIdCol:  cfg.agent_code_column ?? "AgentId",
          dateCol:     cfg.date_column       ?? "CallDate",
          talkCol:     "CallDurationSecond",
          campaignCol: cfg.campaign_col      ?? "CampaignName",
          fromDate,
          toDate,
        });
      } else {
        // Generic: just select all rows in date range
        query = `SELECT * FROM ${sourceTable} WHERE 1=1 LIMIT 5000`;
      }

      const fetched = await fetchFromDatabase(
        { host: cfg.host, port: cfg.port ?? 3306, database: cfg.database, user: creds.user, password: creds.password },
        query
      );

      result.rows_fetched += fetched.rowCount;

      // Write rows to target table (dialer_session_log for vicidial/cdr)
      if (cfg.target_table === "dialer_session_log" && fetched.rowCount > 0) {
        for (const row of fetched.rows) {
          try {
            await db.execute(
              `INSERT INTO dialer_session_log
                 (id, integration_key, employee_code, session_date, login_minutes, process_name, source_system)
               VALUES (UUID(), ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 login_minutes = login_minutes + VALUES(login_minutes),
                 source_system = VALUES(source_system)`,
              [
                connector.integration_key,
                String(row.employee_code ?? row.user ?? ""),
                String(row.session_date  ?? row.CallDate ?? toDate),
                Number(row.login_minutes ?? (Number(row.total_talk_sec ?? 0) / 60)),
                String(row.process_name  ?? row.campaign_id ?? ""),
                `${cfg.database}.${sourceTable}`,
              ]
            );
            result.rows_inserted++;
          } catch {
            result.rows_skipped++;
          }
        }
      }

    } catch (err: any) {
      result.errors.push(`${sourceTable}: ${err.message}`);
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
}
