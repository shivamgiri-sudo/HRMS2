/**
 * One-off setup: creates the 7 Onfido raw-data tables in onfido_db and registers
 * the matching upload_template_master rows in mas_hrms so they appear in the
 * Bulk Upload Hub. Safe to re-run — CREATE TABLE IF NOT EXISTS and an
 * INSERT ... ON DUPLICATE KEY UPDATE on upload_type_code.
 *
 * Run with: npx tsx scripts/setup-onfido-reports.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db } from "../src/db/mysql.js";
import { getOnfidoPool } from "../src/db/onfidoDb.js";
import { ONFIDO_REPORT_CONFIGS, type OnfidoFieldExtract } from "../src/modules/bulk-upload/onfido-report-configs.js";
import { readFileSync } from "fs";

function sqlTypeFor(extract: OnfidoFieldExtract): string {
  switch (extract.type) {
    case "date": return "DATE NULL";
    case "int": return "INT NULL";
    case "float": return "DECIMAL(8,2) NULL";
    case "bool_yes_no": return "TINYINT(1) NULL";
    default:
      // URL/UUID-shaped dedup columns run long; everything else is a short label.
      return /url|uuid/i.test(extract.column) ? "VARCHAR(512) NULL" : "VARCHAR(255) NULL";
  }
}

async function createTable(cfg: (typeof ONFIDO_REPORT_CONFIGS)[number]) {
  const pool = await getOnfidoPool();
  const dedup = cfg.extract.find((e) => e.column === cfg.dedupColumn);
  if (!dedup) throw new Error(`${cfg.table}: dedupColumn ${cfg.dedupColumn} not in extract[]`);

  const otherCols = cfg.extract.filter((e) => e.column !== cfg.dedupColumn);
  const dedupIsLong = /url|uuid/i.test(dedup.column) || dedup.type === "string";
  const dedupSql = dedupIsLong
    ? `${dedup.column} VARCHAR(512) NOT NULL`
    : `${dedup.column} VARCHAR(255) NOT NULL`;

  const columnDefs = [
    // No UNIQUE KEY on the dedup column itself: for CRE/CRQ-shaped exports (one report
    // can have several error rows) it is a grouping value shared by many rows on purpose,
    // not a per-row identity — a unique index there silently collapsed 730 real CRE rows
    // down to 509 via ON DUPLICATE KEY UPDATE the moment forward-fill introduced repeats.
    // `id` alone (table:dedupValue[:occurrence], built in onfido-raw-bulk.service.ts)
    // already gives every row its own identity AND upserts a re-uploaded overlapping day
    // correctly, so it is the only uniqueness constraint this table needs.
    "id VARCHAR(191) PRIMARY KEY",
    dedupSql,
    ...otherCols.map((e) => `${e.column} ${sqlTypeFor(e)}`),
    "raw_data JSON NOT NULL",
    "upload_batch_id CHAR(36) NULL",
    "source_row_no INT NULL",
    "uploaded_by CHAR(36) NULL",
    "uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
    `KEY idx_${cfg.table}_dedup (${dedup.column}${dedupIsLong ? "(191)" : ""})`,
    "KEY idx_report_date (report_completed_date)".replace(
      "report_completed_date",
      otherCols.find((e) => e.type === "date")?.column ?? dedup.column
    ),
  ];

  const sql = `CREATE TABLE IF NOT EXISTS ${cfg.table} (\n  ${columnDefs.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
  await pool.execute(sql);
  console.log(`[ONFIDO] ensured table ${cfg.table}`);
}

async function registerTemplate(cfg: (typeof ONFIDO_REPORT_CONFIGS)[number], sampleRow: Record<string, unknown>) {
  const [existing] = await db.execute(
    "SELECT id FROM upload_template_master WHERE upload_type_code = ? LIMIT 1",
    [cfg.uploadTypeCode]
  );
  const rows = existing as Array<{ id: string }>;

  if (rows.length > 0) {
    await db.execute(
      `UPDATE upload_template_master
          SET upload_type_name = ?, target_table = ?, description = ?,
              required_columns = ?, optional_columns = ?, sample_row = ?, active_status = 1
        WHERE upload_type_code = ?`,
      [
        cfg.uploadTypeName, cfg.table, cfg.description,
        JSON.stringify([]), JSON.stringify(cfg.headers), JSON.stringify(sampleRow),
        cfg.uploadTypeCode,
      ]
    );
    console.log(`[ONFIDO] updated template ${cfg.uploadTypeCode}`);
    return;
  }

  await db.execute(
    `INSERT INTO upload_template_master
       (id, upload_type_code, upload_type_name, target_table, description,
        required_columns, optional_columns, sample_row, active_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    [
      randomUUID(), cfg.uploadTypeCode, cfg.uploadTypeName, cfg.table, cfg.description,
      JSON.stringify([]), JSON.stringify(cfg.headers), JSON.stringify(sampleRow),
    ]
  );
  console.log(`[ONFIDO] inserted template ${cfg.uploadTypeCode}`);
}

async function main() {
  const manifestPath = process.argv[2];
  const manifest = manifestPath
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{ table: string; sampleRow: Record<string, unknown> }>)
    : [];
  const sampleByTable = new Map(manifest.map((m) => [m.table, m.sampleRow]));

  for (const cfg of ONFIDO_REPORT_CONFIGS) {
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
