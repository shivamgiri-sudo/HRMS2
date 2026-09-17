import { randomUUID } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { refuse } from "../process-pnl/finance-error.js";

/**
 * The general ledger's only writer.
 *
 * Every other posting table in this codebase (bank_account_ledger_entry, imprest_transaction_ledger)
 * is append-only by convention and proven so with a source-scan test. journal_entry_line is the
 * same, with one addition: a set of lines is only ever written together, inside the caller's own
 * transaction, and only if they balance to the paisa. MySQL 8 here cannot CHECK an aggregate
 * across sibling rows (imprest-ledger.service.ts's header explains triggers are unavailable in
 * this environment for the same reason), so that invariant lives here instead of in the schema —
 * this function is the schema's stand-in for it. Nothing else may INSERT into journal_entry_line.
 * A source-scan test (journal.service.test.ts) asserts that.
 *
 * post() takes the caller's own PoolConnection rather than opening one — a journal entry that
 * commits after its source event (GRN approval, voucher release) rolls back would claim money
 * moved, or an expense was recognised, when it did not. Same discipline as
 * imprest-ledger.service.ts's postings, same reason.
 *
 * Money is compared in paise. Two DECIMAL(18,2) values that print the same must compare equal —
 * copied verbatim from imprest-ledger.service.ts rather than re-derived, because that file's own
 * header records a real production incident caused by a date-handling version of exactly this
 * kind of "should be equivalent, wasn't" bug.
 *
 * Only genuine IEEE754 multiplication noise is forgiven here (~1e-10 to 1e-13 on any realistic
 * DECIMAL(18,2)-sourced value), never real sub-paisa drift. Rounding every line to its *nearest*
 * paisa independently — Math.round(value * 100) — was tried first and reverted: two lines that
 * are actually ₹0.009 apart (a real upstream miscalculation, e.g. ₹100.004 vs ₹99.995) can each
 * round to the same ₹100.00 and falsely "balance", hiding exactly the class of bug this engine
 * exists to catch. journal.service.test.ts's "rounds to the paisa... 0.005 drift does not
 * silently pass" case is what caught this the one time it was actually run.
 */
const PAISE_NOISE_EPSILON = 1e-6;
const toPaise = (value: number) => {
  const paise = Number(value) * 100;
  const rounded = Math.round(paise);
  return Math.abs(paise - rounded) < PAISE_NOISE_EPSILON ? rounded : paise;
};

export type JournalAccountType = "bank_account" | "vendor" | "expense_sub_head" | "payable_account";

export type JournalLineInput = {
  accountType: JournalAccountType;
  accountId: string;
  /** Exactly one of these must be > 0. Both zero or both positive is refused. */
  debitAmount?: number;
  creditAmount?: number;
  narration?: string | null;
};

export type JournalSourceType = "grn" | "payment_voucher" | "bank_reconciliation_adjustment" | "imprest" | "manual";

export type PostJournalEntryInput = {
  entryDate: string;
  narration: string;
  sourceType: JournalSourceType;
  sourceId: string;
  postedBy: string;
  lines: JournalLineInput[];
};

