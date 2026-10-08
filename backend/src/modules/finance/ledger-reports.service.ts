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

async function resolveAccountNames(
  refs: { accountType: AccountType; accountId: string }[],
): Promise<Map<string, string>> {
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
    for (const r of rows as RowDataPacket[])
      names.set(
        `bank_account:${r.id}`,
        `${r.account_name ?? r.bank_name ?? r.id} (Bank)`,
      );
  }

  const vendorIds = [...(byType.get("vendor") ?? [])];
  if (vendorIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, vendor_name FROM vendor_master WHERE id IN (${vendorIds.map(() => "?").join(",")})`,
      vendorIds,
    );
    for (const r of rows as RowDataPacket[])
      names.set(`vendor:${r.id}`, `${r.vendor_name} (Sundry Creditor)`);
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
    for (const r of rows as RowDataPacket[])
      names.set(
        `expense_sub_head:${r.id}`,
        `${r.head_name} / ${r.sub_head_name}`,
      );
  }

  const payableIds = [...(byType.get("payable_account") ?? [])];
  if (payableIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, account_name FROM payable_account_master WHERE id IN (${payableIds.map(() => "?").join(",")})`,
      payableIds,
    );
    for (const r of rows as RowDataPacket[])
      names.set(`payable_account:${r.id}`, r.account_name);
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
  const costCentreIds = [
    ...new Set(rows.map((r) => r.cost_centre_id).filter(Boolean)),
  ];
  const processIds = [
    ...new Set(rows.map((r) => r.process_id).filter(Boolean)),
  ];

  const branchNames = new Map<string, string>();
  if (branchIds.length) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_name FROM branch_master WHERE id IN (${branchIds.map(() => "?").join(",")})`,
      branchIds,
    );
    for (const row of r as RowDataPacket[])
      branchNames.set(String(row.id), row.branch_name);
  }

  const costCentreNames = new Map<string, string>();
  if (costCentreIds.length) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT id, cost_centre_name FROM cost_centre_master WHERE id IN (${costCentreIds.map(() => "?").join(",")})`,
      costCentreIds,
    );
    for (const row of r as RowDataPacket[])
      costCentreNames.set(String(row.id), row.cost_centre_name);
  }

  const processNames = new Map<string, string>();
  if (processIds.length) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT id, process_name FROM process_master WHERE id IN (${processIds.map(() => "?").join(",")})`,
      processIds,
    );
    for (const row of r as RowDataPacket[])
      processNames.set(String(row.id), row.process_name);
  }

  return { branchNames, costCentreNames, processNames };
}

function money(v: number) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

type VendorItem = {
  vendorId: string; day: string; branchId: unknown; particulars: string; vchType: string; vchNo: string;
  reference: string; narration: string; debit: number; credit: number;
  /** A bill (credit) that has no GRN journal entry, so no expense head has been debited for it. */
  unposted: boolean;
};

/**
 * Every bill and payment of the given vendors (all vendors when `vendorIds` is omitted), from the
 * operational tables. Three sources, so a vendor's ledger is complete:
 *   1. vendor_payment_tracking bills (credit at bill date);
 *   2. their recorded payments (vendor_payment_transaction, debit), plus one "earlier payment"
 *      debit for any paid_amount that has no payment detail behind it;
 *   3. GRNs marked paid that pre-date payment tracking and have no tracking row (credit, and an
 *      equal debit as "settled") — without them a vendor's history is missing years of bills.
 */
async function loadVendorItems(opts: {
  vendorIds?: string[]; scope?: FinanceBranchScope; branchId?: string; costCentreId?: string; processId?: string;
}): Promise<VendorItem[]> {
  const items: VendorItem[] = [];
  const vendorIn = opts.vendorIds ? `vpt.vendor_id IN (${opts.vendorIds.map(() => "?").join(",")})` : "1=1";

  const bc = [vendorIn, "NOT (vpt.payment_status = 'Rejected' AND COALESCE(vpt.paid_amount,0) = 0)"];
  const bp: unknown[] = [...(opts.vendorIds ?? [])];
  if (opts.branchId) { bc.push("vpt.branch_id = ?"); bp.push(opts.branchId); }
  if (opts.costCentreId) { bc.push("vpt.cost_centre_id = ?"); bp.push(opts.costCentreId); }
  if (opts.processId) { bc.push("vpt.process_id = ?"); bp.push(opts.processId); }
  pushBranchScope(bc, bp, opts.scope, "vpt.branch_id");
  const [bills] = await db.execute<RowDataPacket[]>(
    `SELECT vpt.id, vpt.vendor_id, vpt.branch_id, vpt.due_amount, vpt.paid_amount, vpt.payment_date, vpt.payment_mode,
            vpt.bank_name AS vpt_bank, vpt.transaction_id AS vpt_txn, COALESCE(g.bill_date, DATE(vpt.created_at)) AS bill_day,
            g.grn_number, g.invoice_number,
            EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type = 'grn' AND je.source_id = vpt.grn_request_id
                      AND je.reversed_by_entry_id IS NULL) AS journaled
       FROM vendor_payment_tracking vpt LEFT JOIN grn_request g ON g.id = vpt.grn_request_id
      WHERE ${bc.join(" AND ")}`, bp);

  const billIds = (bills as RowDataPacket[]).map((r) => String(r.id));
  const txByBill = new Map<string, RowDataPacket[]>();
  for (let i = 0; i < billIds.length; i += 1000) {
    const chunk = billIds.slice(i, i + 1000);
    const [tx] = await db.execute<RowDataPacket[]>(
      `SELECT vendor_payment_id, payment_date, payment_mode, bank_name, transaction_id, amount, net_amount, tds_amount, remarks
         FROM vendor_payment_transaction WHERE vendor_payment_id IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const t of tx as RowDataPacket[]) {
      const list = txByBill.get(String(t.vendor_payment_id)) ?? [];
      list.push(t);
      txByBill.set(String(t.vendor_payment_id), list);
    }
  }

  for (const b of bills as RowDataPacket[]) {
    const vendorId = String(b.vendor_id);
    const billNo = String(b.grn_number ?? "");
    const ref = billNo ? `Against ${billNo}${b.invoice_number ? ` / ${b.invoice_number}` : ""}` : "";
    const due = money(Number(b.due_amount));
    if (due !== 0) {
      items.push({ vendorId, day: dayOf(b.bill_day), branchId: b.branch_id, particulars: "By Purchase", vchType: "Purchase", vchNo: billNo,
        reference: String(b.invoice_number ?? ""), narration: "", debit: 0, credit: due, unposted: !Number(b.journaled) });
    }
    let recorded = 0;
    for (const t of txByBill.get(String(b.id)) ?? []) {
      const amt = money(Number(t.amount));
      recorded = money(recorded + amt);
      items.push({ vendorId, day: dayOf(t.payment_date), branchId: b.branch_id,
        particulars: `To ${t.bank_name || t.payment_mode || "Bank"}`, vchType: "Payment", vchNo: String(t.transaction_id || billNo || ""), reference: ref,
        narration: `${t.payment_mode ?? ""}${Number(t.tds_amount) > 0 ? ` (net ${money(Number(t.net_amount))}, TDS ${money(Number(t.tds_amount))})` : ""}${t.remarks ? ` - ${t.remarks}` : ""}`.trim(),
        debit: amt, credit: 0, unposted: false });
    }
    const gap = money(Number(b.paid_amount) - recorded);
    if (Math.abs(gap) > 0.005) {
      items.push({ vendorId, day: dayOf(b.payment_date ?? b.bill_day), branchId: b.branch_id,
        particulars: gap > 0 ? `To ${b.vpt_bank || b.payment_mode || "Payment"} (earlier payment)` : "By Payment adjustment",
        vchType: gap > 0 ? "Payment" : "Journal", vchNo: String(b.vpt_txn || billNo || ""), reference: ref,
        narration: "Payment recorded on the bill without individual payment details",
        debit: gap > 0 ? gap : 0, credit: gap < 0 ? -gap : 0, unposted: false });
    }
  }

  // Old GRNs settled before payment tracking existed. The process filter cannot be applied to them.
  if (!opts.processId) {
    const gc = ["g.status = 'paid'", "g.vendor_id IS NOT NULL",
      opts.vendorIds ? `g.vendor_id IN (${opts.vendorIds.map(() => "?").join(",")})` : "1=1",
      "NOT EXISTS (SELECT 1 FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id)"];
    const gp: unknown[] = [...(opts.vendorIds ?? [])];
    if (opts.branchId) { gc.push("g.branch_id = ?"); gp.push(opts.branchId); }
    if (opts.costCentreId) { gc.push("g.cost_centre_id = ?"); gp.push(opts.costCentreId); }
    pushBranchScope(gc, gp, opts.scope, "g.branch_id");
    const [legacy] = await db.execute<RowDataPacket[]>(
      `SELECT g.vendor_id, g.branch_id, g.grn_number, g.invoice_number, COALESCE(g.bill_date, DATE(g.created_at)) AS bill_day,
              COALESCE(NULLIF(g.amount_with_tax, 0), g.amount) AS amt,
              EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type = 'grn' AND je.source_id = g.id AND je.reversed_by_entry_id IS NULL) AS journaled
         FROM grn_request g WHERE ${gc.join(" AND ")}`, gp);
    for (const g of legacy as RowDataPacket[]) {
      const amt = money(Number(g.amt));
      if (!amt) continue;
      const vendorId = String(g.vendor_id);
      const billNo = String(g.grn_number ?? "");
      items.push({ vendorId, day: dayOf(g.bill_day), branchId: g.branch_id, particulars: "By Purchase", vchType: "Purchase", vchNo: billNo,
        reference: String(g.invoice_number ?? ""), narration: "", debit: 0, credit: amt, unposted: !Number(g.journaled) });
      items.push({ vendorId, day: dayOf(g.bill_day), branchId: g.branch_id, particulars: "To Payment (settled before payment tracking)", vchType: "Payment", vchNo: billNo,
        reference: billNo ? `Against ${billNo}` : "", narration: "GRN marked paid; the payment itself was not recorded individually",
        debit: amt, credit: 0, unposted: false });
    }
  }
  return items;
}

