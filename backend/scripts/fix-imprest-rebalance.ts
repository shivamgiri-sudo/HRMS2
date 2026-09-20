/**
 * fix-imprest-rebalance.ts
 *
 * ONE-TIME correction for imprest float imbalances introduced by the db_bill
 * migration. After the migration and subsequent fix-imprest-reattribute run,
 * some branch imprest floats show a deficit — their imprest_manager.current_balance
 * is negative because historical debit entries (spend vouchers) were migrated but
 * the corresponding top-up credits were not, or were attributed to the wrong manager.
 *
 * STRATEGY — proportional distribution, not a zero-balance guarantee
 * ------------------------------------------------------------------
 * For each branch with one or more managers in deficit, a single corrective
 * adjustment credit is posted per deficit manager, sized to bring them to zero.
 * The credit amount is derived proportionally from the known unmatched top-up
 * pool for that branch (from the db_bill reconciliation output). Branches where
 * the pool is insufficient to cover all deficits receive a proportional share:
 *
 *   manager_credit = deficit * (branch_pool / total_branch_deficit)
 *
 * This is deliberate: crediting more than the documented pool would fabricate
 * float money that never existed. A deficit that the pool cannot cover stays
 * open and must be resolved by a human-authorised top-up.
 *
 * IDEMPOTENCY
 * -----------
 * Adjustment entries are tagged created_by = MIGRATION_USER and the narration
 * carries a fixed prefix keyed to this script ("REBALANCE-2026"). A re-run
 * checks for an existing row with that prefix before inserting, so duplicate
 * adjustments are never posted.
 *
 * USAGE
 *   npx ts-node backend/scripts/fix-imprest-rebalance.ts           # dry-run (default)
 *   npx ts-node backend/scripts/fix-imprest-rebalance.ts --apply   # write changes
 */

import mysql from "mysql2/promise";
import "dotenv/config";

const MIGRATION_USER = "00000000-0000-0000-0000-dbbill000001";
const APPLY = process.argv.includes("--apply");
const NARRATION_PREFIX = "REBALANCE-2026:";

/**
 * Branch-level pool amounts from the db_bill reconciliation.
 * Each entry maps a branch_id to the total unmatched top-up amount available
 * for deficit correction in that branch.
 * Populate from the reconciliation output before running.
 */
const BRANCH_POOLS: Record<string, number> = {
  // "feb3ff2d-6583-11f1-adb1-00155d0ab410": 50000,  // Mayapuri — Rs 50,000 pool
};

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    // Find all managers with a negative current_balance, grouped by branch
    const [deficitRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT im.id AS manager_id,
              im.branch_id,
              im.employee_id,
              im.current_balance,
              e.full_name
         FROM imprest_manager im
         LEFT JOIN employees e ON e.id = im.employee_id
        WHERE im.current_balance < 0
        ORDER BY im.branch_id, im.current_balance ASC`
    );

    if (deficitRows.length === 0) {
      console.log("No deficit managers found. Nothing to do.");
      return;
    }

    console.log(`Found ${deficitRows.length} deficit manager(s):`);
    for (const row of deficitRows) {
      console.log(
        `  ${row.full_name ?? row.manager_id} (branch ${row.branch_id}): ` +
        `balance = ${row.current_balance}`
      );
    }

    // Group by branch and compute proportional credits
    const byBranch = new Map<string, typeof deficitRows>();
    for (const row of deficitRows) {
      const list = byBranch.get(row.branch_id) ?? [];
      list.push(row);
      byBranch.set(row.branch_id, list);
    }

    let totalCredits = 0;

    for (const [branchId, managers] of byBranch) {
      const totalDeficit = managers.reduce(
        (sum, m) => sum + Math.abs(m.current_balance),
        0
      );
      const pool = BRANCH_POOLS[branchId] ?? 0;

      if (pool === 0) {
        console.log(
          `\nBranch ${branchId}: no pool configured — deficit of ${totalDeficit} left open.`
        );
        continue;
      }

      // proportion: if pool >= deficit, each manager gets exactly their deficit amount;
      // if pool < deficit, each gets a proportional share of what is available.
      const proportion = Math.min(1, pool / totalDeficit);
      console.log(
        `\nBranch ${branchId}: total deficit ${totalDeficit}, pool ${pool}, ` +
        `proportion ${(proportion * 100).toFixed(1)}%`
      );

      for (const manager of managers) {
        const deficit = Math.abs(manager.current_balance);
        const credit = Math.round(deficit * proportion * 100) / 100;
        const narration =
          `${NARRATION_PREFIX} migration deficit correction ` +
          `(proportion ${(proportion * 100).toFixed(1)}%, pool ${pool})`;

        console.log(
          `  ${manager.full_name ?? manager.manager_id}: ` +
          `deficit ${deficit} → credit ${credit}`
        );

        if (!APPLY) continue;

        // Idempotency: skip if an identical rebalance entry already exists
        const [existing] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT id FROM imprest_transaction_ledger
            WHERE imprest_manager_id = ?
              AND created_by = ?
              AND narration LIKE ?
            LIMIT 1`,
          [manager.manager_id, MIGRATION_USER, `${NARRATION_PREFIX}%`]
        );
        if (existing.length > 0) {
          console.log("    Already rebalanced — skipping.");
          continue;
        }

        await conn.beginTransaction();
        try {
          await conn.execute(
            `INSERT INTO imprest_transaction_ledger
               (id, imprest_manager_id, entry_type, amount, narration,
                reference_type, transaction_date, created_by, created_at, updated_at)
             VALUES (UUID(), ?, 'adjustment', ?, ?, 'manual', CURDATE(), ?, NOW(), NOW())`,
            [manager.manager_id, credit, narration, MIGRATION_USER]
          );

          await conn.execute(
            `UPDATE imprest_manager
                SET current_balance = current_balance + ?
              WHERE id = ?`,
            [credit, manager.manager_id]
          );

          await conn.execute(
            `INSERT INTO sensitive_action_log
               (entity_type, entity_id, action, actor_id, details, created_at)
             VALUES ('imprest_manager', ?, 'IMPREST_REBALANCE', ?, ?, NOW())`,
            [
              manager.manager_id,
              MIGRATION_USER,
              JSON.stringify({ credit, deficit, proportion, pool, branchId }),
            ]
          );

          await conn.commit();
          totalCredits += credit;
          console.log(`    Posted credit of ${credit}.`);
        } catch (err) {
          await conn.rollback();
          throw err;
        }
      }
    }

    console.log(
      `\nDone. Total credits posted: ${totalCredits}` +
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
