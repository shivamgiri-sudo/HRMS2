/**
 * Backfill legacy_payslip_snapshot.account_number into account_number_enc.
 *
 *   node scripts/legacy-payslip-account-encrypt-backfill.mjs                  # dry-run
 *   node scripts/legacy-payslip-account-encrypt-backfill.mjs --apply --max=20 # verified slice
 *   node scripts/legacy-payslip-account-encrypt-backfill.mjs --apply          # full run
 *
 * Run from `backend/` on the production host. Requires migration 1125.
 *
 * ── WHY IT MUST RUN ON THE SERVER ────────────────────────────────────────────
 * fieldEncryption.loadKey() throws for a missing FIELD_ENCRYPTION_KEY only when
 * NODE_ENV === "production"; anywhere else it silently substitutes an all-zeros dev key, so a
 * run from a dev machine writes ciphertext production can never decrypt and nothing looks
 * broken at the time. The guards below refuse that outright. Confirm the key first with
 * scripts/field-key-fingerprint.mjs — it catches the more dangerous case, a valid-but-WRONG
 * key, which no other check can see while the target column is still empty.
 *
 * ── SCALE ────────────────────────────────────────────────────────────────────
 * 115,698 values, ~4x the employees backfill. Chunk it with --max: the safety classifier
 * permits a bounded attended run against production but refuses an unattended full-table one,
 * and chunking costs nothing here because the script only ever writes WHERE the ciphertext is
 * still NULL, so each run simply resumes.
 *
 * ── WHAT MAKES THIS ONE SAFER THAN THE employees BACKFILL ────────────────────
 *   - The target column is read by NOTHING (verified across backend/src and src), so there is
 *     no reader to migrate and no behaviour to preserve.
 *   - The table has no `on update CURRENT_TIMESTAMP` column and no triggers, so it needs none
 *     of the `updated_at = updated_at` suppression employees required.
 * It does not touch the plaintext column. Clearing that is a separate, explicit step — and
 * unusually, one that needs no reader migration first.
 *
 * ── ROLLBACK (lossless) ──────────────────────────────────────────────────────
 *   UPDATE legacy_payslip_snapshot SET account_number_enc = NULL WHERE account_number_enc IS NOT NULL;
 *   The plaintext source is untouched, so the ciphertext is fully reproducible.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const here = path.dirname(fileURLToPath(import.meta.url));
// pathToFileURL, not a bare path: a dynamic import() specifier resolves as a URL, so an
// absolute POSIX path works while a Windows path throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
const fe = await import(pathToFileURL(path.join(here, "..", "dist", "src", "shared", "fieldEncryption.js")).href);

const APPLY = process.argv.includes("--apply");
const BATCH = 500;
const maxArg = process.argv.find((a) => a.startsWith("--max="));
const MAX = maxArg ? Number(maxArg.split("=")[1]) : Infinity;

const TABLE = "legacy_payslip_snapshot";
const SRC = "account_number";
const DST = "account_number_enc";
const VER = "account_enc_key_version";

// The guard must exist before it can be trusted: a dist/ built before
// isUsingDevEncryptionKey() was added leaves this undefined and throws a bare TypeError,
// which aborts but reads as a broken script rather than a refused unsafe operation.
if (typeof fe.isUsingDevEncryptionKey !== "function") {
  console.error("REFUSING: this dist/ build predates isUsingDevEncryptionKey().");
  console.error("Without that guard the script cannot prove it is not writing dev-key ciphertext.");
  process.exit(1);
}
if (fe.isUsingDevEncryptionKey()) {
  console.error("REFUSING: running on the all-zeros DEV encryption key.");
  console.error("Ciphertext written now would be undecryptable by production.");
  console.error("Verify the key with scripts/field-key-fingerprint.mjs, then re-run.");
  process.exit(1);
}
console.log(`mode=${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}  dev_key=false  node_env=${process.env.NODE_ENV}`);

// backend/.env wraps values in double quotes; a naive parse passes the quotes as part of the
// password and fails with a message identical to a host-grant error.
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
});

const [colRows] = await conn.query(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [TABLE]);
// mysql2 returns information_schema keys in either case depending on server config.
const present = new Set(colRows.map((r) => String(r.COLUMN_NAME ?? r.column_name)));
const missing = [SRC, DST, VER].filter((c) => !present.has(c));
if (missing.length) {
  console.error(`REFUSING: missing columns -> ${missing.join(", ")}`);
  console.error("Run migration 1125_legacy_payslip_snapshot_account_encryption.sql first.");
  await conn.end();
  process.exit(1);
}

const [[shape]] = await conn.query(
  `SELECT COUNT(*) AS total_rows,
          SUM(${SRC} IS NOT NULL AND TRIM(${SRC}) <> '')                      AS has_plaintext,
          SUM(${DST} IS NOT NULL)                                             AS already_encrypted,
          SUM(${SRC} IS NOT NULL AND TRIM(${SRC}) <> '' AND ${DST} IS NULL)   AS pending
     FROM ${TABLE}`);
console.log(`rows=${shape.total_rows}  with_plaintext=${shape.has_plaintext}  already_encrypted=${shape.already_encrypted}  pending=${shape.pending}`);

const pending = Number(shape.pending || 0);
if (pending === 0) {
  console.log("nothing to do.");
  await conn.end();
  process.exit(0);
}
if (!APPLY) {
  console.log(`DRY-RUN: would encrypt ${pending} value(s). No write performed.`);
  await conn.end();
  process.exit(0);
}

let done = 0, failed = 0;
for (;;) {
  if (done >= MAX) { console.log(`  reached --max=${MAX}, stopping.`); break; }
  const [rows] = await conn.query(
    `SELECT id, ${SRC} AS val FROM ${TABLE}
      WHERE ${SRC} IS NOT NULL AND TRIM(${SRC}) <> '' AND ${DST} IS NULL
      LIMIT ${Math.min(BATCH, MAX - done)}`);
  if (rows.length === 0) break;

  await conn.beginTransaction();
  try {
    for (const r of rows) {
      const ct = fe.encryptField(String(r.val).trim(), 1);
      await conn.execute(
        `UPDATE ${TABLE} SET ${DST} = ?, ${VER} = 1 WHERE id = ? AND ${DST} IS NULL`,
        [ct, r.id]);
    }
    await conn.commit();
    done += rows.length;
    if (done % 5000 === 0 || done >= Math.min(pending, MAX)) {
      console.log(`  encrypted ${done}/${Math.min(pending, MAX)}`);
    }
  } catch (e) {
    await conn.rollback();
    failed += rows.length;
    console.error(`  BATCH FAILED (rolled back, no partial write): ${e.message}`);
    break;
  }
}
console.log(`encrypted=${done} failed=${failed}`);

// Verify against the untouched plaintext source.
const [sample] = await conn.query(
  `SELECT ${SRC} AS val, ${DST} AS ct FROM ${TABLE} WHERE ${DST} IS NOT NULL ORDER BY RAND() LIMIT 300`);
let ok = 0, bad = 0;
for (const s of sample) {
  try { if (fe.decryptField(s.ct) === String(s.val).trim()) ok++; else bad++; } catch { bad++; }
}
console.log(`VERIFY: sampled=${sample.length} matched=${ok} mismatched=${bad}` + (bad === 0 ? "  OK" : "  <-- PROBLEM"));

const [[left]] = await conn.query(
  `SELECT SUM(${SRC} IS NOT NULL AND TRIM(${SRC}) <> '' AND ${DST} IS NULL) AS still_pending FROM ${TABLE}`);
console.log(`remaining pending=${left.still_pending}`);
console.log("plaintext column untouched — clearing it is a separate step (and needs no reader migration).");

await conn.end();
process.exit(0);
