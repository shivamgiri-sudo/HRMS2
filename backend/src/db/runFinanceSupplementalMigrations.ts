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
const SQL_DIR =
  SQL_DIR_CANDIDATES.find((candidate) => fs.existsSync(candidate))
  ?? SQL_DIR_CANDIDATES[0];

const FINANCE_SUPPLEMENTAL_MIGRATIONS = [
  "412_finance_expense_head_master.sql",
  "413_vendor_payment_transaction_ledger.sql",
  "414_finance_grn_sequence.sql",
  "415_bpo_pnl_revenue_cost_model.sql",
  "416_smart_grn_allocation_document_intelligence.sql",
  "417_budget_subhead_coverage_control.sql",
] as const;

export async function runFinanceSupplementalMigrations() {
  if (process.env.SKIP_MIGRATIONS === "true") return;

  const connectionConfig = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
  };

  const trackingConnection = await mysql.createConnection(connectionConfig);
  try {
    await trackingConnection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    await trackingConnection.end();
  }

  for (const filename of FINANCE_SUPPLEMENTAL_MIGRATIONS) {
    const filePath = path.join(SQL_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required finance migration is missing: ${filename}`);
    }

    const statusConnection = await mysql.createConnection(connectionConfig);
    let alreadyApplied = false;
    try {
      const [rows] = await statusConnection.query<RowDataPacket[]>(
        "SELECT filename FROM schema_migrations WHERE filename = ? LIMIT 1",
        [filename]
      );
      alreadyApplied = rows.length > 0;
    } finally {
      await statusConnection.end();
    }
    if (alreadyApplied) {
      console.log(`[finance-migration] skipped already applied: ${filename}`);
      continue;
    }

    const migrationConnection = await mysql.createConnection(connectionConfig);
    try {
      const rawSql = fs.readFileSync(filePath, "utf8");
      const statements = splitSql(rawSql).filter((statement) => {
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
      console.log(`[finance-migration] applied: ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Finance migration ${filename} failed: ${message}`);
    } finally {
      await migrationConnection.end();
    }
  }
}
