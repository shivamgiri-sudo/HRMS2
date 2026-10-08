/**
 * Backfill employee_bank_detail.account_number_blind_index.
 *
 * Run AFTER migration 1136 has applied. Safe to re-run — it only writes rows whose blind
 * index is still NULL, and recomputing is deterministic, so a partial run simply resumes.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/bank-account-blind-index-backfill.ts [--dry-run] [--batch=500]
 *
 * WHY THIS EXISTS
 *   See 1136_employee_bank_detail_account_blind_index.sql. account_number_enc is AES-256-GCM
 *   with a random IV per row, so two rows holding the same account number never produce the
 *   same ciphertext — there is no way to find a cross-employee duplicate by comparing
 *   ciphertext. A blind index gives that lookup somewhere to go, mirroring
 *   statutory-blind-index-backfill.ts for aadhaar/pan.
 *
 * ⚠️ MUST RUN ON THE PRODUCTION HOST
 *   Same reasoning as statutory-blind-index-backfill.ts: a blind index computed with the
 *   development FIELD_BLIND_INDEX_KEY is not detectably wrong — every lookup just returns
 *   nothing, which a duplicate check reads as "no duplicate exists," silently defeating the
 *   thing this backfill exists to enable. isUsingDevBlindIndexKey() refuses that outright.
 *
 * WHAT IS INDEXED
 *   resolveAccountNumber(row) — the same resolution every payroll/NEFT read path already
 *   uses, preferring account_number_enc and falling back to the legacy plaintext column.
 *   NOT the raw column value, because unlike aadhaar/pan (a single plaintext column at
 *   backfill time), account numbers already live in two possible places post-Fix-3, and
 *   indexing only one would silently miss rows written the other way. Deliberately NOT
 *   normalised beyond what resolveAccountNumber() already does — matches the exact-equality
 *   semantics the duplicate check needs.
 *
 * DOES NOT ACTIVATE ANYTHING
 *   Nothing reads this column yet. Wiring the actual cross-employee duplicate check onto it
 *   (and populating it going forward on every new/changed bank-detail write) is a separate,
 *   deliberate follow-up — see shared/bankAccountDuplicate.ts, which is written and unit
 *   tested but not called from any live route for exactly this reason: calling it before
 *   this backfill has run and been verified would only catch collisions among rows written
 *   after the backfill, giving false confidence that the check covers the existing book.
 *
 * ROLLBACK
 *   UPDATE employee_bank_detail SET account_number_blind_index = NULL, updated_at = updated_at;
 *   Nothing reads this column until the duplicate check is wired in, so rollback is free.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { blindIndex, isUsingDevBlindIndexKey, resolveAccountNumber } from "../src/shared/fieldEncryption.js";
import { withDeadlockRetry } from "../src/shared/deadlockRetry.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--batch="));
  return arg ? parseInt(arg.split("=")[1], 10) : 500;
})();

async function columnExists(): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(1) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'employee_bank_detail'
        AND column_name = 'account_number_blind_index'`,
  );
  const r = rows[0] as Record<string, unknown>;
  return Number(r.n ?? r.N) > 0;
}

interface Row extends RowDataPacket {
  id: string;
  account_number_enc: string | null;
  account_number: Buffer | string | null;
}

async function backfill(): Promise<{ written: number; pending: number; skipped: number }> {
  const [pendingRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM employee_bank_detail
      WHERE account_number_blind_index IS NULL
        AND (account_number_enc IS NOT NULL OR account_number IS NOT NULL)`,
  );
  const pending = Number((pendingRows[0] as Record<string, unknown>).n);
  console.log(`[blind-index] account_number_blind_index: ${pending} row(s) pending`);
  if (DRY_RUN || pending === 0) return { written: 0, pending, skipped: 0 };

  let written = 0;
  let skipped = 0; // resolveAccountNumber() found nothing usable (decrypt failure, empty legacy value)
  let lastId = "";
  for (;;) {
    const [rows] = await db.query<Row[]>(
      `SELECT id, account_number_enc, account_number FROM employee_bank_detail
        WHERE account_number_blind_index IS NULL
          AND (account_number_enc IS NOT NULL OR account_number IS NOT NULL)
          ${lastId ? "AND id > ?" : ""}
        ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
      lastId ? [lastId] : [],
    );
    if (!rows.length) break;

    for (const row of rows) {
      lastId = row.id;
      const value = resolveAccountNumber(row);
      if (!value) { skipped++; continue; }

      // updated_at = updated_at: deriving a blind index from a value that already exists is
      // not a business modification of the row — see the identical note in
      // statutory-blind-index-backfill.ts for why a falsified "last modified" stamp on
      // thousands of rows is a real downstream problem (reports, exports, audit views), not
      // a cosmetic one.
      const [res] = await withDeadlockRetry(
        () => db.execute<ResultSetHeader>(
          `UPDATE employee_bank_detail SET account_number_blind_index = ?, updated_at = updated_at
            WHERE id = ? AND account_number_blind_index IS NULL`,
          [blindIndex(value), row.id],
        ),
        {
          onRetry: (attempt) =>
            console.warn(`\n[blind-index] deadlock on account_number_blind_index row ${row.id}, retry ${attempt}`),
        },
      );
      written += res.affectedRows;
    }
    process.stdout.write(`\r  account_number_blind_index: ${written}/${pending} (${skipped} unresolvable)   `);
    if (rows.length < BATCH_SIZE) break;
  }
  process.stdout.write("\n");
  return { written, pending, skipped };
}

/**
 * Distinct index values must equal distinct resolved account numbers, or the index collides.
 * BINARY comparison: blindIndex() is a case-sensitive HMAC over raw bytes. See the identical
 * warning in statutory-blind-index-backfill.ts's verify() for why a case-insensitive count
 * produces a false MISMATCH.
 */
