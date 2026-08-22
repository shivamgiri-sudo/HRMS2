/**
 * Reverts the slice of remediate-grn-budget-linkage-full-fy.ts that should never have been
 * applied: budget headers created for periods AFTER the current month (2026-09 onward at the
 * time this was written). Creating an 'active' budget — implying real Finance planning — for a
 * month that hasn't happened yet, with its lines already marked 'consumed', fabricates both a
 * plan that was never made and spend that (from the budget's perspective) hasn't occurred yet.
 * The underlying GRN data is legitimate (grn-period-allocation.service.ts's real multi-month
 * cost-recognition feature — one bill split across several future accounting periods), but that
 * does not make it correct to pre-book budgets for those future months today.
 *
 * Reverts ONLY rows stamped with REMEDIATION_USER, and only headers whose period_code is
 * strictly after the cutoff — April through the cutoff month stay exactly as remediated.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");
const REMEDIATION_USER = "00000000-0000-0000-0000-budgetfix001";
/** Current month at the time of the original fix — everything strictly after this is reverted. */
const CUTOFF_PERIOD = "2026-08";

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  try {
    const [headers] = await conn.execute<any[]>(
      `SELECT id, branch_id, period_code, gross_budget_amount
         FROM finance_budget_header
        WHERE created_by = ? AND period_code > ?`,
      [REMEDIATION_USER, CUTOFF_PERIOD]
    );
    console.log(`Future-month headers to revert: ${headers.length}`);
    console.table(headers);

    if (!headers.length) { console.log("Nothing to revert."); return; }
    const headerIds = headers.map((h) => h.id);

    const [allocRows] = await conn.query<any[]>(
      `SELECT gca.id, gca.grn_request_id, gca.amount_with_tax
         FROM grn_cost_allocation gca
        WHERE gca.created_by = ? AND gca.budget_id IN (?)`,
      [REMEDIATION_USER, headerIds]
    );
    console.log(`grn_cost_allocation rows to delete: ${allocRows.length}, total ${allocRows.reduce((s, r) => s + Number(r.amount_with_tax), 0).toFixed(2)}`);

    const [lineRows] = await conn.query<any[]>(
      `SELECT id FROM finance_budget_line WHERE budget_id IN (?)`,
      [headerIds]
    );
    console.log(`finance_budget_line rows to delete: ${lineRows.length}`);

    if (!APPLY) { console.log("\nDRY RUN — nothing written. Pass --apply to write."); return; }

    await conn.beginTransaction();
    try {
      if (allocRows.length) {
        await conn.query(`DELETE FROM grn_cost_allocation WHERE id IN (?)`, [allocRows.map((r) => r.id)]);
      }
      if (lineRows.length) {
        await conn.query(`DELETE FROM finance_budget_line WHERE budget_id IN (?)`, [headerIds]);
      }
      await conn.query(`DELETE FROM finance_budget_header WHERE id IN (?)`, [headerIds]);
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
