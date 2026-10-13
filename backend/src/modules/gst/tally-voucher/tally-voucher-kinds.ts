/**
 * Voucher kinds: how a source document becomes a TallyVoucherModel.
 *
 * Each kind is a small module registered in KIND_REGISTRY. The service iterates the registry, so
 * the Receipt voucher (built later, once client_receipt exists) plugs in by calling
 * registerVoucherKind() with a collector that returns BuiltVoucher[] - no change to the XML
 * writer, the exception checker, the batch tracking, the routes or the UI.
 */

import type { RowDataPacket } from "mysql2";
import { gstinStateCode } from "../gst-export.service.js";
import { checkVoucher } from "./tally-voucher-check.js";
import { deriveVoucherGuid } from "./tally-voucher-xml.js";
import type {
  TallyException,
  TallyLedgerConfig,
  TallyLedgerEntry,
  TallySourceType,
  TallyVoucherKind,
  TallyVoucherModel,
} from "./tally-voucher.types.js";

/** GST state code -> the state name Tally Prime expects in PLACEOFSUPPLY / STATENAME. */
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export interface BuiltVoucher {
  model: TallyVoucherModel;
  errors: TallyException[];
}

export interface Queryable {
  execute<T extends RowDataPacket[]>(
    sql: string,
    params?: unknown[],
  ): Promise<[T, unknown]>;
}

export interface VoucherBuildContext {
  companyGstin: string;
  /** Null when drilling into one document (sourceId set) regardless of its month. */
  periodMonth: string | null;
  /** Restrict to a single source document (drill-down). */
  sourceId?: string;
  config: TallyLedgerConfig;
  companyName: string | null;
  query: Queryable;
}

export interface VoucherKindModule {
  kind: TallyVoucherKind;
  label: string;
  sourceType: TallySourceType;
  collect(ctx: VoucherBuildContext): Promise<BuiltVoucher[]>;
}

const KIND_REGISTRY = new Map<TallyVoucherKind, VoucherKindModule>();

export function registerVoucherKind(mod: VoucherKindModule): void {
  KIND_REGISTRY.set(mod.kind, mod);
}

export function getVoucherKind(kind: string): VoucherKindModule | undefined {
  return KIND_REGISTRY.get(kind as TallyVoucherKind);
}

export function listVoucherKinds(): VoucherKindModule[] {
  return [...KIND_REGISTRY.values()];
}

const toPaise = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
const clean = (v: unknown): string => String(v ?? "").trim();

/** 'NA', '0', '-' are real values in cost_centre_master; they mean "no GSTIN". */
function normaliseGstin(raw: unknown): string | null {
  const g = clean(raw).toUpperCase();
  return /^(NA|N\/A|0|-|)$/i.test(g) ? null : g;
}

/** Normalised view of an invoice or credit-note row, as selected by the collectors below. */
export interface SalesDocRow {
  id: string;
  docNo: string | null;
  docDate: string | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  applyGst: boolean;
  tallyHead: string | null;
  clientTallyName: string | null;
  billingClientName: string | null;
  clientName: string | null;
  costCentreCode: string | null;
  clientGstinRaw: string | null;
  clientStateCode: string | null;
  hsnSac: string | null;
  description: string | null;
  monthLabel: string | null;
  poNo: string | null;
  grnNo: string | null;
  branchStateCode: string | null;
  /** Credit notes: bill_no of the invoice being credited. */
  originalBillNo: string | null;
}

export function normaliseSalesRow(
  r: RowDataPacket,
  isCreditNote: boolean,
): SalesDocRow {
  const gstType = clean(r.gst_type);
  return {
    id: String(r.id),
    docNo: clean(r.doc_no) || null,
    docDate: r.doc_date ? String(r.doc_date).slice(0, 10) : null,
    taxable: toPaise(r.total_amount),
    igst: toPaise(r.igst_amount),
    cgst: toPaise(r.cgst_amount),
    sgst: toPaise(r.sgst_amount),
    grandTotal: toPaise(r.grand_total),
    applyGst: Number(r.apply_gst ?? 0) === 1 && gstType !== "Not Applicable",
    tallyHead: clean(r.tally_head) || null,
    clientTallyName: clean(r.client_tally_name) || null,
    billingClientName: clean(r.billing_client_name) || null,
    clientName: clean(r.client_name) || null,
    costCentreCode: clean(r.cost_centre_code) || null,
    clientGstinRaw: r.vendor_gst_no ? String(r.vendor_gst_no) : null,
    clientStateCode: clean(r.vendor_state_code) || null,
    hsnSac: clean(r.sac_code ?? r.hsn_code) || null,
    description: clean(r.description) || null,
    monthLabel: clean(r.month_label) || null,
    poNo: clean(r.jcc_no) || null,
    grnNo: clean(r.grn) || null,
    branchStateCode: clean(r.gst_state_code) || null,
    originalBillNo: isCreditNote ? clean(r.original_bill_no) || null : null,
  };
}

