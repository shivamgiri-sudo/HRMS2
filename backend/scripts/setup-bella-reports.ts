/**
 * One-off setup: creates the bella_db schema and its 6 Bella Vita raw-data tables,
 * then registers the matching upload_template_master rows in mas_hrms so they
 * appear in the Bulk Upload Hub. Safe to re-run - CREATE DATABASE / TABLE
 * IF NOT EXISTS and an INSERT ... ON DUPLICATE KEY UPDATE on upload_type_code.
 *
 * Mirrors scripts/setup-onfido-reports.ts, with one addition: bella_db does not
 * exist yet on the host, so the schema is created first through a connection
 * that names no database (getBellaPool would fail against a missing schema).
 *
 * Run with: npx tsx scripts/setup-bella-reports.ts [manifest.json]
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import mysql from "mysql2/promise";
import { db } from "../src/db/mysql.js";
import { env } from "../src/config/env.js";
import { getBellaPool } from "../src/db/bellaDb.js";
import { BELLA_REPORT_CONFIGS, type BellaFieldExtract } from "../src/modules/bulk-upload/bella-report-configs.js";
import { readFileSync } from "fs";

function sqlTypeFor(extract: BellaFieldExtract): string {
  switch (extract.type) {
    case "date": return "DATE NULL";
    case "int": return "INT NULL";
    case "float": return "DECIMAL(12,2) NULL";
    case "bool_yes_no": return "TINYINT(1) NULL";
    default:
      // URL/UUID-shaped columns run long; everything else is a short label.
      return /url|uuid/i.test(extract.column) ? "VARCHAR(512) NULL" : "VARCHAR(255) NULL";
  }
}

/** bella_db is new on this host, so create the schema before the pool binds to it. */
async function ensureDatabase(): Promise<void> {
  const name = env.BELLA_DB_NAME;
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsafe BELLA_DB_NAME: ${name}`);
  const conn = await mysql.createConnection({
    host: env.BELLA_DB_HOST,
    port: env.BELLA_DB_PORT || 3306,
    user: env.BELLA_DB_USER,
    password: env.BELLA_DB_PASSWORD,
    connectTimeout: 15000,
  });
  try {
    // utf8mb4_unicode_ci to match the rest of the estate - a new schema defaulting
    // to a different collation is how you end up with COLLATE casts that kill indexes.
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`[BELLA] ensured database ${name}`);
  } finally {
    await conn.end();
  }
}

async function createTable(cfg: (typeof BELLA_REPORT_CONFIGS)[number]) {
  const pool = await getBellaPool();
  const dedup = cfg.extract.find((e) => e.column === cfg.dedupColumn);
  if (!dedup) throw new Error(`${cfg.table}: dedupColumn ${cfg.dedupColumn} not in extract[]`);

  const otherCols = cfg.extract.filter((e) => e.column !== cfg.dedupColumn);
  const dedupIsLong = /url|uuid/i.test(dedup.column) || dedup.type === "string";
  const dedupSql = dedupIsLong
    ? `${dedup.column} VARCHAR(512) NOT NULL`
    : `${dedup.column} VARCHAR(255) NOT NULL`;

  const firstDate = otherCols.find((e) => e.type === "date")?.column ?? dedup.column;

  const columnDefs = [
    // No UNIQUE KEY on the dedup column: for grouped exports it is shared by many rows
    // on purpose. `id` (table:dedupValue[:occurrence], built in bella-raw-bulk.service.ts)
    // is the only uniqueness constraint these tables need - see the same note in
    // setup-onfido-reports.ts for the 730-row CRE regression that established this.
    "id VARCHAR(191) PRIMARY KEY",
    dedupSql,
    ...otherCols.map((e) => `${e.column} ${sqlTypeFor(e)}`),
    "raw_data JSON NOT NULL",
    "upload_batch_id CHAR(36) NULL",
    "source_row_no INT NULL",
    "uploaded_by CHAR(36) NULL",
    "uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
    `KEY idx_${cfg.table}_dedup (${dedup.column}${dedupIsLong ? "(191)" : ""})`,
    `KEY idx_${cfg.table}_date (${firstDate})`,
  ];

  const sql = `CREATE TABLE IF NOT EXISTS ${cfg.table} (\n  ${columnDefs.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  await pool.execute(sql);
  console.log(`[BELLA] ensured table ${cfg.table}`);
}

async function registerTemplate(cfg: (typeof BELLA_REPORT_CONFIGS)[number], sampleRow: Record<string, unknown>) {
  const [existing] = await db.execute(
    "SELECT id FROM upload_template_master WHERE upload_type_code = ? LIMIT 1",
    [cfg.uploadTypeCode]
  );
  const rows = existing as Array<{ id: string }>;

  // The target plan is the one source with a column the raw sheet does not carry
  // (LOB - it is which sheet you opened), so it is genuinely required of the uploader.
  const required = cfg.uploadTypeCode === "BELLA_TARGET_PLAN" ? ["Date", "LOB"] : [];
  const optional = cfg.headers.filter((h) => !required.includes(h));

  if (rows.length > 0) {
    await db.execute(
      `UPDATE upload_template_master
          SET upload_type_name = ?, target_table = ?, description = ?,
              required_columns = ?, optional_columns = ?, sample_row = ?, active_status = 1
        WHERE upload_type_code = ?`,
      [
        cfg.uploadTypeName, cfg.table, cfg.description,
        JSON.stringify(required), JSON.stringify(optional), JSON.stringify(sampleRow),
        cfg.uploadTypeCode,
      ]
    );
    console.log(`[BELLA] updated template ${cfg.uploadTypeCode}`);
    return;
  }

  await db.execute(
    `INSERT INTO upload_template_master
       (id, upload_type_code, upload_type_name, target_table, description,
        required_columns, optional_columns, sample_row, active_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    [
      randomUUID(), cfg.uploadTypeCode, cfg.uploadTypeName, cfg.table, cfg.description,
      JSON.stringify(required), JSON.stringify(optional), JSON.stringify(sampleRow),
    ]
  );
  console.log(`[BELLA] inserted template ${cfg.uploadTypeCode}`);
}

async function main() {
  const manifestPath = process.argv[2];
  const manifest = manifestPath
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{ table: string; sampleRow: Record<string, unknown> }>)
    : [];
  const sampleByTable = new Map(manifest.map((m) => [m.table, m.sampleRow]));

  await ensureDatabase();

  for (const cfg of BELLA_REPORT_CONFIGS) {
    await createTable(cfg);
    await registerTemplate(cfg, sampleByTable.get(cfg.table) ?? {});
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
