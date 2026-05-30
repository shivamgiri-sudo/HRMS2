import mysql from "mysql2/promise";

export interface DbAdapterConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  db_type?: "mysql"; // currently only MySQL
}

export interface DbFetchResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

/**
 * Execute a parameterised read-only source query. Connector query parameters
 * arrive from approved mapping/sync rules; retain one cast at the external DB
 * boundary because mysql2 does not accept an assembled unknown[] at compile time.
 */
export async function fetchFromDatabase(
  config: DbAdapterConfig,
  query: string,
  params: readonly unknown[] = []
): Promise<DbFetchResult> {
  const start = Date.now();

  const pool = mysql.createPool({
    host:            config.host,
    port:            config.port,
    user:            config.user,
    password:        config.password,
    database:        config.database,
    connectionLimit: 3,
    connectTimeout:  10000,
    timezone:        "+00:00",
  });

  try {
    const [rows] = await pool.execute(query, params as any[]);
    const durationMs = Date.now() - start;
    await pool.end();
    return {
      rows: rows as Record<string, unknown>[],
      rowCount: (rows as unknown[]).length,
      durationMs,
    };
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
}

/**
 * Build a daily aggregate query for vicidial_agent_log style tables.
 * Returns: user (agent_code), session_date, total_login_minutes, campaign_id
 */
export function buildDialerAggregateQuery(
  tableName: string,
  opts: {
    agentCodeCol?: string;
    dateCol?: string;
    talkCol?: string;
    campaignCol?: string;
    fromDate?: string;
    toDate?: string;
  } = {}
): string {
  const {
    agentCodeCol = "user",
    dateCol      = "event_time",
    talkCol      = "talk_sec",
    campaignCol  = "campaign_id",
    fromDate,
    toDate,
  } = opts;

  let where = "WHERE 1=1";
  if (fromDate) where += ` AND DATE(${dateCol}) >= '${fromDate}'`;
  if (toDate)   where += ` AND DATE(${dateCol}) <= '${toDate}'`;

  return `
    SELECT
      ${agentCodeCol}              AS employee_code,
      DATE(${dateCol})             AS session_date,
      ${campaignCol}               AS process_name,
      ROUND(SUM(${talkCol}) / 60)  AS login_minutes,
      ROUND(SUM(pause_sec) / 60)   AS break_minutes,
      COUNT(*)                     AS event_count
    FROM ${tableName}
    ${where}
      AND ${agentCodeCol} REGEXP '^[A-Z]{2,4}[0-9]{4,6}$'
    GROUP BY ${agentCodeCol}, DATE(${dateCol}), ${campaignCol}
    ORDER BY DATE(${dateCol}) DESC, login_minutes DESC
    LIMIT 10000
  `.trim();
}

/**
 * Build query for CDR-style tables (cdr_in_*, cdr_ob_*).
 * Returns per-agent per-day call counts and durations.
 */
export function buildCdrAggregateQuery(
  tableName: string,
  opts: {
    agentIdCol?:   string;
    agentNameCol?: string;
    dateCol?:      string;
    talkCol?:      string;
    campaignCol?:  string;
    dispositionCol?: string;
    fromDate?: string;
    toDate?: string;
  } = {}
): string {
  const {
    agentIdCol    = "AgentId",
    agentNameCol  = "AgentName",
    dateCol       = "CallDate",
    talkCol       = "CallDurationSecond",
    campaignCol   = "CampaignName",
    dispositionCol = "Disposition",
    fromDate,
    toDate,
  } = opts;

  let where = "WHERE 1=1";
  if (fromDate) where += ` AND DATE(${dateCol}) >= '${fromDate}'`;
  if (toDate)   where += ` AND DATE(${dateCol}) <= '${toDate}'`;

  return `
    SELECT
      ${agentIdCol}                    AS employee_code,
      ${agentNameCol}                  AS employee_name,
      DATE(${dateCol})                 AS session_date,
      ${campaignCol}                   AS process_name,
      ROUND(SUM(${talkCol}) / 60)      AS login_minutes,
      COUNT(*)                         AS total_calls,
      SUM(CASE WHEN ${dispositionCol} IS NOT NULL THEN 1 ELSE 0 END) AS dispositioned_calls
    FROM ${tableName}
    ${where}
    GROUP BY ${agentIdCol}, ${agentNameCol}, DATE(${dateCol}), ${campaignCol}
    ORDER BY DATE(${dateCol}) DESC, total_calls DESC
    LIMIT 10000
  `.trim();
}
