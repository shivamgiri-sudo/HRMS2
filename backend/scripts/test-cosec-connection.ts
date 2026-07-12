#!/usr/bin/env npx tsx
/**
 * Quick COSEC connectivity test that tolerates schema differences.
 * Usage: npx tsx scripts/test-cosec-connection.ts
 */

import "dotenv/config";
import sql from "mssql";

type TableNameRow = { TABLE_NAME: string };
type ColumnNameRow = { COLUMN_NAME: string };
type StatRow = {
  total_events?: number;
  unique_users?: number;
  earliest_event?: string | Date | null;
  latest_event?: string | Date | null;
};
type SampleRow = {
  UserID?: string;
  punch_date?: Date | string | null;
  punch_time?: string | null;
  AccessLocationID?: string | number | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required; configure it in backend/.env or the Integration Hub`);
  }
  return value;
}

const config: sql.config = {
  server: process.env.NCOSEC_DB_HOST || "<NCOSEC_DB_HOST>",
  port: parseInt(process.env.NCOSEC_DB_PORT || "1433", 10),
  user: requiredEnv("NCOSEC_DB_USER"),
  password: requiredEnv("NCOSEC_DB_PASSWORD"),
  database: process.env.NCOSEC_DB_NAME || "NCOSEC",
  options: {
    encrypt: process.env.NCOSEC_DB_ENCRYPT === "true",
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

function formatDateOnly(value: Date | string | null | undefined): string {
  if (!value) return "N/A";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10) || "N/A";
}

async function hasColumn(
  pool: sql.ConnectionPool,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await pool.request()
    .input("tableName", sql.NVarChar(128), tableName)
    .input("columnName", sql.NVarChar(128), columnName)
    .query<ColumnNameRow>(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName
        AND COLUMN_NAME = @columnName
    `);
  return result.recordset.length > 0;
}

async function testConnection() {
  console.log("COSEC Database Connection Test\n");
  console.log("Configuration:");
  console.log(`  Host:     ${config.server}`);
  console.log(`  Port:     ${config.port}`);
  console.log(`  User:     ${config.user}`);
  console.log(`  Password: ${"*".repeat(config.password?.length || 0)}`);
  console.log(`  Database: ${config.database}`);
  console.log(`  Encrypt:  ${config.options?.encrypt}\n`);

  let pool: sql.ConnectionPool | null = null;

  try {
    console.log("[1/4] Connecting to COSEC SQL Server...");
    pool = await new sql.ConnectionPool(config).connect();
    console.log("Connected successfully.\n");

    console.log("[2/4] Testing basic query...");
    await pool.request().query("SELECT 1 AS test");
    console.log("Basic query successful.\n");

    console.log("[3/4] Checking required tables...");
    const tablesResult = await pool.request().query<TableNameRow>(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME IN ('Mx_ATDEventTrn', 'Mx_UserMst')
      ORDER BY TABLE_NAME
    `);

    if (tablesResult.recordset.length === 2) {
      console.log("Required tables found:");
      tablesResult.recordset.forEach((row) => console.log(`  - ${row.TABLE_NAME}`));
      console.log();
    } else {
      console.log("Warning: Some required tables are missing.");
      console.log(`  Found: ${tablesResult.recordset.map((row) => row.TABLE_NAME).join(", ")}\n`);
    }

    console.log("[4/4] Checking recent attendance data...");
    const countResult = await pool.request().query<StatRow>(`
      SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT UserID) AS unique_users,
        MIN(EDateTime) AS earliest_event,
        MAX(EDateTime) AS latest_event
      FROM Mx_ATDEventTrn WITH (NOLOCK)
      WHERE EDateTime >= DATEADD(DAY, -7, GETDATE())
    `);

    const stats = countResult.recordset[0] as StatRow;
    console.log("Recent data (last 7 days):");
    console.log(`  Total Events:   ${stats.total_events?.toLocaleString() || 0}`);
    console.log(`  Unique Users:   ${stats.unique_users?.toLocaleString() || 0}`);
    console.log(`  Earliest Event: ${stats.earliest_event || "N/A"}`);
    console.log(`  Latest Event:   ${stats.latest_event || "N/A"}`);
    console.log();

    const includeAccessLocation = await hasColumn(pool, "Mx_ATDEventTrn", "AccessLocationID");
    const locationColumn = includeAccessLocation
      ? "AccessLocationID"
      : "CAST(NULL AS NVARCHAR(100)) AS AccessLocationID";

    console.log("Sample Punch Records (Today):");
    const sampleResult = await pool.request().query<SampleRow>(`
      SELECT TOP 5
        UserID,
        CAST(EDateTime AS DATE) AS punch_date,
        CAST(IDateTime AS TIME) AS punch_time,
        ${locationColumn}
      FROM Mx_ATDEventTrn WITH (NOLOCK)
      WHERE CAST(EDateTime AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY IDateTime DESC
    `);

    if (sampleResult.recordset.length > 0) {
      console.log("UserID       Date         Time       Location");
      console.log("------------ ------------ ---------- --------");
      sampleResult.recordset.forEach((row) => {
        const userId = String(row.UserID ?? "").padEnd(12);
        const date = formatDateOnly(row.punch_date).padEnd(12);
        const time = String(row.punch_time ?? "N/A").padEnd(10);
        const location = String(row.AccessLocationID ?? "").padEnd(8);
        console.log(`${userId} ${date} ${time} ${location}`);
      });
      if (!includeAccessLocation) {
        console.log("\nLocation column is not present on this COSEC server schema.");
      }
      console.log();
    } else {
      console.log("  (No punch records found for today)\n");
    }

    console.log("ALL TESTS PASSED.");
    console.log("COSEC database is ready for migration.");
    console.log("Next step: npx tsx scripts/migrate-ncosec-biometric.ts\n");
  } catch (error) {
    console.error("\nConnection failed.\n");

    if (error instanceof Error) {
      console.error("Error:", error.message);

      if (error.message.includes("timeout")) {
        console.error("\nTroubleshooting:");
        console.error("   - Check if the secure route or VPN is connected");
        console.error("   - Verify the configured COSEC IP address");
        console.error("   - Check firewall rules");
        console.error("   - Test TCP 1433 reachability from the HRMS server\n");
      } else if (error.message.includes("Login failed")) {
        console.error("\nTroubleshooting:");
        console.error("   - Verify SQL username and password");
        console.error("   - Check SQL Server authentication mode");
        console.error("   - Ensure the user has permissions on the NCOSEC database\n");
      } else if (error.message.includes("Database")) {
        console.error("\nTroubleshooting:");
        console.error("   - Verify the database name");
        console.error("   - Check that the user has access to this database\n");
      }
    }

    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log("Connection closed.\n");
    }
  }
}

testConnection().catch(console.error);
