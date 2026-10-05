import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { financeBranchFilter, type FinanceBranchScope } from "./finance-access-scope.js";

/** Appends `col IN (...)` for a branch-limited caller; no-op for org-wide ({mode:"all"}) or no scope given. */
function pushBranchScope(conditions: string[], params: unknown[], scope: FinanceBranchScope | undefined, col: string) {
  if (!scope || scope.mode === "all") return;
  const f = financeBranchFilter(scope, col);
  conditions.push(f.sql);
  params.push(...f.params);
}

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

const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);

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

/**
 * Payments made to a vendor through Vendor Payment Dispatch, shaped like journal rows so the
 * vendor ledger can show them as debits. The debit is the GROSS cleared against the vendor's
 * bills (cash paid + any TDS withheld), the same figure vendorGrnLines() debits.
 */
async function vendorDispatchPayments(vendorId: string, from?: string, to?: string, scope?: FinanceBranchScope, before?: string): Promise<RowDataPacket[]> {
  const conditions = ["vpt.vendor_id = ?"];
  const params: unknown[] = [vendorId];
  if (from) { conditions.push("t.payment_date >= ?"); params.push(from); }
  if (to) { conditions.push("t.payment_date <= ?"); params.push(to); }
  if (before) { conditions.push("t.payment_date < ?"); params.push(before); }
  pushBranchScope(conditions, params, scope, "vpt.branch_id");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT('vpt:', t.id) AS journal_entry_id, t.payment_date AS entry_date,
            CONCAT('Payment ', t.payment_mode,
                   IF(t.transaction_id IS NULL OR t.transaction_id = '', '', CONCAT(' ref ', t.transaction_id)),
                   IF(COALESCE(t.tds_amount, 0) > 0, CONCAT(' (net ', FORMAT(t.net_amount, 2), ', TDS ', FORMAT(t.tds_amount, 2), ')'), ''),
                   IF(t.remarks IS NULL OR t.remarks = '', '', CONCAT(' - ', t.remarks))) AS narration,
            'vendor_payment' AS source_type, t.id AS source_id,
            vpt.branch_id, vpt.cost_centre_id, vpt.process_id,
            t.amount AS debit_amount, 0 AS credit_amount, NULL AS line_narration,
            t.bank_name, t.transaction_id, t.payment_mode, t.net_amount, t.tds_amount, t.remarks,
            g.grn_number, g.invoice_number
       FROM vendor_payment_transaction t
       JOIN vendor_payment_tracking vpt ON vpt.id = t.vendor_payment_id
       LEFT JOIN grn_request g ON g.id = t.grn_request_id
      WHERE ${conditions.join(" AND ")}
        AND NOT EXISTS (
          SELECT 1 FROM payment_voucher_grn_allocation a
            JOIN payment_voucher pv ON pv.id = a.payment_voucher_id AND pv.status = 'released'
            JOIN journal_entry je ON je.source_type = 'payment_voucher' AND je.source_id = pv.id
                                 AND je.reversed_by_entry_id IS NULL
           WHERE a.vendor_payment_tracking_id = t.vendor_payment_id)
      ORDER BY t.payment_date ASC, t.sequence_no ASC`,
    params,
  );
  return rows as RowDataPacket[];
}

/**
 * Branch/cost-centre/process depth dimension (owner directive 2026-09-17) — journal_entry
 * carries these as plain denormalized ids (1796_journal_entry_branch_cost_centre_process.sql),
 * resolved to display names here the same batched way resolveAccountNames() does for the
 * polymorphic account_type/account_id pair above.
 */
async function resolveDimensionNames(rows: RowDataPacket[]): Promise<{
  branchNames: Map<string, string>;
  costCentreNames: Map<string, string>;
  processNames: Map<string, string>;
}> {
  const branchIds = [...new Set(rows.map((r) => r.branch_id).filter(Boolean))];
  const costCentreIds = [...new Set(rows.map((r) => r.cost_centre_id).filter(Boolean))];
  const processIds = [...new Set(rows.map((r) => r.process_id).filter(Boolean))];

  const branchNames = new Map<string, string>();
  if (branchIds.length) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_name FROM branch_master WHERE id IN (${branchIds.map(() => "?").join(",")})`,
      branchIds,
    );
    for (const row of r as RowDataPacket[]) branchNames.set(String(row.id), row.branch_name);
  }

  const costCentreNames = new Map<string, string>();
  if (costCentreIds.length) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT id, cost_centre_name FROM cost_centre_master WHERE id IN (${costCentreIds.map(() => "?").join(",")})`,
      costCentreIds,
    );
    for (const row of r as RowDataPacket[]) costCentreNames.set(String(row.id), row.cost_centre_name);
  }

  const processNames = new Map<string, string>();
  if (processIds.length) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT id, process_name FROM process_master WHERE id IN (${processIds.map(() => "?").join(",")})`,
      processIds,
    );
    for (const row of r as RowDataPacket[]) processNames.set(String(row.id), row.process_name);
  }

  return { branchNames, costCentreNames, processNames };
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
   * Branch/Cost Centre/Process pickers for the depth filters below — dedicated to this
   * module (rather than reusing /api/access/branches or /api/processes) because those are
   * gated to admin/hr roles, not the finance roles (finance_head, accounts_head, ceo,
   * branch_head, admin, finance, super_admin) that read this page.
   */
  async filterOptions(scope?: FinanceBranchScope) {
    const limited = scope && scope.mode === "branches";
    const bF = limited ? financeBranchFilter(scope, "branch_id") : null;
    const bIdF = limited ? financeBranchFilter(scope, "id") : null;
    const [branches] = limited
      ? await db.execute<RowDataPacket[]>(
          `SELECT id, branch_name FROM branch_master WHERE active_status = 1 AND ${bIdF!.sql} ORDER BY branch_name`, bIdF!.params)
      : await db.execute<RowDataPacket[]>(
          `SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`,
        );
    const [costCentres] = limited
      ? await db.execute<RowDataPacket[]>(
          `SELECT id, cost_centre_name FROM cost_centre_master WHERE active_status = 1 AND ${bF!.sql} ORDER BY cost_centre_name`, bF!.params)
      : await db.execute<RowDataPacket[]>(
          `SELECT id, cost_centre_name FROM cost_centre_master WHERE active_status = 1 ORDER BY cost_centre_name`,
        );
    const [processes] = limited
      ? await db.execute<RowDataPacket[]>(
          `SELECT id, process_name FROM process_master WHERE active_status = 1 AND ${bF!.sql} ORDER BY process_name`, bF!.params)
      : await db.execute<RowDataPacket[]>(
          `SELECT id, process_name FROM process_master WHERE active_status = 1 ORDER BY process_name`,
        );
    return {
      branches: (branches as RowDataPacket[]).map((r) => ({ id: String(r.id), name: r.branch_name })),
      costCentres: (costCentres as RowDataPacket[]).map((r) => ({ id: String(r.id), name: r.cost_centre_name })),
      processes: (processes as RowDataPacket[]).map((r) => ({ id: String(r.id), name: r.process_name })),
    };
  },

  /**
   * Every account that has EVER had a journal_entry_line posted, summed to its net balance.
   * A correctly-built double-entry ledger has totalDebit === totalCredit across the WHOLE table
   * — that identity is the report's own self-check, returned as `balanced` so a caller (or a
   * standing script, mirroring verify-grn-journal-parity.ts) can alert on it rather than trust
   * it silently. Excludes lines belonging to a reversed journal_entry, so a corrected mistake
   * doesn't show twice.
   */
  async trialBalance(
    asOfDate?: string,
    filters?: { branchId?: string; costCentreId?: string; processId?: string },
    scope?: FinanceBranchScope,
  ): Promise<{ rows: TrialBalanceRow[]; balanced: boolean; totalDebit: number; totalCredit: number }> {
    const conditions = ["je.reversed_by_entry_id IS NULL"];
    const params: unknown[] = [];
    if (asOfDate) { conditions.push("je.entry_date <= ?"); params.push(asOfDate); }
    if (filters?.branchId) { conditions.push("je.branch_id = ?"); params.push(filters.branchId); }
    if (filters?.costCentreId) { conditions.push("je.cost_centre_id = ?"); params.push(filters.costCentreId); }
    if (filters?.processId) { conditions.push("je.process_id = ?"); params.push(filters.processId); }
    pushBranchScope(conditions, params, scope, "je.branch_id");

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
  async accountLedger(accountType: AccountType, accountId: string, from?: string, to?: string, scope?: FinanceBranchScope) {
    const conditions = ["jel.account_type = ?", "jel.account_id = ?", "je.reversed_by_entry_id IS NULL"];
    const params: unknown[] = [accountType, accountId];
    if (from) { conditions.push("je.entry_date >= ?"); params.push(from); }
    if (to) { conditions.push("je.entry_date <= ?"); params.push(to); }
    pushBranchScope(conditions, params, scope, "je.branch_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT je.id AS journal_entry_id, je.entry_date, je.narration, je.source_type, je.source_id,
              je.branch_id, je.cost_centre_id, je.process_id,
              jel.debit_amount, jel.credit_amount, jel.narration AS line_narration
         FROM journal_entry_line jel
         JOIN journal_entry je ON je.id = jel.journal_entry_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY je.entry_date ASC, je.posted_at ASC`,
      params,
    );

    // A vendor's payments made from the Vendor Payment Dispatch page are recorded in
    // vendor_payment_transaction and never reached the journal (release()'s journaling only
    // covers Payment Vouchers, and 0 vouchers have been released), so the journal alone showed
    // every bill and none of the payments. They are read here, at report time, as the debit
    // side. A due whose payments were already journaled by a released voucher is skipped so
    // nothing is counted twice if that path starts being used.
    const dispatched = accountType === "vendor"
      ? await vendorDispatchPayments(accountId, from, to, scope)
      : [];

    const allRows = [...(rows as RowDataPacket[]), ...dispatched];
    const { branchNames, costCentreNames, processNames } = await resolveDimensionNames(allRows);

    const ordered = allRows
      .map((r, i) => ({ r, i }))
      .sort((x, y) => dayOf(x.r.entry_date).localeCompare(dayOf(y.r.entry_date)) || x.i - y.i)
      .map((x) => x.r);

    let runningBalance = 0;
    const entries = ordered.map((r) => {
      runningBalance = money(runningBalance + Number(r.debit_amount) - Number(r.credit_amount));
      return {
        journalEntryId: r.journal_entry_id,
        entryDate: r.entry_date,
        narration: r.line_narration ?? r.narration,
        sourceType: r.source_type,
        sourceId: r.source_id,
        branchId: r.branch_id,
        branchName: r.branch_id ? (branchNames.get(String(r.branch_id)) ?? null) : null,
        costCentreId: r.cost_centre_id,
        costCentreName: r.cost_centre_id ? (costCentreNames.get(String(r.cost_centre_id)) ?? null) : null,
        processId: r.process_id,
        processName: r.process_id ? (processNames.get(String(r.process_id)) ?? null) : null,
        debitAmount: money(Number(r.debit_amount)),
        creditAmount: money(Number(r.credit_amount)),
        runningBalance,
      };
    });

    return { entries, closingBalance: runningBalance };
  },

  /**
   * Tally-style vendor ledger ("Ledger Vouchers" view of a Sundry Creditor): opening balance,
   * one row per voucher with Date / Particulars (To|By) / Vch Type / Vch No / Debit / Credit,
   * period totals, and a closing balance shown Dr or Cr. Bills are the credit side, payments the
   * debit side. Balance sign: Dr positive, Cr negative.
   *
   * BUILT FROM THE OPERATIONAL TABLES, not the journal. vendor_payment_tracking is what Finance
   * pays against, and across all vendors the journal disagreed with it (GRN credits did not match
   * the bills, and most payments never reached the journal). Here every bill is a credit at its
   * bill date, every recorded payment (vendor_payment_transaction) is a debit, and where a bill's
   * paid_amount is larger than its recorded payments (payments loaded from the legacy system
   * without detail) the difference appears as one debit row, so the closing balance always equals
   * the sum of balance_amount that Payment Dispatch shows.
   *
   * A vendor stored under several vendor_master ids (same name, 159 such groups) is one ledger.
   */
  async vendorStatement(vendorId: string, from?: string, to?: string, scope?: FinanceBranchScope) {
    const [vendorRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, vendor_code, vendor_name FROM vendor_master WHERE id = ? LIMIT 1`, [vendorId]);
    const vendor = (vendorRows as RowDataPacket[])[0];
    if (!vendor) return null;

    const [idRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM vendor_master WHERE UPPER(TRIM(vendor_name)) = UPPER(TRIM(?))`, [vendor.vendor_name]);
    const ids = [...new Set([vendorId, ...(idRows as RowDataPacket[]).map((r) => String(r.id))])];
    const inIds = ids.map(() => "?").join(",");

    const bc = [`vpt.vendor_id IN (${inIds})`, "NOT (vpt.payment_status = 'Rejected' AND COALESCE(vpt.paid_amount,0) = 0)"];
    const bp: unknown[] = [...ids];
    pushBranchScope(bc, bp, scope, "vpt.branch_id");
    const [bills] = await db.execute<RowDataPacket[]>(
      `SELECT vpt.id, vpt.branch_id, vpt.due_amount, vpt.paid_amount, vpt.payment_date, vpt.payment_mode, vpt.bank_name AS vpt_bank,
              vpt.transaction_id AS vpt_txn, COALESCE(g.bill_date, DATE(vpt.created_at)) AS bill_day,
              g.grn_number, g.invoice_number
         FROM vendor_payment_tracking vpt LEFT JOIN grn_request g ON g.id = vpt.grn_request_id
        WHERE ${bc.join(" AND ")}`, bp);

    const billIds = (bills as RowDataPacket[]).map((r) => String(r.id));
    const txByBill = new Map<string, RowDataPacket[]>();
    for (let i = 0; i < billIds.length; i += 500) {
      const chunk = billIds.slice(i, i + 500);
      const [tx] = await db.execute<RowDataPacket[]>(
        `SELECT vendor_payment_id, payment_date, payment_mode, bank_name, transaction_id, amount, net_amount, tds_amount, remarks, sequence_no
           FROM vendor_payment_transaction WHERE vendor_payment_id IN (${chunk.map(() => "?").join(",")})`, chunk);
      for (const t of tx as RowDataPacket[]) {
        const list = txByBill.get(String(t.vendor_payment_id)) ?? [];
        list.push(t);
        txByBill.set(String(t.vendor_payment_id), list);
      }
    }

    type Item = { day: string; branchId: unknown; particulars: string; vchType: string; vchNo: string; reference: string; narration: string; debit: number; credit: number };
    const items: Item[] = [];
    for (const b of bills as RowDataPacket[]) {
      const billNo = String(b.grn_number ?? "");
      const billDay = dayOf(b.bill_day);
      const due = money(Number(b.due_amount));
      if (due !== 0) {
        items.push({ day: billDay, branchId: b.branch_id, particulars: "By Purchase", vchType: "Purchase", vchNo: billNo, reference: String(b.invoice_number ?? ""), narration: "", debit: 0, credit: due });
      }
      const txs = txByBill.get(String(b.id)) ?? [];
      let recorded = 0;
      for (const t of txs) {
        const amt = money(Number(t.amount));
        recorded = money(recorded + amt);
        items.push({
          day: dayOf(t.payment_date), branchId: b.branch_id,
          particulars: `To ${t.bank_name || t.payment_mode || "Bank"}`, vchType: "Payment",
          vchNo: String(t.transaction_id || billNo || ""),
          reference: billNo ? `Against ${billNo}${b.invoice_number ? ` / ${b.invoice_number}` : ""}` : "",
          narration: `${t.payment_mode ?? ""}${Number(t.tds_amount) > 0 ? ` (net ${money(Number(t.net_amount))}, TDS ${money(Number(t.tds_amount))})` : ""}${t.remarks ? ` - ${t.remarks}` : ""}`.trim(),
          debit: amt, credit: 0,
        });
      }
      const gap = money(Number(b.paid_amount) - recorded);
      if (Math.abs(gap) > 0.005) {
        items.push({
          day: dayOf(b.payment_date ?? b.bill_day), branchId: b.branch_id,
          particulars: gap > 0 ? `To ${b.vpt_bank || b.payment_mode || "Payment"} (earlier payment)` : "By Payment adjustment",
          vchType: gap > 0 ? "Payment" : "Journal", vchNo: String(b.vpt_txn || billNo || ""),
          reference: billNo ? `Against ${billNo}${b.invoice_number ? ` / ${b.invoice_number}` : ""}` : "",
          narration: "Payment recorded on the bill without individual payment details",
          debit: gap > 0 ? gap : 0, credit: gap < 0 ? -gap : 0,
        });
      }
    }
    items.sort((x, y) => x.day.localeCompare(y.day) || (x.credit > 0 ? 0 : 1) - (y.credit > 0 ? 0 : 1));

    let opening = 0;
    const inPeriod: Item[] = [];
    for (const it of items) {
      if (from && it.day < from) { opening += it.debit - it.credit; continue; }
      if (to && it.day > to) continue;
      inPeriod.push(it);
    }
    opening = money(opening);

    const { branchNames } = await resolveDimensionNames(inPeriod.map((r) => ({ branch_id: r.branchId } as RowDataPacket)));
    let running = opening;
    let totalDebit = 0, totalCredit = 0;
    const rows = inPeriod.map((r) => {
      running = money(running + r.debit - r.credit);
      totalDebit += r.debit; totalCredit += r.credit;
      return {
        date: r.day, particulars: r.particulars, vchType: r.vchType, vchNo: r.vchNo, reference: r.reference,
        narration: r.narration, branchName: r.branchId ? (branchNames.get(String(r.branchId)) ?? null) : null,
        debit: money(r.debit), credit: money(r.credit), balance: Math.abs(running), balanceSide: running < 0 ? "Cr" : "Dr",
      };
    });
    const side = (v: number) => (v < 0 ? "Cr" : "Dr");
    return {
      vendor: { id: vendor.id, code: vendor.vendor_code, name: vendor.vendor_name },
      from: from ?? null, to: to ?? null,
      opening: { amount: Math.abs(opening), side: side(opening) },
      rows,
      totals: { debit: money(totalDebit), credit: money(totalCredit) },
      closing: { amount: Math.abs(running), side: side(running) },
    };
  },

  /**
   * Tally's "Outstanding Bills" for one vendor: every bill (GRN) with a balance left, with the
   * paid and balance amounts and its age in days from the bill date, bucketed 0-30 / 31-60 /
   * 61-90 / 90+. Read from vendor_payment_tracking, the same table the payment dispatch page
   * pays against, so it agrees with what Finance can actually still pay.
   */
  async vendorOutstanding(vendorId: string, asOf?: string, scope?: FinanceBranchScope) {
    const [vn] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM vendor_master WHERE UPPER(TRIM(vendor_name)) = (SELECT UPPER(TRIM(vendor_name)) FROM vendor_master WHERE id = ? LIMIT 1)`, [vendorId]);
    const ids = [...new Set([vendorId, ...(vn as RowDataPacket[]).map((r) => String(r.id))])];
    const conditions = [`vpt.vendor_id IN (${ids.map(() => "?").join(",")})`, "vpt.balance_amount > 0.005", "vpt.payment_status NOT IN ('Rejected','Closed')"];
    const params: unknown[] = [...ids];
    pushBranchScope(conditions, params, scope, "vpt.branch_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vpt.id, g.grn_number, g.invoice_number, g.bill_date, g.due_date,
              vpt.due_amount, vpt.paid_amount, vpt.balance_amount, vpt.payment_status, vpt.branch_id
         FROM vendor_payment_tracking vpt
         LEFT JOIN grn_request g ON g.id = vpt.grn_request_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY COALESCE(g.bill_date, g.due_date) ASC`, params);
    const { branchNames } = await resolveDimensionNames((rows as RowDataPacket[]).map((r) => ({ branch_id: r.branch_id } as RowDataPacket)));
    const ref = asOf ? new Date(`${asOf}T00:00:00Z`) : new Date();
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const bills = (rows as RowDataPacket[]).map((r) => {
      const billDay = r.bill_date ? dayOf(r.bill_date) : null;
      const ageDays = billDay ? Math.max(0, Math.floor((ref.getTime() - new Date(`${billDay}T00:00:00Z`).getTime()) / 86_400_000)) : null;
      const balance = money(Number(r.balance_amount));
      const bucket = ageDays == null ? "90+" : ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";
      buckets[bucket] = money(buckets[bucket] + balance);
      return {
        id: r.id, grnNumber: r.grn_number ?? "", invoiceNumber: r.invoice_number ?? "",
        billDate: billDay, dueDate: r.due_date ? dayOf(r.due_date) : null, ageDays, bucket,
        billAmount: money(Number(r.due_amount)), paidAmount: money(Number(r.paid_amount)), balance,
        status: r.payment_status, branchName: r.branch_id ? (branchNames.get(String(r.branch_id)) ?? null) : null,
      };
    });
    return { bills, buckets, total: money(bills.reduce((sum, b) => sum + b.balance, 0)) };
  },

  async vendorLedger(vendorId: string, from?: string, to?: string, scope?: FinanceBranchScope) {
    return ledgerReportsService.accountLedger("vendor", vendorId, from, to, scope);
  },

  /**
   * Spend by Head/Subhead over a date range — the journal's equivalent of what
   * finance_budget_line.consumed_amount tracks per budget line, except this is the actual
   * accounting figure (every GRN ever posted against that head/subhead, budgeted or not) rather
   * than a per-budget-line running total.
   */
  async headSubHeadLedger(
    from?: string,
    to?: string,
    filters?: { branchId?: string; costCentreId?: string; processId?: string },
    scope?: FinanceBranchScope,
  ) {
    const conditions = ["jel.account_type = 'expense_sub_head'", "je.reversed_by_entry_id IS NULL"];
    const params: unknown[] = [];
    if (from) { conditions.push("je.entry_date >= ?"); params.push(from); }
    if (to) { conditions.push("je.entry_date <= ?"); params.push(to); }
    if (filters?.branchId) { conditions.push("je.branch_id = ?"); params.push(filters.branchId); }
    if (filters?.costCentreId) { conditions.push("je.cost_centre_id = ?"); params.push(filters.costCentreId); }
    if (filters?.processId) { conditions.push("je.process_id = ?"); params.push(filters.processId); }
    pushBranchScope(conditions, params, scope, "je.branch_id");

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
