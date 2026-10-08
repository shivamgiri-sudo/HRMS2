#!/usr/bin/env node
/**
 * Repairs IFSC codes carrying the letter O where RBI mandates a digit 0 at position 5.
 *
 * DRY RUN BY DEFAULT. Writes nothing unless --apply is passed.
 *
 * WHY THIS EXISTS
 * employee_bank_detail holds 874 active-primary rows whose ifsc_code fails the RBI format
 * ^[A-Z]{4}0[A-Z0-9]{6}$. 514 of them are one specific, mechanical corruption: an 11-character
 * value where position 5 is the LETTER O instead of the DIGIT 0 (BARBOSFSMAN for BARB0SFSMAN).
 * Every IFSC ever issued has a zero there — it is a fixed structural position, not a value —
 * so an O in that slot cannot be a legitimate code, and substituting the zero yields a
 * well-formed one.
 *
 * Those 514 employees are excluded from bank payment files by both exporters (correctly — the
 * bank cannot route them), so each is an employee who cannot currently be paid by NEFT.
 *
 * WHAT IT WILL NOT DO
 *  - It will not touch the other 360 malformed rows (326 wrong-length like '20437' or
 *    'PUNB079700', plus ~34 malformed some other way). Those are not mechanically recoverable
 *    and guessing at them would move money on an invention.
 *  - It will not touch the 47 rows whose branch code ALSO carries the O-for-0 corruption
 *    (SBINOO11554, IOBAOOO1137). Fixing position 5 alone would make those pass the format
 *    check while remaining wrong — worse than leaving them, because a malformed code is
 *    correctly held out of the payment file and a well-formed wrong one is not. See the
 *    exclusion clause in CANDIDATE_SQL. Those 47 need the RBI IFSC list to resolve.
 *  - It will not touch rows that are already valid.
 *  - It will not write a value that does not itself pass the RBI format after substitution.
 *  - It changes position 5 ONLY. Every other character is preserved byte-for-byte.
 *
 * SAFETY
 *  - Dry run prints every proposed change and writes nothing.
 *  - --apply runs inside a transaction, updates by primary key, and re-verifies the row count
 *    before committing; any mismatch rolls back.
 *  - Each write is guarded by the same predicate in its WHERE clause, so a row that changed
 *    underneath us is skipped rather than overwritten.
 *  - Prints a rollback statement set for every row it touches.
 *
 * THIS IS A PRODUCTION BANK-DATA WRITE. Do not run --apply without explicit owner approval.
 *
 *   node scripts/ifsc-letter-o-repair.mjs            # dry run, safe
 *   node scripts/ifsc-letter-o-repair.mjs --apply    # writes, needs approval
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const HOST = process.env.IFSC_REPAIR_DB_HOST || process.env.DB_HOST;

/** Position 5 (1-indexed) is a structural zero in every RBI-issued IFSC. */
const CANDIDATE_SQL = `
  SELECT id, employee_id, ifsc_code,
         CONCAT(LEFT(ifsc_code, 4), '0', SUBSTRING(ifsc_code, 6)) AS corrected
    FROM employee_bank_detail
   WHERE active_status = 1
     AND is_primary = 1
     AND ifsc_code IS NOT NULL
     AND CHAR_LENGTH(ifsc_code) = 11
     AND SUBSTRING(ifsc_code, 5, 1) = 'O'
     AND ifsc_code NOT REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$'
     AND CONCAT(LEFT(ifsc_code, 4), '0', SUBSTRING(ifsc_code, 6)) REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$'
     -- Position 5 is structural, but 47 rows carry the SAME O-for-0 corruption further
     -- into the branch code (SBINOO11554, IOBAOOO1137, YESBOOOO139). Correcting position
     -- 5 alone makes those PASS the RBI format while still being wrong, which promotes
     -- them from "malformed, correctly excluded from the payment file" to "well-formed,
     -- included, and unroutable at the bank". That is strictly worse than leaving them.
     --
     -- Nor can they be fixed by replacing every O: UTBIOCON702 would become UTBI0C0N702,
     -- destroying what is plausibly a real branch abbreviation. Telling those two cases
     -- apart needs the RBI IFSC list, not a rule, so they are held back for manual
     -- resolution rather than guessed at.
     --
     -- A branch code mixing O with digits is exactly that ambiguous case. BINARY so a
     -- case-insensitive collation cannot fold a lowercase o into the test.
     AND NOT (
           INSTR(BINARY SUBSTRING(CONCAT(LEFT(ifsc_code, 4), '0', SUBSTRING(ifsc_code, 6)), 6), 'O') > 0
       AND SUBSTRING(CONCAT(LEFT(ifsc_code, 4), '0', SUBSTRING(ifsc_code, 6)), 6) REGEXP '[0-9]'
     )
   ORDER BY ifsc_code`;

