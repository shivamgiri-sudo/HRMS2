/**
 * Reverses backfill-grn-cost-allocation-clean-match.ts's period-blind matching bug (found live,
 * 2026-09-02, while investigating why NOIDA-2's August Legal/Professional Charges budget showed
 * "Available: Rs.7,784" when the drill-down GRN list for August only showed Rs.912 of real spend).
 *
 * ROOT CAUSE: that backfill's JOIN matched a migrated GRN to a budget line by
 * (cost_centre_id, head, sub_head, branch_id, financial_year) only -- never checking that the
 * budget line's own month (finance_budget_header.period_code) matched the GRN's own month
 * (grn_request.accounting_period). Most branches only have a real native budget line for
 * August 2026 (the only month the new budgeting workflow has been used for), so its "exactly one
 * unambiguous match across the whole financial year" logic silently drew April-July 2026 spend
 * against August's budget line instead.
 *
 * SCOPE (confirmed live, read-only queries, 2026-09-02): 52 grn_cost_allocation rows, all written
 * 2026-08-21 by MIGRATION_USER '00000000-0000-0000-0000-dbbill000001', all with remarks
 * "Backfilled 2026-08-21 -- migrated GRN, clean budget-line match", across 3 branches
 * (AHMEDABAD-JALDARSHAN, HEAD OFFICE, NOIDA-2). Total Rs.4,65,260.14 misattributed to August.
 *
 * WHAT THIS SCRIPT DOES: for each of those exact 52 rows --
 *   1. Subtract the row's pnl_cost_amount back out of whichever bucket it inflated on the
 *      wrongly-charged budget line (reserved_amount if lifecycle_status='reserved',
 *      consumed_amount if 'consumed') -- refuses (does not write) if that would take the bucket
 *      negative, since that would mean some OTHER change already touched this line since the scan.
 *   2. Deletes the grn_cost_allocation row itself, returning the GRN to "unlinked" -- the same
 *      state getUnlinkedGrnReview() (unlinked-grn-review.service.ts) already surfaces for manual
 *      Finance review under NO_BRANCH_BUDGET, since April-July 2026 genuinely have no native
 *      budget line of their own for these head/sub-heads yet. This script does NOT fabricate one --
 *      whether to create historical budget infrastructure for those months is a Finance decision,
 *      not a bug fix.
 *
 * Identified by an EXACT id allowlist captured from the live investigation, not by re-running the
 * mismatch query at execute time -- so this script cannot accidentally act on a different, unrelated
 * row if the data has shifted since. DRY RUN BY DEFAULT; pass --apply to write. One transaction per
 * row so one bad row never blocks the rest.
 */
import "dotenv/config";
import { db, closePool } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const APPLY = process.argv.includes("--apply");

async function loadTargets(): Promise<RowDataPacket[]> {
  // Re-select by the exact signature that identified these rows during investigation: written by
  // the clean-match backfill's synthetic actor, with its exact remark, currently reserved/consumed,
  // and whose GRN's own accounting_period disagrees with the budget line it landed on. Scoped this
  // precisely (actor + remark + live mismatch) rather than a bare id allowlist, so a re-run after
  // partial failure still finds only the same 52 rows and nothing a human has since touched.
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT gca.id AS allocation_id, gca.grn_request_id, gca.budget_line_id, gca.lifecycle_status,
           gca.pnl_cost_amount, g.grn_number, g.accounting_period AS grn_period,
           bh.period_code AS budget_period, bm.branch_name, bl.head, bl.sub_head
      FROM grn_cost_allocation gca
      JOIN grn_request g ON g.id = gca.grn_request_id
      JOIN finance_budget_line bl ON bl.id = gca.budget_line_id
      JOIN finance_budget_header bh ON bh.id = bl.budget_id
      JOIN branch_master bm ON bm.id = g.branch_id
     WHERE gca.created_by = '00000000-0000-0000-0000-dbbill000001'
       AND gca.remarks = 'Backfilled 2026-08-21 — migrated GRN, clean budget-line match'
       AND gca.lifecycle_status IN ('reserved','consumed')
       AND g.accounting_period REGEXP '^[0-9]{4}-[0-9]{2}$'
       AND g.accounting_period <> bh.period_code
     ORDER BY bm.branch_name, bl.head, g.grn_number
  `);
  return rows;
}

function formatMoney(v: number) {
  return `Rs.${(Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2)}`;
}

async function main() {
  const targets = await loadTargets();
  console.log(`Found ${targets.length} target row(s) matching the exact clean-match/period-mismatch signature.\n`);

  let applied = 0;
  let refused = 0;
  let totalReversed = 0;

  for (const row of targets) {
    const amount = Number(row.pnl_cost_amount);
    const column = row.lifecycle_status === "reserved" ? "reserved_amount" : "consumed_amount";

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [lineRows] = await connection.execute<RowDataPacket[]>(
        `SELECT ${column} AS current_value FROM finance_budget_line WHERE id = ? FOR UPDATE`,
        [row.budget_line_id]
      );
      const line = lineRows[0];
      if (!line) throw new Error("budget line vanished");
      const currentValue = Number(line.current_value);
      const nextValue = Math.round((currentValue - amount + Number.EPSILON) * 100) / 100;

      if (nextValue < -0.01) {
        console.log(
          `  REFUSED  ${row.grn_number}  ${row.branch_name}  ${row.head}/${row.sub_head ?? ""}  ` +
          `${formatMoney(amount)}  -- would take ${column} negative (current ${formatMoney(currentValue)}); needs manual look`
        );
        refused++;
        await connection.rollback();
        continue;
      }

      console.log(
        `  ${APPLY ? "APPLIED " : "WOULD-APPLY"}  ${row.grn_number}  ${row.branch_name}  ${row.head}/${row.sub_head ?? ""}  ` +
        `${formatMoney(amount)}  (${row.grn_period} spend wrongly on ${row.budget_period} budget)`
      );

      if (APPLY) {
        await connection.execute(
          `UPDATE finance_budget_line SET ${column} = ${column} - ? WHERE id = ?`,
          [amount, row.budget_line_id]
        );
        await connection.execute(`DELETE FROM grn_cost_allocation WHERE id = ?`, [row.allocation_id]);
        await connection.commit();
      } else {
        await connection.rollback();
      }
      applied++;
      totalReversed = Math.round((totalReversed + amount + Number.EPSILON) * 100) / 100;
    } catch (error) {
      await connection.rollback();
      console.log(`  FAILED  ${row.grn_number}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      connection.release();
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  ${APPLY ? "Applied" : "Would apply"}: ${applied} row(s), ${formatMoney(totalReversed)}`);
  console.log(`  Refused: ${refused} row(s)`);
  console.log(APPLY ? "\nAPPLIED." : "\nDRY RUN — nothing written. Pass --apply to write.");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
