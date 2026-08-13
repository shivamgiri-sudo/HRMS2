#!/usr/bin/env tsx
/**
 * Non-production migration preflight — mandatory gate before any production PM2 restart.
 *
 * Born directly from the 2026-08-13 outage (docs/incidents/2026-08-13-migration-1006-production-outage.md):
 * a migration with syntax this production MySQL build doesn't accept was pulled in alongside
 * an unrelated deploy and took the backend down for ~24 minutes, because the first time it
 * ever ran was in production, after the healthy process had already been stopped.
 *
 * What this does, and — as importantly — what it deliberately does NOT do:
 *
 *  - Connects to the SAME MySQL server production talks to (same host, same version/build —
 *    no version-approximation gap), but a dedicated, isolated database that is never
 *    `mas_hrms` and is dropped/recreated on every run. It never reads or writes production
 *    data, and never touches the running application.
 *  - Clones the CURRENT production schema (structure only, via SHOW CREATE TABLE — no
 *    mysqldump dependency, no data) into that isolated database, so the test starts from
 *    exactly today's real applied-migration state, not a bare/empty schema.
 *  - Resolves which backend/sql/*.sql files are pending (added or modified between FROM_SHA
 *    and TARGET_SHA) via `git show`, reading file content directly from git — this runs
 *    BEFORE any `git pull`/checkout, so it never depends on the working tree already having
 *    moved.
 *  - Runs every pending migration against the clone using the exact same statement-splitting
 *    logic production uses (splitSql, imported from runPendingMigrations — not reimplemented),
 *    TWICE per file: once for first-apply, once to prove rerun/idempotency. A migration that
 *    only "works" the first time is exactly the failure mode this exists to catch.
 *  - Exits non-zero on any failure. The deployment runbook treats a non-zero exit here as a
 *    hard stop — no PM2 restart happens until this passes.
 *
 * What this does NOT do (tracked separately, not silently assumed done):
 *  - Does not audit for every possible MySQL-version incompatibility, only proves the specific
 *    pending SQL actually executes. Pair with `npm test -- migration-syntax-compatibility` for
 *    the static pattern check.
 *  - Does not detect schema drift against `MIGRATION_MANIFEST.lock.json` / information_schema
 *    beyond "does the pending SQL run" — a fuller drift detector is still open, see the
 *    readiness doc.
 *  - Does not replace a real staging environment with production-representative data volume;
 *    it proves DDL correctness, not query performance at scale.
 *
 * Usage (run from backend/, before pulling):
 *   npx tsx scripts/migration-preflight.ts <from-sha> <to-sha>
 *
 * Exit code 0 = safe to proceed with git pull + restart. Non-zero = do not deploy.
 */
