/**
 * Standing reconciliation for Journal Task 2: does every GRN that HAS a journal entry post the
 * exact same gross amount postGrnApprovalJournalEntry() was given — i.e. the same figure
 * budgetConsumptionService.consume() itself used? And separately: how many already-approved
 * GRNs have NO journal entry yet, because they were approved before Task 2 went live (expected,
 * and exactly what Phase 6's backfill — journal-task-3-report.md's "Next task" — is for)?
 *
 * This mirrors verify-budget-line-money-ledger-parity.ts's own shape and reasoning: a dual-write
 * period (budget_consumption + journal both recording the same event) needs a standing check
 * that the two never silently disagree, same as that script's own header explains for
 * finance_budget_line vs grn_cost_allocation.
 *
 * READ-ONLY. Run any time; run it specifically right after Task 2 first goes live, and again
 * after Phase 6's historical backfill runs.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

function money(v: number) {
  return `Rs.${(Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2)}`;
}

const CONSUMED_STATUSES = ["pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved"];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const placeholders = CONSUMED_STATUSES.map(() => "?").join(",");

  // GRNs approved but with no journal entry at all — expected for anything approved before
  // Task 2 went live; a growing number AFTER go-live means the wiring stopped firing.
  const [missing] = await conn.query<any[]>(
    `SELECT COUNT(*) AS cnt, MIN(g.finance_head_reviewed_at) AS earliest, MAX(g.finance_head_reviewed_at) AS latest
       FROM grn_request g
      WHERE g.status IN (${placeholders})
        AND NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type = 'grn' AND je.source_id = g.id)`,
    CONSUMED_STATUSES,
  );

  // GRNs that DO have a journal entry — check the entry's expense-line debit total matches the
  // GRN's own gross figure, to the paisa.
  const [mismatches] = await conn.query<any[]>(
    `SELECT g.id, g.grn_number, g.amount, g.amount_with_tax,
            COALESCE(SUM(jel.debit_amount), 0) AS journal_debit_total
       FROM grn_request g
       JOIN journal_entry je ON je.source_type = 'grn' AND je.source_id = g.id AND je.reversed_by_entry_id IS NULL
       JOIN journal_entry_line jel ON jel.journal_entry_id = je.id AND jel.account_type = 'expense_sub_head'
      WHERE g.status IN (${placeholders})
      GROUP BY g.id, g.grn_number, g.amount, g.amount_with_tax
     HAVING ROUND(COALESCE(g.amount_with_tax, g.amount), 2) <> ROUND(journal_debit_total, 2)`,
    CONSUMED_STATUSES,
  );

  console.log(`\n=== GRNs with no journal entry (pre-Task-2 history, or wiring not firing) ===\n`);
  const m = (missing as any[])[0];
  console.log(m.cnt === 0 ? "None — every approved GRN in scope has a journal entry." : `${m.cnt} GRN(s), finance_head_reviewed_at between ${m.earliest} and ${m.latest}.`);

  console.log(`\n=== GRNs where the journal's expense debit total disagrees with the GRN's own gross amount ===\n`);
  if ((mismatches as any[]).length === 0) {
    console.log("None — every GRN with a journal entry posts the exact gross amount.");
  } else {
    console.log(`${(mismatches as any[]).length} mismatch(es):\n`);
    for (const r of mismatches as any[]) {
      console.log(`  ${r.grn_number ?? r.id}: GRN gross ${money(Number(r.amount_with_tax || r.amount))} vs journal debit ${money(Number(r.journal_debit_total))}`);
    }
  }

  await conn.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
