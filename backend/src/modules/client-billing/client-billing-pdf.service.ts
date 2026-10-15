/**
 * Renders a `client_invoice` (proforma or approved) as a PDF matching the REAL legacy
 * db_bill invoice format — not a generic GST-invoice guess. The layout, field list, field
 * order and static legal text below were reverse-engineered field-by-field from a real
 * db_bill invoice PDF the user supplied 2026-08-21 ("Mas Bill Format.pdf", cost centre
 * BSS/FLD/JPR/040-style, bill no 09-100/26-27) — the first time this renderer has ever
 * been checked against an actual legacy sample. The original 2026-08-19 build had none
 * available (design doc's own note) and was schema-only; several fields below did not
 * exist in that build at all (PAN No, Place Of Supply, TAX PAYABLE UNDER RCM, Amount In
 * Words, the MSME/TDS/signature legal footer, the bordered grid layout).
 *
 * Two variants, one renderer: `withLetterhead: true` (default) prints MAS Callnet's logo,
 * CIN and branch address at the top and the corporate-address + ISO-certification-badges
 * block at the bottom — matching the reference sample exactly. `withLetterhead: false`
 * omits both blocks (for printing onto pre-printed letterhead stationery) but keeps every
 * invoice content field identical. Assets: `backend/public/client-billing/*.jpeg`,
 * extracted directly from the reference PDF (same images, not recreations).
 *
 * Every financially-binding figure (`total_amount`, `igst_amount`, `cgst_amount`,
 * `sgst_amount`, `grand_total`) is read verbatim from `client_invoice` — frozen at
 * proforma-creation time by `createProforma` — and never recomputed here.
 *
 * Known, documented gaps versus the reference sample (not fabricated to fill):
 *   - PO No / GRN No / GRN Date / TAX PAYABLE UNDER RCM: printed from the invoice's own
 *     po_numbers / grn_no / grn_date / rcm_applicable (migration 1975, captured on the
 *     proforma form). Blank when not entered; RCM prints "NO" unless the flag is set.
 *     Credit notes have none of these and print them blank / "NO".
 *   - Place Of Supply: derived from the client's own registered GST state
 *     (`cost_centre_master.vendor_gst_state`) — matches the reference sample exactly,
 *     since standard place-of-supply-for-services rules resolve to the recipient's state.
 *   - PAN No: not a stored column anywhere — derived from `service_tax_no` (our own
 *     GSTIN) at print time. A GSTIN's characters 3-12 ARE the PAN by statutory format
 *     (2-digit state code + 10-char PAN + entity code + check digits), not a guess.
 */
import fs from "node:fs";
import { resolveBillingParty, type BillingParty } from "./client-billing-party.js";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

interface InvoiceRow extends RowDataPacket {
  id: string;
  cost_centre_id: string;
  invoice_status: "proforma" | "approved" | "rejected";
  category: string;
  finance_year: string;
  month_label: string;
  invoice_date: string;
  description: string | null;
  proforma_no: string | null;
  bill_no: string | null;
  gst_type: string;
  apply_gst: number;
  total_amount: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  grand_total: number;
  created_at: string;
  po_numbers: string | null;
  grn_no: string | null;
  grn_date: string | Date | null;
  rcm_applicable: number | null;
}

interface LineRow extends RowDataPacket {
  line_type: "charge" | "deduction";
  particulars: string;
  qty: number;
  rate: number;
  amount: number;
}

interface CreditNoteRow extends RowDataPacket {
  id: string;
  invoice_id: string;
  cost_centre_id: string;
  credit_status: "draft" | "approved" | "rejected";
  category: string;
  finance_year: string;
  month_label: string;
  credit_date: string;
  description: string | null;
  credit_no: string | null;
  gst_type: string;
  apply_gst: number;
  total_amount: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  grand_total: number;
}

/** Normalized shape the renderer draws from — either a `client_invoice` or a
 *  `client_credit_note` row maps into this, so the line-items/tax-summary/notes drawing
 *  code is shared instead of duplicated per document type. */
interface PrintableDoc {
  kind: "invoice" | "credit_note";
  titleLabel: string; // "Tax Invoice" / "Proforma Invoice" / "Credit Note"
  numberLabel: string; // meta-box row label: "Bill No" or "Credit Note No"
  docNumber: string;
  docDate: string;
  costCentreId: string;
  gstType: string;
  applyGst: number;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  isRejected: boolean;
  poNumbers: string;
  grnNo: string;
  grnDate: string | null;
  rcmApplicable: boolean;
}

