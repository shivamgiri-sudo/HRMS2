#!/usr/bin/env node
/**
 * Deploy preflight — answers "will restarting this leave /api/health at 503?"
 *
 * /api/health is `dbStatus === "ok" && schemaStatus.valid`, and schemaStatus.valid
 * means every entry in MIGRATION_MANIFEST has a successful row in schema_migrations.
 * So a manifest entry the runner cannot apply takes the whole service to 503 — while
 * the API itself keeps serving traffic perfectly well, which is what makes it easy to
 * miss until an uptime check screams.
 *
 * That happened on 2026-08-09. A migration was renumbered 1116 -> 1117 to resolve a
 * collision; production was sitting on the commit in between, whose manifest named a
 * file that no longer existed under that name. The runner logged
 * `[migration] skipping missing file: 1116_...` and carried on, the schema check went
 * invalid, and health returned 503 for twelve minutes after the restart.
 *
 * A static test cannot catch that: each individual commit was internally consistent —
 * manifest and file agreed at every point. Only the live ledger, compared against the
 * tree you are about to restart, shows it. Hence a preflight rather than a unit test.
 *
 * Read-only. Touches nothing, applies nothing, exits non-zero if a restart would break.
 *
 *   node scripts/deploy-preflight.mjs           # before restarting
 *   node scripts/deploy-preflight.mjs --post    # after, to confirm it actually applied
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const SQL_DIR = path.join(BACKEND, "sql");
const POST = process.argv.includes("--post");

/** Read .env the way the app does — values may be wrapped in quotes. */
function env(key) {
  const raw = fs.readFileSync(path.join(BACKEND, ".env"), "utf8");
  const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

/**
 * The manifest is a TS array of quoted filenames. Parsing it by regex rather than
 * importing keeps this runnable against a tree whose dist is mid-build or broken —
 * which is exactly when you most want to run it.
 *
 * Match array ELEMENTS line by line; do not strip comments first. The obvious
 * implementation — remove block comments, then match every quoted filename — silently
 * loses entries, and it cost a debugging round here: the trailing comment on the 1103
 * entry contains the glob `uat/*.json`, whose `/*` opens a phantom block comment that
 * swallows every entry up to the next `*​/`, taking the whole 1110-1118 range with it.
 * A preflight that under-reports the manifest is worse than none, because it reports
 * OK for exactly the migrations it failed to see.
 *
 * Requiring the line to BE an element (`"1234_name.sql",`) also excludes filenames that
 * are merely discussed in prose comments — 1079 and 1080_credit_notes are deliberately
 * unlisted, and must not be counted as manifest entries.
 */
function manifestEntries() {
  const source = fs.readFileSync(path.join(BACKEND, "src/db/runPendingMigrations.ts"), "utf8");
  const names = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.match(/^\s*"(\d{3,4}_[A-Za-z0-9_]+\.sql)"\s*,/))
    .filter(Boolean)
    .map((match) => match[1]);
  return [...new Set(names)];
}

const problems = [];
const notes = [];

const manifest = manifestEntries();
if (manifest.length === 0) {
  console.error("preflight: parsed 0 manifest entries — the parser is wrong, not the manifest");
  process.exit(2);
}

// 1. Every manifest entry must exist on disk. A missing file is skipped with a warning
//    by the runner, never applied, and never recorded — the exact 503 above.
const missingFiles = manifest.filter((name) => !fs.existsSync(path.join(SQL_DIR, name)));
for (const name of missingFiles) {
  problems.push(`manifest names a file that does not exist on disk: ${name}`);
}

const connection = await mysql.createConnection({
  host: env("DB_HOST"),
  port: Number(env("DB_PORT") ?? 3306),
  user: env("DB_USER"),
  password: env("DB_PASSWORD"),
  database: env("DB_NAME"),
  connectTimeout: 30_000,
});

const [rows] = await connection.query(
  "SELECT filename, success FROM schema_migrations",
);
await connection.end();

const applied = new Set(rows.filter((r) => r.success).map((r) => r.filename));
const failed = new Set(rows.filter((r) => !r.success).map((r) => r.filename));

// 2. Anything in the manifest without a successful row is what the restart will try to
//    run. Pending is normal and fine — as long as the file is present to run.
const pending = manifest.filter((name) => !applied.has(name));
const pendingWithFile = pending.filter((name) => !missingFiles.includes(name));

for (const name of pending) {
  if (failed.has(name)) {
    problems.push(`previously FAILED and will be retried: ${name}`);
  }
}

if (POST) {
  // After the restart, nothing may be left pending — if it is, health is 503 right now.
  for (const name of pending) {
    problems.push(`still not applied after restart: ${name}`);
  }
} else {
  for (const name of pendingWithFile) {
    notes.push(`will apply on restart: ${name}`);
  }
}

console.log(`manifest entries : ${manifest.length}`);
console.log(`applied (success): ${applied.size}`);
console.log(`pending          : ${pending.length}`);
for (const note of notes) console.log(`  - ${note}`);

if (problems.length > 0) {
  console.error(`\nPREFLIGHT FAILED — restarting now would leave /api/health at 503:`);
  for (const problem of problems) console.error(`  ! ${problem}`);
  console.error(
    `\nA manifest entry with no file is usually a renumbered migration. Check whether the`
    + ` file was renamed upstream and pull, rather than editing the manifest here.`,
  );
  process.exit(1);
}

console.log(POST ? "\nOK — schema is complete, health should be 200." : "\nOK — safe to restart.");