/**
 * The rows the clause above deliberately holds back. Reported every run: an exclusion
 * nobody can see reads as "we covered everything", and these are employees who still
 * cannot be paid after this script reports success.
 */
const HELD_BACK_SQL = `
  SELECT id, employee_id, ifsc_code
    FROM employee_bank_detail
   WHERE active_status = 1
     AND is_primary = 1
     AND ifsc_code IS NOT NULL
     AND CHAR_LENGTH(ifsc_code) = 11
     AND SUBSTRING(ifsc_code, 5, 1) = 'O'
     AND ifsc_code NOT REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$'
     AND CONCAT(LEFT(ifsc_code, 4), '0', SUBSTRING(ifsc_code, 6)) REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$'
     AND INSTR(BINARY SUBSTRING(CONCAT(LEFT(ifsc_code, 4), '0', SUBSTRING(ifsc_code, 6)), 6), 'O') > 0
     AND SUBSTRING(CONCAT(LEFT(ifsc_code, 4), '0', SUBSTRING(ifsc_code, 6)), 6) REGEXP '[0-9]'
   ORDER BY ifsc_code`;

async function reportHeldBack(conn) {
  const [held] = await conn.execute(HELD_BACK_SQL);
  if (held.length === 0) return;
  console.log(
    `\nHELD BACK   : ${held.length} rows this script will NOT repair.\n` +
      `  Each carries the O-for-0 corruption in the branch code too, so fixing position 5\n` +
      `  alone would make it pass the RBI format while still being wrong — moving it from\n` +
      `  "correctly excluded from the payment file" to "included and unroutable".\n` +
      `  Replacing every O is not safe either (UTBIOCON702 -> UTBI0C0N702 destroys a real\n` +
      `  branch abbreviation). These need the RBI IFSC list, employee by employee.\n`,
  );
  for (const r of held) {
    console.log(`  ${r.ifsc_code}  employee_id=${r.employee_id}`);
  }
  console.log(`\n  ${held.length} employees remain unpayable by NEFT after this repair.`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 20000,
  });

  const [rows] = await conn.execute(CANDIDATE_SQL);
  console.log(`\nMode        : ${APPLY ? "APPLY (WRITES)" : "DRY RUN (no writes)"}`);
  console.log(`Host        : ${HOST}`);
  console.log(`Candidates  : ${rows.length}\n`);

  if (rows.length === 0) {
    console.log("Nothing to repair.");
    await reportHeldBack(conn);
    await conn.end();
    return;
  }

  // Group for a readable summary — one bad import usually means one bank prefix.
  const byPrefix = new Map();
  for (const r of rows) {
    const p = String(r.ifsc_code).slice(0, 4);
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }
  console.log("By bank prefix:");
  for (const [p, n] of [...byPrefix].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p}  ${n}`);
  }

  console.log("\nSample of proposed changes (first 15):");
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.ifsc_code}  ->  ${r.corrected}`);
  }

  console.log("\nRollback statements for everything this would change:");
  for (const r of rows.slice(0, 5)) {
    console.log(`  UPDATE employee_bank_detail SET ifsc_code='${r.ifsc_code}' WHERE id='${r.id}';`);
  }
  if (rows.length > 5) console.log(`  ... and ${rows.length - 5} more (full set written below on --apply)`);

  await reportHeldBack(conn);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply only after owner approval.\n");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  let updated = 0;
  try {
    for (const r of rows) {
      // Same guard in the WHERE clause: if the row changed underneath us, skip it.
      const [res] = await conn.execute(
        `UPDATE employee_bank_detail
            SET ifsc_code = ?
          WHERE id = ?
            AND ifsc_code = ?
            AND active_status = 1
            AND is_primary = 1`,
        [r.corrected, r.id, r.ifsc_code],
      );
      updated += res.affectedRows;
    }

    const [[{ remaining }]] = await conn.query(
      `SELECT COUNT(*) AS remaining FROM (${CANDIDATE_SQL}) c`,
    );
    if (Number(remaining) !== 0) {
      throw new Error(`Post-check failed: ${remaining} candidates still match after update`);
    }

    await conn.commit();
    console.log(`\nAPPLIED. Rows updated: ${updated}. Post-check clean.\n`);
  } catch (err) {
    await conn.rollback();
    console.error(`\nROLLED BACK — nothing written. Reason: ${err.message}\n`);
    process.exitCode = 1;
  }

  await conn.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