/**
 * Per-vendor totals of the same bills and payments loadVendorItems() lists, summed in SQL so the
 * Trial Balance does not pull ~35,000 rows into memory. Same rules: a bill is a credit, recorded
 * payments plus any paid_amount without detail are debits, a paid_amount smaller than the recorded
 * payments is a credit adjustment, GRNs settled before tracking count as bill + equal payment.
 */
async function loadVendorTotals(opts: {
  asOf?: string; scope?: FinanceBranchScope; branchId?: string; costCentreId?: string; processId?: string;
}): Promise<Map<string, { bills: number; payments: number; adjustments: number; unposted: number }>> {
  const asOf = opts.asOf ?? "9999-12-31";
  const out = new Map<string, { bills: number; payments: number; adjustments: number; unposted: number }>();
  const slot = (id: string) => { let v = out.get(id); if (!v) { v = { bills: 0, payments: 0, adjustments: 0, unposted: 0 }; out.set(id, v); } return v; };

  const bc = ["NOT (vpt.payment_status = 'Rejected' AND COALESCE(vpt.paid_amount,0) = 0)"];
  const bp: unknown[] = [asOf, asOf, asOf, asOf, asOf];
  if (opts.branchId) { bc.push("vpt.branch_id = ?"); bp.push(opts.branchId); }
  if (opts.costCentreId) { bc.push("vpt.cost_centre_id = ?"); bp.push(opts.costCentreId); }
  if (opts.processId) { bc.push("vpt.process_id = ?"); bp.push(opts.processId); }
  pushBranchScope(bc, bp, opts.scope, "vpt.branch_id");
  const [tracked] = await db.execute<RowDataPacket[]>(
    `SELECT vpt.vendor_id,
            SUM(CASE WHEN COALESCE(g.bill_date, DATE(vpt.created_at)) <= ? THEN vpt.due_amount ELSE 0 END) AS bills,
            SUM(CASE WHEN COALESCE(g.bill_date, DATE(vpt.created_at)) <= ? AND jj.source_id IS NULL THEN vpt.due_amount ELSE 0 END) AS unposted,
            SUM(COALESCE(x.s_asof, 0)) AS tx_paid,
            SUM(CASE WHEN vpt.paid_amount - COALESCE(x.s, 0) > 0.005 AND COALESCE(vpt.payment_date, g.bill_date, DATE(vpt.created_at)) <= ?
                     THEN vpt.paid_amount - COALESCE(x.s, 0) ELSE 0 END) AS gap_paid,
            SUM(CASE WHEN vpt.paid_amount - COALESCE(x.s, 0) < -0.005 AND COALESCE(vpt.payment_date, g.bill_date, DATE(vpt.created_at)) <= ?
                     THEN COALESCE(x.s, 0) - vpt.paid_amount ELSE 0 END) AS adj
       FROM vendor_payment_tracking vpt
       LEFT JOIN grn_request g ON g.id = vpt.grn_request_id
       LEFT JOIN (SELECT vendor_payment_id, SUM(amount) AS s, SUM(CASE WHEN payment_date <= ? THEN amount ELSE 0 END) AS s_asof
                    FROM vendor_payment_transaction GROUP BY vendor_payment_id) x ON x.vendor_payment_id = vpt.id
       LEFT JOIN (SELECT DISTINCT source_id FROM journal_entry WHERE source_type = 'grn' AND reversed_by_entry_id IS NULL) jj
              ON jj.source_id = vpt.grn_request_id
      WHERE ${bc.join(" AND ")}
      GROUP BY vpt.vendor_id`, bp);
  for (const r of tracked as RowDataPacket[]) {
    const v = slot(String(r.vendor_id));
    v.bills += Number(r.bills); v.unposted += Number(r.unposted);
    v.payments += Number(r.tx_paid) + Number(r.gap_paid); v.adjustments += Number(r.adj);
  }

  if (!opts.processId) {
    const gc = ["g.status = 'paid'", "g.vendor_id IS NOT NULL", "COALESCE(g.bill_date, DATE(g.created_at)) <= ?",
      "NOT EXISTS (SELECT 1 FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id)"];
    const gp: unknown[] = [asOf];
    if (opts.branchId) { gc.push("g.branch_id = ?"); gp.push(opts.branchId); }
    if (opts.costCentreId) { gc.push("g.cost_centre_id = ?"); gp.push(opts.costCentreId); }
    pushBranchScope(gc, gp, opts.scope, "g.branch_id");
    const [legacy] = await db.execute<RowDataPacket[]>(
      `SELECT g.vendor_id, SUM(COALESCE(NULLIF(g.amount_with_tax, 0), g.amount)) AS amt,
              SUM(CASE WHEN jj.source_id IS NULL THEN COALESCE(NULLIF(g.amount_with_tax, 0), g.amount) ELSE 0 END) AS unposted
         FROM grn_request g
         LEFT JOIN (SELECT DISTINCT source_id FROM journal_entry WHERE source_type = 'grn' AND reversed_by_entry_id IS NULL) jj ON jj.source_id = g.id
        WHERE ${gc.join(" AND ")}
        GROUP BY g.vendor_id`, gp);
    for (const r of legacy as RowDataPacket[]) {
      const v = slot(String(r.vendor_id));
      v.bills += Number(r.amt); v.payments += Number(r.amt); v.unposted += Number(r.unposted);
    }
  }
  return out;
}

