/**
 * Repair ats_candidate.created_date left day/month-swapped after the created_at repair.
 *
 *   node scripts/ats-candidate-created-date-repair.mjs            # dry-run (default)
 *   node scripts/ats-candidate-created-date-repair.mjs --apply    # write
 *
 * ats-candidate-future-date-repair.mjs swapped created_at / walk_in_date back for rows a bulk import had
 * written day-month swapped, but never touched created_date. Those rows now read created_at = 2026-03-10 and
 * created_date = 2026-10-03, so reports bucket a 10-March registration under 3 October.
 *
 * Target: created_date is exactly the day/month swap of DATE(created_at) and differs from it. created_at is the
 * repaired, trusted value, so created_date is set to DATE(created_at). The swap is its own inverse. updated_at is
 * named explicitly because the column is `on update CURRENT_TIMESTAMP`.
 */
import "dotenv/config";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const APPLY = process.argv.includes("--apply");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
  dateStrings: true,
});
console.log(`mode=${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}  table=ats_candidate.created_date`);

const WHERE = `created_at IS NOT NULL AND created_date IS NOT NULL
   AND created_date <> DATE(created_at)
   AND DATE_FORMAT(created_date,'%Y-%d-%m') = DATE_FORMAT(created_at,'%Y-%m-%d')`;

const [[scope]] = await conn.query(`SELECT COUNT(*) target, SUM(q_token LIKE 'OX%') ox, MIN(created_at) first_at, MAX(created_at) last_at FROM ats_candidate WHERE ${WHERE}`);
console.log(`target=${scope.target} (OX tokens: ${scope.ox}) created_at range ${scope.first_at} .. ${scope.last_at}`);
const [by] = await conn.query(`SELECT created_date, DATE(created_at) true_date, COUNT(*) n FROM ats_candidate WHERE ${WHERE} GROUP BY 1,2 ORDER BY 1 DESC LIMIT 15`);
console.table(by);
const [[w]] = await conn.query(`SELECT SUM(walk_in_date = DATE(created_at)) walkin_matches_created_at FROM ats_candidate WHERE ${WHERE}`);
console.log(`walk_in_date already equals DATE(created_at): ${w.walkin_matches_created_at} of ${scope.target}`);

if (Number(scope.target) === 0) { console.log("Nothing to repair."); await conn.end(); process.exit(0); }
if (Number(scope.target) > 5000) { console.error(`REFUSING: ${scope.target} rows is beyond the expected scope. Nothing written.`); await conn.end(); process.exit(1); }
if (!APPLY) { console.log(`\n[DRY RUN] would set created_date = DATE(created_at) on ${scope.target} row(s). Nothing written.`); await conn.end(); process.exit(0); }

const [res] = await conn.execute(`UPDATE ats_candidate SET created_date = DATE(created_at), updated_at = updated_at WHERE ${WHERE}`);
console.log(`\nrepaired ${res.affectedRows} row(s)`);
const [[after]] = await conn.query(`SELECT COUNT(*) remaining FROM ats_candidate WHERE ${WHERE}`);
console.log(`remaining swapped created_date rows: ${after.remaining} (must be 0)`);
await conn.end();
process.exit(0);
