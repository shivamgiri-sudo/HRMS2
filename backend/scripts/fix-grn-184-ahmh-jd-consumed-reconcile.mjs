/**
 * One-off follow-up to remediate-clean-match-wrong-period-linkage.ts (2026-09-02).
 *
 * That script refused to touch Mas/4/26/184's allocation (₹15,506.78, AHMEDABAD-JALDARSHAN
 * Tours/Local Conveyance, budget line c17fab9f-e6a6-445b-a045-d139e99eb84e) because subtracting
 * it in full would have driven consumed_amount negative.
 *
 * Root cause dug into and confirmed live: the original 2026-08-21 clean-match backfill inserted
 * FIVE grn_cost_allocation rows against this one line (184 + the 4 already reversed:
 * 175/197/45/46), all with lifecycle_status='consumed' — but only ever incremented the line's
 * own consumed_amount for 184. The other four's contribution was never actually reflected in the
 * stored figure. Proven by reconciling consumed_amount against its real backing rows: after the
 * first 4 were correctly removed, the line's remaining sole 'consumed' row (184, ₹15,506.78) is
 * MORE than the stored consumed_amount (₹14,548.78) — a ₹958.00 shortfall that pre-dates today's
 * work and was never caused by it; today's earlier reversal simply inherited it by trusting the
 * stored figure as ground truth instead of the actual backing rows.
 *
 * FIX: reconcile consumed_amount to the sum of its real 'consumed'-lifecycle backing rows once
 * 184 is removed (draft rows never count, by this system's own convention) — which is exactly
 * Rs.0.00, since every 'consumed' row this line ever had traces back to the same flawed backfill.
 * Then delete 184's allocation row, same treatment as the other 51.
 *
 * reserved_amount (Rs.811.86) is a SEPARATE, older anomaly — it has zero backing 'reserved' rows
 * on this line, but that predates and is unrelated to the clean-match backfill (none of the 5
 * rows here were ever 'reserved'). Deliberately NOT touched by this script — out of scope, flagged
 * for Finance separately.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const LINE_ID = "c17fab9f-e6a6-445b-a045-d139e99eb84e";
const ALLOCATION_ID = "1d9fff3c-d3c9-4595-bfec-ff5671e675aa";

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [lineRows] = await connection.execute(
      `SELECT id, consumed_amount FROM finance_budget_line WHERE id = ? FOR UPDATE`,
      [LINE_ID]
    );
    const line = lineRows[0];
    if (!line) throw new Error("budget line vanished");

    const [backingRows] = await connection.execute(
      `SELECT lifecycle_status, pnl_cost_amount FROM grn_cost_allocation WHERE budget_line_id = ? AND id <> ?`,
      [LINE_ID, ALLOCATION_ID]
    );
    const otherConsumed = backingRows
      .filter((r) => r.lifecycle_status === "consumed")
      .reduce((s, r) => s + Number(r.pnl_cost_amount), 0);
    const targetConsumed = Math.round((otherConsumed + Number.EPSILON) * 100) / 100;

    console.log(`Current consumed_amount: ${line.consumed_amount}`);
    console.log(`Real backing (excl. row 184, sum of other 'consumed' rows): ${targetConsumed}`);
    console.log(`${APPLY ? "APPLYING" : "WOULD APPLY"}: set consumed_amount = ${targetConsumed}, delete allocation ${ALLOCATION_ID}`);

    if (APPLY) {
      await connection.execute(
        `UPDATE finance_budget_line SET consumed_amount = ? WHERE id = ?`,
        [targetConsumed, LINE_ID]
      );
      await connection.execute(`DELETE FROM grn_cost_allocation WHERE id = ?`, [ALLOCATION_ID]);
      await connection.commit();
      console.log("APPLIED.");
    } else {
      await connection.rollback();
      console.log("DRY RUN — nothing written. Pass --apply to write.");
    }
  } catch (error) {
    await connection.rollback();
    console.error("FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
