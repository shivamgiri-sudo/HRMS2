/**
 * Backfill employees.aadhaar_blind_index and employees.pan_blind_index.
 *
 * Run AFTER migration 1121 has applied. Safe to re-run — it only writes rows whose blind index
 * is still NULL, and recomputing is deterministic, so a partial run simply resumes.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/statutory-blind-index-backfill.ts [--dry-run] [--batch=500]
 *
 * WHY THIS EXISTS
 *   aadhaar_number and pan_number are encrypted alongside their plaintext, but the plaintext
 *   cannot be retired while anything still looks these values up by equality. The
 *   duplicate-employee guard does exactly that, and it is the check that stops one person
 *   becoming two employee records. A blind index gives that lookup somewhere to go.
 *
 * ⚠️ MUST RUN ON THE PRODUCTION HOST
 *   A blind index computed with the development key is not detectably wrong. Every lookup just
 *   returns nothing, which the duplicate guard reads as "no duplicate exists" — so it would pass
 *   every candidate and silently reopen the hole. There is no ciphertext to parity-check against
 *   (an HMAC is one-way and the columns start empty), so the only defence is refusing to run on
 *   the dev key at all. That is what isUsingDevBlindIndexKey() is for.
 *
 * WHAT IS INDEXED
 *   The raw stored value, trimmed. Deliberately NOT normalised (no stripping of spaces or
 *   dashes), because the lookup this replaces is `WHERE aadhaar_number = ?` — plain equality.
 *   Indexing a normalised form would make the guard match pairs it does not match today, which
 *   is a behaviour change smuggled into a security migration. Malformed stored values therefore
 *   remain unmatchable, exactly as they are now.
 *
 *   That is not a loss in practice: the orchestrator format-checks against AADHAAR_REGEX before
 *   it looks anything up, so only well-formed 12-digit values are ever searched for. Normalising
 *   the stored data is a separate, deliberate exercise.
 *
 * ROLLBACK
 *   UPDATE employees SET aadhaar_blind_index = NULL, pan_blind_index = NULL, updated_at = updated_at;
 *   Nothing reads these columns until the guard is migrated, so rollback is free.
 *   `updated_at = updated_at` matters here as much as in the forward direction — see below.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { blindIndex, isUsingDevBlindIndexKey } from "../src/shared/fieldEncryption.js";
import { withDeadlockRetry } from "../src/shared/deadlockRetry.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--batch="));
  return arg ? parseInt(arg.split("=")[1], 10) : 500;
})();

interface Target {
  column: "aadhaar_number" | "pan_number";
  indexColumn: "aadhaar_blind_index" | "pan_blind_index";
}

const TARGETS: Target[] = [
  { column: "aadhaar_number", indexColumn: "aadhaar_blind_index" },
  { column: "pan_number", indexColumn: "pan_blind_index" },
];

async function columnExists(column: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(1) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'employees' AND column_name = ?`,
    [column],
  );
  // This server returns information_schema labels in either case depending on config.
  const r = rows[0] as Record<string, unknown>;
  return Number(r.n ?? r.N) > 0;
}

async function backfill(target: Target): Promise<{ written: number; pending: number }> {
  const { column, indexColumn } = target;

  const [pendingRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM employees
      WHERE ${column} IS NOT NULL AND TRIM(${column}) <> '' AND ${indexColumn} IS NULL`,
  );
  const pending = Number((pendingRows[0] as Record<string, unknown>).n);
  console.log(`[blind-index] ${indexColumn}: ${pending} row(s) pending`);
  if (DRY_RUN || pending === 0) return { written: 0, pending };

  let written = 0;
  // Cursor on id: the pending set shrinks as we write, so OFFSET would skip rows.
  let lastId = "";
  for (;;) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, ${column} AS value FROM employees
        WHERE ${column} IS NOT NULL AND TRIM(${column}) <> '' AND ${indexColumn} IS NULL
          ${lastId ? "AND id > ?" : ""}
        ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
      lastId ? [lastId] : [],
    );
    if (!rows.length) break;

    for (const row of rows as Array<{ id: string; value: string }>) {
      lastId = row.id;
      const value = String(row.value).trim();
      if (!value) continue;
      // `updated_at = updated_at` is deliberate, and copied from
      // employee-pii-encrypt-backfill.mjs which got this right. employees.updated_at is
      // declared `on update CURRENT_TIMESTAMP`, so without this assignment all 53,449 rows
      // touched here would be stamped as modified now. Deriving a blind index from a value
      // that already exists is not a business modification of the employee record, and
      // falsified "last modified" stamps are indistinguishable from real edits afterwards —
      // they would surface in reports, exports and audit views. Assigning the column its own
      // value suppresses the auto-update. Pinned by
      // src/shared/__tests__/backfillUpdatedAtPreservation.test.ts.
      // Retried on deadlock. `employees` is a live OLTP table and this run issues 53,449
      // single-row writes against it, so losing a deadlock to ordinary application traffic
      // is expected, not exceptional — without this the first lost deadlock killed the whole
      // run (observed twice against production, at 13,857 and 14,191 rows). The UPDATE is one
      // autocommit statement carrying `AND ${indexColumn} IS NULL`, so it is idempotent and a
      // retry cannot double-write; see the scope warning in shared/deadlockRetry.ts for why
      // this must not be applied to statements inside a transaction.
      const [res] = await withDeadlockRetry(
        () => db.execute<ResultSetHeader>(
          `UPDATE employees SET ${indexColumn} = ?, updated_at = updated_at
            WHERE id = ? AND ${indexColumn} IS NULL`,
          [blindIndex(value), row.id],
        ),
        {
          onRetry: (attempt) =>
            console.warn(`\n[blind-index] deadlock on ${indexColumn} row ${row.id}, retry ${attempt}`),
        },
      );
      written += res.affectedRows;
    }
    process.stdout.write(`\r  ${indexColumn}: ${written}/${pending}   `);
    if (rows.length < BATCH_SIZE) break;
  }
  process.stdout.write("\n");
  return { written, pending };
}

/**
 * Distinct index values must equal distinct plaintext values, or the index collides.
 *
 * The comparison MUST be BINARY. blindIndex() is an HMAC over raw bytes, so it is
 * case-sensitive; COUNT(DISTINCT TRIM(col)) is evaluated under the column's case-INSENSITIVE
 * collation. Comparing the two counts a case variant as agreement on one side and difference
 * on the other, so they cannot agree by construction whenever any value differs only in case.
 * That is not hypothetical: the first production run reported MISMATCH with
 * distinct_plain=13653 against distinct_index=13744 on a run that was complete and
 * collision-free — 91 PAN values differ only in case, and BINARY distinct is exactly 13,744.
 * A false MISMATCH is worse than no check, because it trains the next reader to ignore a real
 * one, and the old message misdiagnosed it as a collision when more index values than
 * plaintext values is precisely the opposite.
 */
