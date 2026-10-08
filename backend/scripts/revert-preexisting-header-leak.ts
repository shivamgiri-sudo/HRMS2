/**
 * Second, narrower revert. The first revert (revert-future-month-budget-fabrication.ts) only
 * caught finance_budget_header rows created_by=REMEDIATION_USER — it missed ONE case where the
 * remediation reused a PRE-EXISTING, real, human-planned draft header (finance_budget_header has
 * no created_by-equivalent on finance_budget_line, so the earlier script had no way to filter
 * this by header ownership) and added ONE new line + 2 GRN allocations into it, marking part of
 * a real branch's future-month planning as already 'consumed' before that month started —
 * exactly the same mistake as the first revert, just hiding inside someone else's header.
 *
 * Confirmed via investigation (not assumed): header 59cce16e... (febd8777, period 2026-09,
 * status='draft', created_by='a4a4902e...') has 60 lines; 59 of them were created 2026-08-19,
 * untouched (reserved=consumed=0) — real native planning. Exactly ONE line
 * (f4d05439..., Communication & Connectivity / Company Owned Data, gross=70013.34) was created
 * by this remediation and has ONLY this remediation's 2 allocation rows against it — safe to
 * delete outright, not just zero its consumed_amount.
 *
 * Also corrects the header's own base/tax/gross/pnl totals, which the original remediation
 * inflated by exactly this line's contribution when it (correctly, by its own logic) added the
 * new line's amounts to the header's running total — but should never have touched a header it
 * did not create.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");
const REMEDIATION_USER = "00000000-0000-0000-0000-budgetfix001";

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  try {
    // Find every line, in a PRE-EXISTING header for a FUTURE month, whose ONLY allocations are
    // this remediation's. Scoped to period_code > cutoff on purpose: a line added into an
    // existing header for the CURRENT month (2026-08) is exactly the intended fix — real,
    // already-existing August budgets correctly getting new lines for real August spend — and
    // must not be touched. Only future-month additions are the leak.
    const CUTOFF_PERIOD = "2026-08";
    const [leakLines] = await conn.query<any[]>(`
      SELECT l.id AS line_id, l.budget_id, l.base_amount, l.tax_amount, l.gross_amount,
             l.recoverable_tax_amount, l.pnl_cost_amount, l.cgst_amount, l.sgst_amount, l.igst_amount,
             h.period_code, h.created_by AS header_owner
        FROM finance_budget_line l
        JOIN finance_budget_header h ON h.id = l.budget_id
       WHERE h.created_by <> ? AND h.period_code > ?
         AND EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.budget_line_id = l.id AND gca.created_by = ?)
         AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.budget_line_id = l.id AND gca.created_by <> ?)
    `, [REMEDIATION_USER, CUTOFF_PERIOD, REMEDIATION_USER, REMEDIATION_USER]);
    console.log(`Lines fully owned by this remediation but living in someone else's header: ${leakLines.length}`);
    console.table(leakLines);

    if (!leakLines.length) { console.log("Nothing to revert."); return; }

    const lineIds = leakLines.map((l) => l.line_id);
    const [allocRows] = await conn.query<any[]>(
      `SELECT id, amount_with_tax FROM grn_cost_allocation WHERE budget_line_id IN (?) AND created_by = ?`,
      [lineIds, REMEDIATION_USER]
    );
    console.log(`Allocation rows to delete: ${allocRows.length}, total ${allocRows.reduce((s, r) => s + Number(r.amount_with_tax), 0).toFixed(2)}`);

    if (!APPLY) { console.log("\nDRY RUN — nothing written. Pass --apply to write."); return; }

    await conn.beginTransaction();
    try {
      await conn.query(`DELETE FROM grn_cost_allocation WHERE id IN (?)`, [allocRows.map((r) => r.id)]);
      for (const l of leakLines) {
        await conn.execute(
          `UPDATE finance_budget_header
              SET base_budget_amount = base_budget_amount - ?,
                  tax_budget_amount = tax_budget_amount - ?,
                  gross_budget_amount = gross_budget_amount - ?,
                  pnl_budget_amount = pnl_budget_amount - ?
            WHERE id = ?`,
          [l.base_amount, l.tax_amount, l.gross_amount, l.pnl_cost_amount, l.budget_id]
        );
      }
      await conn.query(`DELETE FROM finance_budget_line WHERE id IN (?)`, [lineIds]);
      await conn.commit();
      console.log("\nREVERTED.");
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
