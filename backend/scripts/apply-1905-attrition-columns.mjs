#!/usr/bin/env node
// One-shot script: add attrition_date/reason/notes to employees table.
// Retries up to 10 times with 15s back-off until MDL clears.
// Run: node backend/scripts/apply-1905-attrition-columns.mjs

import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env");

// Parse .env manually (no dotenv dependency needed).
// Handles quoted values (double or single) that may contain # characters.
const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) continue;
  const eq = raw.indexOf("=");
  if (eq < 0) continue;
  const key = raw.slice(0, eq).trim();
  let val = raw.slice(eq + 1).trim();
  // Strip surrounding quotes and unescape inner quotes
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

const pool = await mysql.createPool({
  host:     env.DB_HOST,
  port:     Number(env.DB_PORT) || 3306,
  user:     env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 1,
});

const ENUM_DEF = `ENUM(
  'Resigned - Better Opportunity','Resigned - Personal Reasons',
  'Resigned - Higher Education','Resigned - Relocation',
  'Resigned - Health Issues','Resigned - Salary Dissatisfaction',
  'Resigned - Work Environment','Absconding',
  'Terminated - Performance','Terminated - Misconduct',
  'Terminated - Policy Violation','Terminated - Attendance',
  'Contract End','Retirement','Death','Other'
) NULL DEFAULT NULL`;

async function columnsExist(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'
     AND COLUMN_NAME IN ('attrition_date','attrition_reason','attrition_reason_notes')`
  );
  const existing = new Set(rows.map(r => r.COLUMN_NAME));
  return {
    date:   existing.has("attrition_date"),
    reason: existing.has("attrition_reason"),
    notes:  existing.has("attrition_reason_notes"),
  };
}

function buildAlter(missing) {
  const parts = [];
  if (missing.includes("attrition_date"))
    parts.push("ADD COLUMN attrition_date DATE NULL DEFAULT NULL AFTER date_of_leaving");
  if (missing.includes("attrition_reason"))
    parts.push(`ADD COLUMN attrition_reason ${ENUM_DEF} AFTER attrition_date`);
  if (missing.includes("attrition_reason_notes"))
    parts.push("ADD COLUMN attrition_reason_notes VARCHAR(1000) NULL DEFAULT NULL AFTER attrition_reason");
  // Let MySQL pick best algorithm — INSTANT/INPLACE blocked while concurrent FULLTEXT op runs; retries until clear.
  return `ALTER TABLE employees ${parts.join(", ")}`;
}

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 15_000;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET SESSION innodb_lock_wait_timeout = 300");
    await conn.query("SET SESSION lock_wait_timeout = 300");

    const { date, reason, notes } = await columnsExist(conn);
    const missing = [
      ...(!date   ? ["attrition_date"] : []),
      ...(!reason ? ["attrition_reason"] : []),
      ...(!notes  ? ["attrition_reason_notes"] : []),
    ];

    if (missing.length === 0) {
      console.log("✓ All columns already exist — nothing to do.");
      break;
    }

    console.log(`Attempt ${attempt}/${MAX_RETRIES}: adding [${missing.join(", ")}]...`);
    const sql = buildAlter(missing);
    await conn.query(sql);

    console.log("✓ Done.");
    break;
  } catch (err) {
    const retryable = err.code === "ER_LOCK_WAIT_TIMEOUT" ||
      (err.sqlMessage && err.sqlMessage.includes("one FULLTEXT index creation at a time"));
    if (retryable && attempt < MAX_RETRIES) {
      console.log(`  Lock timeout — retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    } else {
      console.error("✗ Failed:", err.message);
      process.exit(1);
    }
  } finally {
    conn.release();
  }
}

await pool.end();