async function verify(target: Target): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT BINARY TRIM(${target.column})) AS distinct_plain,
            COUNT(DISTINCT TRIM(${target.column}))        AS distinct_plain_ci,
            COUNT(DISTINCT ${target.indexColumn})         AS distinct_index,
            SUM(${target.indexColumn} IS NULL)            AS still_null
       FROM employees
      WHERE ${target.column} IS NOT NULL AND TRIM(${target.column}) <> ''`,
  );
  const r = rows[0] as Record<string, unknown>;
  const ok = Number(r.distinct_plain) === Number(r.distinct_index) && Number(r.still_null) === 0;
  const caseVariants = Number(r.distinct_plain) - Number(r.distinct_plain_ci);

  console.log(
    `[blind-index] verify ${target.indexColumn}: distinct_plain=${r.distinct_plain} ` +
    `distinct_index=${r.distinct_index} still_null=${r.still_null} ` +
    `case_variants=${caseVariants} ${ok ? "OK" : "MISMATCH"}`,
  );

  if (!ok) {
    console.log(
      "  Index count differs from BINARY-distinct plaintext, or rows were left unindexed. " +
      "That is a genuine collision or a missed batch. " +
      "Do NOT migrate the duplicate guard onto this index until it reconciles.",
    );
  }

  // Reported even on an OK run: this is a migration hazard, not a backfill failure.
  if (caseVariants > 0) {
    console.log(
      `  NOTE: ${caseVariants} value(s) differ only by case. The duplicate guard matches ` +
      `plaintext by equality under a case-insensitive collation, so it currently catches ` +
      `those; this index is case-sensitive and would NOT. Normalise case on both the index ` +
      `and the lookup before migrating the guard, or duplicate detection regresses for them.`,
    );
  }
}

async function run(): Promise<void> {
  console.log(`[blind-index] DRY_RUN=${DRY_RUN} BATCH_SIZE=${BATCH_SIZE}`);

  if (isUsingDevBlindIndexKey()) {
    throw new Error(
      "FIELD_BLIND_INDEX_KEY is unset, so the built-in development key is in use. An index built " +
      "with it matches nothing at lookup time, and nothing would report an error — the duplicate " +
      "guard would simply stop finding duplicates. Run this on the production host. Refusing to write.",
    );
  }

  if (!(await columnExists("aadhaar_blind_index"))) {
    throw new Error("employees.aadhaar_blind_index does not exist — apply migration 1121 first.");
  }

  for (const target of TARGETS) {
    const { written, pending } = await backfill(target);
    if (!DRY_RUN) {
      console.log(`[blind-index] ${target.indexColumn}: wrote ${written} of ${pending}`);
      await verify(target);
    }
  }

  if (DRY_RUN) console.log("\n  [DRY RUN — no rows were updated]");
  console.log(
    "\n  Reminder: the duplicate guard still reads plaintext. Migrating it, and flipping the " +
    "assertion in conversion-duplicate-identity.contract.test.ts, is a separate change that " +
    "should only happen once the verify above reconciles.",
  );
  await db.end();
}

run().catch(async (e) => {
  console.error("[blind-index] FATAL", e?.message ?? e);
  try { await db.end(); } catch { /* already closed */ }
  process.exit(1);
});
