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
 *   - PO No: `client_po_number` has zero rows anywhere in this system today (confirmed
 *     live 2026-08-21) — always blank until that table is actually populated.
 *   - GRN No / GRN Date: legacy captured these per-invoice (`tbl_invoice.grn`/`grn_date`);
 *     the new schema never carried a per-invoice GRN field, and `CreateProformaSheet` has
 *     no GRN input field either — always blank. A real fix needs a schema + UI change,
 *     out of scope for a rendering-layer PDF fix.
 *   - TAX PAYABLE UNDER RCM: no RCM flag exists anywhere in the schema; printed as the
 *     static default "NO" (true for every sampled legacy row) until a real flag exists.
 *   - Place Of Supply: derived from the client's own registered GST state
 *     (`cost_centre_master.vendor_gst_state`) — matches the reference sample exactly,
 *     since standard place-of-supply-for-services rules resolve to the recipient's state.
 *   - PAN No: not a stored column anywhere — derived from `service_tax_no` (our own
 *     GSTIN) at print time. A GSTIN's characters 3-12 ARE the PAN by statutory format
 *     (2-digit state code + 10-char PAN + entity code + check digits), not a guess.
 */
import fs from "node:fs";
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
  credit_status: "draft" | "approved";
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
}

interface CostCentreRow extends RowDataPacket {
  billToAddress1: string | null;
  billToAddress2: string | null;
  billToAddress3: string | null;
  shipToAddress1: string | null;
  shipToAddress2: string | null;
  shipToAddress3: string | null;
  hsnCode: string | null;
  sacCode: string | null;
  serviceTaxNo: string | null;
  vendorGstNo: string | null;
  vendorGstState: string | null;
  vendorStateCode: string | null;
  billingClientName: string | null;
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

function money(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function addressLines(a1: string | null, a2: string | null, a3: string | null): string[] {
  return [a1, a2, a3].filter((x): x is string => Boolean(x && x.trim().length > 0));
}

/** A GSTIN's chars 3-12 (1-indexed) ARE the PAN by statutory GSTIN format — not a guess. */
function panFromGstin(gstin: string | null | undefined): string {
  const s = String(gstin ?? "").trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/.test(s) ? s.slice(2, 12) : "";
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
function amountInWords(value: number): string {
  const n = Math.round(Math.abs(value));
  if (n === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  return `Rupees ${parts.join(" ")} Only`;
}

async function loadCostCentre(costCentreId: string): Promise<CostCentreRow | undefined> {
  const [rows] = await db.execute<CostCentreRow[]>(
    `SELECT cc.bill_to_address1 AS billToAddress1, cc.bill_to_address2 AS billToAddress2, cc.bill_to_address3 AS billToAddress3,
            cc.ship_to_address1 AS shipToAddress1, cc.ship_to_address2 AS shipToAddress2, cc.ship_to_address3 AS shipToAddress3,
            cc.hsn_code AS hsnCode, cc.sac_code AS sacCode, cc.service_tax_no AS serviceTaxNo,
            cc.vendor_gst_no AS vendorGstNo, cc.vendor_gst_state AS vendorGstState, cc.vendor_state_code AS vendorStateCode,
            cc.billing_client_name AS billingClientName, cc.company_name AS companyName,
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
            cgst_amount, sgst_amount, grand_total, created_at
     FROM client_invoice WHERE id = ?`,
    [invoiceId]
  );
  const invoice = invoiceRows[0];
  if (!invoice) {
    throw clientError(`Invoice ${invoiceId} not found`);
  }

  const [lineRows] = await db.execute<LineRow[]>(
    `SELECT line_type, particulars, qty, rate, amount
     FROM client_invoice_line WHERE invoice_id = ? ORDER BY created_at`,
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
  };
}

function creditNoteToPrintableDoc(creditNote: CreditNoteRow): PrintableDoc {
  return {
    kind: "credit_note",
    titleLabel: creditNote.credit_status === "draft" ? "Credit Note — Draft" : "Credit Note",
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
  };
}

/** Long free-text audit notes (e.g. the LEGACY-UNMAPPED-VODAFONE placeholder's disclosure
 *  sentence, migration 1309) are correct to KEEP in the database for internal record-keeping,
 *  but must never leak onto a customer-facing PDF verbatim. If the name looks like an audit
 *  note rather than a client name, print only the confirmed short name before the dash. */
function printableClientName(costCentre: CostCentreRow | undefined): string {
  const raw = costCentre?.billingClientName || costCentre?.companyName || "";
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
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(COMPANY_NAME, left, doc.y, { width: textWidth });
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
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
    doc.text(`Branch Address: ${branchAddr}`, { width: textWidth });
  }

  if (logo) {
    try { doc.image(logo, doc.page.width - PAGE.margin - 120, PAGE.margin - 2, { width: 120 }); } catch { /* ignore */ }
  }
  doc.moveDown(0.6);
}

/** Corporate address + ISO/LMS certification badges — the bottom "letterhead" block. */
function drawLetterheadFooter(doc: Doc) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const badges = BADGE_PATHS.map(existingPath).filter((p): p is string => Boolean(p));
  const y = doc.page.height - PAGE.margin - 60;

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK).text("Corporate Address:", left, y, { width: 220, continued: false });
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
  for (const line of CORPORATE_ADDRESS_LINES) doc.text(line, left, doc.y, { width: 220 });
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
function drawPartyGrid(doc: Doc, printable: PrintableDoc, costCentre: CostCentreRow | undefined) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const col1 = width * 0.32;
  const col2 = width * 0.32;
  const col3 = width - col1 - col2;
  const x1 = left, x2 = left + col1, x3 = left + col1 + col2;

  const clientName = printableClientName(costCentre);
  const billTo = addressLines(costCentre?.billToAddress1 ?? null, costCentre?.billToAddress2 ?? null, costCentre?.billToAddress3 ?? null);
  const shipToRaw = addressLines(costCentre?.shipToAddress1 ?? null, costCentre?.shipToAddress2 ?? null, costCentre?.shipToAddress3 ?? null);
  const shipTo = shipToRaw.length ? shipToRaw : billTo;

  const gstBlock = (label: string) => [
    costCentre?.vendorGstNo ? `GST No : ${costCentre.vendorGstNo}` : null,
    costCentre?.vendorGstState ? `GST STATE NAME : ${costCentre.vendorGstState}` : null,
    costCentre?.vendorStateCode ? `GST STATE CODE : ${costCentre.vendorStateCode}` : null,
  ].filter((x): x is string => Boolean(x));

  const meta: Array<[string, string]> = [
    [printable.numberLabel, printable.docNumber],
    ["PO No", ""], // client_po_number has zero rows today — see file header note
    ["GST No", costCentre?.serviceTaxNo ?? ""],
    ["HSN Code", costCentre?.hsnCode ?? ""],
    ["SAC Code", costCentre?.sacCode ?? "N/A"],
    ["Pan No", panFromGstin(costCentre?.serviceTaxNo)],
    ["GRN No", ""], // no per-invoice GRN column in this schema yet — see file header note
    ["GRN Date", ""],
    ["Place Of Supply", costCentre?.vendorGstState ?? ""],
    ["TAX PAYABLE UNDER RCM", TAX_PAYABLE_UNDER_RCM],
  ];

  const top = doc.y;
  const headerH = 14;
  doc.rect(x1, top, col1, headerH).fillAndStroke("#F3F4F6", BORDER);
  doc.rect(x2, top, col2, headerH).fillAndStroke("#F3F4F6", BORDER);
  doc.rect(x3, top, col3, headerH).fillAndStroke("#F3F4F6", BORDER);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5);
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
  for (const line of gstBlock("bill")) { doc.text(line, x1 + 3, y1, { width: col1 - 6 }); y1 = doc.y; }

