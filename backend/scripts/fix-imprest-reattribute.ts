/**
 * fix-imprest-reattribute.ts
 *
 * ONE-TIME correction to re-attribute imprest_transaction_ledger entries that were
 * originally inserted by MIGRATION_USER during the db_bill imprest migration but were
 * linked to the wrong manager due to a name-collision issue in the source data.
 *
 * ROOT CAUSE
 * ----------
 * The db_bill migration script (migrate-imprest-from-dbbill.ts) matched managers by
 * full_name when a matching imprest_manager row already existed in HRMS2. In branches
 * where two employees share a name (e.g. "Rahul Singh" at Noida and "Rahul Singh" at
 * Jaipur), the first match won — so some historical ledger entries landed under the
 * wrong person's float record.
 *
 * SCOPE
 * -----
 * Only ledger entries created by MIGRATION_USER are re-attributed. Live entries
 * (created by real users after go-live) are never touched — the safe key is
 * created_by = MIGRATION_USER and a confirmed-wrong imprest_manager_id.
 *
 * IDEMPOTENCY
 * -----------
 * 1. The DELETE step targets only rows where created_by = ? (MIGRATION_USER), so
 *    no live post-migration entry is ever deleted regardless of how many times this
 *    runs.
 * 2. The re-insert uses INSERT IGNORE so re-running after a partial run does not
 *    produce duplicate rows.
 *
 * USAGE
 *   npx ts-node backend/scripts/fix-imprest-reattribute.ts           # dry-run (default)
 *   npx ts-node backend/scripts/fix-imprest-reattribute.ts --apply   # write changes
 */

import mysql from "mysql2/promise";
import "dotenv/config";

const MIGRATION_USER = "00000000-0000-0000-0000-dbbill000001";
const APPLY = process.argv.includes("--apply");

/**
 * Rows to re-attribute: [wrongManagerId, correctManagerId, branchNote]
 * Populated via prior investigation; update this list before running.
 */
const REATTRIBUTION_TARGETS: Array<{
  wrongManagerId: string;
  correctManagerId: string;
  note: string;
}> = [
  // Example (real IDs confirmed via manual reconciliation):
  // {
  //   wrongManagerId: "aaaaaaaa-0000-0000-0000-000000000001",
  //   correctManagerId: "bbbbbbbb-0000-0000-0000-000000000002",
  //   note: "Rahul Singh Noida vs Jaipur name collision",
  // },
];

async function run() {
  if (REATTRIBUTION_TARGETS.length === 0) {
    console.log(
      "No re-attribution targets configured. " +
      "Populate REATTRIBUTION_TARGETS before running."
    );
    return;
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    let totalDeleted = 0;
    let totalInserted = 0;

    for (const target of REATTRIBUTION_TARGETS) {
      // Fetch the migration-origin rows that belong to the wrong manager
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT * FROM imprest_transaction_ledger
          WHERE imprest_manager_id = ?
            AND created_by = ?
          ORDER BY transaction_date, created_at`,
        [target.wrongManagerId, MIGRATION_USER]
      );

      console.log(
        `[${target.note}] Found ${rows.length} migration-origin entries ` +
        `on wrong manager ${target.wrongManagerId}`
      );

      if (rows.length === 0) continue;

      if (!APPLY) {
        console.log("  DRY-RUN — no changes written.");
        continue;
      }

      await conn.beginTransaction();
      try {
        // Delete only migration-origin entries from the wrong manager
        const [delResult] = await conn.execute<mysql.ResultSetHeader>(
          `DELETE FROM imprest_transaction_ledger
            WHERE imprest_manager_id = ?
              AND created_by = ?`,
          [target.wrongManagerId, MIGRATION_USER]
        );
        totalDeleted += delResult.affectedRows;
        console.log(`  Deleted ${delResult.affectedRows} wrong-manager rows.`);

        // Re-insert under the correct manager using INSERT IGNORE for idempotency
        for (const row of rows) {
          await conn.execute(
            `INSERT IGNORE INTO imprest_transaction_ledger
               (id, imprest_manager_id, entry_type, amount, narration,
                reference_type, reference_id, transaction_date,
                created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id,
              target.correctManagerId,
              row.entry_type,
              row.amount,
              row.narration,
              row.reference_type,
              row.reference_id,
              row.transaction_date,
              row.created_by,
              row.created_at,
              row.updated_at,
            ]
          );
          totalInserted++;
        }

        // Audit the re-attribution
        await conn.execute(
          `INSERT INTO sensitive_action_log
             (entity_type, entity_id, action, actor_id, details, created_at)
           VALUES ('imprest_manager', ?, 'IMPREST_REATTRIBUTE', ?, ?, NOW())`,
          [
            target.correctManagerId,
            MIGRATION_USER,
            JSON.stringify({
              wrongManagerId: target.wrongManagerId,
              rowCount: rows.length,
              note: target.note,
            }),
          ]
        );

        await conn.commit();
        console.log(
          `  Re-attributed ${rows.length} entries to correct manager ${target.correctManagerId}.`
        );
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }

    console.log(
      `\nDone. Deleted: ${totalDeleted}, Re-inserted: ${totalInserted}` +
      (APPLY ? "" : " (DRY-RUN — pass --apply to write)")
    );
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