/**
 * Vendor GRNs that count as spend but have no GRN journal entry (their head/sub-head did not match
 * an active ledger head when they were approved, so posting was refused). The Head / Sub-head
 * Spend report and the sub-head drill-down add them, so spend is not understated; a GRN whose head
 * still has no matching ledger head is shown under "(no matching ledger head) <head> / <sub-head>".
 */
async function unpostedPurchases(opts: {
  from?: string; to?: string; subHeadId?: string; scope?: FinanceBranchScope; branchId?: string; costCentreId?: string; processId?: string;
}): Promise<RowDataPacket[]> {
  const c = [
    "g.grn_type = 'vendor'",
    "g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')",
    "NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type = 'grn' AND je.source_id = g.id AND je.reversed_by_entry_id IS NULL)",
  ];
  const p: unknown[] = [];
  if (opts.from) { c.push("COALESCE(g.bill_date, DATE(g.created_at)) >= ?"); p.push(opts.from); }
  if (opts.to) { c.push("COALESCE(g.bill_date, DATE(g.created_at)) <= ?"); p.push(opts.to); }
  if (opts.branchId) { c.push("g.branch_id = ?"); p.push(opts.branchId); }
  if (opts.costCentreId) { c.push("g.cost_centre_id = ?"); p.push(opts.costCentreId); }
  if (opts.processId) { c.push("g.process_id = ?"); p.push(opts.processId); }
  if (opts.subHeadId) {
    if (opts.subHeadId.startsWith("unmapped:")) return [];
    c.push("sh.id = ?"); p.push(opts.subHeadId);
  }
  pushBranchScope(c, p, opts.scope, "g.branch_id");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.invoice_number, g.head, g.sub_head, g.vendor_id, g.branch_id, g.cost_centre_id, g.process_id,
            COALESCE(g.bill_date, DATE(g.created_at)) AS bill_day,
            COALESCE(NULLIF(g.amount_with_tax, 0), g.amount) AS amt, sh.id AS sub_head_id
       FROM grn_request g
       LEFT JOIN finance_expense_head_master h ON LOWER(TRIM(h.head_name)) = LOWER(TRIM(g.head)) AND h.active_status = 1
       LEFT JOIN finance_expense_sub_head_master sh ON sh.head_id = h.id AND LOWER(TRIM(sh.sub_head_name)) = LOWER(TRIM(g.sub_head)) AND sh.active_status = 1
      WHERE ${c.join(" AND ")}`, p);
  return rows as RowDataPacket[];
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

type TbResult = { rows: TrialBalanceRow[]; balanced: boolean; totalDebit: number; totalCredit: number };
const TB_FRESH_MS = 5 * 60_000;
const TB_STALE_MS = 60 * 60_000;
const tbCache = new Map<string, { at: number; value: TbResult; inflight?: Promise<TbResult> }>();

/**
 * The Trial Balance reads ~40,000 journal entries plus every vendor bill and payment over a slow
 * link to the database, which takes a minute. Served from a short-lived cache: fresh for 5 minutes,
 * then returned stale for up to an hour while one background refresh runs. Off under tests.
 */
async function cachedTrialBalance(
  asOfDate: string | undefined, filters: { branchId?: string; costCentreId?: string; processId?: string } | undefined,
  scope: FinanceBranchScope | undefined, compute: () => Promise<TbResult>,
): Promise<TbResult> {
  if (process.env.VITEST) return compute();
  const key = JSON.stringify([asOfDate ?? null, filters ?? null, !scope || scope.mode === "all" ? "all" : [...scope.branchIds].sort()]);
  const now = Date.now();
  const hit = tbCache.get(key);
  const refresh = () => {
    const inflight = compute().then((value) => { tbCache.set(key, { at: Date.now(), value }); return value; })
      .catch((e) => { const cur = tbCache.get(key); if (cur) tbCache.set(key, { at: cur.at, value: cur.value }); throw e; });
    tbCache.set(key, { at: hit?.at ?? 0, value: hit?.value as TbResult, inflight });
    return inflight;
  };
  if (hit?.value && now - hit.at < TB_FRESH_MS) return hit.value;
  if (hit?.value && now - hit.at < TB_STALE_MS) { if (!hit.inflight) refresh().catch(() => undefined); return hit.value; }
  if (hit?.inflight) return hit.inflight;
  return refresh();
}

/** Keeps the default (org-wide, unfiltered) Trial Balance warm so the first open is instant. */
export function startTrialBalanceWarmer() {
  if (process.env.VITEST || process.env.NODE_ENV !== "production") return;
  const warm = () => { void ledgerReportsService.trialBalance(undefined, undefined, { mode: "all" } as FinanceBranchScope).catch(() => undefined); };
  setTimeout(warm, 45_000).unref?.();
  setInterval(warm, 8 * 60_000).unref?.();
}

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
      branches: (branches as RowDataPacket[]).map((r) => ({
        id: String(r.id),
        name: r.branch_name,
      })),
      costCentres: (costCentres as RowDataPacket[]).map((r) => ({
        id: String(r.id),
        name: r.cost_centre_name,
      })),
      processes: (processes as RowDataPacket[]).map((r) => ({
        id: String(r.id),
        name: r.process_name,
      })),
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
    return cachedTrialBalance(asOfDate, filters, scope, () => ledgerReportsService.computeTrialBalance(asOfDate, filters, scope));
  },

  async computeTrialBalance(
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

    // Unfiltered (the default view): one sequential pass over the lines, minus the lines of the few
    // reversed entries, instead of a per-entry join — the join is ~40,000 lookups and took ~47s.
    const unfiltered = !asOfDate && !filters?.branchId && !filters?.costCentreId && !filters?.processId && (!scope || scope.mode === "all");
    const journalPromise: Promise<RowDataPacket[]> = unfiltered
      ? (async () => {
          const [all] = await db.execute<RowDataPacket[]>(
            `SELECT account_type, account_id, SUM(debit_amount) AS total_debit, SUM(credit_amount) AS total_credit
               FROM journal_entry_line GROUP BY account_type, account_id`);
          const [reversed] = await db.execute<RowDataPacket[]>(
            `SELECT jel.account_type, jel.account_id, SUM(jel.debit_amount) AS total_debit, SUM(jel.credit_amount) AS total_credit
               FROM journal_entry_line jel JOIN journal_entry je ON je.id = jel.journal_entry_id
              WHERE je.reversed_by_entry_id IS NOT NULL GROUP BY jel.account_type, jel.account_id`);
          const minus = new Map((reversed as RowDataPacket[]).map((r) => [`${r.account_type}:${r.account_id}`, r]));
          return (all as RowDataPacket[]).map((r) => {
            const m = minus.get(`${r.account_type}:${r.account_id}`);
            return { ...r, total_debit: Number(r.total_debit) - Number(m?.total_debit ?? 0), total_credit: Number(r.total_credit) - Number(m?.total_credit ?? 0) } as RowDataPacket;
          }).filter((r) => Number(r.total_debit) !== 0 || Number(r.total_credit) !== 0).sort((x, y) => String(x.account_type).localeCompare(String(y.account_type)) || String(x.account_id).localeCompare(String(y.account_id)));
        })()
      : db.execute<RowDataPacket[]>(
          `SELECT jel.account_type, jel.account_id,
                  SUM(jel.debit_amount) AS total_debit, SUM(jel.credit_amount) AS total_credit
             FROM journal_entry_line jel
             JOIN journal_entry je ON je.id = jel.journal_entry_id
            WHERE ${conditions.join(" AND ")}
            GROUP BY jel.account_type, jel.account_id
            ORDER BY jel.account_type, jel.account_id`,
          params,
        ).then(([r]) => r as RowDataPacket[]);
    const [rows, totals] = await Promise.all([
      journalPromise,
      loadVendorTotals({ asOf: asOfDate, scope, branchId: filters?.branchId, costCentreId: filters?.costCentreId, processId: filters?.processId }),
    ]);

    // Vendor accounts are NOT taken from the journal: it holds the bills but almost none of the
    // payments, so every vendor showed as owed its whole history. They are rebuilt from the bill
    // and payment records (the same source as the Vendor Ledger), and two balancing rows carry
    // the other side so the report still has to add up on its own:
    //   - payments made (Cr bank/cash) - the other half of every vendor debit;
    //   - purchases with no expense-head posting yet (Dr) - bills that have no GRN journal entry.
    const journalRows = rows.filter((r) => r.account_type !== "vendor");
    const refs = journalRows.map((r) => ({ accountType: r.account_type as AccountType, accountId: String(r.account_id) }));
    const names = await resolveAccountNames(refs);

    let paymentsTotal = 0, unpostedTotal = 0;
    for (const v of totals.values()) { paymentsTotal += v.payments - v.adjustments; unpostedTotal += v.unposted; }
    const vendorNames = await resolveAccountNames([...totals.keys()].map((id) => ({ accountType: "vendor" as AccountType, accountId: id })));

    let totalDebit = 0;
    let totalCredit = 0;
    const result: TrialBalanceRow[] = journalRows.map((r) => {
      const totalD = money(Number(r.total_debit));
      const totalC = money(Number(r.total_credit));
      totalDebit += totalD;
      totalCredit += totalC;
      return {
        accountType: r.account_type,
        accountId: String(r.account_id),
        accountName:
          names.get(`${r.account_type}:${r.account_id}`) ??
          `(unresolved ${r.account_type} ${r.account_id})`,
        totalDebit: totalD,
        totalCredit: totalC,
        netBalance: money(totalD - totalC),
      };
    });
    for (const [vendorId, v] of totals) {
      const totalD = money(v.payments), totalC = money(v.bills + v.adjustments);
      if (totalD === 0 && totalC === 0) continue;
      totalDebit += totalD; totalCredit += totalC;
      result.push({
        accountType: "vendor", accountId: vendorId,
        accountName: vendorNames.get(`vendor:${vendorId}`) ?? `(unresolved vendor ${vendorId})`,
        totalDebit: totalD, totalCredit: totalC, netBalance: money(totalD - totalC),
      });
    }
    const synth = (name: string, debit: number, credit: number) => {
      const d = money(debit), c = money(credit);
      if (!d && !c) return;
      totalDebit += d; totalCredit += c;
      result.push({ accountType: "payable_account", accountId: `synthetic:${name}`, accountName: name, totalDebit: d, totalCredit: c, netBalance: money(d - c) });
    };
    synth("Payments made to vendors (bank / cash)", 0, paymentsTotal);
    synth("Purchases not yet posted to an expense head", unpostedTotal, 0);

    return {
      rows: result,
      balanced: money(totalDebit) === money(totalCredit),
      totalDebit: money(totalDebit),
      totalCredit: money(totalCredit),
    };
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
    // Spend on this sub-head that was never journaled (see unpostedPurchases).
    const unposted = accountType === "expense_sub_head"
      ? (await unpostedPurchases({ from, to, subHeadId: accountId, scope })).map((u) => ({
          journal_entry_id: `grn:${u.id}`, entry_date: u.bill_day, narration: `GRN ${u.grn_number ?? u.id} (not yet posted to the ledger) — ${u.head} / ${u.sub_head}`,
          source_type: "grn_unposted", source_id: u.id, branch_id: u.branch_id, cost_centre_id: u.cost_centre_id, process_id: u.process_id,
          debit_amount: u.amt, credit_amount: 0, line_narration: null,
        } as unknown as RowDataPacket))
      : [];

    const allRows = [...(rows as RowDataPacket[]), ...dispatched, ...unposted];
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
        branchName: r.branch_id
          ? (branchNames.get(String(r.branch_id)) ?? null)
          : null,
        costCentreId: r.cost_centre_id,
        costCentreName: r.cost_centre_id
          ? (costCentreNames.get(String(r.cost_centre_id)) ?? null)
          : null,
        processId: r.process_id,
        processName: r.process_id
          ? (processNames.get(String(r.process_id)) ?? null)
          : null,
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

    const items = (await loadVendorItems({ vendorIds: ids, scope })).map((it) => ({ ...it }));
    items.sort((x, y) => x.day.localeCompare(y.day) || (x.credit > 0 ? 0 : 1) - (y.credit > 0 ? 0 : 1));

    type Item = VendorItem;
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

  /** Account-ledger shape (used by the Trial Balance drill-down) for a vendor, from the statement. */
  async vendorAsAccountLedger(vendorId: string, from?: string, to?: string, scope?: FinanceBranchScope) {
    const st = await ledgerReportsService.vendorStatement(vendorId, from, to, scope);
    if (!st) return { entries: [], closingBalance: 0 };
    let running = st.opening.side === "Cr" ? -st.opening.amount : st.opening.amount;
    const entries = st.rows.map((r, i) => {
      running = money(running + r.debit - r.credit);
      return {
        journalEntryId: `vs:${i}`, entryDate: r.date, narration: [r.particulars, r.vchNo, r.reference].filter(Boolean).join(" · "),
        sourceType: r.vchType === "Purchase" ? "grn" : "vendor_payment", sourceId: r.vchNo, branchId: null, branchName: r.branchName,
        costCentreId: null, costCentreName: null, processId: null, processName: null,
        debitAmount: r.debit, creditAmount: r.credit, runningBalance: running,
      };
    });
    return { entries, closingBalance: running };
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
    const conditions = [
      "jel.account_type = 'expense_sub_head'",
      "je.reversed_by_entry_id IS NULL",
    ];
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

    const unposted = await unpostedPurchases({ from, to, scope, ...filters });
    const merged = new Map<string, { accountId: string; label?: string; total: number; count: number }>();
    for (const r of rows as RowDataPacket[]) {
      merged.set(String(r.account_id), { accountId: String(r.account_id), total: Number(r.total_spent), count: Number(r.grn_count) });
    }
    for (const u of unposted) {
      const id = u.sub_head_id ? String(u.sub_head_id) : `unmapped:${String(u.head ?? "").trim()}/${String(u.sub_head ?? "").trim()}`;
      const cur = merged.get(id) ?? { accountId: id, label: u.sub_head_id ? undefined : `(no matching ledger head) ${u.head} / ${u.sub_head}`, total: 0, count: 0 };
      cur.total += Number(u.amt); cur.count += 1;
      merged.set(id, cur);
    }

    const refs = [...merged.values()].filter((m) => !m.accountId.startsWith("unmapped:")).map((m) => ({ accountType: "expense_sub_head" as const, accountId: m.accountId }));
    const names = await resolveAccountNames(refs);

    return [...merged.values()].sort((x, y) => y.total - x.total).map((m) => ({
      accountId: m.accountId,
      headSubHead: m.label ?? names.get(`expense_sub_head:${m.accountId}`) ?? `(unresolved ${m.accountId})`,
      totalSpent: money(m.total),
      grnCount: m.count,
    }));
  },
};