interface CostCentreRow extends RowDataPacket {
  billToCity?: string | null;
  billToPincode?: string | null;
  shipToCity?: string | null;
  shipToPincode?: string | null;
  branchGstin?: string | null;
  billToAddress1: string | null;
  billToAddress2: string | null;
  billToAddress3: string | null;
  billToAddress4: string | null;
  billToAddress5: string | null;
  shipToAddress1: string | null;
  shipToAddress2: string | null;
  shipToAddress3: string | null;
  shipToAddress4: string | null;
  shipToAddress5: string | null;
  hsnCode: string | null;
  sacCode: string | null;
  serviceTaxNo: string | null;
  vendorGstNo: string | null;
  vendorGstState: string | null;
  vendorStateCode: string | null;
  billingClientName: string | null;
  clientName?: string | null;
  companyName: string | null;
  stateCode: string | null;
  branchAddress: string | null;
  branchCity: string | null;
  branchState: string | null;
  branchPincode: string | null;
}

// ---- Static company facts (not stored in the DB — same as legacy hardcoding these) ----
const COMPANY_NAME = "Mas Callnet India Pvt Ltd";
const COMPANY_CIN = "U74899DL1990PTC038798";
const CORPORATE_ADDRESS_LINES = [
  "102/C-1, Kanchan House,",
  "Karampura Commercial Complex",
  "Shivaji Marg New Delhi - 110015",
];
const CORPORATE_EMAIL = "care@teammas.in";
const CORPORATE_WEB = "teammas.in";
const MSME_NOTE = "Covered under MSME Act vide letter No : F/5/CL/EM/2012/2062 dated 19.12.12";
const ENTREPRENEURS_MEMO_NOTE = "Enterpreneurs Memorandum No. : '070092201354'";
const PAYMENT_NOTE = "Note : Please issue Ch/DD in favour of SBI A/c. MAS Callnet India Pvt. Ltd. Payable at Delhi";
const TDS_NOTE =
  'TDS for this invoice to be deducted @ 2% "Under section 4th Provision to section 194J(1) of the Income Tax Act, 1961. ' +
  'The Finance Act, 2017" for the payee engaged only in the business of operation of call centre.';
/** No RCM flag exists in the schema yet — every sampled legacy row prints "NO". */
const TAX_PAYABLE_UNDER_RCM = "NO";
/** Signature line exactly as I-Spark prints it. */
const SIGNATORY_FOR = "for MAS Callnet India Pvt. Ltd.";

const ASSET_DIR = path.resolve(process.cwd(), "public", "client-billing");
const LOGO_PATH = path.join(ASSET_DIR, "mas-logo.jpeg");
const BADGE_PATHS = [
  path.join(ASSET_DIR, "iso-9001-badge.jpeg"),
  path.join(ASSET_DIR, "iso-14001-badge.jpeg"),
  path.join(ASSET_DIR, "iso-27001-badge.jpeg"),
];
function existingPath(p: string): string | null {
  try { return fs.existsSync(p) ? p : null; } catch { return null; }
}

const PAGE = { size: "A4" as const, margin: 36 };
const INK = "#111827";
const MUTED = "#4B5563";
const BORDER = "#111827";
const DANGER = "#B91C1C";

type Doc = PDFKit.PDFDocument;

/** MySQL DATE columns come back as plain "YYYY-MM-DD" strings (pool sets dateStrings: true). */
function displayDate(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}

function generatedTimestamp(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date()) + " IST";
}

/** Numbers exactly as I-Spark prints them: no grouping, no trailing .00 (142800, 4.08, 35000). */
function plain(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "");
}


const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
}

