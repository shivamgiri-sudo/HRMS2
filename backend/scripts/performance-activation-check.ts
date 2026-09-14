import "dotenv/config";
import mysql from "mysql2/promise";

type QueryResult = Record<string, unknown>[];

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function query(pool: mysql.Pool, sql: string, params: unknown[] = []): Promise<QueryResult> {
  const [rows] = await withTimeout(pool.query(sql, params), 15_000, "query");
  return rows as QueryResult;
}

async function main() {
  const host = process.env.DB_HOST ?? "localhost";
  const port = Number(process.env.DB_PORT ?? 3306);
  const user = process.env.DB_USER ?? "root";
  const password = process.env.DB_PASSWORD ?? "";
  const database = process.env.DB_NAME ?? "mas_hrms";

  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    connectTimeout: 10_000,
    connectionLimit: 2,
    waitForConnections: true,
  });

  try {
    const migrations = await query(
      pool,
      `SELECT filename, applied_at
         FROM schema_migrations
        WHERE filename IN (?, ?, ?)
        ORDER BY filename`,
      [
        "504_performance_intelligence_foundation.sql",
        "505_performance_source_connector_keys.sql",
        "506_sales_performance_metric_foundation.sql",
      ],
    );

    const connectors = await query(
      pool,
      `SELECT integration_key,
              active_status,
              CASE WHEN encrypted_credentials IS NULL OR encrypted_credentials = '' THEN 0 ELSE 1 END AS has_credentials,
              test_ok,
              test_error
         FROM integration_config
        WHERE integration_key IN (?, ?, ?, ?)
        ORDER BY integration_key`,
      ["apr_productivity", "quality_audit", "outbound_calls", "sales_brand_mis"],
    );

    const lineageColumns = await query(
      pool,
      `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'kpi_daily_actual'
          AND COLUMN_NAME IN (?, ?, ?, ?, ?, ?, ?)
        ORDER BY COLUMN_NAME`,
      [
        "numerator_value",
        "denominator_value",
        "source_system",
        "source_record_count",
        "formula_version_id",
        "integration_run_id",
        "computed_at",
      ],
    );

    const metrics = await query(
      pool,
      `SELECT metric_code, active_status
         FROM kpi_metric_master
        WHERE metric_code IN (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ORDER BY metric_code`,
      [
        "SALES_COUNT",
        "REVENUE",
        "AOV",
        "COD_SHARE",
        "RTO_RATE",
        "CONVERSION_RATE",
        "QUALITY_SCORE",
        "AHT",
        "DIALS",
      ],
    );

    const counts = await query(
      pool,
      `SELECT
         (SELECT COUNT(*) FROM employees WHERE active_status = 1) AS active_employees,
         (SELECT COUNT(*) FROM kpi_daily_actual) AS kpi_daily_actual_rows`,
    );

    const sourceTables = await query(
      pool,
      `SELECT TABLE_SCHEMA, TABLE_NAME
         FROM INFORMATION_SCHEMA.TABLES
        WHERE (TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME IN ('bb_apr', 'gnc_apr', 'bb_sale', 'gnc_sale', 'neemans_apr', 'neemans_sale_raw'))
           OR (TABLE_SCHEMA = 'db_audit' AND TABLE_NAME IN ('call_quality_assessment'))
           OR (TABLE_SCHEMA = 'db_external' AND TABLE_NAME IN ('CallDetails'))
           OR (TABLE_SCHEMA = 'dialer_db' AND TABLE_NAME IN ('vw_agent_log_all'))
        ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    );

    const output = {
      mode: "read-only",
      date: readArg("date") ?? null,
      db: { host, database },
      migrations,
      connectors,
      lineageColumns: lineageColumns.map((row) => row.COLUMN_NAME),
      metrics,
      sourceTables,
      counts: counts[0] ?? {},
      note: "No INSERT, UPDATE, DELETE, ALTER, DROP, migration, or sync command was executed.",
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
