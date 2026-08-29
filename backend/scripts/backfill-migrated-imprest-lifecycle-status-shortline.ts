/**
 * Closes out the 11 rows the main backfill (backfill-migrated-imprest-lifecycle-status.ts)
 * deliberately excluded on 2026-08-29 because their funding budget line's reserved_amount was
 * already short of what a full reclassification would need to subtract.
 *
 * Investigated: across the 4 affected lines, the shortfall (Rs 758.16 total against Rs 4,970.01
 * of rows) is small and each line's consumed_amount is already substantial (Rs 15,506-18,298) —
 * consistent with ordinary later GRN activity on the same line having already drawn its
 * reserved_amount down for unrelated reasons, not with anything this backfill did or should
 * try to further reconcile. Re-deriving the "correct" historical reserved/consumed split for
 * these 4 lines is a separate, deeper investigation and not worth blocking this on.
 *
 * What THIS script does, and only this: flips grn_cost_allocation.lifecycle_status from
 * 'reserved' to 'consumed' for these 11 rows, so their real, already-final spend (the GRN header
 * has been 'approved' for months) is visible on the P&L pages that key off lifecycle_status.
 * Does NOT touch finance_budget_line.reserved_amount/consumed_amount at all — the line's own
 * reserved/consumed split, whatever pre-existing drift it carries, is left exactly as it stands.
 * This cannot drive anything negative and cannot invent money: it corrects a status field to
 * match a header that has already been approved, nothing more.
 *
 *   node --import tsx backend/scripts/backfill-migrated-imprest-lifecycle-status-shortline.ts
 *   node --import tsx backend/scripts/backfill-migrated-imprest-lifecycle-status-shortline.ts --apply
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id AS allocation_id, g.grn_number, g.accounting_period, a.amount_with_tax
       FROM grn_cost_allocation a
       JOIN grn_request g ON g.id = a.grn_request_id
      WHERE g.grn_type = 'imprest'
        AND g.status = 'approved'
        AND a.lifecycle_status = 'reserved'
        AND g.branch_head_reviewed_by IS NULL
        AND g.finance_head_reviewed_by IS NULL
        AND g.reviewed_by IS NULL
        AND g.imprest_ledger_entry_id IS NULL
      ORDER BY g.accounting_period, g.grn_number`,
  );

  console.log(`${rows.length} row(s) found (expect 11 — this script targets only what the main backfill excluded).`);
  console.log(APPLY ? "MODE: --apply, writing.\n" : "MODE: dry run, writing nothing. Pass --apply to write.\n");

  let applied = 0;
  for (const row of rows as RowDataPacket[]) {
    console.log(`  ${row.grn_number}  period=${row.accounting_period}  amount=${Number(row.amount_with_tax).toFixed(2)}`);
    if (!APPLY) continue;
    const [result] = await db.execute(
      `UPDATE grn_cost_allocation
          SET lifecycle_status = 'consumed', consumed_at = NOW()
        WHERE id = ? AND lifecycle_status = 'reserved'`,
      [row.allocation_id],
    );
    if ((result as { affectedRows: number }).affectedRows === 1) applied += 1;
    else console.error(`  FAILED ${row.grn_number}: not in 'reserved' at write time`);
  }

  console.log(APPLY ? `\n${applied} of ${rows.length} row(s) reclassified.` : "\nNothing written. Re-run with --apply once this reads correctly.");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED", e); process.exit(1); });