/** Indian crore/lakh convention, matching the reference sample's "Rupees ... Only" wording. */
export function amountInWords(value: number): string {
  const abs = Math.abs(value);
  const rupees = Math.floor(abs);
  const paiseRaw = Math.round((abs - rupees) * 100);
  const paise = paiseRaw >= 100 ? 0 : paiseRaw;
  const n = rupees + (paiseRaw >= 100 ? 1 : 0);
  if (n === 0 && paise === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  const rupeePart = parts.length ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  if (paise > 0) return `${rupeePart} and ${underThousand(paise)} Paise Only`;
  return `${rupeePart} Only`;
}

async function loadCostCentre(costCentreId: string): Promise<CostCentreRow | undefined> {
  const [rows] = await db.execute<CostCentreRow[]>(
    `SELECT cc.bill_to_address1 AS billToAddress1, cc.bill_to_address2 AS billToAddress2, cc.bill_to_address3 AS billToAddress3,
            cc.bill_to_address4 AS billToAddress4, cc.bill_to_address5 AS billToAddress5,
            cc.ship_to_address1 AS shipToAddress1, cc.ship_to_address2 AS shipToAddress2, cc.ship_to_address3 AS shipToAddress3,
            cc.ship_to_address4 AS shipToAddress4, cc.ship_to_address5 AS shipToAddress5,
            cc.bill_to_city AS billToCity, cc.bill_to_pincode AS billToPincode,
            cc.ship_to_city AS shipToCity, cc.ship_to_pincode AS shipToPincode, b.gstin AS branchGstin,
            cc.hsn_code AS hsnCode, cc.sac_code AS sacCode, cc.service_tax_no AS serviceTaxNo,
            cc.vendor_gst_no AS vendorGstNo, cc.vendor_gst_state AS vendorGstState, cc.vendor_state_code AS vendorStateCode,
            cc.billing_client_name AS billingClientName, cc.client_name AS clientName, cc.company_name AS companyName,
            b.gst_state_code AS stateCode, b.address AS branchAddress, b.city AS branchCity,
            b.state AS branchState, b.pincode AS branchPincode
     FROM cost_centre_master cc
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     WHERE cc.id = ?`,
    [costCentreId]
  );
  return rows[0];
}

async function loadInvoice(invoiceId: string): Promise<{ doc: PrintableDoc; lines: LineRow[]; costCentre: CostCentreRow | undefined }> {
  const [invoiceRows] = await db.execute<InvoiceRow[]>(
    `SELECT id, cost_centre_id, invoice_status, category, finance_year, month_label, invoice_date,
            description, proforma_no, bill_no, gst_type, apply_gst, total_amount, igst_amount,
            cgst_amount, sgst_amount, grand_total, created_at,
            po_numbers, grn_no, grn_date, rcm_applicable
     FROM client_invoice WHERE id = ?`,
    [invoiceId]
  );
  const invoice = invoiceRows[0];
  if (!invoice) {
    throw clientError(`Invoice ${invoiceId} not found`);
  }

  const [lineRows] = await db.execute<LineRow[]>(
    `SELECT line_type, particulars, qty, rate, amount
     FROM client_invoice_line WHERE invoice_id = ? ORDER BY COALESCE(line_no, 2147483647), created_at, id`,
    [invoiceId]
  );

  const costCentre = await loadCostCentre(invoice.cost_centre_id);
  return { doc: invoiceToPrintableDoc(invoice), lines: lineRows, costCentre };
}

async function loadCreditNote(creditNoteId: string): Promise<{ doc: PrintableDoc; lines: LineRow[]; costCentre: CostCentreRow | undefined }> {
  const [creditNoteRows] = await db.execute<CreditNoteRow[]>(
    `SELECT id, invoice_id, cost_centre_id, credit_status, category, finance_year, month_label, credit_date,
            description, credit_no, gst_type, apply_gst, total_amount, igst_amount, cgst_amount, sgst_amount, grand_total
     FROM client_credit_note WHERE id = ?`,
    [creditNoteId]
  );
  const creditNote = creditNoteRows[0];
  if (!creditNote) {
    throw clientError(`Credit note ${creditNoteId} not found`);
  }

  const [lineRows] = await db.execute<LineRow[]>(
    `SELECT 'charge' AS line_type, particulars, qty, rate, amount
     FROM client_credit_note_line WHERE credit_note_id = ?`,
    [creditNoteId]
  );

  const costCentre = await loadCostCentre(creditNote.cost_centre_id);
  return { doc: creditNoteToPrintableDoc(creditNote), lines: lineRows, costCentre };
}

function invoiceToPrintableDoc(invoice: InvoiceRow): PrintableDoc {
  const isProforma = invoice.invoice_status === "proforma";
  const isRejected = invoice.invoice_status === "rejected";
  return {
    kind: "invoice",
    titleLabel: isProforma ? "Proforma Invoice" : isRejected ? "Tax Invoice — Rejected" : "Tax Invoice",
    numberLabel: "Bill No",
    docNumber: (isProforma ? invoice.proforma_no : invoice.bill_no ?? invoice.proforma_no) ?? "—",
    docDate: invoice.invoice_date,
    costCentreId: invoice.cost_centre_id,
    gstType: invoice.gst_type,
    applyGst: invoice.apply_gst,
    totalAmount: Number(invoice.total_amount),
    igstAmount: Number(invoice.igst_amount),
    cgstAmount: Number(invoice.cgst_amount),
    sgstAmount: Number(invoice.sgst_amount),
    grandTotal: Number(invoice.grand_total),
    isRejected,
    poNumbers: String(invoice.po_numbers ?? "").split(",").map((p) => p.trim()).filter(Boolean).join(", "),
    grnNo: String(invoice.grn_no ?? ""),
    grnDate: invoice.grn_date ? String(invoice.grn_date instanceof Date ? invoice.grn_date.toISOString() : invoice.grn_date).slice(0, 10) : null,
    rcmApplicable: Number(invoice.rcm_applicable ?? 0) === 1,
  };
}

function creditNoteToPrintableDoc(creditNote: CreditNoteRow): PrintableDoc {
  return {
    kind: "credit_note",
    titleLabel: creditNote.credit_status === "draft" ? "Credit Note — Draft"
      : creditNote.credit_status === "rejected" ? "Credit Note — Rejected" : "Credit Note",
    numberLabel: "Credit Note No",
    docNumber: creditNote.credit_no ?? "—",
    docDate: creditNote.credit_date,
    costCentreId: creditNote.cost_centre_id,
    gstType: creditNote.gst_type,
    applyGst: creditNote.apply_gst,
    totalAmount: Number(creditNote.total_amount),
    igstAmount: Number(creditNote.igst_amount),
    cgstAmount: Number(creditNote.cgst_amount),
    sgstAmount: Number(creditNote.sgst_amount),
    grandTotal: Number(creditNote.grand_total),
    isRejected: false,
    poNumbers: "",
    grnNo: "",
    grnDate: null,
    rcmApplicable: false,
  };
}

/** Long free-text audit notes (e.g. the LEGACY-UNMAPPED-VODAFONE placeholder's disclosure
 *  sentence, migration 1309) are correct to KEEP in the database for internal record-keeping,
 *  but must never leak onto a customer-facing PDF verbatim. If the name looks like an audit
 *  note rather than a client name, print only the confirmed short name before the dash. */
function printableClientName(costCentre: CostCentreRow | undefined): string {
  // Billing name, then the cost centre's client name; company_name (our own company) only last.
  const raw = costCentre?.billingClientName || costCentre?.clientName || costCentre?.companyName || "";
  if (!raw) return "—";
  const dashIdx = raw.indexOf(" — ");
  return dashIdx > 0 && raw.length > 60 ? raw.slice(0, dashIdx).trim() : raw;
}

/** Company name + CIN + branch address + logo — the "letterhead" block, reference sample §header. */
function drawLetterheadHeader(doc: Doc, costCentre: CostCentreRow | undefined) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const logo = existingPath(LOGO_PATH);

  const textWidth = logo ? width - 130 : width;
  // I-Spark header: large regular-weight name, bold "CIN :" and "Branch Address:" labels.
  doc.font("Helvetica").fontSize(18).fillColor(INK).text(COMPANY_NAME, left, doc.y, { width: textWidth });
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK)
    .text(`CIN : ${COMPANY_CIN}`, { width: textWidth });
  // branch_master.address, when populated, is already a complete multi-line address
  // (frequently with city/state/pincode embedded as free text) — only fall back to
  // building one from the separate city/state/pincode columns when address is blank,
  // so a populated address is never duplicated with those same parts appended again.
  const branchAddr = (costCentre?.branchAddress && costCentre.branchAddress.trim().length > 0)
    ? costCentre.branchAddress.replace(/\n/g, ", ")
    : [costCentre?.branchCity, costCentre?.branchState].filter(Boolean).join(", ") +
      (costCentre?.branchPincode ? ` - ${costCentre.branchPincode}` : "");
  if (branchAddr.trim().length > 1) {
    doc.font("Helvetica-Bold").text("Branch Address: ", { width: textWidth, continued: true })
      .font("Helvetica").text(branchAddr);
  }

  if (logo) {
    try { doc.image(logo, doc.page.width - PAGE.margin - 125, PAGE.margin - 6, { width: 125 }); } catch { /* ignore */ }
  }
  doc.moveDown(0.6);
}

