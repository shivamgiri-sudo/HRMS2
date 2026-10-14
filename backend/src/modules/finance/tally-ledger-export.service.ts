import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { grnBranchCode } from "./grn-tally-context.js";
import { loadGrnTallyDownload } from "./grn-tally-download.service.js";
import { monthEnd, wrapTallyEnvelope, xmlEscape } from "./grn-tally-voucher.js";
import { grnLedgerGroup, TallyMasters, type TallyGroup } from "./tally-ledger-masters.js";

/**
 * Finance Ledger -> Tally, one month at a time (the "Tally Export" tab on /finance/ledger).
 *
 * Tally imports masters and vouchers; it builds Trial Balance, P&L, Balance Sheet, Day Book and the
 * party ledgers itself from those vouchers. So every TRANSACTION the ledger page shows is exported as a
 * Tally voucher, with the masters it needs, and the reports are left for Tally to compute:
 *
 *   grn        GRN purchase journals (JrnlP / JRNLIMP), the legacy import format (grn-tally-voucher.ts)
 *   payments   released payment vouchers from the general ledger: Payment / Receipt / Contra, and Journal
 *              for an advance applied to a bill; plus imprest top-ups disbursed straight from the bank
 *   journals   approved journal vouchers and bank-reconciliation adjustments (Journal)
 *   masters    every ledger, cost category / centre and voucher type the above use
 *
 * Ledger names are the Tally names HRMS keeps: vendor_master.tally_name, payable_account_master and
 * company_bank_account.tally_ledger_name, the expense sub-head name, imprest_manager.tally_name. The GL's
 * generic "Imprest Float" line becomes the holder's own ledger, and a TDS line on a vendor payment is
 * dropped (TDS is booked on the GRN purchase journal and the vendor is paid net), so nothing is booked
 * twice. Payroll (JRNLSAL) and GST sales invoices keep their own exports on their own pages.
 *
 * Read-only: builds files, writes nothing.
 */

export type LedgerTallyKind = "all" | "masters" | "grn" | "payments" | "journals";

type Line = { ledger: string; amount: number; dr: boolean; group: TallyGroup; costCategory?: string; costCentre?: string };
type Voucher = { kind: "grn" | "payments" | "journals"; remoteId: string; type: string; number: string; date: string; narration: string; lines: Line[] };
export type LedgerTallySummary = {
  month: string;
  counts: Record<string, number>;
  totals: Record<string, number>;
  masters: TallyMasters["counts"];
  exceptions: { kind: string; ref: string; reason: string }[];
};

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ymd = (v: unknown) => {
  if (!v) return "";
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const tdate = (d: string) => d.replace(/-/g, "");
const inList = (ids: string[]) => ids.map(() => "?").join(",");

async function byId(table: string, columns: string, ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (!ids.length) return out;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT id, ${columns} FROM ${table} WHERE id IN (${inList(ids)})`, ids);
  for (const r of rows) out.set(String(r.id), r);
  return out;
}

/** Legacy Tally names (migration 2210 side table) for these ids; empty before the table exists. */
async function legacyNames(entityType: "branch" | "expense_sub_head", ids: string[]): Promise<Map<string, { name: string | null; code: string | null }>> {
  const out = new Map<string, { name: string | null; code: string | null }>();
  if (!ids.length) return out;
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT entity_id, tally_name, tally_code FROM tally_legacy_name WHERE entity_type = ? AND entity_id IN (${inList(ids)})`, [entityType, ...ids]);
    for (const r of rows) out.set(String(r.entity_id), { name: String(r.tally_name ?? "").trim() || null, code: String(r.tally_code ?? "").trim() || null });
  } catch { /* table not created yet */ }
  return out;
}

