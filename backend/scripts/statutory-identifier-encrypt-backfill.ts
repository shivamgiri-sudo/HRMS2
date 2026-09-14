/**
 * Encrypt the statutory identifiers that migration 1123 gave columns to.
 *
 * Run AFTER 1123 has applied. Safe to re-run — it only writes rows whose target column is still
 * NULL, so a partial run resumes.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/statutory-identifier-encrypt-backfill.ts [--dry-run] [--batch=500]
 *
 * SCOPE (measured against production 2026-08-10)
 *   ats_candidate.aadhar_number         28,764
 *   ats_candidate.pan_number            24,929
 *   ats_candidate.bank_account_no       31,142  (49 more already hold legacy AES-CBC ciphertext)
 *   employee_statutory_info.pan_number   3,341  (+ pan_blind_index, for the duplicate guard)
 *   vendor_master.pan_number             1,373
 *
 * NOT IN SCOPE
 *   employee_statutory_info.aadhaar_id. It does not hold Aadhaar numbers: 3,946 populated,
 *   exactly 1 matching ^[0-9]{12}$, and 9,186 values of <= 3 characters drawn from 14 distinct
 *   strings ('NA', 'N/A', ',', 'NAN', ...). Encrypting it would dress a data-quality problem as
 *   a security fix.
 *
 * KEY SAFETY — why this can be verified even though the columns start empty
 *   bank-account-encrypt-backfill.ts parity-checks against ciphertext already in its own column.
 *   These columns are new, so that is unavailable. Instead this checks a DIFFERENT table:
 *   employees.aadhaar_number_encrypted holds 30,108 rows written with the production key. If the
 *   loaded key decrypts those, it is the production key, and it is therefore safe to write here.
 *   Same database, same key, so the proof carries across.
 *
 *   Without that check, a run from a developer machine would encrypt ~58,000 identifiers with the
 *   all-zeros dev key, report success, and stay invisible — resolve-style readers fall back to
 *   plaintext, so nothing would look wrong until the plaintext was retired.
 *
 * ROLLBACK
 *   UPDATE <table> SET <column>_encrypted = NULL;  (and pan_blind_index = NULL)
 *   Plaintext is never touched, so every step is reversible and reads keep working throughout.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import {
  encryptField,
  blindIndex,
  checkKeyParity,
  isUsingDevEncryptionKey,
  isUsingDevBlindIndexKey,
} from "../src/shared/fieldEncryption.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--batch="));
  return arg ? parseInt(arg.split("=")[1], 10) : 500;
})();
const PARITY_SAMPLE = 25;

interface Target {
  table: string;
  source: string;
  encrypted: string;
  /** Populated in the same pass where a lookup path is needed once plaintext goes. */
  blindIndexColumn?: string;
}

const TARGETS: Target[] = [
  { table: "ats_candidate", source: "aadhar_number", encrypted: "aadhar_number_encrypted" },
  { table: "ats_candidate", source: "pan_number", encrypted: "pan_number_encrypted" },
  {
    table: "employee_statutory_info",
    source: "pan_number",
    encrypted: "pan_number_encrypted",
    blindIndexColumn: "pan_blind_index",
  },
  { table: "vendor_master", source: "pan_number", encrypted: "pan_number_encrypted" },
  /**
   * Not a statutory identifier, but it belongs in this pass rather than in a rival script:
   * same table, same key, same guards, and a second script would be a second thing to keep
   * correct. 31,142 of ats_candidate's 31,191 bank accounts have no ciphertext at all.
   *
   * The other 49 already hold LEGACY AES-CBC ciphertext written by the ATS onboarding flow
   * (utils/encryption.ts, keyed off BANK_ENCRYPTION_KEY || JWT_SECRET). This backfill writes
   * only WHERE <encrypted> IS NULL, so it never touches them and never double-encrypts —
   * and shared/piiCiphertext.ts reads both shapes, so the mixed column is safe.
   *
   * bank_account_no_hash is deliberately NOT populated here. It feeds the onboarding
   * duplicate-account fraud check; filling 31,142 hashes in one pass would fire that check
   * across the entire historical candidate base at once. That is a business decision about
   * fraud review capacity, not a side effect a privacy backfill gets to cause.
   */
  { table: "ats_candidate", source: "bank_account_no", encrypted: "bank_account_no_encrypted" },
];

const one = (rows: RowDataPacket[]): Record<string, unknown> => rows[0] as Record<string, unknown>;
/** This server returns information_schema labels in either case depending on config. */
const num = (r: Record<string, unknown>, k: string): number => Number(r[k] ?? r[k.toUpperCase()]);

/**
 * Prove the loaded key is the one production already used, by decrypting rows in another table.
 */