/** Corporate address + ISO/LMS certification badges — the bottom "letterhead" block. */
function drawLetterheadFooter(doc: Doc) {
  const left = PAGE.margin;
  const badges = BADGE_PATHS.map(existingPath).filter((p): p is string => Boolean(p));
  // I-Spark puts the corporate block directly under the invoice box, not at the page bottom.
  const y = Math.min(doc.y + 8, doc.page.height - PAGE.margin - 60);

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK).text("Corporate Address: ", left, y, { width: 220, continued: true })
    .font("Helvetica").text(CORPORATE_ADDRESS_LINES[0] ?? "");
  doc.font("Helvetica").fontSize(7.5).fillColor(INK);
  for (const line of CORPORATE_ADDRESS_LINES.slice(1)) doc.text(line, left, doc.y, { width: 220 });
  doc.text(`E-mail : ${CORPORATE_EMAIL}`, left, doc.y, { width: 220 });
  doc.text(`Web : ${CORPORATE_WEB}`, left, doc.y, { width: 220 });

  if (badges.length) {
    const badgeSize = 46;
    const gap = 8;
    let x = doc.page.width - PAGE.margin - badges.length * badgeSize - (badges.length - 1) * gap;
    for (const badge of badges) {
      try { doc.image(badge, x, y, { width: badgeSize, height: badgeSize }); } catch { /* ignore */ }
      x += badgeSize + gap;
    }
  }
}

