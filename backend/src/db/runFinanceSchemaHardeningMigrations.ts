import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { splitSql } from "./runPendingMigrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR_CANDIDATES = [
  path.resolve(__dirname, "../../sql"),
  path.resolve(__dirname, "../../../sql"),
];
const SQL_DIR = SQL_DIR_CANDIDATES.find((candidate) => fs.existsSync(candidate))
  ?? SQL_DIR_CANDIDATES[0];

const MIGRATIONS = ["420_grn_validation_schema_hardening.sql"] as const;

export async function runFinanceSchemaHardeningMigrations() {
  if (process.env.SKIP_MIGRATIONS === "true") return;

  const config = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
  };

  const tracker = await mysql.createConnection(config);
  try {
    await tracker.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    await tracker.end();
  }

  for (const filename of MIGRATIONS) {
    const filePath = path.join(SQL_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required finance hardening migration is missing: ${filename}`);
    }

    const statusConnection = await mysql.createConnection(config);
    try {
      const [rows] = await statusConnection.query<RowDataPacket[]>(
        "SELECT filename FROM schema_migrations WHERE filename = ? LIMIT 1",
        [filename]
      );
      if (rows.length) {
        console.log(`[finance-hardening] skipped already applied: ${filename}`);
        continue;
      }
    } finally {
      await statusConnection.end();
    }

    const migrationConnection = await mysql.createConnection(config);
    try {
      const statements = splitSql(fs.readFileSync(filePath, "utf8")).filter((statement) => {
        const upper = statement.toUpperCase();
        return !upper.startsWith("SOURCE ") && !upper.startsWith("USE ");
      });
      for (const statement of statements) {
        await migrationConnection.query(statement);
      }
      await migrationConnection.query(
        "INSERT INTO schema_migrations (filename) VALUES (?)",
        [filename]
      );
      console.log(`[finance-hardening] applied: ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Finance hardening migration ${filename} failed: ${message}`);
    } finally {
      await migrationConnection.end();
    }
  }
}
