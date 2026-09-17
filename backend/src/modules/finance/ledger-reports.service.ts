import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Phase 4 of the double-entry plan (payment-voucher-double-entry-plan.md) — the first reports
 * that read journal_entry_line directly rather than reconstructing figures from
 * bank_account_ledger_entry + vendor_payment_tracking + budget_consumption the way every other
 * finance report in this codebase still has to. These only exist for GRNs approved and vouchers
 * released AFTER Journal Task 1–3 shipped — see each report's own "as-of" caveat below. Until
 * Phase 6's historical backfill runs, these are honest about covering a partial period, not
 * silently wrong.
 *
 * account_type is polymorphic (see 1787_journal_entry.sql's own header for why) — every query
 * here resolves display names in a SECOND pass, one batched query per account_type actually
 * present in the result set, rather than a four-way LEFT JOIN UNION that would be unreadable and
 * slow. Same "resolve the small set of ids you actually got back" shape as
 * bank-ledger.service.ts's own report already uses for payable_account/vendor/employee names.
 */

type AccountType = "bank_account" | "vendor" | "expense_sub_head" | "payable_account";

async function resolveAccountNames(refs: { accountType: AccountType; accountId: string }[]): Promise<Map<string, string>> {
  const byType = new Map<AccountType, Set<string>>();
  for (const r of refs) {
    if (!byType.has(r.accountType)) byType.set(r.accountType, new Set());
    byType.get(r.accountType)!.add(r.accountId);
  }
  const names = new Map<string, string>(); // key: `${accountType}:${accountId}`

  const bankIds = [...(byType.get("bank_account") ?? [])];
  if (bankIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, account_name, bank_name FROM company_bank_account WHERE id IN (${bankIds.map(() => "?").join(",")})`,
      bankIds,
    );
    for (const r of rows as RowDataPacket[]) names.set(`bank_account:${r.id}`, `${r.account_name ?? r.bank_name ?? r.id} (Bank)`);
  }

  const vendorIds = [...(byType.get("vendor") ?? [])];
  if (vendorIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, vendor_name FROM vendor_master WHERE id IN (${vendorIds.map(() => "?").join(",")})`,
      vendorIds,
    );
    for (const r of rows as RowDataPacket[]) names.set(`vendor:${r.id}`, `${r.vendor_name} (Sundry Creditor)`);
  }

  const subHeadIds = [...(byType.get("expense_sub_head") ?? [])];
  if (subHeadIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sh.id, h.head_name, sh.sub_head_name
         FROM finance_expense_sub_head_master sh
         JOIN finance_expense_head_master h ON h.id = sh.head_id
        WHERE sh.id IN (${subHeadIds.map(() => "?").join(",")})`,
      subHeadIds,
    );
    for (const r of rows as RowDataPacket[]) names.set(`expense_sub_head:${r.id}`, `${r.head_name} / ${r.sub_head_name}`);
  }

  const payableIds = [...(byType.get("payable_account") ?? [])];
  if (payableIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, account_name FROM payable_account_master WHERE id IN (${payableIds.map(() => "?").join(",")})`,
      payableIds,
    );
    for (const r of rows as RowDataPacket[]) names.set(`payable_account:${r.id}`, r.account_name);
  }

  return names;
}

function money(v: number) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

export type TrialBalanceRow = {
  accountType: AccountType;
  accountId: string;
  accountName: string;
  totalDebit: number;
  totalCredit: number;
  /** Positive = net debit balance, negative = net credit balance. Tally-style single figure. */
  netBalance: number;
};

