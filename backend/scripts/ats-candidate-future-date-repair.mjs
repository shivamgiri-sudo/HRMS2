/**
 * Repair the ats_candidate rows whose dates were written by a day/month swap.
 *
 *   node scripts/ats-candidate-future-date-repair.mjs            # dry-run (default)
 *   node scripts/ats-candidate-future-date-repair.mjs --apply    # write
 *
 * ── WHAT AND WHY ─────────────────────────────────────────────────────────────
 * bulk-import.service.ts parsed ambiguous d/m/yyyy dates as M/D/YYYY. Where both parts were
 * <= 12 and the real format was D/M, the day and month exchanged places. Measured on
 * production 2026-08-11: 453 rows carry a created_at between 2026-09-03 and 2026-12-05 against
 * a clock of 2026-08-11. A record cannot be created after now, so those are provably wrong.
 *
 * The parser is fixed (2876444a); this repairs the rows it already wrote.
 *
 * ── WHY EXACTLY THESE 453 AND NOT ONE MORE ───────────────────────────────────
 * The swap is only detectable when it pushes a date into the future. 4,300 further rows are
 * equally ambiguous (both parts <= 12) but landed in the past, where the two readings are
 * indistinguishable — a wrong one looks exactly like a right one. Touching those would be
 * guessing, so the target is strictly `created_at > NOW()`.
 *
 * Verified before writing this:
 *   453 of 453 have DAY(created_at) <= 12, so the swap is well defined
 *   453 of 453 land in the PAST once swapped (2026-03-09 .. 2026-06-11, a coherent import window)
 *   453 of 453 have walk_in_date = DATE(created_at), i.e. both came from the same parsed value
 *   448 of 453 also have a future updated_at, and all 448 swap into the past
 *
 * ── THE TRAP THIS AVOIDS ─────────────────────────────────────────────────────
 * ats_candidate.updated_at is `DEFAULT_GENERATED on update CURRENT_TIMESTAMP`. Any UPDATE that
 * does not name it explicitly would stamp all 453 rows with today's timestamp and destroy the
 * historical value — repairing one column by silently corrupting another. Every statement here
 * sets updated_at explicitly.
 *
 * ── REVERSIBILITY ────────────────────────────────────────────────────────────
 * The swap is its own inverse. To undo, re-apply the same expression to the affected ids —
 * they are printed and can be captured before the run:
 *   SELECT id, created_at, updated_at, walk_in_date FROM ats_candidate WHERE created_at > NOW();
 * After a successful run no row satisfies that predicate, so a re-run is a no-op rather than a
 * second swap.
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
});

console.log(`mode=${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}  table=ats_candidate`);

/** Exchange month and day, preserving the time component. */
const SWAP = (col) =>
  `STR_TO_DATE(CONCAT(YEAR(${col}),'-',LPAD(DAY(${col}),2,'0'),'-',LPAD(MONTH(${col}),2,'0'),' ',TIME(${col})),'%Y-%m-%d %H:%i:%s')`;

const [[scope]] = await conn.query(`
  SELECT COUNT(*) AS target,
         SUM(DAY(created_at) <= 12)                       AS swappable,
         SUM(${SWAP("created_at")} <= NOW())              AS lands_in_past,
         SUM(walk_in_date = DATE(created_at))             AS walkin_matches,
         SUM(updated_at > NOW() AND DAY(updated_at) <= 12) AS updated_repairable
    FROM ats_candidate WHERE created_at > NOW()`);

const target = Number(scope.target);
console.log(`target=${target} swappable=${scope.swappable} lands_in_past=${scope.lands_in_past} ` +
            `walkin_matches=${scope.walkin_matches} updated_repairable=${scope.updated_repairable}`);

const [[extra]] = await conn.query(`
  SELECT COUNT(*) AS n FROM ats_candidate
   WHERE updated_at > NOW() AND DAY(updated_at) <= 12
     AND ${SWAP("updated_at")} <= NOW() AND ${SWAP("updated_at")} >= created_at`);
console.log(`updated_at-only rows repairable in the second pass: ${extra.n}`);

if (target === 0 && Number(extra.n) === 0) {
  console.log("Nothing to repair — no row has a future created_at or a repairable future updated_at.");
  await conn.end();
  process.exit(0);
}

