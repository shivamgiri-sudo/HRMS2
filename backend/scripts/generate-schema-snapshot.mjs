#!/usr/bin/env node
/**
 * Regenerate backend/sql/schema-snapshot.json from the live database.
 *
 * The snapshot is what src/db/__tests__/schema-column-refs.test.ts validates
 * every SQL reference in the tree against. It had drifted: six tables existed
 * in production and not in the snapshot (portal_user_sessions,
 * portal_user_permissions, gratuity_calculation_audit, kpi_process_assignment,
 * notification_dispatch_block and a backup table), which made the guard report
 * live tables as missing and let genuinely new columns look broken. Nothing
 * regenerated it because nothing could — there was no script.
 *
 * Read-only. Touches only information_schema.
 *
 *   node scripts/generate-schema-snapshot.mjs            # write the snapshot
 *   node scripts/generate-schema-snapshot.mjs --check    # exit 1 if it drifted
 *
 * Two invariants this must preserve, both load-bearing:
 *
 *  1. COLUMN AND TABLE NAMES ARE LOWERCASED. columnRefsIn() lowercases every
 *     identifier it extracts, so a snapshot holding MySQL's real case would
 *     make the guard flag correct code. `apr` alone has 17 mixed-case columns
 *     (ReportDate, UserID, TALK_TIME...); storing them as-is would report all
 *     17 as broken references.
 *
 *  2. information_schema keys arrive in either case depending on the driver and
 *     server (see the mysql2 casing note in the test suite), so every row is
 *     read through pick() rather than a fixed key.
 */
import { createConnection } from "mysql2/promise";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(HERE, "..", "sql", "schema-snapshot.json");
const CHECK_ONLY = process.argv.includes("--check");

/**
 * Credentials come from a .env file when there is one, and from the process
 * environment otherwise — on the server the app is started by pm2 and there may
 * be no readable .env beside this script, and a git worktree never has one
 * because it is untracked. `--env <path>` points at a specific file.
 */
function env() {
  const flag = process.argv.indexOf("--env");
  const candidates = [
    flag !== -1 ? process.argv[flag + 1] : null,
    resolve(HERE, "..", ".env"),
  ].filter(Boolean);

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = Object.fromEntries(
        raw.split(/\r?\n/)
          .filter((l) => l && !l.startsWith("#") && l.includes("="))
          .map((l) => {
            const i = l.indexOf("=");
            return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
          })
      );
      return { ...process.env, ...parsed };
    } catch {
      // try the next candidate
    }
  }
  return { ...process.env };
}

const pick = (row, key) => row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()];

async function build() {
  const e = env();
  const db = e.DB_NAME ?? "mas_hrms";
  const conn = await createConnection({
    host: e.DB_HOST, port: Number(e.DB_PORT ?? 3306), user: e.DB_USER,
    password: e.DB_PASSWORD, database: db, connectTimeout: 20000,
  });

  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [db]
  );
  await conn.end();

  const tables = {};
  for (const row of rows) {
    const table = String(pick(row, "TABLE_NAME")).toLowerCase();
    const column = String(pick(row, "COLUMN_NAME")).toLowerCase();
    (tables[table] ||= []).push(column);
  }

  const ordered = {};
  for (const name of Object.keys(tables).sort()) ordered[name] = tables[name];

  return {
    generatedFrom: db,
    tableCount: Object.keys(ordered).length,
    columnCount: rows.length,
    tables: ordered,
  };
}

const next = await build();

if (CHECK_ONLY) {
  const current = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const a = JSON.stringify(current.tables);
  const b = JSON.stringify(next.tables);
  if (a === b) {
    console.log(`schema snapshot is current (${next.tableCount} tables, ${next.columnCount} columns)`);
    process.exit(0);
  }
  console.error(
    `schema snapshot has drifted: snapshot has ${current.tableCount} tables / ` +
    `${current.columnCount} columns, the database has ${next.tableCount} / ${next.columnCount}.\n` +
    `Run: node scripts/generate-schema-snapshot.mjs`
  );
  process.exit(1);
}

writeFileSync(SNAPSHOT, JSON.stringify(next) + "\n");
console.log(`wrote ${SNAPSHOT}: ${next.tableCount} tables, ${next.columnCount} columns`);
