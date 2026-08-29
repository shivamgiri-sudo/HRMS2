/**
 * Computes the missing cost-centre split for branch-level budget lines that already carry a
 * sharing driver.
 *
 * WHAT IS WRONG
 * -------------
 * A branch-level budget line (`planning_level = 'branch'`) is a cost nobody owns alone — rent,
 * electricity, the cafeteria, UPS maintenance — and the planner records HOW it should be shared by
 * choosing an allocation driver. `finance_budget_line_allocation` is where that choice becomes
 * per-cost-centre numbers, and it is what tells anyone whose budget a shared cost belongs to.
 *
 * On 2026-08-29, 100 of 103 branch-level lines — Rs 3.46 crore, 46% of the active branch budget —
 * had a driver recorded and NOTHING computed from it. Replayed read-only, 78 of those 100 compute
 * cleanly against today's data: the inputs were never the problem, nothing had ever asked. The
 * split was only ever written by a full budget save, and these lines had not been through one
 * since; the four other paths that change a line's amount left it behind entirely (now fixed by
 * `resyncLineAllocations`, which this script reuses so the two can never disagree).
 *
 * The consequence of leaving it: those lines belong to no cost centre, so the branch-wide GRN
 * headroom gate lets whichever cost centre bills first consume the whole pot, and no report can
 * answer "did this cost centre stay inside budget?" for any shared cost.
 *
 * WHAT THIS DOES, AND WHAT IT REFUSES TO DO
 * -----------------------------------------
 * For every branch-level line with no split, it runs the SAME computation a budget save runs and
 * writes the result. It changes no amount, no budget total, no line, and no GRN — a split is a
 * breakdown of a number that already exists, and every row it writes sums back to that number.
 *
 * It does not invent data. A line whose branch is missing driver values (19 of the 100), or a
 * manual split with no percentages recorded (3), is REPORTED and skipped. Those need a person to
 * fill in the monthly drivers or the percentages; guessing them would put a number on a cost
 * centre that nobody chose.
 *
 * SAFETY
 * ------
 *   --dry-run   (default) computes everything and writes nothing. Run this first.
 *   --apply     writes, one transaction per line, so a refusal on one line cannot half-apply
 *               another.
 *
 * Re-runnable: `replaceLineAllocations` deletes and rewrites a line's own split, so applying twice
 * produces the same rows. Reversible: `DELETE FROM finance_budget_line_allocation WHERE
 * budget_line_id IN (...)` restores the previous state exactly, because the previous state was
 * "no rows".
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { resyncLineAllocations } from "../src/modules/process-pnl/branch-budget-allocation.service.js";

const APPLY = process.argv.includes("--apply");
/** `created_by`/`updated_by` are char(36) — a user id column, not a free-text label. A readable
 *  string overflows it, and mysql2 reports that as ER_DATA_TOO_LONG. Fixed UUID so every row this
 *  script writes is identifiable as its work and re-running attributes them the same way. */
const ACTOR = "00000000-0000-4000-8000-0000000b1630";

async function main() {
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.head, l.sub_head, l.allocation_driver, l.gross_amount,
            h.budget_number, h.period_code, h.status AS header_status
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE l.planning_level = 'branch'
        AND NOT EXISTS (
              SELECT 1 FROM finance_budget_line_allocation a
               WHERE a.budget_line_id = l.id)
      ORDER BY h.period_code, h.budget_number, l.head, l.sub_head`
  );

  console.log(
    `${lines.length} branch-level line(s) carry a sharing driver with no split computed from it.`
  );
  console.log(APPLY ? "MODE: --apply, writing.\n" : "MODE: dry run, writing nothing. Pass --apply to write.\n");

  let written = 0;
  let skipped = 0;
  let money = 0;
  const reasons = new Map<string, string[]>();

  for (const line of lines as any[]) {
    const label = `${line.period_code} ${line.budget_number} — ${line.head}${line.sub_head ? ` / ${line.sub_head}` : ""}`;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await resyncLineAllocations(connection, String(line.id), ACTOR);
      if (result.status === "written") {
        written += 1;
        money += Number(line.gross_amount ?? 0);
        console.log(`  OK    ${label} → ${result.rows} cost centre(s)`);
        if (APPLY) await connection.commit();
        else await connection.rollback();
      } else {
        skipped += 1;
        const reason = result.reason ?? result.status;
        reasons.set(reason, [...(reasons.get(reason) ?? []), label]);
        await connection.rollback();
      }
    } catch (error) {
      skipped += 1;
      const message = error instanceof Error ? error.message : String(error);
      reasons.set("UNEXPECTED", [...(reasons.get("UNEXPECTED") ?? []), `${label}: ${message}`]);
      await connection.rollback();
    } finally {
      connection.release();
    }
  }

  console.log(`\n${written} line(s) ${APPLY ? "split" : "would split"} cleanly, covering Rs ${money.toFixed(2)}.`);
  if (skipped) {
    console.log(`${skipped} line(s) need a person before they can be split:`);
    for (const [reason, labels] of reasons) {
      console.log(`\n  ${reason} — ${labels.length} line(s)`);
      for (const label of labels.slice(0, 10)) console.log(`      ${label}`);
      if (labels.length > 10) console.log(`      ... and ${labels.length - 10} more`);
    }
    console.log(
      "\n  MONTHLY_DRIVER_MISSING   set the monthly driver for every active cost centre in that"
      + "\n                           branch (Branch Budget → Drivers), then re-run."
      + "\n  MANUAL_SPLIT_INCOMPLETE  the line was planned with a manual split and no percentages"
      + "\n                           were ever recorded. Open the budget and enter them."
    );
  }
  if (!APPLY && written) console.log("\nNothing was written. Re-run with --apply once the above reads correctly.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("FAILED", error);
    process.exit(1);
  });
