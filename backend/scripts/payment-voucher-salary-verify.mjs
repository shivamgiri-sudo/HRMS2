/**
 * Payment voucher "salary" source type (migration 2122) — production check / repair.
 *
 *   node scripts/payment-voucher-salary-verify.mjs           # read-only report
 *   node scripts/payment-voucher-salary-verify.mjs --apply   # adds 'salary' to the ENUM if missing
 *
 * Default is read-only (READ ONLY session). --apply runs only the same idempotent
 * ALTER TABLE payment_voucher MODIFY COLUMN source_type that migration 2122 runs, and only
 * when the ENUM lacks 'salary'. It keeps every existing value, so no row changes.
 */
import { createRequire } from "node:module";

const MIGRATION_FILE = "migrations/2122_payment_voucher_salary_source_type.sql";
const apply = process.argv.includes("--apply");

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
  dateStrings: true,
});

const columnType = async () => {
  const [rows] = await conn.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'source_type'",
  );
  return String(rows[0]?.t ?? "");
};

try {
  if (!apply) await conn.query("SET SESSION TRANSACTION READ ONLY");
  const [whoRows] = await conn.query("SELECT DATABASE() AS db");
  console.log(`payment-voucher-salary-verify (${apply ? "APPLY" : "read-only"})  database=${whoRows[0].db}`);

  let type = await columnType();
  console.log(`source_type before: ${type}`);
  if (type.includes("'salary'")) {
    console.log("PASS  'salary' present in payment_voucher.source_type");
  } else if (!apply) {
    console.log("FAIL  'salary' missing from payment_voucher.source_type. Re-run with mode=apply.");
    process.exitCode = 1;
  } else {
    await conn.query(
      "ALTER TABLE payment_voucher MODIFY COLUMN source_type ENUM('vendor_grn','imprest_allocation','sales_receipt','general','vendor_advance','vendor_advance_application','internal_transfer','salary') NOT NULL",
    );
    type = await columnType();
    console.log(`source_type after:  ${type}`);
    if (type.includes("'salary'")) console.log("PASS  'salary' added");
    else {
      console.log("FAIL  ALTER ran but 'salary' still missing");
      process.exitCode = 1;
    }
  }

  const [mig] = await conn.query(
    "SELECT filename, success, applied_at FROM schema_migrations WHERE filename = ? OR filename LIKE ? LIMIT 1",
    [MIGRATION_FILE, "%2122_payment_voucher_salary_source_type.sql"],
  );
  console.log(
    mig[0]
      ? `schema_migrations: ${mig[0].filename} success=${mig[0].success} applied_at=${mig[0].applied_at}`
      : "schema_migrations: no row for 2122",
  );
  const [counts] = await conn.query("SELECT source_type, COUNT(*) AS n FROM payment_voucher GROUP BY source_type");
  console.log("vouchers by source_type:", JSON.stringify(counts));
} finally {
  await conn.end();
}