// Every targeted row must be provably repairable. A row that cannot swap, or that stays in the
// future after swapping, is not the defect this script understands, and guessing at it would be
// worse than leaving it.
if (Number(scope.swappable) !== target || Number(scope.lands_in_past) !== target) {
  console.error(`REFUSING: only ${scope.swappable} of ${target} are swappable and ${scope.lands_in_past} land in the past.`);
  console.error("Some future-dated rows come from a different cause. Nothing written.");
  await conn.end();
  process.exit(1);
}
if (target > 2000) {
  console.error(`REFUSING: ${target} rows is far beyond the measured 453 — the scope has changed. Nothing written.`);
  await conn.end();
  process.exit(1);
}

if (!APPLY) {
  // Formatted in SQL, never through a JS Date. mysql2 hands back a DATE as a Date at local
  // midnight and toISOString() then converts to UTC — on a +05:30 host that prints the
  // PREVIOUS day. The first dry run showed "created 2026-09-03 ... walk_in 2026-09-02" for
  // rows where the scope query had just confirmed walk_in_date = DATE(created_at) on all 453,
  // which reads as a contradiction in the repair. The repair SQL never went through JS and was
  // correct throughout; only this log was wrong. An operator checking a data change against a
  // log that disagrees with itself cannot tell a display bug from a real one.
  const [sample] = await conn.query(`
    SELECT id,
           DATE_FORMAT(created_at, '%Y-%m-%d')                  AS created_before,
           DATE_FORMAT(${SWAP("created_at")}, '%Y-%m-%d')       AS created_after,
           DATE_FORMAT(walk_in_date, '%Y-%m-%d')                AS walkin_before,
           DATE_FORMAT(DATE(${SWAP("created_at")}), '%Y-%m-%d') AS walkin_after
      FROM ats_candidate WHERE created_at > NOW() ORDER BY created_at LIMIT 5`);
  console.log("\n[DRY RUN] sample of the change:");
  for (const s of sample) {
    console.log(`  ${s.id}  created ${s.created_before} -> ${s.created_after}   walk_in ${s.walkin_before ?? "null"} -> ${s.walkin_after}`);
  }
  console.log(`\n[DRY RUN] would repair ${target} row(s). Nothing was written.`);
  await conn.end();
  process.exit(0);
}

// updated_at is named explicitly in every branch — see the header. Without it, `on update
// CURRENT_TIMESTAMP` would overwrite all 453 with today.
const [res] = await conn.execute(`
  UPDATE ats_candidate
     SET walk_in_date = DATE(${SWAP("created_at")}),
         updated_at   = CASE WHEN updated_at > NOW() AND DAY(updated_at) <= 12
                             THEN ${SWAP("updated_at")} ELSE updated_at END,
         created_at   = ${SWAP("created_at")}
   WHERE created_at > NOW()`);
console.log(`\nrepaired ${res.affectedRows} row(s)`);

/**
 * Second pass: rows whose created_at was already sane but whose updated_at is future.
 *
 * The first pass targets `created_at > NOW()`, so it never sees a row that was created in the
 * past and only had its updated_at mangled. Four such rows survived the first apply — same
 * day/month swap, found through the other column. Verified on production 2026-08-12: all four
 * swap into the past AND land after their own created_at.
 *
 * The `swapped >= created_at` condition is the one that makes this safe: an update cannot
 * precede creation, so a swap that produced one would be repairing a date into a different
 * impossibility. Such a row is left alone and reported.
 */
const [res2] = await conn.execute(`
  UPDATE ats_candidate
     SET updated_at = ${SWAP("updated_at")}
   WHERE updated_at > NOW()
     AND DAY(updated_at) <= 12
     AND ${SWAP("updated_at")} <= NOW()
     AND ${SWAP("updated_at")} >= created_at`);
console.log(`repaired ${res2.affectedRows} row(s) whose updated_at alone was in the future`);

const [[after]] = await conn.query(`
  SELECT SUM(created_at > NOW()) AS created_future,
         SUM(updated_at > NOW()) AS updated_future,
         SUM(updated_at < created_at) AS updated_before_created,
         COUNT(*)                AS total
    FROM ats_candidate`);
console.log(`\n=== verification ===`);
console.log(`created_at in the future: ${after.created_future}  (must be 0)`);
console.log(`updated_at in the future: ${after.updated_future}  (must be 0)`);
console.log(`updated_at before created_at: ${after.updated_before_created}  (pre-existing, not touched here)`);
console.log(`total rows: ${after.total}  (must be unchanged)`);

await conn.end();
process.exit(0);