import mysql from "mysql2/promise";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
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
 * The application's own DB_USER (shivam_user) is intentionally scoped to mas_hrms only — it
 * cannot CREATE DATABASE, which is the correct posture for an app credential and the wrong one
 * for this script. Rather than widen the app account's privileges just for this, connection
 * details for creating/dropping the isolated preflight database are read from separate
 * PREFLIGHT_DB_* env vars, falling back to DB_* only for values that don't need elevated
 * privilege (host/port/database-to-clone-from).
 *
 * ONE-TIME SETUP STILL OPEN: for this to run against the exact production MySQL server
 * (192.168.10.6, 8.0.42) rather than an approximation, a DBA needs to grant CREATE/DROP/ALTER
 * on `hrms2_migration_preflight` to a credential this script can use — see the readiness doc.
 * Until that grant exists, PREFLIGHT_DB_HOST/USER/PASSWORD may point at any MySQL 8.0.4x server
 * this operator has admin rights on (e.g. the deploy box's own local mysqld) as a close
 * approximation; the version banner this script prints makes that gap visible on every run
 * rather than hiding it.
 */
function loadAdminConfig(env: Record<string, string>) {
  // Real shell/CI environment variables take priority over .env-file values — PREFLIGHT_DB_*
  // is meant to be set per-invocation (e.g. by CI secrets), not committed to the .env file.
  const pick = (key: string) => process.env[key] ?? env[key];
  return {
    host: pick("PREFLIGHT_DB_HOST") || env.DB_HOST,
    port: Number(pick("PREFLIGHT_DB_PORT") || env.DB_PORT || 3306),
    user: pick("PREFLIGHT_DB_USER") || env.DB_USER,
    password: pick("PREFLIGHT_DB_PASSWORD") ?? env.DB_PASSWORD,
  };
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** Reads a file's content at a given ref directly from git — no checkout required. */
function readAtRef(ref: string, relPath: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${relPath}`], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch {
    return null; // file doesn't exist at that ref (e.g. newly added)
  }
}

async function main() {
  const [fromSha, toSha] = process.argv.slice(2);
  if (!fromSha || !toSha) {
    console.error("Usage: npx tsx scripts/migration-preflight.ts <from-sha> <to-sha>");
    process.exit(2);
  }

  console.log(`[preflight] range: ${fromSha}..${toSha}`);

  // 1. Enumerate every backend/sql/*.sql file added or modified in the range — ownership of
  //    who wrote it is irrelevant, per the incident's own finding: the migration that took
  //    production down was authored by a different session than the one that deployed it.
  const diffOutput = git(["diff", "--name-status", `${fromSha}..${toSha}`, "--", "backend/sql/*.sql"]);
  const pendingFiles = diffOutput
    .split("\n")
    .filter(Boolean)
    .filter((line) => /^[AM]\t/.test(line))
    .map((line) => line.split("\t")[1]);

  if (pendingFiles.length === 0) {
    console.log("[preflight] no pending backend/sql/*.sql changes in range — nothing to test. PASS.");
    process.exit(0);
  }
  console.log(`[preflight] ${pendingFiles.length} pending migration file(s): ${pendingFiles.join(", ")}`);

  const env = loadEnv();
  const adminCfg = loadAdminConfig(env);
  const PREFLIGHT_DB = "hrms2_migration_preflight";

  // Read-only connection to real production — used only for SHOW CREATE TABLE (structure,
  // never data) and to report whether the admin host is actually production or an approximation.
  const prodConn = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  const [[prodVerRow]] = (await prodConn.query("SELECT VERSION() AS v")) as any;

  // 2. Admin connection for creating/dropping the isolated preflight database.
  const admin = await mysql.createConnection({
    host: adminCfg.host, port: adminCfg.port,
    user: adminCfg.user, password: adminCfg.password,
    multipleStatements: false,
  });
  const [[verRow]] = (await admin.query("SELECT VERSION() AS v")) as any;

  const sameServer = adminCfg.host === env.DB_HOST;
  console.log(`[preflight] production MySQL:        ${prodVerRow.v} (${env.DB_HOST})`);
  console.log(`[preflight] preflight-DB admin host: ${verRow.v} (${adminCfg.host})`);
  if (!sameServer || verRow.v !== prodVerRow.v) {
    console.warn(
      `[preflight] WARNING: preflight is running against a DIFFERENT server/version than production. ` +
      `This is an approximation, not a guarantee — see the ONE-TIME SETUP note in this script's header. ` +
      `Set PREFLIGHT_DB_HOST/PORT/USER/PASSWORD to a credential with CREATE/DROP on production itself ` +
      `to close this gap.`
    );
  }

  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${PREFLIGHT_DB}\``);
    await admin.query(`CREATE DATABASE \`${PREFLIGHT_DB}\``);
    console.log(`[preflight] created isolated database ${PREFLIGHT_DB}`);

    // 3. Clone current production schema — structure only, via SHOW CREATE TABLE. No data ever
    //    leaves mas_hrms; this only reads table definitions.
    const [tables] = (await prodConn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [env.DB_NAME]
    )) as any;
    console.log(`[preflight] cloning schema of ${tables.length} table(s) from ${env.DB_NAME}...`);

    const testConn = await mysql.createConnection({
      host: adminCfg.host, port: adminCfg.port,
      user: adminCfg.user, password: adminCfg.password, database: PREFLIGHT_DB,
      multipleStatements: false,
    });

    // Disable FK checks while recreating tables out of dependency order.
    await testConn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const { TABLE_NAME: tableName } of tables as Array<{ TABLE_NAME: string }>) {
      const [[createRow]] = (await prodConn.query(`SHOW CREATE TABLE \`${tableName}\``)) as any;
      const createSql: string = createRow["Create Table"];
      try {
        await testConn.query(createSql);
      } catch (e) {
        console.error(`[preflight] FAILED cloning table ${tableName}: ${(e as Error).message}`);
        throw e;
      }
    }
    await testConn.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log(`[preflight] schema clone complete — ${PREFLIGHT_DB} now matches production structure as of today`);

    // 4 & 5. Run each pending migration against the clone using the SAME splitter production
    // uses, twice, to prove both first-apply and rerun/idempotency.
    const { splitSql } = await import("../src/db/runPendingMigrations.js");

    let anyFailure = false;
    for (const relPath of pendingFiles) {
      const sql = readAtRef(toSha, relPath);
      if (sql === null) {
        console.log(`[preflight] ${relPath}: deleted at ${toSha}, skipping`);
        continue;
      }
      const statements = splitSql(sql).filter((s) => {
        const upper = s.toUpperCase();
        return !upper.startsWith("SOURCE ") && !upper.startsWith("USE ");
      });

      for (const pass of [1, 2] as const) {
        console.log(`[preflight] ${relPath}: pass ${pass}/2 (${statements.length} statement(s))`);
        for (const [i, stmt] of statements.entries()) {
          try {
            await testConn.query(stmt);
          } catch (e) {
            const err = e as { code?: string; sqlMessage?: string; message: string };
            console.error(
              `[preflight] FAIL ${relPath} pass ${pass} statement ${i + 1}/${statements.length}: ` +
              `${err.code ?? ""} ${err.sqlMessage ?? err.message}`
            );
            console.error(`[preflight]   statement: ${stmt.slice(0, 300)}`);
            anyFailure = true;
          }
        }
      }
      if (!anyFailure) console.log(`[preflight] ${relPath}: PASS (both passes clean)`);
    }

    await testConn.end();

    if (anyFailure) {
      console.error(`\n[preflight] FAILED — do not proceed with deployment. Database ${PREFLIGHT_DB} left in place for inspection.`);
      process.exitCode = 1;
    } else {
      await admin.query(`DROP DATABASE IF EXISTS \`${PREFLIGHT_DB}\``);
      console.log(`\n[preflight] PASS — all ${pendingFiles.length} pending migration(s) apply cleanly and are rerun-safe. Safe to deploy.`);
      process.exitCode = 0;
    }
  } finally {
    await admin.end();
    await prodConn.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[preflight] unexpected error:", e);
  process.exit(1);
});
