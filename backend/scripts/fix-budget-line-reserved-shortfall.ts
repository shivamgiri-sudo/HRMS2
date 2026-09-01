/**
 * fix-budget-line-reserved-shortfall.ts
 *
 * ONE-TIME correction for a narrow, fully root-caused data issue found during a 2026-09-01
 * CEO-level self-review of the budget-cost-centre-utilization.service.ts tax-basis fix (commit
 * 45890035, branch fix/grn-variance-drilldown-and-remarks).
 *
 * THE ISSUE
 *   finance_budget_line.reserved_amount is a running counter, incremented by
 *   budgetConsumptionService.reserve() at Branch Head approval. It is supposed to equal the sum
 *   of that line's own grn_cost_allocation rows still in lifecycle_status = 'reserved'
 *   (pnl_cost_amount basis — see budget-cost-centre-utilization.service.ts's own comment).
 *
 *   System-wide scan (2026-09-01) found exactly 2 lines, both on budget 2f76428d, where the
 *   counter is LOWER than the allocation sum:
 *     - line 8d0e5faa (Repairs & Maintenance / R&M-Ups Networking Equipment): short Rs 4,275.00
 *     - line ed50e469 (Printing & Stationery / Office Stationery):            short Rs 387.00
 *   Total: Rs 4,662.00.
 *
 *   Traced as far as retrievable data allows: the allocation rows are correct (one GRN is
 *   is_multi_month=1; grn_period_allocation confirms it only spreads that SAME correct total's
 *   P&L RECOGNITION across months for reporting, never the reservation itself). Whatever wrote
 *   reserved_amount originally under-recorded it, for reasons with no surviving audit trail
 *   (both GRNs date to 2026-08-24/27, before this investigation). No reserve()/consume() call
 *   arguments survive to reconstruct why.
 *
 *   PRACTICAL EFFECT while unfixed: this budget's "available" figure reads Rs 4,662 HIGHER than
 *   it actually is — money that is already committed (both GRNs are branch_head_approved,
 *   awaiting Finance Head) looks available to commit again.
 *
 * WHAT THIS DOES
 *   For each of the 2 lines above ONLY (hard-coded — this is not a generalizable pattern; the
 *   system-wide scan that found them is reproduced in DRY-RUN mode below so a re-run can prove
 *   no other line needs the same fix before or after applying):
 *     UPDATE finance_budget_line SET reserved_amount = <allocation sum> WHERE id = <line>
 *       AND reserved_amount = <the exact value read this run>   -- concurrency guard
 *   Writes one sensitive_action_log row per line.
 *
 * NOT IN SCOPE (deliberately) — a separate, smaller, un-root-caused residual of Rs 4,970 across
 * 4 OTHER budgets' Consumed figures has NO identified common cause (see the same commit's
 * comment) and is NOT touched by this script. Correcting a discrepancy without a confirmed cause
 * risks masking a real problem instead of fixing one.
 *
 * USAGE
 *   npx ts-node backend/scripts/fix-budget-line-reserved-shortfall.ts           # dry-run
 *   npx ts-node backend/scripts/fix-budget-line-reserved-shortfall.ts --apply   # write
 *
 * SAFE TO RE-RUN — re-derives the correct value from grn_cost_allocation every run rather than
 * adding a fixed delta, and the WHERE clause's exact-value guard means a second --apply after a
 * successful first one finds affectedRows = 0 and reports "already correct", not a double-fix.
 */

import mysql from "mysql2/promise";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

const APPLY = process.argv.includes("--apply");
const ACTOR_ID = "00000000-0000-0000-0000-migration0003"; // sentinel for audit log, distinct from other fix-*.ts scripts' sentinels

const TARGET_LINE_IDS = [
  "8d0e5faa-26e7-48a7-9ba2-1a5caf1f33b8",
  "ed50e469-17b3-4ac0-a6bf-ec1897af0c23",
];

