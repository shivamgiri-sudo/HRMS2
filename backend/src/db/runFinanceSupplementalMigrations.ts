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

export const FINANCE_SUPPLEMENTAL_MIGRATIONS = [
  "412_finance_expense_head_master.sql",
  "413_vendor_payment_transaction_ledger.sql",
  "414_finance_grn_sequence.sql",
  "415_bpo_pnl_revenue_cost_model.sql",
  "416_smart_grn_allocation_document_intelligence.sql",
  "417_budget_subhead_coverage_control.sql",
  "418_grn_allocation_pnl_attribution.sql",
  "419_grn_validation_override_control.sql",
  "424_employee_reimbursement_claim.sql",
  "425_mira_openrouter_company_knowledge.sql",
] as const;

export type SupplementalMigrationStatus = {
  valid: boolean;
  appliedCount: number;
  pendingCount: number;
  pendingFiles: string[];
};

function connectionConfig() {
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
  };
}

export async function verifyFinanceSupplementalMigrations(): Promise<SupplementalMigrationStatus> {
  const connection = await mysql.createConnection(connectionConfig());
  try {
    const [tables] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_NAME
         FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'schema_migrations'`,
      [env.DB_NAME],
    );

    if (!tables.length) {
      return {
        valid: false,
        appliedCount: 0,
        pendingCount: FINANCE_SUPPLEMENTAL_MIGRATIONS.length,
        pendingFiles: [...FINANCE_SUPPLEMENTAL_MIGRATIONS],
      };
    }

    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => String(row.filename ?? "")));
    const pendingFiles = FINANCE_SUPPLEMENTAL_MIGRATIONS.filter((filename) => !applied.has(filename));

    return {
      valid: pendingFiles.length === 0,
      appliedCount: FINANCE_SUPPLEMENTAL_MIGRATIONS.length - pendingFiles.length,
      pendingCount: pendingFiles.length,
      pendingFiles: [...pendingFiles],
    };
  } finally {
    await connection.end();
  }
}

export async function runFinanceSupplementalMigrations() {
  if (process.env.SKIP_MIGRATIONS === "true") return;

  const config = connectionConfig();
  const trackingConnection = await mysql.createConnection(config);
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

    const statusConnection = await mysql.createConnection(config);
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

    const migrationConnection = await mysql.createConnection(config);
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
