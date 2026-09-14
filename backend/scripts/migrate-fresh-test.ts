/**
 * migrate-fresh-test.ts
 *
 * Drops and recreates the TEST database, then runs every migration in manifest
 * order, stopping on the first failure and printing the exact failing statement
 * plus the MySQL server version.
 *
 * Usage:
 *   npm run migrate:fresh:test
 *
 * Environment variables read (falls back to .env.test, then .env):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   TEST_DB_NAME  — optional override; defaults to <DB_NAME>_test
 *
 * NEVER run against the production database.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { splitSql, MIGRATION_MANIFEST } from "../src/db/runPendingMigrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, "../sql");

for (const envPath of [
  path.resolve(process.cwd(), ".env.test"),
  path.resolve(process.cwd(), ".env"),
]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

// Resolve test DB name — never allow production DB name
const PROD_DB = process.env.DB_NAME ?? "mas_hrms";
const TEST_DB = process.env.TEST_DB_NAME ?? `${PROD_DB}_test`;
const DB_HOST = process.env.DB_HOST ?? "127.0.0.1";
const NODE_ENV = process.env.NODE_ENV ?? "development";
const allowDestructive = process.argv.includes("--allow-destructive-test-db");
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const disposableDbName =
  /(^test_|_test$|_testing$|^hrms_migration_test_|^hrms_test_)/i.test(TEST_DB);

if (!allowDestructive) {
  console.error("[migrate-fresh-test] FATAL: missing --allow-destructive-test-db confirmation flag.");
  process.exit(1);
}

if (!localHosts.has(DB_HOST.trim().toLowerCase())) {
  console.error(`[migrate-fresh-test] FATAL: refusing destructive test migration on non-local host '${DB_HOST}'.`);
  process.exit(1);
}

if (!disposableDbName) {
  console.error(`[migrate-fresh-test] FATAL: TEST_DB_NAME '${TEST_DB}' does not look disposable/test-scoped.`);
  process.exit(1);
}

if (NODE_ENV === "production") {
  console.error("[migrate-fresh-test] FATAL: refusing destructive test migration when NODE_ENV=production.");
  process.exit(1);
}

if (TEST_DB === PROD_DB) {
  console.error(
    `[migrate-fresh-test] FATAL: TEST_DB_NAME '${TEST_DB}' matches DB_NAME '${PROD_DB}'. ` +
      "Refusing to drop production database."
  );
  process.exit(1);
}

const connBase = {
  host: DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
};

// The manifest is imported from runPendingMigrations.ts, NOT copied. This file used to
// hold its own duplicate under a "must stay in sync" comment; it drifted to 115 entries
// against the real 524, so this test silently skipped ~400 migrations - every recent one
// included - and still printed "All migrations passed". A fresh-database check that
// cannot see most migrations is worse than none, because it is believed.

async function main() {
  // Connect without a database to create/drop the test DB
  const adminConn = await mysql.createConnection(connBase);

  let mysqlVersion = "unknown";
  try {
    const [rows] = await adminConn.query<RowDataPacket[]>("SELECT VERSION() AS v");
    const row = rows[0] as (RowDataPacket & { v?: string }) | undefined;
    mysqlVersion = row?.v ?? "unknown";
  } catch (error: unknown) {
    console.warn(
      `[migrate-fresh-test] Unable to determine MySQL version: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  console.log(`[migrate-fresh-test] MySQL version: ${mysqlVersion}`);
  console.log(`[migrate-fresh-test] Host: ${connBase.host}`);
  console.log(`[migrate-fresh-test] Port: ${connBase.port}`);
  console.log(`[migrate-fresh-test] NODE_ENV: ${NODE_ENV}`);
  console.log(`[migrate-fresh-test] Test database: ${TEST_DB}`);

  console.log(`[migrate-fresh-test] Dropping '${TEST_DB}' ...`);
  await adminConn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  console.log(`[migrate-fresh-test] Creating '${TEST_DB}' ...`);
  await adminConn.query(
    `CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await adminConn.end();

  const connConfig = { ...connBase, database: TEST_DB, multipleStatements: false };

  // Create schema_migrations tracking table
  {
    const conn = await mysql.createConnection(connConfig);
    await conn.query(`
      CREATE TABLE schema_migrations (
        filename   VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.end();
  }

  let applied = 0;
  let skipped = 0;

  for (const file of MIGRATION_MANIFEST) {
    const filePath = path.join(SQL_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[migrate-fresh-test] SKIP (missing): ${file}`);
      skipped++;
      continue;
    }

    const rawSql = fs.readFileSync(filePath, "utf8");
    const statements = splitSql(rawSql).filter((stmt) => {
      const upper = stmt.toUpperCase();
      return !upper.startsWith("SOURCE ") && !upper.startsWith("USE ");
    });

    console.log(`[migrate-fresh-test] Running: ${file} (${statements.length} statements)`);

    const conn = await mysql.createConnection(connConfig);
    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          await conn.query(stmt);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`\n[migrate-fresh-test] FAILED: ${file}`);
          console.error(`  Statement #${i + 1}:`);
          console.error("  " + stmt.replace(/\n/g, "\n  "));
          console.error(`\n  Error: ${message}`);
          console.error(`  MySQL version: ${mysqlVersion}`);
          console.error(`\n  ${applied} file(s) applied before failure.\n`);
          await conn.end();
          process.exit(1);
        }
      }

      await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
      applied++;
      console.log(`[migrate-fresh-test] OK: ${file}`);
    } finally {
      await conn.end();
    }
  }

  console.log(
    `\n[migrate-fresh-test] Pass 1 (fresh database) passed.\n` +
      `  Applied: ${applied}  Skipped: ${skipped}  MySQL: ${mysqlVersion}\n`
  );

  // ---------------------------------------------------------------------------
  // Pass 2 — idempotency.
  //
  // Every migration is replayed against the database pass 1 just built, where all
  // its objects now exist. A migration that is not re-runnable fails here with
  // ER_DUP_FIELDNAME (1060), ER_DUP_KEYNAME (1061) or ER_TABLE_EXISTS (1050).
  //
  // This matters because migrations run at boot on this deployment, and because
  // objects have repeatedly reached production out of band - so the FIRST scheduled
  // run of a migration is frequently against a database that already has everything
  // it declares. Pass 1 alone cannot see that: it only ever runs against an empty
  // schema, which is the one case that is never true in production.
  //
  // 1218_grn_phase_a_columns.sql is the worked example. It was a single multi-column
  // ALTER plus four bare CREATE INDEX, applied out of band, absent from the manifest.
  // Pass 1 would have said OK. Pass 2 is what says no.
  //
  // schema_migrations is deliberately NOT consulted: the point is to re-execute the
  // SQL itself, not to confirm the runner would skip it.
  // ---------------------------------------------------------------------------
  let replayed = 0;

  for (const file of MIGRATION_MANIFEST) {
    const filePath = path.join(SQL_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const rawSql = fs.readFileSync(filePath, "utf8");
    const statements = splitSql(rawSql).filter((stmt) => {
      const upper = stmt.toUpperCase();
      return !upper.startsWith("SOURCE ") && !upper.startsWith("USE ");
    });

    const conn = await mysql.createConnection(connConfig);
    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          await conn.query(stmt);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`\n[migrate-fresh-test] NOT IDEMPOTENT: ${file}`);
          console.error(`  Statement #${i + 1} failed on the SECOND run:`);
          console.error("  " + stmt.replace(/\n/g, "\n  "));
          console.error(`\n  Error: ${message}`);
          console.error(`  MySQL version: ${mysqlVersion}`);
          console.error(
            `\n  This migration applies cleanly to an empty database but cannot be re-run.\n` +
              `  Guard each object with information_schema + PREPARE/EXECUTE (MySQL 8.0\n` +
              `  rejects ADD COLUMN IF NOT EXISTS), as the other migrations here do.\n`
          );
          await conn.end();
          process.exit(1);
        }
      }
      replayed++;
    } finally {
      await conn.end();
    }
  }

  console.log(
    `\n[migrate-fresh-test] Pass 2 (idempotency replay) passed.\n` +
      `  Replayed: ${replayed}  MySQL: ${mysqlVersion}\n\n` +
      `[migrate-fresh-test] All migrations passed both passes.\n`
  );
}

main().catch((err) => {
  console.error("[migrate-fresh-test] Unexpected error:", err);
  process.exit(1);
});