export const journalService = {
  /**
   * Posts a balanced journal entry inside the caller's transaction.
   *
   * Refuses (409, code UNBALANCED_JOURNAL_ENTRY) rather than silently rounding or forcing a
   * balancing line — an unbalanced entry means the caller's own arithmetic is wrong somewhere
   * upstream, and rounding it away here would hide exactly the bug this table exists to make
   * impossible to hide.
   *
   * Callers that need to correct a wrong entry should call reverse(), not attempt a second
   * post() that nets against the first — journal_entry has no UPDATE path, matching every other
   * ledger table in this codebase.
   */
  async post(connection: PoolConnection, input: PostJournalEntryInput): Promise<{ journalEntryId: string }> {
    if (input.lines.length < 2) {
      throw refuse(400, "JOURNAL_ENTRY_TOO_SHORT", "A journal entry needs at least two lines — one debit side, one credit side.");
    }

    let debitTotalPaise = 0;
    let creditTotalPaise = 0;
    const normalizedLines = input.lines.map((line, index) => {
      const debit = Number(line.debitAmount ?? 0);
      const credit = Number(line.creditAmount ?? 0);
      const debitPaise = toPaise(debit);
      const creditPaise = toPaise(credit);

      if (debitPaise > 0 && creditPaise > 0) {
        throw refuse(400, "JOURNAL_LINE_BOTH_SIDES", `Line ${index + 1} has both a debit and a credit — a line moves exactly one side.`);
      }
      if (debitPaise === 0 && creditPaise === 0) {
        throw refuse(400, "JOURNAL_LINE_ZERO", `Line ${index + 1} has no amount on either side.`);
      }

      debitTotalPaise += debitPaise;
      creditTotalPaise += creditPaise;

      return {
        id: randomUUID(),
        lineOrder: index,
        accountType: line.accountType,
        accountId: line.accountId,
        debitAmount: debitPaise / 100,
        creditAmount: creditPaise / 100,
        narration: line.narration ?? null,
      };
    });

    if (debitTotalPaise !== creditTotalPaise) {
      throw refuse(
        409,
        "UNBALANCED_JOURNAL_ENTRY",
        `Journal entry does not balance: debit ₹${(debitTotalPaise / 100).toFixed(2)} vs credit ₹${(creditTotalPaise / 100).toFixed(2)} for ${input.sourceType} ${input.sourceId}.`,
      );
    }

    const journalEntryId = randomUUID();
    await connection.execute(
      `INSERT INTO journal_entry (id, entry_date, narration, source_type, source_id, posted_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [journalEntryId, input.entryDate, input.narration, input.sourceType, input.sourceId, input.postedBy],
    );

    for (const line of normalizedLines) {
      await connection.execute(
        `INSERT INTO journal_entry_line
           (id, journal_entry_id, line_order, account_type, account_id, debit_amount, credit_amount, narration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          line.id,
          journalEntryId,
          line.lineOrder,
          line.accountType,
          line.accountId,
          line.debitAmount,
          line.creditAmount,
          line.narration,
        ],
      );
    }

    return { journalEntryId };
  },

  /**
   * Reverses a live journal entry with an equal-and-opposite one, inside the caller's transaction.
   * Marks the original reversed_by_entry_id rather than deleting it — the original stays legible
   * in a Trial Balance for the period it was posted in, exactly as a contra entry would in Tally.
   */
  async reverse(connection: PoolConnection, journalEntryId: string, postedBy: string, reason: string): Promise<{ reversalEntryId: string }> {
    const [rows] = await connection.execute(
      `SELECT id, entry_date, narration, source_type, source_id, reversed_by_entry_id
         FROM journal_entry WHERE id = ? FOR UPDATE`,
      [journalEntryId],
    );
    const original = (rows as any[])[0];
    if (!original) throw refuse(404, "JOURNAL_ENTRY_NOT_FOUND", "Journal entry not found.");
    if (original.reversed_by_entry_id) throw refuse(409, "JOURNAL_ENTRY_ALREADY_REVERSED", "Journal entry has already been reversed.");

    const [lineRows] = await connection.execute(
      `SELECT account_type, account_id, debit_amount, credit_amount, narration
         FROM journal_entry_line WHERE journal_entry_id = ? ORDER BY line_order ASC`,
      [journalEntryId],
    );

    const { journalEntryId: reversalEntryId } = await this.post(connection, {
      entryDate: new Date().toISOString().slice(0, 10),
      narration: `Reversal of ${journalEntryId}: ${reason}`,
      sourceType: original.source_type,
      sourceId: original.source_id,
      postedBy,
      lines: (lineRows as any[]).map((l) => ({
        accountType: l.account_type,
        accountId: l.account_id,
        // Swap sides — an equal-and-opposite contra entry.
        debitAmount: Number(l.credit_amount) || undefined,
        creditAmount: Number(l.debit_amount) || undefined,
        narration: l.narration,
      })),
    });

    await connection.execute(`UPDATE journal_entry SET reversed_by_entry_id = ? WHERE id = ?`, [reversalEntryId, journalEntryId]);

    return { reversalEntryId };
  },
};