function drawTitle(doc: Doc, printable: PrintableDoc) {
  const width = doc.page.width - PAGE.margin * 2;
  doc.font("Helvetica-Bold").fontSize(13)
    .fillColor(printable.isRejected ? DANGER : INK)
    .text(printable.titleLabel, PAGE.margin, doc.y, { width, align: "center" });
  doc.moveDown(0.4);
}

/** The bordered 3-column grid: Bill To | Ship To | invoice meta (Bill No, PO No, GST No,
 *  HSN/SAC, Pan No, GRN No/Date, Place Of Supply, TAX PAYABLE UNDER RCM) — matches the
 *  reference sample's layout exactly, including which fields sit in the meta column. */
/** The PDF's camelCase row through the shared resolver (client-billing-party.ts). */
function partyOf(cc: CostCentreRow | undefined): BillingParty {
  return resolveBillingParty({
    company_name: cc?.companyName, billing_client_name: cc?.billingClientName, client_name: cc?.clientName,
    service_tax_no: cc?.serviceTaxNo, vendor_gst_no: cc?.vendorGstNo, vendor_gst_state: cc?.vendorGstState,
    vendor_state_code: cc?.vendorStateCode, hsn_code: cc?.hsnCode, sac_code: cc?.sacCode,
    bill_to_address1: cc?.billToAddress1, bill_to_address2: cc?.billToAddress2, bill_to_address3: cc?.billToAddress3,
    bill_to_address4: cc?.billToAddress4, bill_to_address5: cc?.billToAddress5, bill_to_city: cc?.billToCity, bill_to_pincode: cc?.billToPincode,
    ship_to_address1: cc?.shipToAddress1, ship_to_address2: cc?.shipToAddress2, ship_to_address3: cc?.shipToAddress3,
    ship_to_address4: cc?.shipToAddress4, ship_to_address5: cc?.shipToAddress5, ship_to_city: cc?.shipToCity, ship_to_pincode: cc?.shipToPincode,
    branch_state_code: cc?.stateCode, branch_gstin: cc?.branchGstin,
  });
}

