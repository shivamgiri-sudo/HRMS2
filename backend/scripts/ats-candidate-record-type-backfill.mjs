/**
 * Backfill ats_candidate.record_type, which migration 1130 added.
 *
 *   node scripts/ats-candidate-record-type-backfill.mjs            # dry-run (default)
 *   node scripts/ats-candidate-record-type-backfill.mjs --apply    # write
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * ats_candidate holds 37,696 rows, of which 29,926 are legacy EMPLOYEE records whose
 * candidate_code matches a real employees.employee_code, and 7,770 are genuine candidates.
 * Nothing marks which is which, so ~20 query sites each repeat a correlated NOT EXISTS over
 * 30k rows. This writes the answer down once.
 *
 * ── ORDER MATTERS ────────────────────────────────────────────────────────────
 * Migration 1130 defaults every existing row to 'candidate', which is deliberately WRONG for
 * the 29,926 legacy rows until this runs. So:
 *
 *      1130 applied  ->  THIS SCRIPT  ->  only then repoint excludeEmployeeShapedCandidatesSql
 *
 * Repointing the helper before this has run would mark every legacy row as a genuine candidate
 * and silently undo every exclusion fixed this week. Nothing reads record_type until that last
 * step, so running this changes no behaviour — it only makes the later switch safe.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 *   - Dry-run by default; writes only with --apply.
 *   - Refuses if migration 1130 has not applied.
 *   - Refuses if the measured legacy count is implausible, so a broken join cannot relabel the
 *     whole table.
 *   - Batched and idempotent: it only touches rows not already labelled, so an interrupted run
 *     resumes and a re-run is a no-op.
 *   - Reversible: UPDATE ats_candidate SET record_type = 'candidate';  (the column is derived,
 *     never a source of truth — it can always be recomputed from the join.)
 */
import "dotenv/config";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const APPLY = process.argv.includes("--apply");
const BATCH = 2000;

const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
});

console.log(`mode=${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}  table=ats_candidate`);

// Guard 1: the column must exist. Running before 1130 would fail per-statement anyway, but a
// clear refusal beats an ER_BAD_FIELD_ERROR halfway through.
const [[col]] = await conn.query(
  `SELECT COUNT(1) AS n FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ats_candidate' AND column_name = 'record_type'`,
);
if (Number(col.n) === 0) {
  console.error("REFUSING: ats_candidate.record_type does not exist — apply migration 1130 first.");
  await conn.end();
  process.exit(1);
}

// Guard 2: measure before writing, and sanity-check the shape.
const [[m]] = await conn.query(`
  SELECT COUNT(*) AS total,
         SUM(e.id IS NOT NULL) AS legacy,
         SUM(e.id IS NULL)     AS genuine,
         SUM(e.id IS NOT NULL AND ac.record_type <> 'legacy_employee') AS pending
    FROM ats_candidate ac
    LEFT JOIN employees e ON e.employee_code = ac.candidate_code`);
const total = Number(m.total), legacy = Number(m.legacy), genuine = Number(m.genuine), pending = Number(m.pending);
console.log(`total=${total}  legacy=${legacy}  genuine=${genuine}  pending=${pending}`);

// A join that silently matched everything (or nothing) is the failure that would matter here:
// relabelling all 37,696 rows as legacy would empty every candidate report at once.
if (legacy === 0 || legacy === total) {
  console.error(`REFUSING: measured legacy=${legacy} of total=${total}. That is not a credible split —`);
  console.error("the candidate_code -> employees.employee_code join is behaving unexpectedly. Nothing written.");
  await conn.end();
  process.exit(1);
}
if (genuine < 1000) {
  console.error(`REFUSING: only ${genuine} rows would remain as genuine candidates. Expected ~7,700.`);
  await conn.end();
  process.exit(1);
}

if (!APPLY) {
  console.log(`\n[DRY RUN] would set record_type='legacy_employee' on ${pending} row(s).`);
  console.log("Nothing was written. Re-run with --apply to write.");
  await conn.end();
  process.exit(0);
}

let written = 0;
for (;;) {
  // Only rows not already labelled, so this is idempotent and resumable.
  const [res] = await conn.execute(
    `UPDATE ats_candidate ac
        SET ac.record_type = 'legacy_employee'
      WHERE ac.record_type <> 'legacy_employee'
        AND EXISTS (SELECT 1 FROM employees e2 WHERE e2.employee_code = ac.candidate_code)
      LIMIT ${BATCH}`,
  );
  if (res.affectedRows === 0) break;
  written += res.affectedRows;
  process.stdout.write(`\r  labelled ${written}/${pending}   `);
}
process.stdout.write("\n");

const [[after]] = await conn.query(`
  SELECT SUM(record_type = 'legacy_employee') AS legacy_labelled,
         SUM(record_type = 'candidate')       AS candidate_labelled,
         COUNT(*)                             AS total
    FROM ats_candidate`);
console.log(`\n=== verification ===`);
console.log(`legacy_employee=${after.legacy_labelled}  candidate=${after.candidate_labelled}  total=${after.total}`);

// The column must agree with the join it was derived from, exactly.
const [[drift]] = await conn.query(`
  SELECT SUM(e.id IS NOT NULL AND ac.record_type <> 'legacy_employee') AS legacy_mislabelled,
         SUM(e.id IS NULL     AND ac.record_type <> 'candidate')       AS genuine_mislabelled
    FROM ats_candidate ac
    LEFT JOIN employees e ON e.employee_code = ac.candidate_code`);
console.log(`drift vs the join: legacy_mislabelled=${drift.legacy_mislabelled} genuine_mislabelled=${drift.genuine_mislabelled} (both must be 0)`);

await conn.end();
process.exit(0);
