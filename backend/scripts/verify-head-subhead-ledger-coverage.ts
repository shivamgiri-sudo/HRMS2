/**
 * Pre-flight check for Journal Task 2 (grn-journal-posting.service.ts).
 *
 * postGrnApprovalJournalEntry() refuses (422 EXPENSE_LEDGER_NOT_FOUND) any GRN whose
 * head/sub_head text has no matching active finance_expense_sub_head_master row — correct
 * behaviour once Task 2 is live, since a wrong or missing ledger head is worse than a blocked
 * approval. But that refusal should never be the FIRST time a gap is discovered: this repo's own
 * finance-expense-head-master seed history shows head/sub_head text drifts from the master
 * (typos, renamed heads, legacy db_bill-imported values) are common, not rare.
 *
 * Run this BEFORE flipping Task 2's postGrnApprovalJournalEntry() call live (or after, as a
 * standing check) to find every head/sub_head combination currently in use on an ACTIVE budget
 * line — i.e. one a real GRN could still be raised and approved against — that would fail to
 * resolve. finance_expense_sub_head_master name matching is case-insensitive/trimmed, same as
 * the resolver itself, so this script's SQL mirrors resolveExpenseSubHeadAccountId() exactly
 * rather than approximating it.
 *
 * READ-ONLY. Reports gaps; fixing them (adding the missing ledger head, or correcting a budget
 * line's head/sub_head text to match an existing one) is a Finance decision, not this script's.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [gaps] = await conn.query<any[]>(
    `SELECT bl.head, bl.sub_head, COUNT(DISTINCT bl.id) AS budget_line_count,
            SUM(bl.gross_amount) AS total_approved_amount
       FROM finance_budget_line bl
       JOIN finance_budget_header bh ON bh.id = bl.budget_id
      WHERE bh.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM finance_expense_sub_head_master sh
          JOIN finance_expense_head_master h ON h.id = sh.head_id
          WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(bl.head))
            AND LOWER(TRIM(sh.sub_head_name)) = LOWER(TRIM(bl.sub_head))
            AND sh.active_status = 1 AND h.active_status = 1
        )
      GROUP BY bl.head, bl.sub_head
      ORDER BY total_approved_amount DESC`,
  );

  const [imprestFloat] = await conn.query<any[]>(
    `SELECT id FROM payable_account_master WHERE account_name = 'Imprest Float' AND active_status = 1`,
  );

  console.log(`\n=== Head/Sub-head ledger coverage check ===\n`);
  if ((gaps as any[]).length === 0) {
    console.log("No gaps — every active budget line's head/sub_head resolves to a ledger master row.");
  } else {
    console.log(`${(gaps as any[]).length} head/sub_head combination(s) on ACTIVE budget lines have no matching ledger head:\n`);
    for (const g of gaps as any[]) {
      console.log(`  "${g.head}" / "${g.sub_head}"  —  ${g.budget_line_count} budget line(s), Rs.${Number(g.total_approved_amount).toFixed(2)} approved`);
    }
    console.log(`\nAdd these to Finance → Ledger Heads (finance_expense_head_master / finance_expense_sub_head_master) — or correct the budget line's head/sub_head text to match an existing one — before enabling Journal Task 2's GRN posting for these lines.`);
  }

  console.log(`\n=== Imprest Float account check ===\n`);
  console.log((imprestFloat as any[]).length > 0 ? "OK — an active 'Imprest Float' row exists in payable_account_master." : "MISSING — imprest GRN approvals will refuse with IMPREST_FLOAT_ACCOUNT_NOT_FOUND until an active 'Imprest Float' row exists in payable_account_master.");

  await conn.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
