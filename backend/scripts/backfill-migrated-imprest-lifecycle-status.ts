/**
 * Flips migrated imprest GRNs' cost-allocation status from 'reserved' to 'consumed', so their
 * real, already-final spend counts on the P&L pages that key off lifecycle_status = 'consumed'.
 *
 * ROOT CAUSE, confirmed against production on 2026-08-29
 * --------------------------------------------------------------------------------------------
 * 686 grn_cost_allocation rows for imprest GRNs sit at lifecycle_status = 'reserved' even though
 * their GRN header is already status = 'approved' — the terminal state for an imprest voucher.
 * Every one of these 686 rows has branch_head_reviewed_by, finance_head_reviewed_by AND
 * reviewed_by all NULL, which the live review() code path can never produce (it always stamps
 * the actor on approval) — so these never went through the app's own approval flow. They are a
 * migration/import artifact: something wrote the GRN header as already-approved and gave it a
 * grn_cost_allocation row, but left the row's lifecycle_status one step short of where the
 * header says it already is, and never posted an imprest ledger entry for it (imprest_manager_id
 * is set on all 686, imprest_ledger_entry_id on none — consistent with historical vouchers that
 * predate the ledger, not with a live approval that skipped a step).
 *
 * All 686 are fully budgeted (budget_line_id set on every row) and their accounting_period is
 * 2026-04 through 2026-08 — several already-closed months. The corresponding
 * finance_budget_line.reserved_amount for each line matches this backfill's own allocation sum
 * exactly, with consumed_amount unaffected — i.e. the money has been sitting in "reserved" limbo
 * on the budget line for months, understating consumed spend on the branch's own budget reports
 * for periods that already closed.
 *
 * WHAT THIS DOES
 * --------------
 * For each of the 686 rows:
 *   1. grn_cost_allocation.lifecycle_status: 'reserved' -> 'consumed', consumed_at = NOW()
 *   2. finance_budget_line.reserved_amount -= the row's amount; consumed_amount += the same
 *      amount — a reclassification, not a net change: reserved + consumed on the line is
 *      unchanged, matching what happened at create() and leaving nothing to reconcile.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * -----------------------------------
 * Does NOT post an imprest ledger entry, and does NOT set imprest_ledger_entry_id. Debiting the
 * float today for spend already recorded as historical fact months ago would incorrectly reduce
 * TODAY's float balance for money that (per the header's own already-approved status) left the
 * float long ago. If these vouchers still need a ledger trail, that is a distinct, separate
 * decision — this script only corrects the STATUS FIELD to match what the header already
 * asserts, so P&L and budget reports stop showing already-final spend as still pending.
 *
 * Does NOT touch grn_request.status, grn_cost_allocation.cost_centre_id/budget_line_id/amounts,
 * or any other column. Does NOT run for a row outside this exact match (grn_type = 'imprest',
 * grn_request.status = 'approved', lifecycle_status = 'reserved', all three review columns NULL)
 * — a row that fails any part of that match is left untouched and reported separately so it can
 * be looked at by hand rather than swept in by a looser match.
 *
 * SAFETY
 * ------
 *   --dry-run   (default) computes and reports everything, writes nothing.
 *   --apply     writes, one transaction per GRN, so a failure on one cannot half-apply another.
 *
 * Reversible: every value overwritten is read and logged before the write, so a rollback is
 * `UPDATE ... SET lifecycle_status='reserved', consumed_at=NULL ...` /
 * `UPDATE finance_budget_line SET reserved_amount = reserved_amount + X, consumed_amount =
 * consumed_amount - X ...` from the logged before-values — printed at the end of an --apply run.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [candidates] = await db.execute<RowDataPacket[]>(
    `SELECT a.id AS allocation_id, a.budget_line_id, a.amount_with_tax, a.amount_without_tax,
            g.id AS grn_id, g.grn_number, g.accounting_period, g.status,
            g.branch_head_reviewed_by, g.finance_head_reviewed_by, g.reviewed_by,
            g.imprest_manager_id, g.imprest_ledger_entry_id
       FROM grn_cost_allocation a
       JOIN grn_request g ON g.id = a.grn_request_id
      WHERE g.grn_type = 'imprest'
        AND g.status = 'approved'
        AND a.lifecycle_status = 'reserved'
      ORDER BY g.accounting_period, g.grn_number`
  );

  // Defensive: confirm every affected line's CURRENT reserved_amount actually covers the sum of
  // rows this script is about to move off it. It matched exactly on 2026-08-29, but this is a
  // live table other work can touch between then and whenever this actually runs — a shortfall
  // here would mean subtracting more than a line has, which must refuse per-line rather than
  // silently drive reserved_amount negative.
  const [lineChecks] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.reserved_amount,
            (SELECT COALESCE(SUM(a.amount_with_tax), 0)
               FROM grn_cost_allocation a
               JOIN grn_request g ON g.id = a.grn_request_id
              WHERE a.budget_line_id = l.id
                AND g.grn_type = 'imprest' AND g.status = 'approved'
                AND a.lifecycle_status = 'reserved') AS matched_sum
       FROM finance_budget_line l
      WHERE l.id IN (
        SELECT DISTINCT a.budget_line_id
          FROM grn_cost_allocation a
          JOIN grn_request g ON g.id = a.grn_request_id
         WHERE g.grn_type = 'imprest' AND g.status = 'approved' AND a.lifecycle_status = 'reserved'
      )`
  );
  const shortLines = new Set(
    (lineChecks as RowDataPacket[])
      .filter((l) => Number(l.reserved_amount) + 0.01 < Number(l.matched_sum))
      .map((l) => String(l.id)),
  );
  if (shortLines.size) {
    console.log(
      `${shortLines.size} budget line(s) have LESS reserved_amount than this backfill would `
      + `subtract from them — every row funded by one of these is excluded, not forced through:`,
    );
    for (const id of shortLines) console.log(`    ${id}`);
  }

  console.log(`${candidates.length} candidate allocation row(s) found.`);
  console.log(APPLY ? "MODE: --apply, writing.\n" : "MODE: dry run, writing nothing. Pass --apply to write.\n");

  const eligible: RowDataPacket[] = [];
  const excluded: Array<{ row: RowDataPacket; reason: string }> = [];
  for (const row of candidates as RowDataPacket[]) {
    const isMigrationArtifact =
      row.branch_head_reviewed_by == null
      && row.finance_head_reviewed_by == null
      && row.reviewed_by == null;
    if (!isMigrationArtifact) {
      excluded.push({ row, reason: "has a review actor recorded — not the migration pattern, left untouched" });
      continue;
    }
    if (row.imprest_ledger_entry_id != null) {
      excluded.push({ row, reason: "already has an imprest_ledger_entry_id — not the migration pattern, left untouched" });
      continue;
    }
    if (!row.budget_line_id) {
      excluded.push({ row, reason: "no budget_line_id — nothing on finance_budget_line to reclassify" });
      continue;
    }
    if (shortLines.has(String(row.budget_line_id))) {
      excluded.push({ row, reason: "funding line's reserved_amount is short of the matched sum — see warning above" });
      continue;
    }
    eligible.push(row);
  }

  console.log(`${eligible.length} row(s) match the migration pattern exactly.`);
  if (excluded.length) {
    console.log(`${excluded.length} row(s) excluded:`);
    for (const { row, reason } of excluded.slice(0, 20)) {
      console.log(`    ${row.grn_number} (${row.grn_id}) — ${reason}`);
    }
    if (excluded.length > 20) console.log(`    ... and ${excluded.length - 20} more`);
  }

  const totalAmount = eligible.reduce((sum, r) => sum + Number(r.amount_with_tax), 0);
  console.log(`\nTotal to reclassify: Rs ${totalAmount.toFixed(2)} across ${eligible.length} row(s).\n`);

  let applied = 0;
  const rollbackLines: string[] = [];

  for (const row of eligible) {
    const amount = Number(row.amount_with_tax);
    console.log(
      `  ${row.grn_number}  period=${row.accounting_period}  amount=${amount.toFixed(2)}`
      + `  line=${row.budget_line_id}`,
    );
    rollbackLines.push(
      `UPDATE grn_cost_allocation SET lifecycle_status='reserved', consumed_at=NULL WHERE id='${row.allocation_id}';`,
      `UPDATE finance_budget_line SET reserved_amount = reserved_amount + ${amount}, `
      + `consumed_amount = consumed_amount - ${amount} WHERE id='${row.budget_line_id}';`,
    );

    if (!APPLY) continue;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [allocResult] = await connection.execute(
        `UPDATE grn_cost_allocation
            SET lifecycle_status = 'consumed', consumed_at = NOW()
          WHERE id = ? AND lifecycle_status = 'reserved'`,
        [row.allocation_id],
      );
      if ((allocResult as { affectedRows: number }).affectedRows !== 1) {
        throw new Error(`allocation ${row.allocation_id} was not in 'reserved' at write time — refusing`);
      }
      // WHERE reserved_amount >= ? is the same defense as the pre-check above, applied again at
      // write time under the row lock this transaction already holds via the allocation UPDATE
      // — refuses rather than driving the line negative if it moved between the check and here.
      const [lineResult] = await connection.execute(
        `UPDATE finance_budget_line
            SET reserved_amount = reserved_amount - ?, consumed_amount = consumed_amount + ?
          WHERE id = ? AND reserved_amount >= ?`,
        [amount, amount, row.budget_line_id, amount],
      );
      if ((lineResult as { affectedRows: number }).affectedRows !== 1) {
        throw new Error(`budget line ${row.budget_line_id} no longer has enough reserved_amount — refusing`);
      }
      await connection.commit();
      applied += 1;
    } catch (error) {
      await connection.rollback();
      console.error(`  FAILED ${row.grn_number}: ${error instanceof Error ? error.message : error}`);
    } finally {
      connection.release();
    }
  }

  if (APPLY) {
    console.log(`\n${applied} of ${eligible.length} row(s) reclassified.`);
    console.log("\nRollback (paste to reverse):\n" + rollbackLines.join("\n"));
  } else {
    console.log("Nothing was written. Re-run with --apply once the above reads correctly.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("FAILED", error);
    process.exit(1);
  });
