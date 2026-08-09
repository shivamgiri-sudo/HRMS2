/**
 * Backfill employees.{aadhaar_number,pan_number} into their AES-256-GCM ciphertext
 * columns, which migration 515 created and which have held zero rows ever since.
 *
 *   node --experimental-vm-modules scripts/employee-pii-encrypt-backfill.mjs            # dry-run
 *   node scripts/employee-pii-encrypt-backfill.mjs --apply --max=20                     # small verified slice
 *   node scripts/employee-pii-encrypt-backfill.mjs --apply                              # full run
 *
 * Run from `backend/` on the production host. It is .mjs rather than .ts on purpose:
 * it imports the ALREADY-COMPILED dist/ crypto helper, so it needs no build step and
 * cannot collide with a concurrent `npm run build`.
 *
 * ── WHY IT MUST RUN ON THE SERVER ────────────────────────────────────────────
 * fieldEncryption.loadKey() throws when FIELD_ENCRYPTION_KEY is missing ONLY if
 * NODE_ENV === "production". Anywhere else it silently substitutes an all-zeros dev
 * key. A backfill run from a dev machine therefore writes ciphertext production can
 * never decrypt, and nothing looks broken at the time. The key exists only on the
 * server, so this must run there. The guard below refuses the dev key outright.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 * It does not touch the plaintext columns. 15+ modules still read
 * employees.aadhaar_number / pan_number directly (BGV, onboarding, offer letters,
 * compliance, dashboards), and NOTHING reads the _encrypted columns on this table
 * yet. Clearing plaintext before those read paths are migrated would break all of
 * them. That is a separate, approval-gated phase.
 *
 * So this run creates the encrypted store and changes no behaviour. It is the
 * prerequisite for the exposure fix, not the exposure fix itself.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 *   - Dry-run by default; writes only with --apply.
 *   - Refuses to run on the all-zeros dev key.
 *   - Writes only WHERE <col>_encrypted IS NULL, so it is idempotent: a re-run
 *     cannot double-encrypt, and an interrupted run resumes cleanly.
 *   - One transaction per batch; a failure rolls back that batch alone.
 *   - Preserves updated_at (see the note at the UPDATE).
 *   - Verifies by decrypting a random sample and comparing to the source plaintext.
 *   - Prints no PII — counts, lengths and ids only.
 *
 * ── ROLLBACK (lossless) ──────────────────────────────────────────────────────
 *   UPDATE employees SET aadhaar_number_encrypted = NULL, updated_at = updated_at
 *    WHERE aadhaar_number_encrypted IS NOT NULL;
 *   UPDATE employees SET pan_number_encrypted = NULL, updated_at = updated_at
 *    WHERE pan_number_encrypted IS NOT NULL;
 *   The plaintext source is untouched, so the ciphertext is fully reproducible.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const here = path.dirname(fileURLToPath(import.meta.url));
const fe = await import(path.join(here, "..", "dist", "src", "shared", "fieldEncryption.js"));

const APPLY = process.argv.includes("--apply");
const BATCH = 500;
// --max N caps how many rows a run will touch, so the first pass can be a small,
// fully verified slice before committing to all 53,449.
const maxArg = process.argv.find((a) => a.startsWith("--max="));
const MAX = maxArg ? Number(maxArg.split("=")[1]) : Infinity;

const FIELDS = [
  { name: "aadhaar", src: "aadhaar_number", dst: "aadhaar_number_encrypted", ver: "aadhaar_enc_key_version" },
  { name: "pan", src: "pan_number", dst: "pan_number_encrypted", ver: "pan_enc_key_version" },
];

if (fe.isUsingDevEncryptionKey()) {
  console.error("REFUSING: running on the all-zeros DEV encryption key.");
  console.error("Ciphertext written now would be undecryptable by production. Aborting.");
  process.exit(1);
}
console.log(`mode=${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}  dev_key=false  node_env=${process.env.NODE_ENV}`);

// backend/.env stores values wrapped in double quotes; a naive parse passes the quote
// characters as part of the password and fails with a message identical to a host-grant error.
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
});

const REQUIRED = [
  "aadhaar_number", "pan_number", "aadhaar_number_encrypted",
  "pan_number_encrypted", "aadhaar_enc_key_version", "pan_enc_key_version",
];
const [colRows] = await conn.query(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'`
);
// mysql2 returns information_schema keys in either case depending on server config —
// accept both rather than silently reading undefined and reporting "columns missing".
const present = new Set(colRows.map((r) => String(r.COLUMN_NAME ?? r.column_name)));
const missing = REQUIRED.filter((c) => !present.has(c));
if (missing.length) {
  console.error("REFUSING: missing columns -> " + missing.join(", "));
  console.error("Run migration 515_employee_pii_encryption_columns.sql first.");
  await conn.end();
  process.exit(1);
}

let grandTotal = 0;

for (const f of FIELDS) {
  console.log(`\n===== ${f.name.toUpperCase()} =====`);

  const [[shape]] = await conn.query(
    `SELECT COUNT(*) AS total_rows,
            SUM(${f.src} IS NOT NULL AND TRIM(${f.src}) <> '') AS has_plaintext,
            SUM(${f.dst} IS NOT NULL) AS already_encrypted,
            SUM(${f.src} IS NOT NULL AND TRIM(${f.src}) <> '' AND ${f.dst} IS NULL) AS pending
       FROM employees`
  );
  console.log(`rows=${shape.total_rows}  with_plaintext=${shape.has_plaintext}  already_encrypted=${shape.already_encrypted}  pending=${shape.pending}`);

  // Length distribution is a shape check that reads no value. Expect a large
  // well-formed cluster (Aadhaar 12, PAN 10) plus a tail of 1-2 char placeholders.
  const [lens] = await conn.query(
    `SELECT CHAR_LENGTH(TRIM(${f.src})) AS len, COUNT(*) AS c FROM employees
      WHERE ${f.src} IS NOT NULL AND TRIM(${f.src}) <> ''
      GROUP BY len ORDER BY c DESC LIMIT 8`
  );
  console.log("length distribution: " + lens.map((r) => `len${r.len}=${r.c}`).join("  "));

  const pending = Number(shape.pending || 0);
  if (pending === 0) { console.log("nothing to do."); continue; }
  if (!APPLY) { console.log(`DRY-RUN: would encrypt ${pending} value(s). No write performed.`); grandTotal += pending; continue; }

  let done = 0, failed = 0;
  const touched = [];
  for (;;) {
    if (done >= MAX) { console.log(`  reached --max=${MAX}, stopping.`); break; }
    const [rows] = await conn.query(
      `SELECT id, ${f.src} AS val, updated_at FROM employees
        WHERE ${f.src} IS NOT NULL AND TRIM(${f.src}) <> '' AND ${f.dst} IS NULL
        LIMIT ${Math.min(BATCH, MAX - done)}`
    );
    if (rows.length === 0) break;

    await conn.beginTransaction();
    try {
      for (const r of rows) {
        const ct = fe.encryptField(String(r.val).trim(), 1);
        // `updated_at = updated_at` is deliberate. The column is declared
        // `on update CURRENT_TIMESTAMP`, so without this assignment every row touched
        // here would be stamped as modified now. Writing a ciphertext mirror of a value
        // that already exists is not a business modification of the employee record, and
        // 53,449 falsified "last modified" stamps would surface in reports, exports and
        // audit views. Assigning the column its own value suppresses the auto-update.
        await conn.execute(
          `UPDATE employees SET ${f.dst} = ?, ${f.ver} = 1, updated_at = updated_at
            WHERE id = ? AND ${f.dst} IS NULL`,
          [ct, r.id]
        );
        if (touched.length < 50) touched.push({ id: r.id, before: String(r.updated_at) });
      }
      await conn.commit();
      done += rows.length;
      if (done % 5000 === 0 || done === pending || MAX !== Infinity) {
        console.log(`  encrypted ${done}/${Math.min(pending, MAX)}`);
      }
    } catch (e) {
      await conn.rollback();
      failed += rows.length;
      console.error(`  BATCH FAILED (rolled back, no partial write): ${e.message}`);
      break;
    }
  }
  console.log(`${f.name}: encrypted=${done} failed=${failed}`);
  grandTotal += done;

  if (touched.length) {
    const ids = touched.map((t) => t.id);
    const [after] = await conn.query(
      `SELECT id, updated_at FROM employees WHERE id IN (${ids.map(() => "?").join(",")})`, ids
    );
    const byId = new Map(after.map((r) => [String(r.id), String(r.updated_at)]));
    const moved = touched.filter((t) => byId.get(String(t.id)) !== t.before).length;
    console.log(`UPDATED_AT ${f.name}: checked=${touched.length} moved=${moved}` +
      (moved === 0 ? "  OK (timestamps preserved)" : "  <-- PROBLEM: timestamps moved"));
  }

  // Verify against the untouched plaintext source.
  const [sample] = await conn.query(
    `SELECT ${f.src} AS val, ${f.dst} AS ct FROM employees
      WHERE ${f.dst} IS NOT NULL ORDER BY RAND() LIMIT 200`
  );
  let ok = 0, bad = 0;
  for (const s of sample) {
    try { if (fe.decryptField(s.ct) === String(s.val).trim()) ok++; else bad++; } catch { bad++; }
  }
  console.log(`VERIFY ${f.name}: sampled=${sample.length} matched=${ok} mismatched=${bad}` +
    (bad === 0 ? "  OK" : "  <-- PROBLEM"));
}

console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} total=${grandTotal}`);
console.log("plaintext columns untouched by design — read paths still depend on them.");
await conn.end();
process.exit(0);