/**
 * Pure: turn one normalised document into a voucher model plus its exceptions.
 *
 * Sales:       Dr party (grand total, New Ref = bill no) / Cr sales + Cr output tax (+/- round-off)
 * Credit note: Dr sales returns + Dr output tax (+/- round-off) / Cr party (Agst Ref = original bill no)
 *
 * Round-off is the grand total minus (taxable + tax), booked to its own ledger, so the voucher
 * always balances to the paisa; a difference above Rs 1.00 is flagged TOTAL_MISMATCH instead of
 * being quietly absorbed.
 */
export function buildSalesDocVoucher(
  doc: SalesDocRow,
  kind: "sales" | "credit_note",
  ctx: Pick<VoucherBuildContext, "companyGstin" | "config" | "companyName">,
): BuiltVoucher {
  const isCredit = kind === "credit_note";
  const { config } = ctx;
  const partyLedger =
    doc.billingClientName ?? doc.clientTallyName ?? doc.clientName ?? "";
  const partyGstin = normaliseGstin(doc.clientGstinRaw);
  const clientStateCode =
    gstinStateCode(partyGstin) ?? (doc.clientStateCode || null);
  const companyStateCode = gstinStateCode(ctx.companyGstin);
  const salesLedger = isCredit
    ? config.creditNoteSalesLedger
    : (doc.tallyHead ?? config.salesLedger);

  // The "goods side" of the voucher carries the sales + tax legs; the party leg is the opposite.
  const goodsSide: "Dr" | "Cr" = isCredit ? "Dr" : "Cr";
  const partySide: "Dr" | "Cr" = isCredit ? "Cr" : "Dr";
  const entries: TallyLedgerEntry[] = [];

  const billName = isCredit ? (doc.originalBillNo ?? "") : (doc.docNo ?? "");
  entries.push({
    ledgerName: partyLedger,
    side: partySide,
    paise: doc.grandTotal,
    role: "party",
    billAllocations: [
      {
        name: billName,
        type: isCredit ? "Agst Ref" : "New Ref",
        paise: doc.grandTotal,
      },
    ],
  });
  entries.push({
    ledgerName: salesLedger,
    side: goodsSide,
    paise: doc.taxable,
    role: "sales",
    hsnSac: doc.hsnSac,
  });
  const taxLegs: Array<[string, number]> = [
    [config.igstLedger, doc.igst],
    [config.cgstLedger, doc.cgst],
    [config.sgstLedger, doc.sgst],
  ];
  for (const [ledgerName, paise] of taxLegs) {
    if (paise > 0)
      entries.push({ ledgerName, side: goodsSide, paise, role: "tax" });
  }
  // Round-off: whatever makes the goods side equal the party leg.
  const goodsTotal = doc.taxable + doc.igst + doc.cgst + doc.sgst;
  const roundOff = doc.grandTotal - goodsTotal;
  if (roundOff !== 0) {
    entries.push({
      ledgerName: config.roundOffLedger,
      side: roundOff > 0 ? goodsSide : partySide,
      paise: Math.abs(roundOff),
      role: "round_off",
    });
  }

  const narrationParts = [
    isCredit ? `Credit note ${doc.docNo ?? ""}` : `Invoice ${doc.docNo ?? ""}`,
    isCredit && doc.originalBillNo ? `against ${doc.originalBillNo}` : null,
    doc.monthLabel,
    doc.costCentreCode ? `CC ${doc.costCentreCode}` : null,
    doc.poNo ? `PO/JCC ${doc.poNo}` : null,
    doc.grnNo ? `GRN ${doc.grnNo}` : null,
    doc.description,
  ].filter((p): p is string => Boolean(p && p.trim()));

  const placeOfSupply = clientStateCode
    ? (GST_STATE_NAMES[clientStateCode] ?? null)
    : null;
  const sourceType: TallySourceType = isCredit ? "credit_note" : "invoice";

  const model: TallyVoucherModel = {
    kind,
    sourceType,
    sourceId: doc.id,
    guid: deriveVoucherGuid(sourceType, doc.id),
    voucherType: isCredit
      ? config.creditNoteVoucherType
      : config.salesVoucherType,
    voucherNumber: doc.docNo ?? "",
    date: doc.docDate ?? "",
    narration: narrationParts.join(" | "),
    partyLedger,
    partyGstin,
    partyStateName: placeOfSupply,
    placeOfSupply,
    companyGstin: ctx.companyGstin,
    companyStateName: companyStateCode
      ? (GST_STATE_NAMES[companyStateCode] ?? null)
      : null,
    entries,
    display: {
      clientName: partyLedger || null,
      costCentreCode: doc.costCentreCode,
      amountPaise: doc.grandTotal,
      taxablePaise: doc.taxable,
      taxPaise: doc.igst + doc.cgst + doc.sgst,
    },
  };

  const errors = checkVoucher({
    model,
    config,
    companyName: ctx.companyName,
    documentTotalPaise: doc.grandTotal,
    taxablePaise: doc.taxable,
    igstPaise: doc.igst,
    cgstPaise: doc.cgst,
    sgstPaise: doc.sgst,
    applyGst: doc.applyGst,
    hsnSac: doc.hsnSac,
    branchStateCode: doc.branchStateCode ?? companyStateCode,
    clientStateCode,
    requiresOriginalBill: isCredit,
  });
  return { model, errors };
}