async function writeAudit(
  conn: mysql.Connection,
  lineId: string,
  fromAmount: number,
  toAmount: number,
) {
  await conn.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, actor_role, action_type, module_key,
        entity_type, entity_id, change_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      uuidv4(),
      ACTOR_ID,
      "migration_script",
      "BUDGET_LINE_RESERVED_SHORTFALL_CORRECTED",
      "FINANCE",
      "finance_budget_line",
      lineId,
      JSON.stringify({
        from_reserved_amount: fromAmount,
        to_reserved_amount: toAmount,
        reason: "reserved_amount undercounted relative to sum of its own 'reserved'-status "
          + "grn_cost_allocation.pnl_cost_amount rows — root-caused 2026-09-01, no surviving "
          + "audit trail for the original shortfall. See fix-budget-line-reserved-shortfall.ts.",
      }),
    ],
  );
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log("\n════════════════════════════════════════════════════════");
    console.log(" Budget Line Reserved-Amount Shortfall Correction");
    console.log("════════════════════════════════════════════════════════");
    console.log(` Mode: ${APPLY ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}\n`);

    // ── System-wide re-scan, every run — proves these 2 lines are still the only mismatch ──
    const [allLines] = await conn.query<any[]>(
      `SELECT id, budget_id, head, sub_head, reserved_amount FROM finance_budget_line WHERE reserved_amount > 0`,
    );
    const [allAlloc] = await conn.query<any[]>(
      `SELECT budget_line_id, SUM(pnl_cost_amount) AS alloc_sum
         FROM grn_cost_allocation WHERE lifecycle_status = 'reserved' GROUP BY budget_line_id`,
    );
    const allocByLine = new Map<string, number>(allAlloc.map((r) => [String(r.budget_line_id), Number(r.alloc_sum)]));
    const mismatches = allLines
      .map((l) => ({ ...l, allocSum: allocByLine.get(String(l.id)) ?? 0 }))
      .filter((l) => Math.abs(Number(l.reserved_amount) - l.allocSum) > 0.01);

    console.log(` System-wide scan: ${mismatches.length} line(s) with reserved_amount != allocation sum`);
    for (const m of mismatches) {
      const inScope = TARGET_LINE_IDS.includes(String(m.id));
      console.log(
        `   ${String(m.id).slice(0, 8)} (${m.head} / ${m.sub_head}) line=${m.reserved_amount} `
        + `allocSum=${m.allocSum.toFixed(2)} diff=${(Number(m.reserved_amount) - m.allocSum).toFixed(2)} `
        + (inScope ? "[IN SCOPE for this script]" : "[NOT touched — see script header, no confirmed cause]"),
      );
    }
    const unexpected = mismatches.filter((m) => !TARGET_LINE_IDS.includes(String(m.id)) && m.allocSum > 0);
    if (unexpected.length) {
      console.log(
        `\n ⚠  ${unexpected.length} mismatch(es) found OUTSIDE this script's hard-coded target list `
        + `that also have a nonzero allocation sum (the "shortfall" shape, not the already-shipped `
        + `"simple GRN fallback" shape). Investigate before relying on this script alone.`,
      );
    }

    console.log("\n Targeted lines for this correction:");
    for (const lineId of TARGET_LINE_IDS) {
      const line = allLines.find((l: any) => String(l.id) === lineId);
      if (!line) {
        console.log(`   SKIP ${lineId}: not found or reserved_amount is now 0 (already resolved?)`);
        continue;
      }
      const correctAmount = Math.round((allocByLine.get(lineId) ?? 0) * 100) / 100;
      const currentAmount = Number(line.reserved_amount);
      console.log(
        `   ${lineId} (${line.head} / ${line.sub_head}): current=${currentAmount} -> correct=${correctAmount}`,
      );

      if (Math.abs(currentAmount - correctAmount) < 0.01) {
        console.log(`     → Already correct. Nothing to do.`);
        continue;
      }

      if (!APPLY) {
        console.log(`     → Would UPDATE reserved_amount to ${correctAmount}`);
        continue;
      }

      const [result] = await conn.execute<any>(
        `UPDATE finance_budget_line SET reserved_amount = ? WHERE id = ? AND reserved_amount = ?`,
        [correctAmount, lineId, currentAmount],
      );
      if (result.affectedRows !== 1) {
        console.log(`     → SKIPPED: reserved_amount changed concurrently since this run started. Re-run the script.`);
        continue;
      }
      await writeAudit(conn, lineId, currentAmount, correctAmount);
      console.log(`     → CORRECTED: ${currentAmount} -> ${correctAmount}`);
    }

    if (!APPLY) {
      console.log("\n DRY RUN complete — nothing written. Re-run with --apply to execute.\n");
    } else {
      console.log("\n Apply complete.\n");
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFIX FAILED:", err.message ?? err);
  process.exit(1);
});
