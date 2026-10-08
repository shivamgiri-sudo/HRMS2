import "dotenv/config";
import { createCipheriv, randomBytes } from "crypto";
import mysql from "mysql2/promise";

type Connector = {
  key: string;
  name: string;
  database: string;
  dateColumn: string;
  employeeCodeColumn: string;
  tables: string[];
};

const connectors: Connector[] = [
  {
    key: "apr_productivity",
    name: "Dialer APR Productivity",
    database: process.env.PERFORMANCE_APR_DB_NAME ?? "dialer_db",
    dateColumn: "event_time",
    employeeCodeColumn: "user",
    tables: ["vw_agent_log_all"],
  },
  {
    key: "quality_audit",
    name: "Quality Audit - Mydashboards Source",
    database: process.env.PERFORMANCE_QUALITY_DB_NAME ?? "db_audit",
    dateColumn: "CallDate",
    employeeCodeColumn: "User",
    tables: ["call_quality_assessment"],
  },
  {
    key: "outbound_calls",
    name: "Outbound Calls - Mydashboards Source",
    database: process.env.PERFORMANCE_OUTBOUND_DB_NAME ?? "db_external",
    dateColumn: "CallDate",
    employeeCodeColumn: "AgentName",
    tables: ["CallDetails"],
  },
  {
    key: "sales_brand_mis",
    name: "Brand Sales MIS - Mydashboards Source",
    database: process.env.PERFORMANCE_SALES_DB_NAME ?? "db_masmis",
    dateColumn: "report_date",
    employeeCodeColumn: "emp_id",
    tables: ["bb_apr", "gnc_apr", "neemans_apr", "bb_sale", "gnc_sale", "neemans_sale_raw"],
  },
];

function requireApplyFlag(): void {
  if (!process.argv.includes("--apply")) {
    throw new Error("Refusing to write connector credentials without --apply");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function encryptPayload(payload: Record<string, unknown>): string {
  const key = Buffer.from(requireEnv("ENCRYPTION_KEY"), "hex");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

async function main() {
  requireApplyFlag();

  const sourceHost = requireEnv("PERFORMANCE_SOURCE_HOST");
  const sourceUser = requireEnv("PERFORMANCE_SOURCE_USER");
  const sourcePassword = requireEnv("PERFORMANCE_SOURCE_PASSWORD");
  const sourcePort = Number(process.env.PERFORMANCE_SOURCE_PORT ?? 3306);

  const pool = mysql.createPool({
    host: requireEnv("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 3306),
    user: requireEnv("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    database: requireEnv("DB_NAME"),
    connectionLimit: 2,
    connectTimeout: 10_000,
  });

  try {
    for (const connector of connectors) {
      const encrypted = encryptPayload({
        host: sourceHost,
        port: sourcePort,
        database: connector.database,
        username: sourceUser,
        password: sourcePassword,
        db_type: "mysql",
        date_column: connector.dateColumn,
        employee_code_column: connector.employeeCodeColumn,
        tables: connector.tables,
      });

      await pool.execute(
        `INSERT INTO integration_config
           (id, integration_key, integration_name, integration_type, auth_type, active_status, config_json, encrypted_credentials, notes)
         VALUES
           (UUID(), ?, ?, 'database', 'basic', 1, ?, ?, 'Encrypted read-only source connector for Performance Hub')
         ON DUPLICATE KEY UPDATE
           integration_name = VALUES(integration_name),
           integration_type = VALUES(integration_type),
           auth_type = VALUES(auth_type),
           active_status = 1,
           config_json = VALUES(config_json),
           encrypted_credentials = VALUES(encrypted_credentials),
           updated_at = NOW()`,
        [
          connector.key,
          connector.name,
          JSON.stringify({
            db_type: "mysql",
            host: sourceHost,
            port: sourcePort,
            database: connector.database,
            username: sourceUser,
            date_column: connector.dateColumn,
            employee_code_column: connector.employeeCodeColumn,
            tables: connector.tables,
          }),
          encrypted,
        ],
      );
    }

    console.log(JSON.stringify({
      configured: connectors.map((connector) => connector.key),
      note: "Credentials were encrypted before storage. No secret values were printed.",
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