/** One document (drill-down) or one month (batch); never both and never neither. */
function scopeSql(
  dateCol: string,
  idCol: string,
  ctx: VoucherBuildContext,
): string {
  return ctx.sourceId
    ? `AND ${idCol} = ?`
    : `AND DATE_FORMAT(${dateCol}, '%Y-%m') = ?`;
}

function scopeParams(ctx: VoucherBuildContext): unknown[] {
  return [ctx.companyGstin, ctx.sourceId ?? ctx.periodMonth];
}

const SALES_DOC_COLUMNS = `
  cm.cost_centre_code, cm.billing_client_name, cm.client_name, cm.vendor_gst_no, cm.vendor_state_code,
  cm.sac_code, cm.hsn_code, cm.jcc_no, cm.grn, bm.gst_state_code`;

const salesKind: VoucherKindModule = {
  kind: "sales",
  label: "Sales (tax invoices)",
  sourceType: "invoice",
  async collect(ctx) {
    const [rows] = await ctx.query.execute<RowDataPacket[]>(
      `SELECT ci.id, ci.bill_no AS doc_no, ci.invoice_date AS doc_date, ci.month_label, ci.description,
              ci.gst_type, ci.apply_gst, ci.total_amount, ci.igst_amount, ci.cgst_amount, ci.sgst_amount,
              ci.grand_total, ci.tally_head, ci.client_tally_name,${SALES_DOC_COLUMNS}
         FROM client_invoice ci
         JOIN cost_centre_master cm ON cm.id = ci.cost_centre_id
         JOIN branch_master bm ON bm.id = cm.branch_id
        WHERE bm.gstin = ?
          AND ci.invoice_status = 'approved'
          ${scopeSql("ci.invoice_date", "ci.id", ctx)}
        ORDER BY ci.invoice_date, ci.bill_no`,
      scopeParams(ctx),
    );
    return rows.map((r) =>
      buildSalesDocVoucher(normaliseSalesRow(r, false), "sales", ctx),
    );
  },
};

const creditNoteKind: VoucherKindModule = {
  kind: "credit_note",
  label: "Credit notes",
  sourceType: "credit_note",
  async collect(ctx) {
    const [rows] = await ctx.query.execute<RowDataPacket[]>(
      `SELECT cn.id, cn.credit_no AS doc_no, cn.credit_date AS doc_date, cn.month_label, cn.description,
              cn.gst_type, cn.apply_gst, cn.total_amount, cn.igst_amount, cn.cgst_amount, cn.sgst_amount,
              cn.grand_total, cn.tally_head, cn.client_tally_name, oi.bill_no AS original_bill_no,${SALES_DOC_COLUMNS}
         FROM client_credit_note cn
         JOIN cost_centre_master cm ON cm.id = cn.cost_centre_id
         JOIN branch_master bm ON bm.id = cm.branch_id
         LEFT JOIN client_invoice oi ON oi.id = cn.invoice_id
        WHERE bm.gstin = ?
          AND cn.credit_status = 'approved'
          ${scopeSql("cn.credit_date", "cn.id", ctx)}
        ORDER BY cn.credit_date, cn.credit_no`,
      scopeParams(ctx),
    );
    return rows.map((r) =>
      buildSalesDocVoucher(normaliseSalesRow(r, true), "credit_note", ctx),
    );
  },
};

registerVoucherKind(salesKind);
registerVoucherKind(creditNoteKind);