function drawPartyGrid(doc: Doc, printable: PrintableDoc, costCentre: CostCentreRow | undefined) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const col1 = width * 0.32;
  const col2 = width * 0.32;
  const col3 = width - col1 - col2;
  const x1 = left, x2 = left + col1, x3 = left + col1 + col2;

  const clientName = printableClientName(costCentre);
  const party = partyOf(costCentre);
  // All five address lines, as I-Spark prints them, plus city / PIN when not already in them.
  const billTo = party.billTo;
  const shipTo = party.shipTo;

  // State name / code follow the client GSTIN (the same source the tax type uses).
  const gstBlock = (_label: string) => [
    party.clientGstin ? `GST No : ${party.clientGstin}` : null,
    party.clientStateName ? `GST STATE NAME : ${party.clientStateName}` : null,
    party.clientStateCode ? `GST STATE CODE : ${party.clientStateCode}` : null,
  ].filter((x): x is string => Boolean(x));

  const meta: Array<[string, string]> = [
    [printable.numberLabel, printable.docNumber],
    ["PO No", printable.poNumbers],
    ["GST No", party.ourGstin],
    ["HSN Code", party.hsnCode],
    ["SAC Code", party.sacCode || "N/A"],
    ["Pan No", party.pan],
    ["GRN No", printable.grnNo],
    ["GRN Date", displayDate(printable.grnDate)],
    ["Place Of Supply", party.placeOfSupply],
    ["TAX PAYABLE UNDER RCM", printable.rcmApplicable ? "YES" : TAX_PAYABLE_UNDER_RCM],
  ];

  const top = doc.y;
  const headerH = 14;
  doc.rect(x1, top, col1, headerH).fillAndStroke("#F3F4F6", BORDER);
  doc.rect(x2, top, col2, headerH).fillAndStroke("#F3F4F6", BORDER);
  doc.rect(x3, top, col3, headerH).fillAndStroke("#F3F4F6", BORDER);
  doc.fillColor(INK).font("Helvetica").fontSize(7.5);
  doc.text("Bill to Address", x1 + 3, top + 3, { width: col1 - 6 });
  doc.text("Ship to Address", x2 + 3, top + 3, { width: col2 - 6 });
  doc.text("Date", x3 + 3, top + 3, { width: col3 * 0.4 - 6 });
  doc.font("Helvetica").fontSize(7.5).text(displayDate(printable.docDate), x3 + col3 * 0.4, top + 3, { width: col3 * 0.6 - 3 });

  const bodyTop = top + headerH;
  let y1 = bodyTop + 3;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(clientName, x1 + 3, y1, { width: col1 - 6 });
  y1 = doc.y;
  doc.font("Helvetica").fontSize(7.5);
  for (const line of billTo) { doc.text(line, x1 + 3, y1, { width: col1 - 6 }); y1 = doc.y; }
  y1 += 6;
  for (const line of gstBlock("bill")) { doc.text(line, x1 + 3, y1, { width: col1 - 6 }); y1 = doc.y; }

  let y2 = bodyTop + 3;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(clientName, x2 + 3, y2, { width: col2 - 6 });
  y2 = doc.y;
  doc.font("Helvetica").fontSize(7.5);
  for (const line of shipTo) { doc.text(line, x2 + 3, y2, { width: col2 - 6 }); y2 = doc.y; }
  y2 += 6;
  for (const line of gstBlock("ship")) { doc.text(line, x2 + 3, y2, { width: col2 - 6 }); y2 = doc.y; }

  let y3 = bodyTop + 3;
  const metaLabelW = col3 * 0.55;
  // Bold exactly where I-Spark is bold; the rest regular.
  const boldMeta = new Set(["PO No", "GRN No", "GRN Date", "Place Of Supply", "TAX PAYABLE UNDER RCM"]);
  for (const [label, value] of meta) {
    doc.font(boldMeta.has(label) ? "Helvetica-Bold" : "Helvetica").fontSize(7.2).fillColor(INK).text(label, x3 + 3, y3, { width: metaLabelW - 3 });
    doc.font("Helvetica").fontSize(7.2).text(value || "", x3 + metaLabelW, y3, { width: col3 - metaLabelW - 3 });
    y3 = Math.max(y3 + 10, doc.y);
  }

  const bottom = Math.max(y1, y2, y3) + 4;
  doc.rect(x1, top, col1, bottom - top).stroke(BORDER);
  doc.rect(x2, top, col2, bottom - top).stroke(BORDER);
  doc.rect(x3, top, col3, bottom - top).stroke(BORDER);
  doc.moveTo(x1, bodyTop).lineTo(x1 + width, bodyTop).strokeColor(BORDER).lineWidth(0.6).stroke();

  doc.y = bottom;
  doc.x = left;
  doc.fillColor(INK);
}

