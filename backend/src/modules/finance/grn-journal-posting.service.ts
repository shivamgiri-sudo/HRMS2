import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { refuse } from "../process-pnl/finance-error.js";
import { journalService } from "./journal.service.js";

/**
 * Wires GRN Finance-Head approval to the journal engine (journal.service.ts). Kept in its own
 * file rather than inlined into grn.service.ts — that file is already large, and every other
 * GRN side-concern in this codebase (notifications, LOB attribution, number assignment) already
 * lives in its own grn-*.ts file called from the one approval path in grn.service.ts.
 *
 * WHAT THIS POSTS
 *   vendor GRN:  Dr  Expense: <head>:<sub_head>     Cr  Sundry Creditors: <vendor>
 *   imprest GRN: Dr  Expense: <head>:<sub_head>     Cr  Imprest Float (payable_account_master)
 * Both at gross (amount_with_tax || amount) — the exact figure budgetConsumptionService.consume()
 * itself uses, so the journal and the budget ledger post identical amounts from the same
 * approval call. verify-grn-journal-parity.ts (backend/scripts) checks the two agree.
 *
 * WHY grn_request.head/sub_head (free text) INSTEAD OF A NUMERIC FK
 * grn_request and finance_budget_line both carry head/sub_head as VARCHAR, not as an FK to
 * finance_expense_sub_head_master — that master table (412_finance_expense_head_master.sql) was
 * added later, for tax-treatment defaults, and nothing in the budget/GRN write path was ever
 * migrated onto it. This function is the first thing that needs head_id/sub_head_id genuinely
 * *resolved*, not just displayed — so it does the text match here (case-insensitive, head+sub_head
 * together, since sub_head_name is only unique WITHIN a head) rather than pretending an id
 * column exists that doesn't.
 *
 * WHAT HAPPENS WHEN A NAME DOESN'T MATCH
 * Refuses (422 EXPENSE_LEDGER_NOT_FOUND) rather than posting to a guessed or generic account —
 * a wrong ledger head is worse than a blocked approval, and this refusal happens INSIDE the same
 * transaction budgetConsumptionService.consume() just ran in, so the whole approval rolls back
 * cleanly rather than leaving budget consumed with no journal entry behind it. Before this path
 * is enabled in production, run backend/scripts/verify-head-subhead-ledger-coverage.ts against
 * every head/sub_head combination in currently-active budget lines to find gaps ahead of time,
 * not at the moment someone is trying to approve a real GRN.
 */

async function resolveExpenseSubHeadAccountId(connection: PoolConnection, head: string, subHead: string): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT sh.id
       FROM finance_expense_sub_head_master sh
       JOIN finance_expense_head_master h ON h.id = sh.head_id
      WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(?))
        AND LOWER(TRIM(sh.sub_head_name)) = LOWER(TRIM(?))
        AND sh.active_status = 1 AND h.active_status = 1
      LIMIT 1`,
    [head, subHead],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) {
    throw refuse(
      422,
      "EXPENSE_LEDGER_NOT_FOUND",
      `No active ledger head found for "${head} / ${subHead}". Add it in Finance → Ledger Heads before this GRN can be approved.`,
    );
  }
  return String(row.id);
}

async function resolveImprestFloatAccountId(connection: PoolConnection): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM payable_account_master WHERE account_name = 'Imprest Float' AND active_status = 1 LIMIT 1`,
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) {
    throw refuse(422, "IMPREST_FLOAT_ACCOUNT_NOT_FOUND", `The "Imprest Float" ledger head is missing or inactive.`);
  }
  return String(row.id);
}

export type GrnForJournalPosting = {
  id: string;
  grn_type: "vendor" | "imprest";
  grn_number: string | null;
  head: string;
  sub_head: string;
  vendor_id: string | null;
  amount: number | string;
  amount_with_tax: number | string | null;
  branch_id?: string | null;
  cost_centre_id?: string | null;
  process_id?: string | null;
};

export async function postGrnApprovalJournalEntry(
  connection: PoolConnection,
  grn: GrnForJournalPosting,
  actorUserId: string,
  /**
   * Defaults to today, correct for the live approval path this function's own name describes.
   * The Phase 6 backfill (backend/scripts/backfill-journal-entries.ts) is the one other caller,
   * and MUST pass the GRN's own historical approval date here — leaving this at its default for
   * a backfill would stamp every one of thousands of historical entries with the backfill run's
   * date instead of when the money actually moved, corrupting the Trial Balance's date view.
   * Live-caught 2026-09-17 before the backfill ran, not after.
   */
  entryDate: string = new Date().toISOString().slice(0, 10),
): Promise<{ journalEntryId: string }> {
  const grossAmount = Number(grn.amount_with_tax || grn.amount);
  const expenseAccountId = await resolveExpenseSubHeadAccountId(connection, grn.head, grn.sub_head);

  const creditLine =
    grn.grn_type === "vendor"
      ? (() => {
          if (!grn.vendor_id) {
            throw refuse(422, "GRN_VENDOR_MISSING", `Vendor GRN ${grn.grn_number ?? grn.id} has no vendor_id — cannot determine the creditor.`);
          }
          return { accountType: "vendor" as const, accountId: grn.vendor_id };
        })()
      : { accountType: "payable_account" as const, accountId: await resolveImprestFloatAccountId(connection) };

  return journalService.post(connection, {
    entryDate,
    narration: `GRN ${grn.grn_number ?? grn.id} approved — ${grn.head} / ${grn.sub_head}`,
    sourceType: "grn",
    sourceId: grn.id,
    postedBy: actorUserId,
    branchId: grn.branch_id ?? null,
    costCentreId: grn.cost_centre_id ?? null,
    processId: grn.process_id ?? null,
    lines: [
      { accountType: "expense_sub_head", accountId: expenseAccountId, debitAmount: grossAmount },
      { accountType: creditLine.accountType, accountId: creditLine.accountId, creditAmount: grossAmount },
    ],
  });
}
