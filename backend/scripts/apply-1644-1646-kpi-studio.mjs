/**
 * Applies migrations 1644 / 1645 / 1646 — the KPI Studio schema — to the database
 * named in backend/.env.
 *
 * These three files shipped with their code but were registered in neither
 * MIGRATION_MANIFEST nor knownUnlisted, so the runner never executed them: on
 * production, kpi-studio.service.ts / .sources.ts / .compute.ts query seven tables
 * that do not exist (verified live 2026-09-03, information_schema returns none of
 * them), which is what schema-column-refs.test.ts has been failing on.
 *
 * Each file is sent to the server as one batch rather than being split client-side:
 * the statements use SET/PREPARE/EXECUTE guards, and the server's own parser handles
 * comments and quoting exactly, which no local splitter can be trusted to do.
 *
 * Every statement in all three files is idempotent by construction (CREATE TABLE IF
 * NOT EXISTS, information_schema-guarded PREPARE/EXECUTE for indexes and ALTERs,
 * INSERT ... WHERE NOT EXISTS for the two seed rows), so re-running is a no-op.
 *
 * Usage: node scripts/apply-1644-1646-kpi-studio.mjs [--dry-run]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(HERE, '..', 'sql');
const FILES = [
  '1644_kpi_studio_foundation.sql',
  '1645_kpi_studio_resolution.sql',
  '1646_kpi_studio_multi_source.sql',
];
const EXPECTED_TABLES = [
  'kpi_studio_data_source',
  'kpi_studio_source_field',
  'kpi_studio_definition',
  'kpi_studio_upload_batch',
  'kpi_studio_manual_value',
  'kpi_studio_computation_log',
  'kpi_studio_definition_source',
];
const dryRun = process.argv.includes('--dry-run');

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});
const q = async (sql, params = []) => (await db.query(sql, params))[0];

const tablesNow = async () =>
  (await q(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'kpi_studio%' ORDER BY TABLE_NAME`,
  )).map((r) => r.t ?? r.TABLE_NAME);

console.log(`database : ${(await q('SELECT DATABASE() d'))[0].d}`);
console.log(`before   : ${JSON.stringify(await tablesNow())}`);

if (dryRun) {
  for (const f of FILES) console.log(`would apply ${f} (${readFileSync(resolve(SQL_DIR, f), 'utf8').length} bytes)`);
  await db.end();
  process.exit(0);
}

for (const file of FILES) {
  const sql = readFileSync(resolve(SQL_DIR, file), 'utf8');
  const started = Date.now();
  try {
    const results = await q(sql);
    const n = Array.isArray(results) ? results.length : 1;
    console.log(`applied  : ${file} — ${n} result sets, ${Date.now() - started}ms`);
    await q(
      `INSERT INTO schema_migrations (filename, applied_at, environment, executor, success, duration_ms)
       VALUES (?, NOW(), ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at), success = 1`,
      [file, process.env.NODE_ENV ?? 'production', 'scripts/apply-1644-1646-kpi-studio.mjs', Date.now() - started],
    );
  } catch (err) {
    console.error(`FAILED   : ${file} — ${err.code ?? ''} ${err.message}`);
    await db.end();
    process.exit(1);
  }
}

const after = await tablesNow();
console.log(`after    : ${JSON.stringify(after)}`);

const missing = EXPECTED_TABLES.filter((t) => !after.includes(t));
if (missing.length) {
  console.error(`INCOMPLETE: still missing ${missing.join(', ')}`);
  await db.end();
  process.exit(1);
}

console.log('\nkpi_employee_resolved — columns 1645 adds:');
console.table(await q(
  `SELECT COLUMN_NAME AS col, COLUMN_TYPE AS type FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
      AND COLUMN_NAME IN ('studio_definition_id','formula_expression','data_source_id',
                          'aggregation_method','scoring_type','resolved_scope','resolved_from')`,
));

console.log('\nkpi_studio_data_source seed rows:');
console.table(await q(`SELECT source_code, source_name, source_type FROM kpi_studio_data_source`));

console.log('\nrow counts (all new tables must be empty except the two seeded sources):');
for (const t of EXPECTED_TABLES) {
  const [{ n }] = await q(`SELECT COUNT(*) n FROM \`${t}\``);
  console.log(`  ${t.padEnd(30)} ${n}`);
}

await db.end();
console.log('\nDone.');
