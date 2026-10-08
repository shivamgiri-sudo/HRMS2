/**
 * Clear legacy_payslip_snapshot.account_number now that every value is encrypted.
 *
 *   node scripts/legacy-payslip-account-plaintext-clear.mjs                  # dry-run
 *   node scripts/legacy-payslip-account-plaintext-clear.mjs --apply --max=20 # verified slice
 *   node scripts/legacy-payslip-account-plaintext-clear.mjs --apply          # full
 *
 * ── WHY THIS ONE CAN BE CLEARED AND employees.pan_number CANNOT ──────────────
 * Retiring plaintext normally requires migrating every reader first. This column has none.
 * Verified across backend/src and src: nothing references legacy_payslip_snapshot.account_number,
 * every account_number in payroll.routes.ts and payroll.executor.ts is qualified to a different
 * table (ebd.account_number / e.bank_account_number), and the one SELECT * against this table
 * destructures an explicit allow-list of salary fields that never touches it. Nothing writes it
 * either — no INSERT or UPDATE exists in application code, the salary sync targets
 * employee_salary_snapshot, and the data is frozen: sal_date runs 2018-01 to 2026-06 and has not
 * grown since.
 *
 * So this is the rare case where clearing removes 115,698 cleartext bank account numbers and
 * changes no behaviour whatsoever.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 * Clears a row ONLY when its ciphertext decrypts back to exactly the plaintext being removed.
 * Not "ciphertext is present" — decrypted and compared, row by row, immediately before the
 * delete. A row whose ciphertext is missing, unreadable, or disagrees is left untouched and
 * reported. That makes it impossible to destroy a value that was not provably recoverable a
 * moment earlier.
 *
 * Refuses on the dev key, and refuses if the dist build predates isUsingDevEncryptionKey() —
 * without the real key, decryption would fail for every row and the script would correctly
 * clear nothing, but failing loudly is better than a silent no-op.
 *
 * ── ROLLBACK ─────────────────────────────────────────────────────────────────
 * Decrypt account_number_enc back into account_number. The verification above is what
 * guarantees that works: every cleared row was proven decryptable to its own former value.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const here = path.dirname(fileURLToPath(import.meta.url));
const fe = await import(pathToFileURL(path.join(here, "..", "dist", "src", "shared", "fieldEncryption.js")).href);

const APPLY = process.argv.includes("--apply");
const BATCH = 500;
const maxArg = process.argv.find((a) => a.startsWith("--max="));
const MAX = maxArg ? Number(maxArg.split("=")[1]) : Infinity;

if (typeof fe.isUsingDevEncryptionKey !== "function") {
  console.error("REFUSING: this dist/ build predates isUsingDevEncryptionKey().");
  process.exit(1);
}
if (fe.isUsingDevEncryptionKey()) {
  console.error("REFUSING: running on the all-zeros DEV encryption key — cannot verify recoverability.");
  process.exit(1);
}
console.log(`mode=${APPLY ? "APPLY (clears plaintext)" : "DRY-RUN (no writes)"}  dev_key=false  node_env=${process.env.NODE_ENV}`);

const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME), connectTimeout: 20000,
});

const [[pre]] = await conn.query(`
  SELECT SUM(account_number IS NOT NULL AND TRIM(account_number) <> '')                              AS plaintext,
         SUM(account_number_enc IS NOT NULL)                                                         AS ciphertext,
         SUM(account_number IS NOT NULL AND TRIM(account_number) <> '' AND account_number_enc IS NULL) AS unprotected
    FROM legacy_payslip_snapshot`);
console.log(`plaintext=${pre.plaintext} ciphertext=${pre.ciphertext} plaintext_without_ciphertext=${pre.unprotected}`);

if (Number(pre.unprotected) > 0) {
  console.error(`REFUSING: ${pre.unprotected} row(s) still have plaintext with no ciphertext.`);
  console.error("Run scripts/legacy-payslip-account-encrypt-backfill.mjs to completion first.");
  await conn.end();
  process.exit(1);
}

let cleared = 0, skipped = 0, scanned = 0, lastId = 0;
for (;;) {
  if (cleared + skipped >= MAX) { console.log(`  reached --max=${MAX}, stopping.`); break; }
  // Keyset pagination on the primary key, identical whether applying or not.
  //
  // Two earlier shapes were both wrong, and only running it showed that. A plain LIMIT with
  // no cursor re-reads the same page forever in dry-run, because nothing is cleared and the
  // WHERE keeps matching — it reported "WOULD CLEAR=116000" against 115,698 real rows, having
  // checked one 500-row page 232 times. Switching to OFFSET produced the right count but made
  // it O(n^2), since MySQL walks and discards every skipped row.
  //
  // `id > lastId` advances in both modes, costs one index seek per page, and can neither
  // re-read nor skip a row.
  const [rows] = await conn.query(
    `SELECT id, account_number AS val, account_number_enc AS ct
       FROM legacy_payslip_snapshot
      WHERE account_number IS NOT NULL AND TRIM(account_number) <> ''
        AND id > ?
      ORDER BY id
      LIMIT ${Math.min(BATCH, MAX - cleared - skipped)}`, [lastId]);
  if (rows.length === 0) break;
  scanned += rows.length;
  lastId = rows[rows.length - 1].id;

  const safe = [];
  for (const r of rows) {
    let recoverable = false;
    try { recoverable = r.ct != null && fe.decryptField(r.ct) === String(r.val).trim(); } catch { recoverable = false; }
    if (recoverable) safe.push(r.id); else skipped++;
  }

  if (!APPLY) {
    cleared += safe.length;
    if (rows.length < BATCH) break;   // last page
    continue;
  }

  if (safe.length) {
    await conn.beginTransaction();
    try {
      await conn.query(
        `UPDATE legacy_payslip_snapshot SET account_number = NULL
          WHERE id IN (${safe.map(() => "?").join(",")})`, safe);
      await conn.commit();
      cleared += safe.length;
    } catch (e) {
      await conn.rollback();
      console.error(`  BATCH FAILED (rolled back): ${e.message}`);
      break;
    }
  }
  if (cleared % 10000 < BATCH && cleared > 0) console.log(`  cleared ${cleared}`);
  if (!safe.length && skipped >= rows.length) break;   // nothing clearable left
}

console.log(`\n${APPLY ? "CLEARED" : "WOULD CLEAR"}=${cleared}  left_in_place(not provably recoverable)=${skipped}`);

if (APPLY) {
  const [[post]] = await conn.query(`
    SELECT SUM(account_number IS NOT NULL AND TRIM(account_number) <> '') AS plaintext_left,
           SUM(account_number_enc IS NOT NULL)                            AS ciphertext
      FROM legacy_payslip_snapshot`);
  console.log(`verification: plaintext_left=${post.plaintext_left}  ciphertext=${post.ciphertext} (must be unchanged)`);
}

await conn.end();
process.exit(0);
