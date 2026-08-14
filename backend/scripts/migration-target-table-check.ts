#!/usr/bin/env tsx
/**
 * Read-only pre-restart check: does every table a PENDING migration writes to
 * (INSERT/UPDATE/ALTER TABLE) actually exist in production, unless the same
 * migration file creates it first?
 *
 * Born from the 2026-08-14 migration 1007 outage (~11 min): 1007 wrote to
 * `workforce_page_catalog` / `workforce_role_page_permissions`, which have
 * never existed — the real tables are `page_catalog` / `role_page_access`.
 * The fix commit (656cc5b1) described building exactly this check and
 * running it once against production, but never actually committed the tool
 * — so the next migration with the same fault class would be caught by
 * nothing durable. This is that tool, for real this time.
 *
 * Deliberately DOES NOT need the CREATE/DROP DATABASE grant
 * migration-preflight.ts requires (see its own header: that grant is still
 * open as of this audit). This only ever reads information_schema against
 * the real application DB_* credential — the same one runPendingMigrations
 * already uses — so it can run today, with zero new privilege, as a fast
 * first gate. It does NOT replace migration-preflight.ts: it catches "the
 * table doesn't exist at all", not "the DDL has a syntax error" (1006's
 * class) or "the statement fails against real data" — pair both.
 *
 * Usage (from backend/):
 *   npx tsx scripts/migration-target-table-check.ts
 *
 * Exit code 0 = every pending migration's target tables exist (or the
 * migration creates them itself). Non-zero = at least one pending migration
 * would fail with ER_NO_SUCH_TABLE on restart — do not deploy.
 */
import mysql from "mysql2/promise";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..");

function loadEnv(): Record<string, string> {
  const envText = readFileSync(path.join(BACKEND_DIR, ".env"), "utf8");
  const env: Record<string, string> = {};
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/**
 * Tables a migration file CREATEs itself (fine even if absent from
 * information_schema — the migration is what brings them into existence),
 * versus tables it WRITES to assuming they already exist (INSERT/UPDATE/
 * ALTER TABLE) — the class that produced the 1007 outage. A table this file
 * creates is never flagged even if it's also written to later in the same
 * file (the common CREATE TABLE ...; INSERT INTO ...; pattern).
 *
 * Deliberately regex-based, matching this codebase's established convention
 * for static SQL analysis elsewhere (migration-syntax-compatibility.test.ts,
 * the schema-column-refs suite) rather than a full SQL parser dependency.
 * Backtick-quoted and bare identifiers both match; comments are stripped
 * first so a commented-out statement is never mistaken for a real one.
 */
export function parseTargetTables(sql: string): { created: Set<string>; written: Set<string> } {
  const stripped = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const created = new Set<string>();
  for (const m of stripped.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi)) {
    created.add(m[1].toLowerCase());
  }

  const written = new Set<string>();
  const patterns = [
    /INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?/gi,
    /UPDATE\s+`?(\w+)`?\s+SET/gi,
    /ALTER\s+TABLE\s+`?(\w+)`?/gi,
    /REPLACE\s+INTO\s+`?(\w+)`?/gi,
  ];
  for (const pattern of patterns) {
    for (const m of stripped.matchAll(pattern)) {
      const table = m[1].toLowerCase();
      if (!created.has(table)) written.add(table);
    }
  }

  return { created, written };
}

async function main() {
  const env = loadEnv();
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });

  try {
    const { MIGRATION_MANIFEST, buildSchemaMigrationsAppliedQuery } = await import(
      "../src/db/runPendingMigrations.js"
    );

    const [colRows] = (await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'schema_migrations' AND COLUMN_NAME = 'success'`,
      [env.DB_NAME]
    )) as any;
    const hasSuccessColumn = colRows.length > 0;

    const [appliedRows] = (await conn.query(buildSchemaMigrationsAppliedQuery(hasSuccessColumn))) as any;
    const appliedSet = new Set((appliedRows as Array<{ filename: string }>).map((r) => r.filename));

    const pending = (MIGRATION_MANIFEST as string[]).filter((f) => !appliedSet.has(f));
    console.log(`[table-check] ${pending.length} pending migration(s) of ${MIGRATION_MANIFEST.length} total`);

    if (pending.length === 0) {
      console.log("[table-check] nothing pending. PASS.");
      process.exitCode = 0;
      return;
    }

    const [existingTableRows] = (await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [env.DB_NAME]
    )) as any;
    const existingTables = new Set(
      (existingTableRows as Array<{ TABLE_NAME: string }>).map((r) => r.TABLE_NAME.toLowerCase())
    );

    let anyFailure = false;
    for (const filename of pending) {
      const filePath = path.join(BACKEND_DIR, "sql", filename);
      if (!existsSync(filePath)) {
        console.error(`[table-check] ${filename}: listed in MIGRATION_MANIFEST but the file does not exist on disk`);
        anyFailure = true;
        continue;
      }
      const sql = readFileSync(filePath, "utf8");
      const { written } = parseTargetTables(sql);
      const missing = [...written].filter((t) => !existingTables.has(t));

      if (missing.length > 0) {
        console.error(
          `[table-check] FAIL ${filename}: writes to table(s) that do not exist and this file does not create: ${missing.join(", ")}`
        );
        anyFailure = true;
      } else {
        console.log(`[table-check] ${filename}: PASS (${written.size} target table(s) all present or self-created)`);
      }
    }

    if (anyFailure) {
      console.error("\n[table-check] FAILED — at least one pending migration would raise ER_NO_SUCH_TABLE on restart. Do not deploy.");
      process.exitCode = 1;
    } else {
      console.log(`\n[table-check] PASS — all ${pending.length} pending migration(s) target tables that exist or are self-created.`);
      process.exitCode = 0;
    }
  } finally {
    await conn.end();
  }
}

// Only run main() when executed directly (tsx scripts/migration-target-table-check.ts),
// not when imported for its parseTargetTables export by tests.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((e) => {
    console.error("[table-check] unexpected error:", e);
    process.exit(1);
  });
}
