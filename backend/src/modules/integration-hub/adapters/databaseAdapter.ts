import mysql from "mysql2/promise";
import sql from "mssql";

export type DbDialect = "mysql" | "mssql";

export interface DbAdapterConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  db_type?: DbDialect;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export interface DbFetchResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

const IDENTIFIER_PART = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertSafeIdentifier(identifier: string, label = "identifier"): string {
  const value = String(identifier ?? "").trim();
  const parts = value.split(".");
  if (!value || parts.some((part) => !IDENTIFIER_PART.test(part))) {
    throw new Error(`Invalid ${label}: ${value || "(blank)"}`);
  }
  return value;
}

export function quoteIdentifier(identifier: string, dialect: DbDialect): string {
  return assertSafeIdentifier(identifier)
    .split(".")
    .map((part) => dialect === "mssql" ? `[${part}]` : `\`${part}\``)
    .join(".");
}

function safeDate(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!ISO_DATE.test(value)) throw new Error(`${label} must be YYYY-MM-DD`);
  return value;
}

/** Execute a read-only query against an approved MySQL or SQL Server source. */
export async function fetchFromDatabase(
  config: DbAdapterConfig,
  query: string,
  params: readonly unknown[] = [],
): Promise<DbFetchResult> {
  const start = Date.now();
  const dialect = config.db_type ?? "mysql";

  if (dialect === "mssql") {
    const pool = await new sql.ConnectionPool({
      server: config.host,
      port: config.port || 1433,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionTimeout: 10_000,
      requestTimeout: 60_000,
      pool: { min: 0, max: 3, idleTimeoutMillis: 30_000 },
      options: {
        encrypt: config.encrypt ?? false,
        trustServerCertificate: config.trustServerCertificate ?? true,
      },
    }).connect();

    try {
      const request = pool.request();
      params.forEach((value, index) => request.input(`p${index}`, value as any));
      const result = await request.query(query);
      const rows = (result.recordset ?? []) as Record<string, unknown>[];
      return { rows, rowCount: rows.length, durationMs: Date.now() - start };
    } finally {
      await pool.close().catch(() => undefined);
    }
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 3,
    connectTimeout: 10_000,
    timezone: "+00:00",
  });

  try {
    const [rows] = await pool.execute(query, params as any);
    const resultRows = rows as Record<string, unknown>[];
    return { rows: resultRows, rowCount: resultRows.length, durationMs: Date.now() - start };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export function buildDialerAggregateQuery(
  tableName: string,
  opts: {
    dialect?: DbDialect;
    agentCodeCol?: string;
    dateCol?: string;
    talkCol?: string;
    pauseCol?: string;
    campaignCol?: string;
    fromDate?: string;
    toDate?: string;
  } = {},
): string {
  const dialect = opts.dialect ?? "mysql";
  const table = quoteIdentifier(tableName, dialect);
  const agent = quoteIdentifier(opts.agentCodeCol ?? "user", dialect);
  const date = quoteIdentifier(opts.dateCol ?? "event_time", dialect);
  const talk = quoteIdentifier(opts.talkCol ?? "talk_sec", dialect);
  const pause = quoteIdentifier(opts.pauseCol ?? "pause_sec", dialect);
  const campaign = quoteIdentifier(opts.campaignCol ?? "campaign_id", dialect);
  const fromDate = safeDate(opts.fromDate, "fromDate");
  const toDate = safeDate(opts.toDate, "toDate");
  const dayExpr = dialect === "mssql" ? `CAST(${date} AS date)` : `DATE(${date})`;

  let where = "WHERE 1=1";
  if (fromDate) where += ` AND ${dayExpr} >= '${fromDate}'`;
  if (toDate) where += ` AND ${dayExpr} <= '${toDate}'`;
  where += dialect === "mssql"
    ? ` AND ${agent} LIKE '[A-Z][A-Z]%[0-9]'`
    : ` AND ${agent} REGEXP '^[A-Z]{2,4}[0-9]{4,6}$'`;

  const top = dialect === "mssql" ? "TOP (10000) " : "";
  const limit = dialect === "mysql" ? "LIMIT 10000" : "";

  return `
    SELECT ${top}
      ${agent} AS employee_code,
      ${dayExpr} AS session_date,
      ${campaign} AS process_name,
      ROUND(SUM(${talk}) / 60.0, 0) AS login_minutes,
      ROUND(SUM(${pause}) / 60.0, 0) AS break_minutes,
      COUNT(*) AS event_count
    FROM ${table}
    ${where}
    GROUP BY ${agent}, ${dayExpr}, ${campaign}
    ORDER BY ${dayExpr} DESC, login_minutes DESC
    ${limit}
  `.trim();
}

export function buildCdrAggregateQuery(
  tableName: string,
  opts: {
    dialect?: DbDialect;
    agentIdCol?: string;
    agentNameCol?: string;
    dateCol?: string;
    talkCol?: string;
    campaignCol?: string;
    dispositionCol?: string;
    fromDate?: string;
    toDate?: string;
  } = {},
): string {
  const dialect = opts.dialect ?? "mysql";
  const table = quoteIdentifier(tableName, dialect);
  const agentId = quoteIdentifier(opts.agentIdCol ?? "AgentId", dialect);
  const agentName = quoteIdentifier(opts.agentNameCol ?? "AgentName", dialect);
  const date = quoteIdentifier(opts.dateCol ?? "CallDate", dialect);
  const talk = quoteIdentifier(opts.talkCol ?? "CallDurationSecond", dialect);
  const campaign = quoteIdentifier(opts.campaignCol ?? "CampaignName", dialect);
  const disposition = quoteIdentifier(opts.dispositionCol ?? "Disposition", dialect);
  const fromDate = safeDate(opts.fromDate, "fromDate");
  const toDate = safeDate(opts.toDate, "toDate");
  const dayExpr = dialect === "mssql" ? `CAST(${date} AS date)` : `DATE(${date})`;

  let where = "WHERE 1=1";
  if (fromDate) where += ` AND ${dayExpr} >= '${fromDate}'`;
  if (toDate) where += ` AND ${dayExpr} <= '${toDate}'`;

  const top = dialect === "mssql" ? "TOP (10000) " : "";
  const limit = dialect === "mysql" ? "LIMIT 10000" : "";

  return `
    SELECT ${top}
      ${agentId} AS employee_code,
      ${agentName} AS employee_name,
      ${dayExpr} AS session_date,
      ${campaign} AS process_name,
      ROUND(SUM(${talk}) / 60.0, 0) AS login_minutes,
      COUNT(*) AS total_calls,
      SUM(CASE WHEN ${disposition} IS NOT NULL THEN 1 ELSE 0 END) AS dispositioned_calls
    FROM ${table}
    ${where}
    GROUP BY ${agentId}, ${agentName}, ${dayExpr}, ${campaign}
    ORDER BY ${dayExpr} DESC, total_calls DESC
    ${limit}
  `.trim();
}