function drawLineItemsTable(doc: Doc, lines: LineRow[]): void {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const cols = { sno: width * 0.06, particulars: width * 0.54, qty: width * 0.12, rate: width * 0.13, amount: width * 0.15 };
  const rowH = 15;

  const headerY = doc.y;
  doc.rect(left, headerY, width, rowH).fillAndStroke("#F3F4F6", BORDER);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK);
  let x = left;
  doc.text("S.No", x + 2, headerY + 4, { width: cols.sno - 4 }); x += cols.sno;
  doc.text("Particulars", x, headerY + 4, { width: cols.particulars, align: "center" }); x += cols.particulars;
  doc.text("Qty", x, headerY + 4, { width: cols.qty, align: "center" }); x += cols.qty;
  doc.text("Rate", x, headerY + 4, { width: cols.rate, align: "center" }); x += cols.rate;
  doc.text("Amount", x, headerY + 4, { width: cols.amount, align: "center" });

  doc.font("Helvetica").fontSize(8).fillColor(INK);
  let y = headerY + rowH;
  const minBodyH = 90;
  const bodyTop = y;

  const charges = lines.filter(l => l.line_type !== "deduction");
  const deductions = lines.filter(l => l.line_type === "deduction");

  charges.forEach((line, i) => {
    x = left;
    const rowTop = y;
    doc.font("Helvetica").fontSize(8).fillColor(INK);
    doc.text(String(i + 1) + ".", x, rowTop + 3, { width: cols.sno, align: "center" }); x += cols.sno;
    doc.text(line.particulars, x + 4, rowTop + 3, { width: cols.particulars - 8 }); x += cols.particulars;
    doc.text(plain(line.qty), x, rowTop + 3, { width: cols.qty, align: "center" }); x += cols.qty;
    doc.text(plain(line.rate), x, rowTop + 3, { width: cols.rate, align: "center" }); x += cols.rate;
    doc.text(plain(Number(line.amount)), x, rowTop + 3, { width: cols.amount, align: "center" });
    y = Math.max(y + rowH, doc.y + 4);
  });

  if (deductions.length > 0) {
    // "Less" section header row — bold, spans full row, no S.No or numeric columns
    const lessY = y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK);
    doc.text("Less", left + cols.sno + 4, lessY + 3, { width: cols.particulars - 8 });
    y = Math.max(y + rowH, doc.y + 4);

    deductions.forEach((line, i) => {
      x = left;
      const rowTop = y;
      doc.font("Helvetica").fontSize(8).fillColor(INK);
      doc.text(String(i + 1) + ".", x, rowTop + 3, { width: cols.sno, align: "center" }); x += cols.sno;
      doc.text(line.particulars, x + 4, rowTop + 3, { width: cols.particulars - 8 }); x += cols.particulars;
      doc.text(plain(line.qty), x, rowTop + 3, { width: cols.qty, align: "center" }); x += cols.qty;
      doc.text(plain(line.rate), x, rowTop + 3, { width: cols.rate, align: "center" }); x += cols.rate;
      doc.text(plain(Number(line.amount)), x, rowTop + 3, { width: cols.amount, align: "center" });
      y = Math.max(y + rowH, doc.y + 4);
    });
  }
  const bodyH = Math.max(minBodyH, y - bodyTop);
  y = bodyTop + bodyH;

  // Grid lines
  doc.moveTo(left, headerY).lineTo(left, y).strokeColor(BORDER).lineWidth(0.6).stroke();
  let gx = left;
  for (const w of [cols.sno, cols.particulars, cols.qty, cols.rate, cols.amount]) {
    gx += w;
    doc.moveTo(gx, headerY).lineTo(gx, y).strokeColor(BORDER).lineWidth(0.6).stroke();
  }
  doc.moveTo(left, headerY).lineTo(left + width, headerY).strokeColor(BORDER).lineWidth(0.6).stroke();
  doc.moveTo(left, bodyTop).lineTo(left + width, bodyTop).strokeColor(BORDER).lineWidth(0.6).stroke();
  // Only under Qty / Rate / Amount: S.No and Particulars run on into the totals, as in I-Spark.
  doc.moveTo(left + cols.sno + cols.particulars, y).lineTo(left + width, y).strokeColor(BORDER).lineWidth(0.6).stroke();

  doc.y = y;
  doc.x = left;
}

/** TAXABLE INVOICE VALUE, then IGST @ 18% (Integrated) or CGST+SGST @ 9% each (Intrastate),
 *  then G. Total — labels/order match the reference sample exactly. Frozen columns, never
 *  recomputed. Drawn as the bottom rows of the same bordered table as the line items. */
function drawTaxSummary(doc: Doc, printable: PrintableDoc) {
  const width = doc.page.width - PAGE.margin * 2;
  const left = PAGE.margin;
  // Same column geometry as drawLineItemsTable: the S.No / Particulars columns run on beside
  // the totals, the label sits under Qty+Rate and the value under Amount (I-Spark layout).
  const sno = width * 0.06, particulars = width * 0.54, qty = width * 0.12, rate = width * 0.13;
  const labelX = left + sno + particulars;
  const labelW = qty + rate;
  const valueX = labelX + labelW;
  const valueW = left + width - valueX;
  const rowH = 14;

  const row = (label: string, amount: number) => {
    const y = doc.y;
    doc.rect(labelX, y, labelW, rowH).stroke(BORDER);
    doc.rect(valueX, y, valueW, rowH).stroke(BORDER);
    doc.moveTo(left, y).lineTo(left, y + rowH).strokeColor(BORDER).lineWidth(0.6).stroke();
    doc.moveTo(left + sno, y).lineTo(left + sno, y + rowH).strokeColor(BORDER).lineWidth(0.6).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK)
      .text(label, labelX, y + 3, { width: labelW, align: "center" })
      .text(plain(amount), valueX, y + 3, { width: valueW, align: "center" });
    doc.y = y + rowH;
  };

  row("TAXABLE INVOICE VALUE", printable.totalAmount);
  if (printable.applyGst) {
    if (printable.gstType === "Integrated") {
      row("IGST @ 18%", printable.igstAmount);
    } else {
      row("CGST @ 9%", printable.cgstAmount);
      row("SGST @ 9%", printable.sgstAmount);
    }
  }
  row("G. Total", printable.grandTotal);
  doc.x = left;
}