export function ledgerVoucherXml(v: Pick<Voucher, "remoteId" | "type" | "number" | "date" | "narration" | "lines">): string {
  const entries = v.lines
    .filter((l) => r2(l.amount) !== 0)
    .map((l) => {
      const signed = (l.dr ? -Math.abs(l.amount) : Math.abs(l.amount)).toFixed(2);
      const alloc = l.costCategory && l.costCentre
        ? `<CATEGORYALLOCATIONS.LIST><CATEGORY>${xmlEscape(l.costCategory)}</CATEGORY><COSTCENTREALLOCATIONS.LIST><NAME>${xmlEscape(l.costCentre)}</NAME><AMOUNT>${signed}</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>`
        : "";
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEscape(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${l.dr ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${signed}</AMOUNT>${alloc}</ALLLEDGERENTRIES.LIST>`;
    })
    .join("");
  // REMOTEID: fixed per source record, so a second import of the same file is ignored, not duplicated.
  return `<VOUCHER REMOTEID="${xmlEscape(v.remoteId)}" VCHTYPE="${xmlEscape(v.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${tdate(v.date)}</DATE><VOUCHERTYPENAME>${xmlEscape(v.type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${xmlEscape(v.number)}</VOUCHERNUMBER><NARRATION>${xmlEscape(v.narration.slice(0, 480))}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${entries}</VOUCHER>`;
}

/** Group for a payable_account_master head. */
function payableGroup(accountType: string, name: string): TallyGroup {
  if (accountType === "receivable") return "Sundry Debtors";
  if (accountType === "income") return "Indirect Incomes";
  if (accountType === "expense" || accountType === "bank_charge") return "Indirect Expenses";
  if (/tds|gst|tax|statutory/i.test(name)) return "Duties & Taxes";
  if (/imprest|advance/i.test(name)) return "Loans & Advances (Asset)";
  return "Current Liabilities";
}

/** Vouchers posted to the general ledger in the month: payment vouchers, journal vouchers, bank adjustments. */
async function glVouchers(month: string, masters: TallyMasters, exceptions: LedgerTallySummary["exceptions"]): Promise<Voucher[]> {
  const from = `${month}-01`;
  const [entries] = await db.query<RowDataPacket[]>(
    `SELECT id, entry_date, narration, source_type, source_id, branch_id FROM journal_entry
      WHERE entry_date >= ? AND entry_date <= ? AND source_type IN ('payment_voucher','manual','bank_reconciliation_adjustment')
      ORDER BY entry_date, posted_at`,
    [from, monthEnd(from)],
  );
  if (!entries.length) return [];
  const entryIds = entries.map((e) => String(e.id));
  const [lineRows] = await db.query<RowDataPacket[]>(
    `SELECT journal_entry_id, line_order, account_type, account_id, debit_amount, credit_amount FROM journal_entry_line
      WHERE journal_entry_id IN (${inList(entryIds)}) ORDER BY journal_entry_id, line_order`,
    entryIds,
  );
  const linesBy = new Map<string, RowDataPacket[]>();
  for (const l of lineRows) { const k = String(l.journal_entry_id); if (!linesBy.has(k)) linesBy.set(k, []); linesBy.get(k)!.push(l); }
  const idsOf = (type: string) => [...new Set(lineRows.filter((l) => l.account_type === type).map((l) => String(l.account_id)))];

  const vendors = await byId("vendor_master", "COALESCE(NULLIF(TRIM(tally_name), ''), vendor_name) AS n", idsOf("vendor"));
  const payables = await byId("payable_account_master", "tally_ledger_name AS n, account_name, account_type", idsOf("payable_account"));
  const banks = await byId("company_bank_account", "tally_ledger_name AS n", idsOf("bank_account"));
  const subHeads = await byId("finance_expense_sub_head_master", "sub_head_name AS n, pnl_bucket", idsOf("expense_sub_head"));
  for (const [id, l] of await legacyNames("expense_sub_head", [...subHeads.keys()])) if (l.name) subHeads.get(id).n = l.name;
  const branches = await byId("branch_master", "branch_name AS n, branch_name, NULL AS code",
    [...new Set(entries.map((e) => String(e.branch_id ?? "")).filter(Boolean))]);
  for (const [id, l] of await legacyNames("branch", [...branches.keys()])) {
    const b = branches.get(id);
    if (l.name) b.n = l.name;
    b.code = l.code;
  }
  const pvs = await byId("payment_voucher",
    "voucher_number, voucher_type, source_type, linked_imprest_manager_id, linked_client_invoice_id, transaction_ref, particulars, remarks",
    entries.filter((e) => e.source_type === "payment_voucher").map((e) => String(e.source_id)));
  const holders = await byId("imprest_manager", "tally_name AS n", [...new Set([...pvs.values()].map((p) => String(p.linked_imprest_manager_id ?? "")).filter(Boolean))]);
  const invoices = await byId("client_invoice", "client_tally_name AS n", [...new Set([...pvs.values()].map((p) => String(p.linked_client_invoice_id ?? "")).filter(Boolean))]);
  const [jvRows] = await db.query<RowDataPacket[]>(
    `SELECT journal_entry_id, reversal_entry_id, voucher_number, narration FROM journal_voucher
      WHERE journal_entry_id IN (${inList(entryIds)}) OR reversal_entry_id IN (${inList(entryIds)})`,
    [...entryIds, ...entryIds],
  );
  const jvBy = new Map<string, { number: string; narration: string }>();
  for (const j of jvRows) {
    if (j.journal_entry_id) jvBy.set(String(j.journal_entry_id), { number: String(j.voucher_number), narration: String(j.narration ?? "") });
    if (j.reversal_entry_id) jvBy.set(String(j.reversal_entry_id), { number: `${j.voucher_number}-REV`, narration: `Reversal of ${j.voucher_number}: ${j.narration ?? ""}` });
  }

  const out: Voucher[] = [];
  for (const e of entries) {
    const date = ymd(e.entry_date);
    const b = branches.get(String(e.branch_id ?? ""));
    const branch = b?.n as string | undefined;
    const code = (b?.code as string | null) || (b ? grnBranchCode(String(b.branch_name ?? b.n)) : null);
    const centre = code ? `${code}/${date.slice(2, 4)}${date.slice(5, 7)}` : undefined;
    const pv = e.source_type === "payment_voucher" ? pvs.get(String(e.source_id)) : undefined;
    const ref = pv?.voucher_number ?? jvBy.get(String(e.id))?.number ?? `${e.source_type === "manual" ? "JE" : "BRA"}-${String(e.id).slice(0, 8)}`;
    let bad = "";
    const lines: Line[] = [];
    for (const l of linesBy.get(String(e.id)) ?? []) {
      const amount = r2(Number(l.debit_amount) > 0 ? l.debit_amount : l.credit_amount);
      const dr = Number(l.debit_amount) > 0;
      const id = String(l.account_id);
      if (l.account_type === "vendor") lines.push({ ledger: vendors.get(id)?.n ?? "", amount, dr, group: "Sundry Creditors" });
      else if (l.account_type === "bank_account") lines.push({ ledger: banks.get(id)?.n ?? "", amount, dr, group: "Bank Accounts" });
      else if (l.account_type === "expense_sub_head") {
        const s = subHeads.get(id);
        lines.push({ ledger: s?.n ?? "", amount, dr, group: s?.pnl_bucket === "capex" ? "Fixed Assets" : "Indirect Expenses", costCategory: branch, costCentre: centre });
      } else {
        const p = payables.get(id);
        const name = String(p?.account_name ?? "");
        if (pv?.source_type === "imprest_allocation" && /imprest/i.test(name)) {
          // Imprest top-up through a payment voucher: the GL's generic float is the holder's own ledger in Tally.
          const holder = holders.get(String(pv.linked_imprest_manager_id ?? ""))?.n;
          if (!holder) bad = "imprest holder has no Tally ledger name";
          lines.push({ ledger: holder ?? "", amount, dr, group: "Loans & Advances (Asset)" });
        } else if (pv?.source_type === "sales_receipt" && p?.account_type === "receivable" && invoices.get(String(pv.linked_client_invoice_id ?? ""))?.n) {
          lines.push({ ledger: invoices.get(String(pv.linked_client_invoice_id))!.n, amount, dr, group: "Sundry Debtors" });
        } else {
          const group = payableGroup(String(p?.account_type ?? ""), name);
          lines.push({ ledger: p?.n ?? "", amount, dr, group, ...(group === "Indirect Expenses" ? { costCategory: branch, costCentre: centre } : {}) });
        }
      }
    }
    // TDS on a vendor payment: booked on the GRN journal already, so drop it and debit the vendor net.
    if (pv && (pv.source_type === "vendor_grn" || pv.source_type === "vendor_advance_application")) {
      const tds = lines.filter((l) => !l.dr && l.group === "Duties & Taxes");
      const vendorLine = lines.find((l) => l.dr && l.group === "Sundry Creditors");
      if (tds.length && vendorLine) {
        vendorLine.amount = r2(vendorLine.amount - tds.reduce((s, t) => s + t.amount, 0));
        for (const t of tds) lines.splice(lines.indexOf(t), 1);
      }
    }
    if (lines.some((l) => !l.ledger.trim())) bad ||= "a line has no Tally ledger name (check the vendor / bank / ledger head)";
    const dr = r2(lines.filter((l) => l.dr).reduce((s, l) => s + l.amount, 0));
    const cr = r2(lines.filter((l) => !l.dr).reduce((s, l) => s + l.amount, 0));
    if (Math.abs(dr - cr) > 0.009) bad ||= `debits ${dr} and credits ${cr} do not balance`;
    const kind = pv ? "payments" : "journals";
    if (bad) { exceptions.push({ kind, ref, reason: bad }); continue; }

    const type = !pv ? "Journal"
      : pv.source_type === "internal_transfer" ? "Contra"
      : pv.source_type === "vendor_advance_application" ? "Journal"
      : pv.voucher_type === "receipt" ? "Receipt" : "Payment";
    const narration = pv
      ? [pv.particulars, pv.remarks, e.narration, pv.transaction_ref ? `Ref ${pv.transaction_ref}` : "", `Vch ${pv.voucher_number}`].filter(Boolean).join(" | ")
      : jvBy.get(String(e.id))?.narration || String(e.narration ?? "");
    for (const l of lines) { masters.ledger(l.ledger, l.group); if (l.costCategory && l.costCentre) masters.costCentre(l.costCategory, l.costCentre); }
    out.push({ kind, remoteId: `HRMS-JE-${e.id}`, type, number: ref, date, narration, lines });
  }
  return out;
}

/** Imprest top-ups disbursed straight from the bank (no payment voucher, so not in the GL). */
async function directImprestTopUps(month: string, masters: TallyMasters, exceptions: LedgerTallySummary["exceptions"]): Promise<Voucher[]> {
  const from = `${month}-01`;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT a.allocation_no, a.allocation_date, a.amount, a.reference_no, a.remarks, a.imprest_manager_id, a.company_bank_account_id
       FROM imprest_allocation a
      WHERE a.status = 'disbursed' AND a.bill_source_id IS NULL AND a.company_bank_account_id IS NOT NULL
        AND a.allocation_date >= ? AND a.allocation_date <= ?
        AND EXISTS (SELECT 1 FROM bank_account_ledger_entry b
                     WHERE b.source_type = 'direct_imprest_allocation' AND b.narration LIKE CONCAT('Imprest allocation ', a.allocation_no, ' %'))`,
    [from, monthEnd(from)],
  );
  const holders = await byId("imprest_manager", "tally_name AS n", [...new Set(rows.map((r) => String(r.imprest_manager_id)))]);
  const banks = await byId("company_bank_account", "tally_ledger_name AS n", [...new Set(rows.map((r) => String(r.company_bank_account_id)))]);
  const out: Voucher[] = [];
  for (const r of rows) {
    const holder = holders.get(String(r.imprest_manager_id))?.n;
    const bank = banks.get(String(r.company_bank_account_id))?.n;
    if (!holder || !bank) {
      exceptions.push({ kind: "payments", ref: String(r.allocation_no), reason: !holder ? "imprest holder has no Tally ledger name" : "bank account has no Tally ledger name" });
      continue;
    }
    const amount = r2(r.amount);
    masters.ledger(holder, "Loans & Advances (Asset)");
    masters.ledger(bank, "Bank Accounts");
    out.push({
      kind: "payments", remoteId: `HRMS-IMP-${r.allocation_no}`, type: "Payment", number: String(r.allocation_no), date: ymd(r.allocation_date),
      narration: [`Imprest top-up ${r.allocation_no}`, r.remarks, r.reference_no ? `Ref ${r.reference_no}` : ""].filter(Boolean).join(" | "),
      lines: [{ ledger: holder, amount, dr: true, group: "Loans & Advances (Asset)" }, { ledger: bank, amount, dr: false, group: "Bank Accounts" }],
    });
  }
  return out;
}

export async function buildLedgerTallyExport(opts: { month: string; kind: LedgerTallyKind }): Promise<{ xml: string; summary: LedgerTallySummary }> {
  const { month, kind } = opts;
  const masters = new TallyMasters();
  const exceptions: LedgerTallySummary["exceptions"] = [];
  const vouchers: Voucher[] = [];

  // GRN purchase journals, vendor and imprest; posting month = month approved (as the legacy import).
  const grn = await loadGrnTallyDownload({ branchScope: { mode: "all" }, month, grnType: "all" });
  for (const r of grn.rows) {
    if (r.exception || !r.header) { exceptions.push({ kind: "grn", ref: r.grnNumber, reason: r.exception ?? "not built" }); continue; }
    const imprest = r.grnType === "imprest";
    const party = r.entries.find((e) => e.side === "Cr" && !/^(TDS |Short\/Excess)/i.test(e.ledger))?.ledger;
    for (const e of r.entries) masters.ledger(e.ledger, grnLedgerGroup(e.ledger, e.side, e.ledger === party, imprest));
    masters.costCentre(r.header.costCategory, r.header.costCentre);
    masters.voucherType(r.header.voucherType, "Journal");
    vouchers.push({ kind: "grn", remoteId: `HRMS-GRN-${r.grnId}`, type: r.header.voucherType, number: r.header.voucherNumber, date: r.header.date, narration: r.header.narration, lines: [] });
  }

  vouchers.push(...(await glVouchers(month, masters, exceptions)), ...(await directImprestTopUps(month, masters, exceptions)));

  const wanted = (k: Voucher["kind"]) => kind === "all" || kind === k;
  const messages: string[] = [];
  if (kind === "all" || kind === "masters") messages.push(...masters.messages());
  if (wanted("grn")) messages.push(...grn.vouchersXml);
  for (const v of vouchers) if (v.kind !== "grn" && wanted(v.kind)) messages.push(ledgerVoucherXml(v));

  const count = (k: Voucher["kind"]) => vouchers.filter((v) => v.kind === k).length;
  const total = (k: Voucher["kind"]) =>
    r2(vouchers.filter((v) => v.kind === k).reduce((s, v) => s + v.lines.filter((l) => l.dr).reduce((a, l) => a + l.amount, 0), 0));
  const summary: LedgerTallySummary = {
    month,
    counts: { grn: count("grn"), payments: count("payments"), journals: count("journals"), exceptions: exceptions.length },
    totals: { grn: r2(grn.rows.filter((r) => !r.exception).reduce((s, r) => s + r.gross, 0)), payments: total("payments"), journals: total("journals") },
    masters: masters.counts,
    exceptions,
  };
  return { xml: wrapTallyEnvelope(messages), summary };
}