async function verify(): Promise<void> {
  const [rows] = await db.query<Row[]>(
    `SELECT id, account_number_enc, account_number, account_number_blind_index
       FROM employee_bank_detail
      WHERE account_number_enc IS NOT NULL OR account_number IS NOT NULL`,
  );

  const distinctPlain = new Set<string>();
  const distinctPlainCI = new Set<string>();
  const distinctIndex = new Set<string>();
  let stillNull = 0;

  for (const row of rows) {
    const value = resolveAccountNumber(row);
    if (value) {
      distinctPlain.add(value);
      distinctPlainCI.add(value.toLowerCase());
    }
    const idx = (row as unknown as { account_number_blind_index: string | null }).account_number_blind_index;
    if (idx) distinctIndex.add(idx);
    else if (value) stillNull++;
  }

  const ok = distinctPlain.size === distinctIndex.size && stillNull === 0;
  const caseVariants = distinctPlain.size - distinctPlainCI.size;

  console.log(
    `[blind-index] verify account_number_blind_index: distinct_plain=${distinctPlain.size} ` +
    `distinct_index=${distinctIndex.size} still_null=${stillNull} case_variants=${caseVariants} ` +
    `${ok ? "OK" : "MISMATCH"}`,
  );

  if (!ok) {
    console.log(
      "  Index count differs from resolved-plaintext count, or rows were left unindexed. " +
      "That is a genuine collision or a missed batch. Do NOT wire the duplicate check onto " +
      "this index until it reconciles.",
    );
  }
  if (caseVariants > 0) {
    console.log(
      `  NOTE: ${caseVariants} value(s) differ only by case (unlikely for numeric account ` +
      "numbers, but checked for parity with the statutory backfill's own warning).",
    );
  }
}

async function run(): Promise<void> {
  console.log(`[blind-index] DRY_RUN=${DRY_RUN} BATCH_SIZE=${BATCH_SIZE}`);

  if (isUsingDevBlindIndexKey()) {
    throw new Error(
      "FIELD_BLIND_INDEX_KEY is unset, so the built-in development key is in use. An index " +
      "built with it matches nothing at lookup time, and nothing would report an error — the " +
      "duplicate check would simply stop finding duplicates. Run this on the production host. " +
      "Refusing to write.",
    );
  }

  if (!(await columnExists())) {
    throw new Error("employee_bank_detail.account_number_blind_index does not exist — apply migration 1136 first.");
  }

  const { written, pending, skipped } = await backfill();
  if (!DRY_RUN) {
    console.log(`[blind-index] account_number_blind_index: wrote ${written} of ${pending} (${skipped} unresolvable)`);
    await verify();
  } else {
    console.log("\n  [DRY RUN — no rows were updated]");
  }

  console.log(
    "\n  Reminder: nothing reads this column yet. Wiring shared/bankAccountDuplicate.ts into " +
    "the live bank-write paths is a separate change that should only happen once the verify " +
    "above reconciles.",
  );
  await db.end();
}

run().catch((err) => {
  console.error("[blind-index] FAILED:", err);
  process.exitCode = 1;
});