/** The bordered notes box under the totals, as in I-Spark: amount in words (bold italic, its own
 *  row), payment note, MSME + "for MAS Callnet India Pvt. Ltd.", memorandum, signatory, TDS. */
function drawAmountInWordsAndNotes(doc: Doc, printable: PrintableDoc) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const top = doc.y;
  const pad = 3;

  doc.font("Helvetica-BoldOblique").fontSize(8).fillColor(INK)
    .text(`Amount In Words : ${amountInWords(printable.grandTotal)}`, left + pad, top + pad, { width: width * 0.75 });
  const wordsBottom = doc.y + pad;
  doc.moveTo(left, wordsBottom).lineTo(left + width, wordsBottom).strokeColor(BORDER).lineWidth(0.6).stroke();
  doc.moveTo(left + width * 0.78, top).lineTo(left + width * 0.78, wordsBottom).strokeColor(BORDER).lineWidth(0.6).stroke();

  doc.font("Helvetica").fontSize(7.5).text(PAYMENT_NOTE, left + pad, wordsBottom + pad, { width: width - 2 * pad });
  const noteBottom = doc.y + 1;
  doc.moveTo(left, noteBottom).lineTo(left + width, noteBottom).strokeColor(BORDER).lineWidth(0.6).stroke();

  const msmeY = noteBottom + pad;
  doc.font("Helvetica-Bold").fontSize(7.5).text(MSME_NOTE, left + pad, msmeY, { width: width * 0.65 });
  doc.text(SIGNATORY_FOR, left + width * 0.62, msmeY, { width: width * 0.38 - pad, align: "right" });
  doc.text(ENTREPRENEURS_MEMO_NOTE, left + pad, doc.y, { width: width * 0.65 });

  doc.moveDown(2.2);
  doc.text("Authorised Signatory", left, doc.y, { width: width - 40, align: "right" });
  doc.moveDown(0.8);

  doc.font("Times-Bold").fontSize(8).fillColor(INK).text(TDS_NOTE, left + pad, doc.y, { width: width - 2 * pad });
  const bottom = doc.y + pad;
  doc.rect(left, top, width, bottom - top).stroke(BORDER);
  doc.y = bottom;
  doc.x = left;
}

function drawFooter(doc: Doc, withLetterhead: boolean) {
  if (withLetterhead) {
    drawLetterheadFooter(doc);
    return;
  }
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  doc.font("Helvetica").fontSize(7).fillColor(MUTED)
    .text(`This is a system-generated invoice. Generated: ${generatedTimestamp()}`, left, doc.page.height - PAGE.margin - 12, { width });
}

function renderPdf(
  printable: PrintableDoc,
  lines: LineRow[],
  costCentre: CostCentreRow | undefined,
  withLetterhead: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (withLetterhead) drawLetterheadHeader(doc, costCentre);
    drawTitle(doc, printable);
    drawPartyGrid(doc, printable, costCentre);
    drawLineItemsTable(doc, lines);
    drawTaxSummary(doc, printable);
    drawAmountInWordsAndNotes(doc, printable);
    drawFooter(doc, withLetterhead);

    doc.end();
  });
}

async function generateInvoicePdf(invoiceId: string, withLetterhead = true): Promise<Buffer> {
  const { doc, lines, costCentre } = await loadInvoice(invoiceId);
  return renderPdf(doc, lines, costCentre, withLetterhead);
}

async function generateCreditNotePdf(creditNoteId: string, withLetterhead = true): Promise<Buffer> {
  const { doc, lines, costCentre } = await loadCreditNote(creditNoteId);
  return renderPdf(doc, lines, costCentre, withLetterhead);
}

export const clientBillingPdfService = { generateInvoicePdf, generateCreditNotePdf };
