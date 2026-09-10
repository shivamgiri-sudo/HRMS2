import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/** Structurally matches both `db` (../../db/mysql.js's own wrapper, not a raw mysql2 Pool) and a
 *  `PoolConnection` mid-transaction — every call site passes one or the other. */
type Executor = {
  execute(sql: string, params?: any[]): Promise<[any, any]>;
};

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

/**
 * Guards every bank_account_ledger_entry insert site (9 of them, across
 * payment-voucher.service.ts, vendor-payment-ledger.service.ts, imprest.service.ts and
 * bank-reconciliation-match.service.ts) against posting into an account's already-closed books.
 *
 * A closed period's computed_closing_balance/outstanding_total were derived from exactly the
 * ledger rows with entry_date <= to_date at close() time (see close() above). A later insert
 * with an entry_date inside that same window would silently change what those already-stamped
 * numbers should have been, with nothing to flag the mismatch — the period would go on reporting
 * a closing balance that no longer matches its own ledger.
 *
 * Deliberately no lower bound (no "and entry_date >= from_date"): close()'s own closing-balance
 * query (entry_date <= to_date) and reopen()'s own "is a later period closed" check
 * (from_date > this period's to_date) both treat "closed coverage" for an account as everything
 * up to and including to_date, with no floor — an entry dated before from_date but still
 * <= to_date would corrupt the same already-computed totals just as much as one dated inside
 * [from_date, to_date]. Matches close()'s exact boundary (<=) so this guard and close() can never
 * disagree about what "in this closed period" means.
 *
 * Picks the latest closed period covering the date (ORDER BY to_date DESC) purely for the error
 * message — the most recent close is the most useful date to show. accepts db or a connection
 * already inside a transaction, so every call site can pass whichever it already has.
 */
export async function assertNotInClosedPeriod(
  executor: Executor,
  bankAccountId: string,
  entryDate: string,
): Promise<void> {
  const [[closed]] = (await executor.execute(
    `SELECT id, to_date FROM bank_reconciliation_period
      WHERE bank_account_id = ? AND status = 'closed' AND ? <= to_date
      ORDER BY to_date DESC LIMIT 1`,
    [bankAccountId, entryDate],
  )) as [RowDataPacket[], unknown];
  if (closed) {
    throw new BankReconciliationPeriodError(
      `This account's books are closed through ${String((closed as any).to_date).slice(0, 10)}. ` +
      `Entries dated on or before that cannot be posted; reopen the period first.`,
      409,
    );
  }
}

export const bankReconciliationPeriodService = {
  async create(bankAccountId: string, fromDate: string, toDate: string, actorUserId: string): Promise<{ id: string }> {
    const [[account]] = await db.execute<RowDataPacket[]>(`SELECT opening_balance FROM company_bank_account WHERE id = ?`, [bankAccountId]);
    const [[openPeriod]] = await db.execute<RowDataPacket[]>(`SELECT id FROM bank_reconciliation_period WHERE bank_account_id = ? AND status = 'open'`, [bankAccountId]);
    if (openPeriod) throw new BankReconciliationPeriodError("This account already has an open reconciliation period. Close it before starting a new one.");

    // The open-period check above only ever stops a SECOND open period from existing at once —
    // it says nothing about the new window's dates. A back-dated fromDate/toDate can still land
    // on top of a period already closed for this account; standard interval-overlap test.
    const [overlapping] = await db.execute<RowDataPacket[]>(
      `SELECT id, from_date, to_date FROM bank_reconciliation_period
        WHERE bank_account_id = ? AND status = 'closed' AND from_date <= ? AND to_date >= ?
        ORDER BY to_date DESC LIMIT 1`,
      [bankAccountId, toDate, fromDate],
    );
    if (overlapping.length > 0) {
      const o = overlapping[0] as any;
      throw new BankReconciliationPeriodError(
        `This date range overlaps a closed period (${String(o.from_date).slice(0, 10)} to ${String(o.to_date).slice(0, 10)}). Choose a range starting after that period, or reopen it first.`,
      );
    }

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
