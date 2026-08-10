/**
 * Clear the plaintext PII columns from employees_backup_20260711.
 *
 *   node scripts/backup-table-pii-scrub.mjs                 # dry-run
 *   node scripts/backup-table-pii-scrub.mjs --apply         # write
 *   DB_HOST_OVERRIDE=<addr> node scripts/...                # off-LAN
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * employees_backup_20260711 is an orphaned one-off snapshot from 11 July 2026. No
 * code in backend/src or src references it. It holds a full SECOND plaintext copy of
 * 30,108 Aadhaar, 23,341 PAN, 28,660 bank accounts, 11,751 UAN, 28,654 IFSC codes and
 * 19,166 personal email addresses — 141,680 values in all, in a database whose 3306
 * answers from the internet. Encrypting employees while this sits beside it is false
 * assurance: the same values are readable one table over.
 *
 * ── WHAT THIS DOES NOT COVER ─────────────────────────────────────────────────
 * zz_backup_ebd_acct_20260809 also holds 2,080 plaintext account numbers, and is
 * deliberately NOT in scope. Measured 2026-08-10: only 49 of its 2,080 rows still match
 * the live employee_bank_detail value, so the other 2,031 are the sole surviving record
 * of what those accounts held before the 2026-08-09 bank recovery rewrote them. Clearing
 * it would not remove a duplicate, it would destroy the rollback. That table needs
 * encryption or a dated retention decision, not a scrub.
 *
 * ── WHY CLEARING COLUMNS RATHER THAN DROPPING THE TABLE ──────────────────────
 * Dropping would also discard the July snapshot of every other column, which may
 * still have audit value. Clearing the four PII columns removes the entire exposure
 * and keeps the rest.
 *
 * ── WHY THIS LOSES NOTHING ───────────────────────────────────────────────────
 * Measured before writing: every backup row still exists in employees (0 orphans),
 * and for all four columns the backup value is byte-identical to the live value on
 * every populated row — identical=30108/23341/28660/11751, only_in_backup=0,
 * differs=0. So the backup holds no value that exists nowhere else.
 *
 * This script does not take that on trust. It clears a row's column ONLY where that
 * row's value is still provably identical to the live employees row. Anything
 * unexpected — a value the live row lost, or one that diverged since the measurement
 * — is left untouched and reported, rather than destroyed.
 *
 * ── ROLLBACK ─────────────────────────────────────────────────────────────────
 * Every cleared value is recoverable from employees by id, which is exactly the
 * property that made clearing safe:
 *   UPDATE employees_backup_20260711 b JOIN employees e ON e.id = b.id
 *      SET b.aadhaar_number = e.aadhaar_number
 *    WHERE b.aadhaar_number IS NULL AND e.aadhaar_number IS NOT NULL;
 *   (and likewise for pan_number, bank_account_number, uan_number)
 */
import "dotenv/config";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const APPLY = process.argv.includes("--apply");
const TABLE = "employees_backup_20260711";
/**
 * ifsc_code and personal_email were missing from this list, leaving 47,820 of the table's
 * 141,680 populated PII values in place — 28,654 IFSC codes beside the account numbers they
 * route, and 19,166 personal email addresses, which DPDP treats as personal data in their own
 * right. Re-measured 2026-08-10: ifsc_code is 28,654/28,654 identical to the live employees row
 * and personal_email 19,161/19,166, with 0 rows orphaned from employees in either case. The
 * per-row identity guard below still decides each row individually, so the 5 divergent emails
 * are left in place rather than destroyed.
 */
const COLS = [
  "aadhaar_number",
  "pan_number",
  "bank_account_number",
  "uan_number",
  "ifsc_code",
  "personal_email",
];

const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
});

console.log(`mode=${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}  table=${TABLE}`);

const [tbl] = await conn.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [TABLE]);
if (tbl.length === 0) {
  console.log(`${TABLE} does not exist — nothing to do.`);
  await conn.end();
  process.exit(0);
}

// Guard: the live table must still carry the data that makes clearing lossless.
const [[live]] = await conn.query(`
  SELECT SUM(aadhaar_number IS NOT NULL AND TRIM(aadhaar_number) <> '') AS a,
         SUM(pan_number IS NOT NULL AND TRIM(pan_number) <> '')         AS p
    FROM employees`);
if (Number(live.a) === 0 || Number(live.p) === 0) {
  console.error("REFUSING: employees no longer holds the plaintext this backup mirrors.");
  console.error("Clearing the backup would then destroy the only remaining copy.");
  await conn.end();
  process.exit(1);
}
console.log(`live employees still holds aadhaar=${live.a} pan=${live.p} — clearing the mirror is lossless\n`);

let cleared = 0, skipped = 0;

for (const col of COLS) {
  const [[d]] = await conn.query(`
    SELECT SUM(b.${col} IS NOT NULL AND TRIM(b.${col}) <> ''
               AND TRIM(b.${col}) = TRIM(e.${col}))                  AS safe_to_clear,
           SUM(b.${col} IS NOT NULL AND TRIM(b.${col}) <> ''
               AND (e.${col} IS NULL OR TRIM(e.${col}) = ''
                    OR TRIM(b.${col}) <> TRIM(e.${col})))            AS not_redundant
      FROM ${TABLE} b JOIN employees e ON e.id = b.id`);
  const [[orph]] = await conn.query(`
    SELECT SUM(b.${col} IS NOT NULL AND TRIM(b.${col}) <> '') AS n
      FROM ${TABLE} b LEFT JOIN employees e ON e.id = b.id WHERE e.id IS NULL`);

  console.log(`${col}: safe_to_clear=${d.safe_to_clear || 0}  not_redundant=${d.not_redundant || 0}  on_orphan_rows=${orph.n || 0}`);
  skipped += Number(d.not_redundant || 0) + Number(orph.n || 0);

  if (!APPLY) { cleared += Number(d.safe_to_clear || 0); continue; }

  // Clear ONLY where the live row still holds an identical value.
  const [res] = await conn.execute(`
    UPDATE ${TABLE} b JOIN employees e ON e.id = b.id
       SET b.${col} = NULL
     WHERE b.${col} IS NOT NULL AND TRIM(b.${col}) <> ''
       AND TRIM(b.${col}) = TRIM(e.${col})`);
  console.log(`  cleared ${res.affectedRows}`);
  cleared += res.affectedRows;
}

console.log(`\n${APPLY ? "CLEARED" : "WOULD CLEAR"} total=${cleared}   left_in_place(not provably redundant)=${skipped}`);

if (APPLY) {
  console.log("\n=== verification ===");
  for (const col of COLS) {
    const [[r]] = await conn.query(
      `SELECT SUM(${col} IS NOT NULL AND TRIM(${col}) <> '') AS remaining FROM ${TABLE}`);
    console.log(`${col}: remaining_plaintext=${r.remaining || 0}`);
  }
  const [[chk]] = await conn.query(`
    SELECT SUM(aadhaar_number IS NOT NULL AND TRIM(aadhaar_number) <> '') AS a,
           SUM(pan_number IS NOT NULL AND TRIM(pan_number) <> '')         AS p
      FROM employees`);
  console.log(`live employees UNCHANGED: aadhaar=${chk.a} pan=${chk.p} (expect 30108 / 23341)`);
}

await conn.end();
process.exit(0);
