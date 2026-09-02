/**
 * Builds the UAT schema by running the REAL migration manifest against the disposable UAT MySQL.
 *
 * WHY THIS EXISTS RATHER THAN `npm run migrate:fresh:test`
 * migrate-fresh-test.ts stops at the FIRST failing statement, which makes it a good gate for
 * "is every migration clean on a fresh database" and a poor tool for building one. It halts at
 * 054_ats_onboarding_flow.sql statement #30 — an unguarded
 * `ALTER TABLE auth_user ADD COLUMN must_change_password` against a column an earlier file now
 * creates — after 56 of 667 files. That is a genuine pre-existing fresh-build defect, but it is
 * ER_DUP_FIELDNAME (1060), which the BOOT runner treats as benign and skips. So production boots
 * fine and only the fresh-build gate trips.
 *
 * This script therefore applies the manifest with the boot runner's OWN error classification,
 * imported from runPendingMigrations.ts rather than reimplemented, with one deliberate difference:
 *
 *   boot runner : a benign error skips the REST OF THE FILE
 *   this script : a benign error skips only that STATEMENT and the file continues
 *
 * The per-statement form is the correct one for building a schema, and the difference is not
 * academic — it is the exact defect the manifest comments record for 509_portal_client_master_fixes
 * and 246_nominee_gratuity_distribution, both of which were "recorded as applied" while losing
 * every statement after a mid-file ER_DUP_FIELDNAME. Whole-file skipping on a fresh database would
 * silently omit hundreds of tables and the UAT would then "pass" against a schema that is missing
 * the objects under test.
 *
 * Non-benign errors are recorded and the run continues, matching the boot runner. They are printed
 * as a census at the end so a real defect is visible rather than buried.
 *
 * SAFETY. Refuses to run unless the target is a disposable, local, test-named database. There is no
 * flag to override that.
 *
 *   npx tsx scripts/uat/uat-build-schema.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import { splitSql, MIGRATION_MANIFEST, isIdempotentMigrationError } from "../../src/db/runPendingMigrations.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(HERE, "../../sql");

const DB_HOST = process.env.UAT_DB_HOST ?? "127.0.0.1";
const DB_PORT = Number(process.env.UAT_DB_PORT ?? 13306);
const DB_USER = process.env.UAT_DB_USER ?? "root";
const DB_PASSWORD = process.env.UAT_DB_PASSWORD ?? "uatroot";
const DB_NAME = process.env.UAT_DB_NAME ?? "mas_hrms_test";

// ── Guards. Identical in spirit to migrate-fresh-test.ts, and not overridable. ────────────────
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
if (!LOCAL_HOSTS.has(DB_HOST.trim().toLowerCase())) {
  console.error(`FATAL: refusing to build schema on non-local host '${DB_HOST}'.`);
  process.exit(1);
}
if (!/(^test_|_test$|_testing$|_uat$|^uat_)/i.test(DB_NAME)) {
  console.error(`FATAL: '${DB_NAME}' does not look disposable. Name it *_test or *_uat.`);
  process.exit(1);
}

interface Failure {
  file: string;
  statementIndex: number;
  statement: string;
  code: string;
  message: string;
}

async function main() {
  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD,
    multipleStatements: false,
  });

  console.log(`[uat-schema] target ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  // utf8mb4_unicode_ci is the DATABASE default on production; the SERVER default there is
  // utf8mb4_0900_ai_ci (set on the container). Reproducing BOTH is the point — a bare
  // CHARSET=utf8mb4 in a migration resolves to the server default, not the database default, and
  // the resulting cross-collation join is a hard errno 1267. Making them equal here would hide it.
  await conn.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.changeUser({ database: DB_NAME });
  await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 0");

  let applied = 0, missingFiles = 0, benignSkips = 0, statementsRun = 0;
  const failures: Failure[] = [];

  for (const file of MIGRATION_MANIFEST) {
    const full = path.join(SQL_DIR, file);
    if (!fs.existsSync(full)) { missingFiles++; continue; }

    // `USE` and `SOURCE` are STRIPPED, matching migrate-fresh-test.ts lines 144/210.
    // This is not cosmetic. 177 of these files carry a bare `USE mas_hrms;`, and one carries
    // `CREATE DATABASE IF NOT EXISTS mas_hrms`. Executing them redirects the rest of the session out
    // of the target database and into one literally named `mas_hrms` — which on a developer machine
    // or CI runner IS the real database. Verified by leaving them in on the first run of this
    // script: 827 tables were created in `mas_hrms` and the UAT database was left with 0. Any tool
    // that applies these files MUST filter these two verbs.
    const statements = splitSql(fs.readFileSync(full, "utf8")).filter((s) => {
      const upper = s.trimStart().toUpperCase();
      return !upper.startsWith("USE ") && !upper.startsWith("SOURCE ");
    });
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        await conn.query(statement);
        statementsRun++;
      } catch (error) {
        if (isIdempotentMigrationError(error)) { benignSkips++; continue; }
        const e = error as { code?: string; message?: string };
        failures.push({
          file, statementIndex: i + 1,
          statement: statement.replace(/\s+/g, " ").slice(0, 160),
          code: String(e.code ?? "?"), message: String(e.message ?? error).slice(0, 200),
        });
      }
    }
    applied++;
  }

  const [[{ tables }]] = await conn.query<any[]>(
    "SELECT COUNT(*) AS tables FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [DB_NAME]);
  const [[{ columns }]] = await conn.query<any[]>(
    "SELECT COUNT(*) AS columns FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?", [DB_NAME]);

  console.log(`\n[uat-schema] files in manifest : ${MIGRATION_MANIFEST.length}`);
  console.log(`[uat-schema] files processed   : ${applied}  (absent from disk: ${missingFiles})`);
  console.log(`[uat-schema] statements run    : ${statementsRun}`);
  console.log(`[uat-schema] benign skips      : ${benignSkips}  (already-exists / dup column / dup key)`);
  console.log(`[uat-schema] hard failures     : ${failures.length}`);
  console.log(`[uat-schema] schema built      : ${tables} tables / ${columns} columns`);

  if (failures.length) {
    const byCode = new Map<string, number>();
    for (const f of failures) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
    console.log(`\n[uat-schema] hard failures by error code:`);
    for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)} ${code}`);
    }
  }
  fs.writeFileSync("/tmp/uat-schema-failures.json", JSON.stringify(failures, null, 2));
  console.log(`\n[uat-schema] full failure detail -> /tmp/uat-schema-failures.json`);

  await conn.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
