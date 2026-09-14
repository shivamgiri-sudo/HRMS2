/**
 * Standing reconciliation check: does every finance_budget_line's reserved_amount/consumed_amount
 * actually equal the sum of its real backing grn_cost_allocation rows?
 *
 * WHY THIS EXISTS. Every drift found on 2026-09-02 (52 period-mismatched GRN allocations; an
 * orphaned reserved_amount on AHMEDABAD-JALDARSHAN's August Local Conveyance line with zero
 * backing rows; three more AHMEDABAD-JALDARSHAN lines under-stating real consumed spend) traced
 * back to the SAME root cause: one-off backfill/remediation scripts
 * (backfill-grn-cost-allocation-clean-match.ts, remediate-grn-budget-linkage-full-fy.ts,
 * remediate-residual-grn-cost-allocation-2026-08.ts, and this file's own earlier one-off fixes)
 * each wrote raw arithmetic UPDATEs against finance_budget_line.reserved_amount/consumed_amount
 * directly, with no shared invariant check that the aggregate still equalled the sum of its real
 * grn_cost_allocation rows afterward. budget-consumption.service.ts's own reserve/consume/release
 * triad IS symmetric and correct for the live app's day-to-day GRN flow — every drift found so far
 * came from a script bypassing that service to record historical/migrated spend directly, not from
 * a bug in the live reserve→consume→release cycle itself.
 *
 * This script is the guard rail: run it any time (read-only by default) to catch the next drift
 * immediately, from whatever future script or manual correction causes it, rather than discovering
 * it three GRNs deep in an unrelated support question. ANY new one-off script that writes
 * finance_budget_line directly should be run through this checker afterward as a matter of course.
 *
 * DRY RUN BY DEFAULT: reports drift only. Pass --apply to reconcile every drifted line's
 * reserved_amount/consumed_amount to the sum of its real backing rows (the same "trust the actual
 * allocation rows over the stored aggregate" fix applied by hand three times on 2026-09-02).
 * Deliberately does NOT touch gross_amount — if reconciling consumed/reserved would leave a line
 * showing negative available (spend exceeding its own approved gross_amount), that is reported,
 * not silently fixed by inflating the approved budget. Whether to raise a line's gross_amount is a
 * Finance decision, never this script's to make.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

function money(v: number) {
  return `Rs.${(Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2)}`;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [lines] = await conn.query<any[]>(
    `SELECT bl.id, bl.gross_amount, bl.reserved_amount, bl.consumed_amount,
            bm.branch_name, bh.period_code, bl.head, bl.sub_head
       FROM finance_budget_line bl
       JOIN finance_budget_header bh ON bh.id = bl.budget_id
       JOIN branch_master bm ON bm.id = bh.branch_id`
  );

  const [sums] = await conn.query<any[]>(
    `SELECT budget_line_id,
            SUM(CASE WHEN lifecycle_status='reserved' THEN pnl_cost_amount ELSE 0 END) AS real_reserved,
            SUM(CASE WHEN lifecycle_status='consumed' THEN pnl_cost_amount ELSE 0 END) AS real_consumed
       FROM grn_cost_allocation
      WHERE budget_line_id IS NOT NULL
      GROUP BY budget_line_id`
  );
  const backingMap = new Map(sums.map((r) => [r.budget_line_id, r]));

  console.log(`Scanning ${lines.length} budget line(s)...\n`);

  let drifted = 0;
  let overGross = 0;

  for (const line of lines) {
    const backing = backingMap.get(line.id) ?? { real_reserved: 0, real_consumed: 0 };
    const realReserved = Number(backing.real_reserved);
    const realConsumed = Number(backing.real_consumed);
    const rDiff = Math.round((Number(line.reserved_amount) - realReserved) * 100) / 100;
    const cDiff = Math.round((Number(line.consumed_amount) - realConsumed) * 100) / 100;
    if (Math.abs(rDiff) < 0.01 && Math.abs(cDiff) < 0.01) continue;

    drifted++;
    const label = `${line.branch_name} / ${line.period_code} / ${line.head}${line.sub_head ? "/" + line.sub_head : ""}`;
    const availableAfter = Number(line.gross_amount) - realReserved - realConsumed;
    const flag = availableAfter < -0.01 ? "  ⚠ would show NEGATIVE available — Finance review needed, gross_amount not raised" : "";
    if (availableAfter < -0.01) overGross++;

    console.log(`${APPLY ? "FIXING " : "DRIFTED"}  ${label}`);
    console.log(`  reserved: stored=${money(Number(line.reserved_amount))} real=${money(realReserved)} (diff ${money(rDiff)})`);
    console.log(`  consumed: stored=${money(Number(line.consumed_amount))} real=${money(realConsumed)} (diff ${money(cDiff)})${flag}`);

    if (APPLY) {
      await conn.execute(
        `UPDATE finance_budget_line SET reserved_amount = ?, consumed_amount = ? WHERE id = ?`,
        [realReserved, realConsumed, line.id]
      );
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  ${drifted} line(s) drifted${APPLY ? ", reconciled to real backing rows" : ""}.`);
  console.log(`  ${overGross} line(s) now show real spend exceeding their own gross_amount — flagged for Finance, not auto-corrected.`);
  console.log(APPLY ? "\nAPPLIED." : "\nDRY RUN — pass --apply to write.");

  await conn.end();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
