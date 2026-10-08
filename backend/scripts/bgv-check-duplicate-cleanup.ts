/**
 * One-time cleanup: collapse duplicate candidate_bgv_check rows down to one per
 * (candidate_id, check_type), keeping the most recently updated row in each group.
 *
 * Matches the dedup rule already shipped in getBgvStatusForCandidate (read path) —
 * this closes the same gap at the data layer. It does NOT fix the underlying
 * causes: photo_match's bare-INSERT bug is fixed (see recordFaceMatchSkipped in
 * onboarding-full.service.ts); the aadhaar/bank/pan duplication is a separate,
 * still-open race condition in createOrUpdateCheck (no unique constraint on
 * candidate_id+check_type lets near-simultaneous calls each see "no existing row").
 * Re-running this script later will not undo that — it only stays clean until the
 * race fires again.
 *
 * Safe by construction:
 *   - Dry-run by default. Nothing is deleted unless --apply is passed.
 *   - Only ever deletes rows that are NOT the max(updated_at) in their group —
 *     the row every current read path already treats as authoritative survives.
 *   - Runs inside one transaction; any failure rolls back everything.
 *
 * Usage:
 *   npx tsx scripts/bgv-check-duplicate-cleanup.ts            # dry run (default)
 *   npx tsx scripts/bgv-check-duplicate-cleanup.ts --apply     # actually delete
 */
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [groups] = await db.execute(
    `SELECT candidate_id, check_type, COUNT(*) AS cnt
       FROM candidate_bgv_check
      GROUP BY candidate_id, check_type
     HAVING COUNT(*) > 1`
  );
  const groupRows = groups as Array<{ candidate_id: string; check_type: string; cnt: number }>;

  if (!groupRows.length) {
    console.log("No duplicate groups found. Nothing to do.");
    process.exit(0);
  }

  let totalToDelete = 0;
  const idsToDelete: string[] = [];

  for (const g of groupRows) {
    const [rows] = await db.execute(
      `SELECT id, status, updated_at, created_at
         FROM candidate_bgv_check
        WHERE candidate_id = ? AND check_type = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC`,
      [g.candidate_id, g.check_type]
    );
    const ordered = rows as Array<{ id: string; status: string; updated_at: string; created_at: string }>;
    const [keep, ...drop] = ordered; // first row after DESC sort = most recently updated
    if (!keep || drop.length === 0) continue;

    console.log(
      `${g.candidate_id}  ${g.check_type}: keep ${keep.id} (status=${keep.status}, updated=${keep.updated_at}); ` +
      `${APPLY ? "deleting" : "would delete"} ${drop.length} row(s): ${drop.map((d) => d.id).join(", ")}`
    );
    totalToDelete += drop.length;
    idsToDelete.push(...drop.map((d) => d.id));
  }

  console.log(`\n${APPLY ? "Deleting" : "Would delete"} ${totalToDelete} row(s) across ${groupRows.length} group(s).`);

  if (!APPLY) {
    console.log("Dry run only — re-run with --apply to actually delete.");
    process.exit(0);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const placeholders = idsToDelete.map(() => "?").join(",");
    const [result] = await conn.execute(
      `DELETE FROM candidate_bgv_check WHERE id IN (${placeholders})`,
      idsToDelete
    );
    await conn.commit();
    console.log(`Committed. Deleted ${(result as any).affectedRows} row(s).`);
  } catch (err) {
    await conn.rollback();
    console.error("Rolled back — nothing was deleted.", err);
    process.exit(1);
  } finally {
    conn.release();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
