import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Matching engine (Bank Reconciliation, Phase 4). Three ways a bank_statement_line resolves:
 *   1. autoMatch()      — exact amount, one candidate within the date window. Automatic.
 *   2. manualMatch()    — user picks the pair when auto-match found 0 or >1 candidates.
 *   3. postAdjustment() — the bank shows something HRMS never recorded (charges, interest);
 *      a brand-new bank_account_ledger_entry is posted, same balance discipline as
 *      payment-voucher.service.ts's release().
 * Amounts are never fuzzy-matched — a mismatch is a real discrepancy the accountant must see,
 * not something this engine guesses past.
 */

const MATCH_WINDOW_DAYS = 15;

export class BankReconciliationMatchError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

async function findCandidates(bankAccountId: string, txnDate: string, debit: number, credit: number) {
  const amountClause = debit > 0 ? "bale.debit_amount = ?" : "bale.credit_amount = ?";
  const amountParam = debit > 0 ? debit : credit;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bale.id, bale.entry_date FROM bank_account_ledger_entry bale
      WHERE bale.bank_account_id = ? AND bale.matched_statement_line_id IS NULL AND ${amountClause}`,
    [bankAccountId, amountParam],
  );
  return (rows as RowDataPacket[]).filter((r) => daysBetween(String(r.entry_date).slice(0, 10), txnDate) <= MATCH_WINDOW_DAYS);
}

async function linkLine(statementLineId: string, ledgerEntryId: string) {
  await db.execute(`UPDATE bank_statement_line SET match_status = 'matched', matched_ledger_entry_id = ? WHERE id = ?`, [ledgerEntryId, statementLineId]);
  await db.execute(`UPDATE bank_account_ledger_entry SET matched_statement_line_id = ? WHERE id = ?`, [statementLineId, ledgerEntryId]);
}

export const bankReconciliationMatchService = {
  async autoMatch(importId: string): Promise<{ matchedCount: number; unmatchedCount: number }> {
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT bsl.id, bsl.txn_date, bsl.debit_amount, bsl.credit_amount, bsi.bank_account_id
         FROM bank_statement_line bsl
         JOIN bank_statement_import bsi ON bsi.id = bsl.import_id
        WHERE bsl.import_id = ? AND bsl.match_status = 'unmatched'`,
      [importId],
    );
    let matchedCount = 0;
    let unmatchedCount = 0;
    for (const line of lines as RowDataPacket[]) {
      const candidates = await findCandidates(String(line.bank_account_id), String(line.txn_date).slice(0, 10), Number(line.debit_amount), Number(line.credit_amount));
      if (candidates.length === 1) {
        await linkLine(String(line.id), String(candidates[0].id));
        matchedCount++;
      } else {
        unmatchedCount++;
      }
    }
    return { matchedCount, unmatchedCount };
  },

  async manualMatch(statementLineId: string, ledgerEntryId: string, actorUserId: string): Promise<void> {
    const [[line]] = await db.execute<RowDataPacket[]>(`SELECT id, debit_amount, credit_amount, match_status FROM bank_statement_line WHERE id = ?`, [statementLineId]);
    if (!line) throw new BankReconciliationMatchError("Statement line not found.", 404);
    if (line.match_status !== "unmatched") throw new BankReconciliationMatchError("Statement line is already resolved.");
    const [[entry]] = await db.execute<RowDataPacket[]>(`SELECT id, debit_amount, credit_amount FROM bank_account_ledger_entry WHERE id = ?`, [ledgerEntryId]);
    if (!entry) throw new BankReconciliationMatchError("Ledger entry not found.", 404);
    const lineAmount = Number(line.debit_amount) > 0 ? Number(line.debit_amount) : Number(line.credit_amount);
    const entryAmount = Number(line.debit_amount) > 0 ? Number(entry.debit_amount) : Number(entry.credit_amount);
    if (lineAmount !== entryAmount) throw new BankReconciliationMatchError(`Amounts don't match: statement ₹${lineAmount} vs ledger ₹${entryAmount}.`);
    await linkLine(statementLineId, ledgerEntryId);
    await logSensitiveAction({ actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_MANUAL_MATCH", module_key: "FINANCE", entity_type: "bank_statement_line", entity_id: statementLineId, change_summary: { ledger_entry_id: ledgerEntryId } }).catch(() => undefined);
  },

  async unmatch(statementLineId: string, actorUserId: string): Promise<void> {
    const [[line]] = await db.execute<RowDataPacket[]>(`SELECT matched_ledger_entry_id FROM bank_statement_line WHERE id = ?`, [statementLineId]);
    if (!line?.matched_ledger_entry_id) throw new BankReconciliationMatchError("Statement line has no match to undo.");
    await db.execute(`UPDATE bank_account_ledger_entry SET matched_statement_line_id = NULL WHERE id = ?`, [line.matched_ledger_entry_id]);
    await db.execute(`UPDATE bank_statement_line SET match_status = 'unmatched', matched_ledger_entry_id = NULL WHERE id = ?`, [statementLineId]);
    await logSensitiveAction({ actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_UNMATCH", module_key: "FINANCE", entity_type: "bank_statement_line", entity_id: statementLineId }).catch(() => undefined);
  },

  async postAdjustment(input: { statementLineId: string; bankAccountId: string; payableAccountId: string; narration: string; actorUserId: string }): Promise<{ ledgerEntryId: string }> {
    const [[line]] = await db.execute<RowDataPacket[]>(`SELECT id, txn_date, description, debit_amount, credit_amount, match_status FROM bank_statement_line WHERE id = ?`, [input.statementLineId]);
    if (!line) throw new BankReconciliationMatchError("Statement line not found.", 404);
    if (line.match_status !== "unmatched") throw new BankReconciliationMatchError("Statement line is already resolved.");

    // Same discipline as payment-voucher.service.ts's release(): lock the account row, read the
    // last running_balance, compute the new one, insert. FOR UPDATE serializes concurrent posts.
    await db.execute(`SELECT id FROM company_bank_account WHERE id = ? FOR UPDATE`, [input.bankAccountId]);
    const [[last]] = await db.execute<RowDataPacket[]>(
      `SELECT running_balance FROM bank_account_ledger_entry WHERE bank_account_id = ? ORDER BY entry_date DESC, created_at DESC, id DESC LIMIT 1`,
      [input.bankAccountId],
    );
    const priorBalance = Number(last?.running_balance ?? 0);
    const debit = Number(line.debit_amount);
    const credit = Number(line.credit_amount);
    const newBalance = priorBalance + credit - debit; // debit reduces bank balance, credit increases it

    const ledgerEntryId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO bank_account_ledger_entry
         (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount, payable_account_id, narration, running_balance, source_type, created_by, matched_statement_line_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ledgerEntryId, input.bankAccountId, line.txn_date, debit, credit, input.payableAccountId, input.narration, newBalance, "reconciliation_adjustment", input.actorUserId, input.statementLineId],
    );
    await db.execute(`UPDATE bank_statement_line SET match_status = 'adjusted', matched_ledger_entry_id = ? WHERE id = ?`, [ledgerEntryId, input.statementLineId]);
    await logSensitiveAction({
      actor_user_id: input.actorUserId, action_type: "BANK_RECONCILIATION_ADJUSTMENT_POSTED", module_key: "FINANCE",
      entity_type: "bank_account_ledger_entry", entity_id: ledgerEntryId,
      change_summary: { statement_line_id: input.statementLineId, debit, credit, narration: input.narration },
    }).catch(() => undefined);
    return { ledgerEntryId };
  },
};