  let y2 = bodyTop + 3;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(clientName, x2 + 3, y2, { width: col2 - 6 });
  y2 = doc.y;
  doc.font("Helvetica").fontSize(7.5);
  for (const line of shipTo) { doc.text(line, x2 + 3, y2, { width: col2 - 6 }); y2 = doc.y; }
  for (const line of gstBlock("ship")) { doc.text(line, x2 + 3, y2, { width: col2 - 6 }); y2 = doc.y; }

  let y3 = bodyTop + 3;
  const metaLabelW = col3 * 0.55;
  for (const [label, value] of meta) {
    doc.font("Helvetica-Bold").fontSize(7.2).fillColor(INK).text(label, x3 + 3, y3, { width: metaLabelW - 3 });
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
  doc.text("Particulars", x + 2, headerY + 4, { width: cols.particulars - 4 }); x += cols.particulars;
  doc.text("Qty", x, headerY + 4, { width: cols.qty - 4, align: "right" }); x += cols.qty;
  doc.text("Rate", x, headerY + 4, { width: cols.rate - 4, align: "right" }); x += cols.rate;
  doc.text("Amount", x, headerY + 4, { width: cols.amount - 6, align: "right" });

  doc.font("Helvetica").fontSize(8).fillColor(INK);
  let y = headerY + rowH;
  const minBodyH = 90;
  const bodyTop = y;
  lines.forEach((line, i) => {
    const signedAmount = line.line_type === "deduction" ? -Number(line.amount) : Number(line.amount);
    x = left;
    const rowTop = y;
    doc.text(String(i + 1) + ".", x + 2, rowTop + 3, { width: cols.sno - 4 }); x += cols.sno;
    doc.text(line.particulars, x + 2, rowTop + 3, { width: cols.particulars - 4 }); x += cols.particulars;
    doc.text(String(line.qty), x, rowTop + 3, { width: cols.qty - 4, align: "right" }); x += cols.qty;
    doc.text(money(line.rate), x, rowTop + 3, { width: cols.rate - 4, align: "right" }); x += cols.rate;
    doc.text(money(signedAmount), x, rowTop + 3, { width: cols.amount - 6, align: "right" });
    y = Math.max(y + rowH, doc.y + 4);
  });
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
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor(BORDER).lineWidth(0.6).stroke();

  doc.y = y;
  doc.x = left;
}

/** TAXABLE INVOICE VALUE, then IGST @ 18% (Integrated) or CGST+SGST @ 9% each (Intrastate),
 *  then G. Total — labels/order match the reference sample exactly. Frozen columns, never
 *  recomputed. Drawn as the bottom rows of the same bordered table as the line items. */
function drawTaxSummary(doc: Doc, printable: PrintableDoc) {
  const width = doc.page.width - PAGE.margin * 2;
  const left = PAGE.margin;
  const labelW = width * 0.85;
  const amountW = width - labelW;
  const rowH = 14;

  const row = (label: string, amount: number, bold = false) => {
    const y = doc.y;
    doc.rect(left, y, width, rowH).stroke(BORDER);
    doc.moveTo(left + labelW, y).lineTo(left + labelW, y + rowH).strokeColor(BORDER).lineWidth(0.6).stroke();
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(INK)
      .text(label, left, y + 3, { width: labelW - 6, align: "right" })
      .text(money(amount), left + labelW, y + 3, { width: amountW - 6, align: "right" });
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
  row("G. Total", printable.grandTotal, true);
  doc.x = left;
  doc.moveDown(0.5);
}

function drawAmountInWordsAndNotes(doc: Doc, printable: PrintableDoc) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;

  doc.font("Helvetica-Oblique").fontSize(8).fillColor(INK)
    .text(`Amount In Words : ${amountInWords(printable.grandTotal)}`, left, doc.y, { width });
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(7.5).fillColor(INK);
  doc.text(PAYMENT_NOTE, left, doc.y, { width });

  const noteY = doc.y;
  doc.text(MSME_NOTE, left, noteY, { width: width * 0.65 });
  doc.font("Helvetica").fontSize(7.5).text(`for ${COMPANY_NAME}.`, left + width * 0.65, noteY, { width: width * 0.35, align: "right" });
  doc.text(ENTREPRENEURS_MEMO_NOTE, left, doc.y, { width: width * 0.65 });

  doc.moveDown(1.4);
  doc.font("Helvetica-Bold").fontSize(7.5).text("Authorised Signatory", left, doc.y, { width, align: "right" });
  doc.moveDown(0.4);

  doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(TDS_NOTE, left, doc.y, { width });
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
