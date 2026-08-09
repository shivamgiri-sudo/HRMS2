/**
 * Backfill script: encrypt all plaintext account_number rows in employee_bank_detail.
 *
 * Run AFTER migration 1110 is applied and the app is deployed with the new read/write
 * paths. Safe to re-run — skips rows that already have account_number_enc set.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/bank-account-encrypt-backfill.ts [--dry-run] [--batch=500]
 *
 * The script processes rows in batches to avoid holding a long transaction.
 * Corrupt scientific-notation rows (e.g. "3.03801E+13") are skipped and reported
 * — these require manual HR re-collection (they are unrecoverable by code).
 */

import "dotenv/config";
import { db } from "../src/db/mysql.js";
import {
  encryptField,
  checkKeyParity,
  isUsingDevEncryptionKey,
} from "../src/shared/fieldEncryption.js";
import type { RowDataPacket } from "mysql2";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = (() => {
  const arg = process.argv.find(a => a.startsWith("--batch="));
  return arg ? parseInt(arg.split("=")[1], 10) : 200;
})();

const SCIENTIFIC_RE = /[Ee][+-]/;
const VALID_ACCOUNT_RE = /^[0-9]{6,20}$/;

interface BankRow {
  id: string;
  account_number: Buffer | string | null;
  account_number_enc: string | null;
}

const ALLOW_FIRST_RUN = process.argv.includes("--allow-first-run");
const PARITY_SAMPLE = 25;

/**
 * Refuse to write unless the loaded key can read ciphertext that is already in the table.
 *
 * Without this the script happily encrypts production rows with the all-zeros development key
 * (substituted by loadKey() whenever NODE_ENV !== "production") and exits 0. Nothing downstream
 * notices, because resolveAccountNumber() catches the decrypt failure and falls back to the
 * legacy plaintext column — so the rows only become unrecoverable later, when that column goes.
 *
 * Measured 2026-08-09 against production: 0 of 50 stored rows decrypted with the dev key.
 */
async function assertKeyParity(): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT account_number_enc
       FROM employee_bank_detail
      WHERE account_number_enc IS NOT NULL
      LIMIT ${PARITY_SAMPLE}`
  );
  const samples = rows
    .map((r) => (r as { account_number_enc: string | null }).account_number_enc)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (samples.length === 0) {
    if (ALLOW_FIRST_RUN) {
      console.log("[bank-encrypt-backfill] no existing ciphertext to compare against; " +
        "proceeding under --allow-first-run");
      return;
    }
    throw new Error(
      "No existing encrypted rows to verify the key against. If this really is the first run, " +
      "re-invoke with --allow-first-run — but confirm FIELD_ENCRYPTION_KEY is the production key first."
    );
  }

  const parity = checkKeyParity(samples);
  console.log(
    `[bank-encrypt-backfill] key parity: ${parity.decrypted}/${parity.sampled} existing rows decrypt` +
    (isUsingDevEncryptionKey() ? "  (WARNING: using the built-in development key)" : "")
  );

  if (!parity.ok) {
    throw new Error(
      `KEY MISMATCH — only ${parity.decrypted} of ${parity.sampled} existing rows decrypt with the ` +
      `loaded key. Writing now would produce ciphertext this database cannot read, and the failure ` +
      `would be silent. ` +
      (isUsingDevEncryptionKey()
        ? "FIELD_ENCRYPTION_KEY is unset, so the all-zeros development key is in use. Run this on the " +
          "server where the real key is configured."
        : "Check FIELD_ENCRYPTION_KEY matches the key these rows were written with.") +
      " Refusing to write."
    );
  }
}

async function run() {
  console.log(`[bank-encrypt-backfill] DRY_RUN=${DRY_RUN} BATCH_SIZE=${BATCH_SIZE}`);

  // Gate BEFORE any write, and before the dry run too, so a dry run reports the same verdict
  // the real run would reach rather than a falsely reassuring row count.
  await assertKeyParity();

  const [total] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM employee_bank_detail WHERE account_number IS NOT NULL AND account_number_enc IS NULL`
  );
  const pending = (total[0] as any).n as number;
  console.log(`[bank-encrypt-backfill] rows pending encryption: ${pending}`);

  let encrypted = 0;
  let skipped_corrupt = 0;
  let skipped_empty = 0;
  const corrupt_ids: string[] = [];
  let processed = 0;

  // Cursor-based pagination: always fetch from id > lastId so the shrinking
  // enc IS NULL set does not cause OFFSET to skip unprocessed rows.
  let lastId = "";

  while (true) {
    const cursorClause = lastId ? `AND id > '${lastId.replace(/'/g, "''")}'` : "";
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, account_number, account_number_enc
         FROM employee_bank_detail
        WHERE account_number IS NOT NULL AND account_number_enc IS NULL
          ${cursorClause}
        ORDER BY id ASC
        LIMIT ${BATCH_SIZE}`
    );

    if (!rows.length) break;

    for (const row of rows as BankRow[]) {
      lastId = row.id as unknown as string;
      const raw = row.account_number;
      if (!raw) { skipped_empty++; continue; }

      const plaintext = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      const trimmed = plaintext.trim();

      if (!trimmed) { skipped_empty++; continue; }

      if (SCIENTIFIC_RE.test(trimmed) || !VALID_ACCOUNT_RE.test(trimmed)) {
        skipped_corrupt++;
        corrupt_ids.push(row.id as unknown as string);
        continue;
      }

      if (!DRY_RUN) {
        const enc = encryptField(trimmed);
        await db.execute(
          `UPDATE employee_bank_detail SET account_number_enc = ? WHERE id = ?`,
          [enc, row.id]
        );
      }
      encrypted++;
    }

    processed += rows.length;
    process.stdout.write(`\r  progress: ${processed} scanned (encrypted=${encrypted} corrupt=${skipped_corrupt} empty=${skipped_empty})   `);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`\n[bank-encrypt-backfill] done`);
  console.log(`  encrypted:       ${encrypted}`);
  console.log(`  skipped_corrupt: ${skipped_corrupt}`);
  console.log(`  skipped_empty:   ${skipped_empty}`);

  if (corrupt_ids.length) {
    console.log(`\n  Corrupt rows (require HR re-collection, ${corrupt_ids.length} total):`);
    corrupt_ids.slice(0, 20).forEach(id => console.log(`    ${id}`));
    if (corrupt_ids.length > 20) console.log(`    ... and ${corrupt_ids.length - 20} more`);
  }

  if (DRY_RUN) console.log("\n  [DRY RUN — no rows were updated]");

  await db.end();
}

run().catch(async (e) => {
  console.error("[bank-encrypt-backfill] FATAL", e?.message ?? e);
  try { await db.end(); } catch { }
  process.exit(1);
});