export const ledgerReportsService = {
  /**
   * Every account that has EVER had a journal_entry_line posted, summed to its net balance.
   * A correctly-built double-entry ledger has totalDebit === totalCredit across the WHOLE table
   * — that identity is the report's own self-check, returned as `balanced` so a caller (or a
   * standing script, mirroring verify-grn-journal-parity.ts) can alert on it rather than trust
   * it silently. Excludes lines belonging to a reversed journal_entry, so a corrected mistake
   * doesn't show twice.
   */
  async trialBalance(asOfDate?: string): Promise<{ rows: TrialBalanceRow[]; balanced: boolean; totalDebit: number; totalCredit: number }> {
    const conditions = ["je.reversed_by_entry_id IS NULL"];
    const params: unknown[] = [];
    if (asOfDate) { conditions.push("je.entry_date <= ?"); params.push(asOfDate); }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT jel.account_type, jel.account_id,
              SUM(jel.debit_amount) AS total_debit, SUM(jel.credit_amount) AS total_credit
         FROM journal_entry_line jel
         JOIN journal_entry je ON je.id = jel.journal_entry_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY jel.account_type, jel.account_id
        ORDER BY jel.account_type, jel.account_id`,
      params,
    );

    const refs = (rows as RowDataPacket[]).map((r) => ({ accountType: r.account_type as AccountType, accountId: String(r.account_id) }));
    const names = await resolveAccountNames(refs);

    let totalDebit = 0;
    let totalCredit = 0;
    const result: TrialBalanceRow[] = (rows as RowDataPacket[]).map((r) => {
      const totalD = money(Number(r.total_debit));
      const totalC = money(Number(r.total_credit));
      totalDebit += totalD;
      totalCredit += totalC;
      return {
        accountType: r.account_type,
        accountId: String(r.account_id),
        accountName: names.get(`${r.account_type}:${r.account_id}`) ?? `(unresolved ${r.account_type} ${r.account_id})`,
        totalDebit: totalD,
        totalCredit: totalC,
        netBalance: money(totalD - totalC),
      };
    });

    return { rows: result, balanced: money(totalDebit) === money(totalCredit), totalDebit: money(totalDebit), totalCredit: money(totalCredit) };
  },

  /**
   * One account's sub-ledger, chronological, with a running balance — Tally's "Bill-wise
   * Outstanding" equivalent for a vendor, or the general ledger card for any other account
   * type. Positive running balance = net debit (an expense/asset account, or a vendor who has
   * been paid an advance ahead of what they're owed); negative = net credit (a vendor who is
   * owed money — the normal state for Sundry Creditors).
   *
   * Generalized from what was a vendor-only query so Trial Balance and Head/Subhead Ledger rows
   * can drill down into the same underlying entries (the Drill-Down Mandate) without a second,
   * near-duplicate query — vendorLedger() below is now a thin wrapper over this.
   */
  async accountLedger(accountType: AccountType, accountId: string, from?: string, to?: string) {
    const conditions = ["jel.account_type = ?", "jel.account_id = ?", "je.reversed_by_entry_id IS NULL"];
    const params: unknown[] = [accountType, accountId];
    if (from) { conditions.push("je.entry_date >= ?"); params.push(from); }
    if (to) { conditions.push("je.entry_date <= ?"); params.push(to); }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT je.id AS journal_entry_id, je.entry_date, je.narration, je.source_type, je.source_id,
              jel.debit_amount, jel.credit_amount, jel.narration AS line_narration
         FROM journal_entry_line jel
         JOIN journal_entry je ON je.id = jel.journal_entry_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY je.entry_date ASC, je.posted_at ASC`,
      params,
    );

    let runningBalance = 0;
    const entries = (rows as RowDataPacket[]).map((r) => {
      runningBalance = money(runningBalance + Number(r.debit_amount) - Number(r.credit_amount));
      return {
        journalEntryId: r.journal_entry_id,
        entryDate: r.entry_date,
        narration: r.line_narration ?? r.narration,
        sourceType: r.source_type,
        sourceId: r.source_id,
        debitAmount: money(Number(r.debit_amount)),
        creditAmount: money(Number(r.credit_amount)),
        runningBalance,
      };
    });

    return { entries, closingBalance: runningBalance };
  },

  async vendorLedger(vendorId: string, from?: string, to?: string) {
    return ledgerReportsService.accountLedger("vendor", vendorId, from, to);
  },

  /**
   * Spend by Head/Subhead over a date range — the journal's equivalent of what
   * finance_budget_line.consumed_amount tracks per budget line, except this is the actual
   * accounting figure (every GRN ever posted against that head/subhead, budgeted or not) rather
   * than a per-budget-line running total.
   */
  async headSubHeadLedger(from?: string, to?: string) {
    const conditions = ["jel.account_type = 'expense_sub_head'", "je.reversed_by_entry_id IS NULL"];
    const params: unknown[] = [];
    if (from) { conditions.push("je.entry_date >= ?"); params.push(from); }
    if (to) { conditions.push("je.entry_date <= ?"); params.push(to); }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT jel.account_id, SUM(jel.debit_amount) AS total_spent, COUNT(DISTINCT je.source_id) AS grn_count
         FROM journal_entry_line jel
         JOIN journal_entry je ON je.id = jel.journal_entry_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY jel.account_id
        ORDER BY total_spent DESC`,
      params,
    );

    const refs = (rows as RowDataPacket[]).map((r) => ({ accountType: "expense_sub_head" as const, accountId: String(r.account_id) }));
    const names = await resolveAccountNames(refs);

    return (rows as RowDataPacket[]).map((r) => ({
      accountId: String(r.account_id),
      headSubHead: names.get(`expense_sub_head:${r.account_id}`) ?? `(unresolved ${r.account_id})`,
      totalSpent: money(Number(r.total_spent)),
      grnCount: Number(r.grn_count),
    }));
  },
};