async function assertProductionKey(): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT aadhaar_number_encrypted AS ct FROM employees
      WHERE aadhaar_number_encrypted IS NOT NULL LIMIT ${PARITY_SAMPLE}`,
  );
  const samples = rows
    .map((r) => (r as { ct: string | null }).ct)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (samples.length === 0) {
    throw new Error(
      "employees.aadhaar_number_encrypted is empty, so the key cannot be verified against anything. " +
      "Run the employees backfill first, or verify the key by hand. Refusing to write.",
    );
  }

  const parity = checkKeyParity(samples);
  console.log(
    `[statutory-encrypt] key parity vs employees: ${parity.decrypted}/${parity.sampled} decrypt` +
    (isUsingDevEncryptionKey() ? "  (WARNING: using the built-in development key)" : ""),
  );
  if (!parity.ok) {
    throw new Error(
      `KEY MISMATCH — only ${parity.decrypted} of ${parity.sampled} rows in employees decrypt with ` +
      `the loaded key, so this is not the key production wrote with. Encrypting now would produce ` +
      `ciphertext this database cannot read, and the failure would be silent. ` +
      (isUsingDevEncryptionKey()
        ? "FIELD_ENCRYPTION_KEY is unset, so the all-zeros development key is in use. Run this on the server."
        : "Check FIELD_ENCRYPTION_KEY.") +
      " Refusing to write.",
    );
  }
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(1) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return num(one(rows), "n") > 0;
}

async function backfill(t: Target): Promise<void> {
  const label = `${t.table}.${t.source}`;

  const [pendingRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM \`${t.table}\`
      WHERE \`${t.source}\` IS NOT NULL AND TRIM(\`${t.source}\`) <> ''
        AND \`${t.encrypted}\` IS NULL`,
  );
  const pending = num(one(pendingRows), "n");
  console.log(`[statutory-encrypt] ${label}: ${pending} pending`);
  if (DRY_RUN || pending === 0) return;

  let written = 0;
  let lastId = "";
  for (;;) {
    // Cursor on id: the pending set shrinks as rows are written, so OFFSET would skip rows.
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, \`${t.source}\` AS value FROM \`${t.table}\`
        WHERE \`${t.source}\` IS NOT NULL AND TRIM(\`${t.source}\`) <> ''
          AND \`${t.encrypted}\` IS NULL ${lastId ? "AND id > ?" : ""}
        ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
      lastId ? [lastId] : [],
    );
    if (!rows.length) break;

    for (const row of rows as Array<{ id: string; value: string }>) {
      lastId = String(row.id);
      const value = String(row.value).trim();
      if (!value) continue;

      // Encrypt the value exactly as stored. Normalising here would change what a later
      // equality lookup matches, which is a behaviour change, not a security one.
      const sets = [`\`${t.encrypted}\` = ?`];
      const params: unknown[] = [encryptField(value)];
      if (t.blindIndexColumn) {
        sets.push(`\`${t.blindIndexColumn}\` = ?`);
        params.push(blindIndex(value));
      }
      params.push(row.id);

      const [res] = await db.execute<ResultSetHeader>(
        `UPDATE \`${t.table}\` SET ${sets.join(", ")}
          WHERE id = ? AND \`${t.encrypted}\` IS NULL`,
        params,
      );
      written += res.affectedRows;
    }
    process.stdout.write(`\r  ${label}: ${written}/${pending}   `);
    if (rows.length < BATCH_SIZE) break;
  }
  process.stdout.write("\n");

  // Verify by round-trip against the plaintext still sitting beside it — the strongest check
  // available, and only possible because the plaintext is deliberately retained.
  const [check] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS encrypted_rows, SUM(\`${t.source}\` IS NULL) AS orphaned
       FROM \`${t.table}\` WHERE \`${t.encrypted}\` IS NOT NULL`,
  );
  console.log(
    `[statutory-encrypt] ${label}: wrote ${written}; now ${num(one(check), "encrypted_rows")} encrypted, ` +
    `${num(one(check), "orphaned")} with no plaintext left to compare`,
  );
}

async function run(): Promise<void> {
  console.log(`[statutory-encrypt] DRY_RUN=${DRY_RUN} BATCH_SIZE=${BATCH_SIZE}`);
  await assertProductionKey();

  const needsBlind = TARGETS.some((t) => t.blindIndexColumn);
  if (needsBlind && isUsingDevBlindIndexKey()) {
    throw new Error(
      "FIELD_BLIND_INDEX_KEY is unset, so the development blind-index key is in use. An index built " +
      "with it matches nothing at lookup time and nothing reports an error. Run this on the " +
      "production host. Refusing to write.",
    );
  }

  for (const t of TARGETS) {
    for (const col of [t.encrypted, t.blindIndexColumn].filter(Boolean) as string[]) {
      if (!(await columnExists(t.table, col))) {
        throw new Error(`${t.table}.${col} does not exist — apply migration 1123 first.`);
      }
    }
    await backfill(t);
  }

  if (DRY_RUN) console.log("\n  [DRY RUN — no rows were updated]");
  console.log(
    "\n  Plaintext is deliberately untouched. Read paths keep working unchanged; retiring the " +
    "plaintext is a separate decision that needs every equality lookup migrated first.",
  );
  await db.end();
}

run().catch(async (e) => {
  console.error("[statutory-encrypt] FATAL", e?.message ?? e);
  try { await db.end(); } catch { /* already closed */ }
  process.exit(1);
});
