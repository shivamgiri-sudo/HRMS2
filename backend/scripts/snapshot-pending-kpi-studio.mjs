#!/usr/bin/env node
/**
 * Adds the KPI Studio tables and columns to backend/sql/schema-snapshot.json by APPLYING migrations
 * 1644/1645/1646 to a throwaway MySQL and reading information_schema back.
 *
 * WHY THIS EXISTS
 * schema-snapshot.json is generated from the LIVE database (generate-schema-snapshot.mjs), and
 * src/db/__tests__/schema-column-refs.test.ts validates every SQL reference in the tree against it.
 * That works for schema already in production and breaks down for a migration that has not been
 * applied yet: the code is written against the post-migration schema, the snapshot describes the
 * pre-migration one, and the guard correctly reports every new table and column as broken.
 *
 * The tempting fix is to hand-type the new entries into the snapshot. That defeats the guard: the
 * guard exists to catch a column name that does not match the DDL, and a hand-typed snapshot entry
 * carries exactly the same typo the code does, so the two agree and the mistake ships. A snapshot
 * that was typed rather than observed is not evidence of anything.
 *
 * So the entries are OBSERVED. The migrations are executed for real against a disposable MySQL 8 and
 * information_schema is read back, which means a column named wrongly in the migration or in the
 * code still fails the guard — the failure mode the guard is for is preserved.
 *
 * Read-only with respect to the production database: it never connects to it.
 *
 *   node scripts/snapshot-pending-kpi-studio.mjs
 *
 * Requires a working docker daemon. Once migrations 1644-1646 are applied to production,
 * generate-schema-snapshot.mjs will observe them directly and this script becomes unnecessary.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(HERE, "../sql");
const SNAPSHOT = resolve(SQL_DIR, "schema-snapshot.json");
const CONTAINER = `kpi-studio-snapshot-${process.pid}`;

/** The files whose effect on the schema we want recorded, in application order. */
const MIGRATIONS = [
  "verify/kpi_studio_migration_fixture.sql",
  "1644_kpi_studio_foundation.sql",
  "1645_kpi_studio_resolution.sql",
  "1646_kpi_studio_multi_source.sql",
  "1647_portal_kpi_config.sql",
];

/**
 * Tables to lift out of the throwaway schema.
 *
 * kpi_employee_resolved is included because 1645 ADDS columns to a table that already exists in
 * production, so its snapshot entry has to be replaced rather than added. The fixture recreates it
 * with the exact pre-migration shape read from the live database, so what comes back is
 * "production's columns plus the migration's" and not an invention.
 *
 * The fixture's other tables (employees, kpi_metric_master) are deliberately NOT lifted: they exist
 * in production, the snapshot already describes them accurately, and the fixture's copies are
 * simplified stand-ins. Overwriting real entries with stand-ins would blind the guard to every other
 * column those tables have.
 */
const LIFT_PREFIX = "kpi_studio";
const LIFT_EXACT = ["kpi_employee_resolved", "portal_kpi_config"];

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options });
}

function mysql(sqlText) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "mysql", "-uroot", "-pthrowaway", "-N", "-B", "snapshot_probe"],
    { input: sqlText, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

function cleanup() {
  try {
    docker(["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

process.on("exit", cleanup);

console.log("Starting throwaway MySQL 8...");
docker([
  "run", "-d", "--rm",
  "--name", CONTAINER,
  "-e", "MYSQL_ROOT_PASSWORD=throwaway",
  "-e", "MYSQL_DATABASE=snapshot_probe",
  "mysql:8.0",
  // Matches the production server default, so a missing COLLATE in a migration is not masked here.
  "--collation-server=utf8mb4_0900_ai_ci",
  "--character-set-server=utf8mb4",
]);

// Readiness is an authenticated SELECT, not mysqladmin ping. The official image starts a temporary
// server during initialisation that answers ping while the root password is still being configured,
// so pinging succeeds and the very next statement fails with ER_ACCESS_DENIED_ERROR (1045).
let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    mysql("SELECT 1;");
    ready = true;
    break;
  } catch {
    execFileSync("sleep", ["2"]);
  }
}
if (!ready) {
  console.error("MySQL did not become ready.");
  process.exit(1);
}

for (const file of MIGRATIONS) {
  const sqlText = readFileSync(resolve(SQL_DIR, file), "utf8");
  try {
    mysql(sqlText);
    console.log(`  applied ${file}`);
  } catch (error) {
    console.error(`  FAILED ${file}`);
    console.error(String(error.stderr ?? error.message));
    process.exit(1);
  }
}

// Ordered by ORDINAL_POSITION so the snapshot lists columns in their real declaration order, matching
// how generate-schema-snapshot.mjs records them.
const rows = mysql(
  `SELECT TABLE_NAME, COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'snapshot_probe'
    ORDER BY TABLE_NAME, ORDINAL_POSITION;`,
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));

const observed = new Map();
for (const [table, column] of rows) {
  // Lowercased to honour the snapshot's first invariant: columnRefsIn() lowercases every identifier
  // it extracts, so a snapshot holding MySQL's real case would make the guard flag correct code.
  const tableName = table.toLowerCase();
  if (!tableName.startsWith(LIFT_PREFIX) && !LIFT_EXACT.includes(tableName)) continue;
  if (!observed.has(tableName)) observed.set(tableName, []);
  observed.get(tableName).push(column.toLowerCase());
}

if (!observed.size) {
  console.error("Nothing was observed — the migrations did not create the expected tables.");
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
let added = 0;
let replaced = 0;

for (const [table, columns] of [...observed.entries()].sort()) {
  const existing = snapshot.tables[table];
  if (!existing) {
    snapshot.tables[table] = columns;
    added += 1;
    console.log(`  + ${table} (${columns.length} columns)`);
    continue;
  }
  // A table that already exists keeps every column the live database has, and gains the ones the
  // migration adds. Replacing outright would drop any column present in production but absent from
  // the fixture, which would then be reported as a broken reference everywhere it is used.
  const merged = [...existing];
  const before = merged.length;
  for (const column of columns) {
    if (!merged.includes(column)) merged.push(column);
  }
  if (merged.length !== before) {
    snapshot.tables[table] = merged;
    replaced += 1;
    console.log(`  ~ ${table} (+${merged.length - before} columns: ${columns.filter((c) => !existing.includes(c)).join(", ")})`);
  }
}

snapshot.tableCount = Object.keys(snapshot.tables).length;
snapshot.columnCount = Object.values(snapshot.tables).reduce((total, columns) => total + columns.length, 0);
// generatedFrom is LEFT ALONE on purpose. It names the database the snapshot mirrors, and
// report-accuracy-guards.contract.test.ts asserts it is exactly "mas_hrms" before using the
// snapshot as its oracle for which tables exist in production. An earlier version of this script
// appended provenance to that string; the guard then threw inside its module initialiser, which
// aborts the whole FILE rather than failing one test — so its 7 assertions silently stopped
// running instead of reporting red. Provenance belongs in its own key, where nothing pins it.
snapshot.pendingMigrations =
  "kpi_studio tables, kpi_employee_resolved columns and portal_kpi_config are from migrations " +
  "1644-1647, observed via scripts/snapshot-pending-kpi-studio.mjs. Everything else mirrors live " +
  "mas_hrms. Remove this key once 1644-1647 are applied to production and the snapshot is " +
  "regenerated by generate-schema-snapshot.mjs.";

writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `\nSnapshot updated: ${added} table(s) added, ${replaced} extended. ` +
    `Now ${snapshot.tableCount} tables / ${snapshot.columnCount} columns.`,
);
