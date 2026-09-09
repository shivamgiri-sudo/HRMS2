import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Period lifecycle (Bank Reconciliation, Phase 4). close() enforces the classic reconciliation
 * formula — computed HRMS closing balance minus still-outstanding (unmatched, dated <= to_date)
 * entries must equal what the real bank statement says — and refuses with the exact difference
 * otherwise, so the accountant knows what to go investigate rather than being told "no" with no
 * number attached. reopen() refuses to reopen a period that a LATER period has already closed
 * over, because that would corrupt the forward opening-balance chain those later periods relied on.
 */

export class BankReconciliationPeriodError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const bankReconciliationPeriodService = {
  async create(bankAccountId: string, fromDate: string, toDate: string, actorUserId: string): Promise<{ id: string }> {
    const [[account]] = await db.execute<RowDataPacket[]>(`SELECT opening_balance FROM company_bank_account WHERE id = ?`, [bankAccountId]);
    const [[openPeriod]] = await db.execute<RowDataPacket[]>(`SELECT id FROM bank_reconciliation_period WHERE bank_account_id = ? AND status = 'open'`, [bankAccountId]);
    if (openPeriod) throw new BankReconciliationPeriodError("This account already has an open reconciliation period. Close it before starting a new one.");
    const id = randomUUID();
    await db.execute(
      `INSERT INTO bank_reconciliation_period (id, bank_account_id, from_date, to_date, opening_balance, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, bankAccountId, fromDate, toDate, Number(account?.opening_balance ?? 0), actorUserId],
    );
    return { id };
  },

  async close(periodId: string, statementClosingBalance: number, actorUserId: string): Promise<{ closed: true }> {
    const [[period]] = await db.execute<RowDataPacket[]>(`SELECT id, bank_account_id, to_date, status FROM bank_reconciliation_period WHERE id = ?`, [periodId]);
    if (!period) throw new BankReconciliationPeriodError("Reconciliation period not found.", 404);
    if (period.status !== "open") throw new BankReconciliationPeriodError("Period is not open.");

    const [[unmatched]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM bank_statement_line bsl JOIN bank_statement_import bsi ON bsi.id = bsl.import_id
        WHERE bsi.period_id = ? AND bsl.match_status = 'unmatched'`,
      [periodId],
    );
    if (Number(unmatched.cnt) > 0) throw new BankReconciliationPeriodError(`${unmatched.cnt} statement line(s) are still unmatched. Match or post them as adjustments before closing.`);

    const [[last]] = await db.execute<RowDataPacket[]>(
      `SELECT running_balance FROM bank_account_ledger_entry WHERE bank_account_id = ? AND entry_date <= ? ORDER BY entry_date DESC, created_at DESC, id DESC LIMIT 1`,
      [period.bank_account_id, period.to_date],
    );
    const computedClosingBalance = round2(Number(last?.running_balance ?? 0));

    const [[outstanding]] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(credit_amount - debit_amount), 0) AS total FROM bank_account_ledger_entry
        WHERE bank_account_id = ? AND entry_date <= ? AND matched_statement_line_id IS NULL`,
      [period.bank_account_id, period.to_date],
    );
    const outstandingTotal = round2(Number(outstanding.total));

    const expectedStatementBalance = round2(computedClosingBalance - outstandingTotal);
    const difference = round2(expectedStatementBalance - round2(statementClosingBalance));
    if (difference !== 0) {
      throw new BankReconciliationPeriodError(
        `Doesn't balance: HRMS says ₹${expectedStatementBalance} after outstanding items, statement says ₹${round2(statementClosingBalance)} — difference of ₹${Math.abs(difference)}.`,
      );
    }

    await db.execute(
      `UPDATE bank_reconciliation_period SET status = 'closed', statement_closing_balance = ?, computed_closing_balance = ?, outstanding_total = ?, closed_by = ?, closed_at = NOW() WHERE id = ?`,
      [round2(statementClosingBalance), computedClosingBalance, outstandingTotal, actorUserId, periodId],
    );
    await db.execute(
      `UPDATE bank_account_ledger_entry SET reconciliation_period_id = ?
        WHERE bank_account_id = ? AND entry_date <= ? AND matched_statement_line_id IS NOT NULL AND reconciliation_period_id IS NULL`,
      [periodId, period.bank_account_id, period.to_date],
    );
    await db.execute(
      `UPDATE company_bank_account SET opening_balance = ?, opening_balance_as_of = ? WHERE id = ?`,
      [round2(statementClosingBalance), period.to_date, period.bank_account_id],
    );
    await logSensitiveAction({
      actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_PERIOD_CLOSED", module_key: "FINANCE",
      entity_type: "bank_reconciliation_period", entity_id: periodId,
      change_summary: { computed_closing_balance: computedClosingBalance, outstanding_total: outstandingTotal, statement_closing_balance: round2(statementClosingBalance) },
    }).catch(() => undefined);
    return { closed: true };
  },

  async reopen(periodId: string, reason: string, actorUserId: string): Promise<void> {
    if (!reason || !reason.trim()) throw new BankReconciliationPeriodError("A reason is required to reopen a closed period.");
    const [[period]] = await db.execute<RowDataPacket[]>(`SELECT id, bank_account_id, to_date, status FROM bank_reconciliation_period WHERE id = ?`, [periodId]);
    if (!period) throw new BankReconciliationPeriodError("Reconciliation period not found.", 404);
    if (period.status !== "closed") throw new BankReconciliationPeriodError("Period is not closed.");

    const [laterClosed] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM bank_reconciliation_period WHERE bank_account_id = ? AND status = 'closed' AND from_date > ? LIMIT 1`,
      [period.bank_account_id, period.to_date],
    );
    if ((laterClosed as RowDataPacket[]).length > 0) {
      throw new BankReconciliationPeriodError("A later period for this account is already closed. Reopen that one first.");
    }

    await db.execute(`UPDATE bank_account_ledger_entry SET reconciliation_period_id = NULL WHERE reconciliation_period_id = ?`, [periodId]);
    await db.execute(
      `UPDATE bank_reconciliation_period SET status = 'open', reopened_by = ?, reopened_at = NOW(), reopen_reason = ? WHERE id = ?`,
      [actorUserId, reason.trim(), periodId],
    );
    await logSensitiveAction({
      actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_PERIOD_REOPENED", module_key: "FINANCE",
      entity_type: "bank_reconciliation_period", entity_id: periodId, change_summary: { reason: reason.trim() },
    }).catch(() => undefined);
  },
};
