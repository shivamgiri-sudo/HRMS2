#!/usr/bin/env node
/**
 * Synthetic scale fixtures for the UAT build's performance assertions.
 *
 * WHY THIS EXISTS
 *   The build environment gets a schema-only database — no real data, so nothing real can
 *   leak into an environment that executes AI-generated code. But an empty database cannot
 *   validate performance: `EXPLAIN` on a table with zero rows reports a full scan as free,
 *   the optimiser picks different plans at different cardinalities, and an N+1 that would
 *   take 40 seconds against 30,000 employees takes 4ms against none.
 *
 *   So: enough synthetic rows to make the query planner behave like production, and not one
 *   real value.
 *
 * EVERY VALUE IS GENERATED, NOT SAMPLED
 *   Names are "Employee 00042", codes are sequential, salaries are a formula. There is no
 *   copying, masking or perturbing of production data — masking is a Phase 5 project with
 *   its own privacy review, and a half-done version of it here would be worse than nothing
 *   because it would look like it had been done.
 *
 * REFUSES TO RUN ANYWHERE THAT LOOKS LIKE PRODUCTION
 *   Host must be local, database name must end in _test. Both, not either.
 *
 * Usage: node uat-seed-scale-fixtures.mjs [--employees 30000]
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const HOST = process.env.DB_HOST || "127.0.0.1";
const DB = process.env.DB_NAME || "mas_hrms_test";
const EMPLOYEES = Number(arg("employees", 30000));

// Two independent conditions, both required. A local host with a production database name is
// a port-forward; a _test name on a remote host is a shared server. Neither is acceptable.
const LOCAL = ["127.0.0.1", "localhost", "::1", "mysql", "uatdb"].includes(HOST);
if (!LOCAL) {
  console.error(`[scale-fixtures] REFUSING: host "${HOST}" is not local.`);
  console.error("  These fixtures write tens of thousands of rows. They run against a");
  console.error("  disposable local database only, never a shared or production server.");
  process.exit(2);
}
if (!/_test$/.test(DB)) {
  console.error(`[scale-fixtures] REFUSING: database "${DB}" does not end in _test.`);
  process.exit(2);
}

const conn = await mysql.createConnection({
  host: HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? "",
  database: DB,
  multipleStatements: false,
});

/** Does a table exist? The schema evolves; seeding a table that is gone must not be fatal. */
async function has(table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB, table]
  );
  return rows.length > 0;
}

/** Column names of a table, so inserts adapt rather than assuming a shape. */
async function columns(table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, DATA_TYPE
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB, table]
  );
  return rows;
}

function uuid(n) {
  const h = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
}

let seeded = 0;

try {
  if (!(await has("employees"))) {
    console.error("[scale-fixtures] employees table is absent; run the migrations first.");
    process.exit(1);
  }

  const [[{ n: existing }]] = await conn.query(`SELECT COUNT(*) AS n FROM employees`);
  if (existing > 0) {
    // A populated employees table in a _test database on localhost is still not something
    // to add 30,000 synthetic rows to — the mix would make every later count meaningless.
    console.error(`[scale-fixtures] employees already has ${existing} rows; refusing to mix.`);
    process.exit(2);
  }

  const cols = await columns("employees");
  const byName = new Map(cols.map((c) => [c.COLUMN_NAME, c]));
  // Only the columns that must be filled: the primary key, anything NOT NULL without a
  // default, and the handful the performance queries actually filter on.
  const required = cols
    .filter(
      (c) =>
        c.COLUMN_NAME === "id" ||
        (c.IS_NULLABLE === "NO" && c.COLUMN_DEFAULT === null && c.DATA_TYPE !== "timestamp")
    )
    .map((c) => c.COLUMN_NAME);

  const wanted = ["id", "employee_code", "full_name", "email", "status", "branch_id"].filter((c) =>
    byName.has(c)
  );
  const insertCols = [...new Set([...required, ...wanted])].filter((c) => byName.has(c));

  const value = (col, i) => {
    switch (col) {
      case "id":
        return uuid(i);
      case "employee_code":
        return `SYN${String(i).padStart(6, "0")}`;
      case "full_name":
      case "name":
        return `Employee ${String(i).padStart(5, "0")}`;
      case "email":
        return `synthetic.${i}@example.invalid`; // .invalid is reserved and unroutable
      case "status":
        return i % 20 === 0 ? "inactive" : "active";
      case "branch_id":
        // Spread across 12 branches so branch-scoped queries see realistic selectivity.
        return uuid(900000 + (i % 12));
      default: {
        const c = byName.get(col);
        if (!c) return null;
        if (/int|decimal|double|float/.test(c.DATA_TYPE)) return i % 100;
        if (/date|time/.test(c.DATA_TYPE)) return "2024-01-01";
        return `syn-${col}-${i}`;
      }
    }
  };

  const BATCH = 1000;
  const placeholders = `(${insertCols.map(() => "?").join(",")})`;
  const sql = `INSERT INTO employees (${insertCols.map((c) => `\`${c}\``).join(",")}) VALUES `;

  for (let start = 0; start < EMPLOYEES; start += BATCH) {
    const end = Math.min(start + BATCH, EMPLOYEES);
    const rows = [];
    const params = [];
    for (let i = start; i < end; i++) {
      rows.push(placeholders);
      for (const c of insertCols) params.push(value(c, i));
    }
    await conn.query(sql + rows.join(","), params);
    seeded += end - start;
    if (seeded % 10000 === 0) console.log(`[scale-fixtures] ${seeded}/${EMPLOYEES} employees`);
  }

  // ANALYZE so the optimiser has statistics. Without it the planner may still choose
  // small-table plans and the whole exercise proves nothing.
  await conn.query(`ANALYZE TABLE employees`);

  console.log(`[scale-fixtures] seeded ${seeded} synthetic employees into ${DB} on ${HOST}.`);
  console.log("[scale-fixtures] every value is generated; no production data was read.");
} catch (error) {
  console.error(`[scale-fixtures] failed after ${seeded} rows:`, error.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}

void path;
