/**
 * Renders a `client_invoice` (proforma or approved) as a GST-compliant PDF, matching
 * legacy's `view_proforma_pdf()` / `view_pdf()`. Design:
 * docs/superpowers/specs/2026-08-19-client-billing-pdf-design.md
 *
 * One shared renderer for both invoice stages — the title and printed number switch on
 * `invoice_status` (see design §3), so `GET .../proformas/:id/pdf` and
 * `GET .../invoices/:id/pdf` (wired separately) both resolve to the same document.
 *
 * Every financially-binding figure (`total_amount`, `igst_amount`, `cgst_amount`,
 * `sgst_amount`, `grand_total`) is read verbatim from `client_invoice` — frozen at
 * proforma-creation time by `createProforma` — and never recomputed here.
 *
 * Column names verified live against MySQL 8 (`mas_hrms`) before writing this file:
 *   - `client_invoice` has no `credit_date` column (the design doc's own sketch used that
 *     as a placeholder) — the real date column is `invoice_date`.
 *   - `cost_centre_master.bill_to_address4/5` and `ship_to_address4/5` do not exist; only
 *     `1`-`3` are populated columns, so only those three are read.
 *   - `cost_centre_master.client_tally_name` does not exist. The live billing-client-name
 *     column is `billing_client_name` (added by migration 1227, nullable, backfilled for
 *     399/437 active cost centres from `billing_invoice_snapshot`), which is a strictly
 *     better fit than the design's cited column name — it is the actual legal client
 *     entity, where `company_name` on this table is MAS Callnet's own name. Falls back to
 *     `company_name` only when `billing_client_name` is blank, so a cost centre that
 *     hasn't been backfilled yet still prints something rather than a blank line —
 *     the same graceful-omission pattern `branchAddress.service.ts` uses for
 *     `hasAddress`.
 *
 * Uses `pdfkit` (already the established PDF library in this codebase — see
 * `appointmentLetterPdf.service.ts`) and returns an in-memory `Buffer` via chunk
 * collection, matching that file's convention exactly: this is a generated-on-request
 * document, not a stored asset, so nothing is written to the filesystem.
 */
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
  billingClientName: string | null;
  companyName: string | null;
  stateCode: string | null;
}

const COMPANY_NAME = "Mas Callnet India Pvt. Ltd.";
const PAGE = { size: "A4" as const, margin: 48 };
const INK = "#111827";
const MUTED = "#6B7280";
const ACCENT = "#0EA5E9";
const DANGER = "#B91C1C";

type Doc = PDFKit.PDFDocument;

/** MySQL DATE columns come back as plain "YYYY-MM-DD" strings (pool sets dateStrings: true). */
function displayDate(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function generatedTimestamp(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date()) + " IST";
}

function money(n: number | null | undefined): string {
  return `Rs. ${Number(n ?? 0).toFixed(2)}`;
}

function addressLines(a1: string | null, a2: string | null, a3: string | null): string[] {
  return [a1, a2, a3].filter((x): x is string => Boolean(x && x.trim().length > 0));
}

async function loadInvoice(invoiceId: string): Promise<{ invoice: InvoiceRow; lines: LineRow[]; costCentre: CostCentreRow | undefined }> {
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

  const [costCentreRows] = await db.execute<CostCentreRow[]>(
    `SELECT cc.bill_to_address1 AS billToAddress1, cc.bill_to_address2 AS billToAddress2, cc.bill_to_address3 AS billToAddress3,
            cc.ship_to_address1 AS shipToAddress1, cc.ship_to_address2 AS shipToAddress2, cc.ship_to_address3 AS shipToAddress3,
            cc.hsn_code AS hsnCode, cc.sac_code AS sacCode, cc.service_tax_no AS serviceTaxNo,
            cc.vendor_gst_no AS vendorGstNo, cc.vendor_gst_state AS vendorGstState,
            cc.billing_client_name AS billingClientName, cc.company_name AS companyName,
            b.gst_state_code AS stateCode
     FROM cost_centre_master cc
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     WHERE cc.id = ?`,
    [invoice.cost_centre_id]
  );

  return { invoice, lines: lineRows, costCentre: costCentreRows[0] };
}

/** "PROFORMA INVOICE" / "TAX INVOICE" / "TAX INVOICE — REJECTED", per design §3. */
function documentTitle(status: InvoiceRow["invoice_status"]): string {
  if (status === "proforma") return "PROFORMA INVOICE";
  if (status === "rejected") return "TAX INVOICE — REJECTED";
  return "TAX INVOICE";
}

/** proforma_no while in proforma stage; bill_no once approved; either (bill_no first) if rejected. */
function documentNumber(invoice: InvoiceRow): string {
  if (invoice.invoice_status === "proforma") return invoice.proforma_no ?? "—";
  return invoice.bill_no ?? invoice.proforma_no ?? "—";
}

function drawHeader(doc: Doc, invoice: InvoiceRow, costCentre: CostCentreRow | undefined) {
  const width = doc.page.width - PAGE.margin * 2;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(COMPANY_NAME, PAGE.margin, PAGE.margin);
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  if (costCentre?.serviceTaxNo) doc.text(`GSTIN: ${costCentre.serviceTaxNo}`);
  if (costCentre?.stateCode) doc.text(`State Code: ${costCentre.stateCode}`);

  const title = documentTitle(invoice.invoice_status);
  doc.font("Helvetica-Bold").fontSize(16)
    .fillColor(invoice.invoice_status === "rejected" ? DANGER : INK)
    .text(title, PAGE.margin, PAGE.margin, { width, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(INK)
    .text(`Invoice No: ${documentNumber(invoice)}`, { width, align: "right" })
    .text(`Invoice Date: ${displayDate(invoice.invoice_date)}`, { width, align: "right" });

  doc.moveDown(0.8);
  const ruleY = doc.y;
  doc.moveTo(PAGE.margin, ruleY).lineTo(doc.page.width - PAGE.margin, ruleY)
    .lineWidth(1.2).strokeColor(ACCENT).stroke();
  doc.moveDown(0.6);
  doc.fillColor(INK);
}

function drawPartyColumns(doc: Doc, invoice: InvoiceRow, costCentre: CostCentreRow | undefined) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const colWidth = width / 2 - 10;
  const startY = doc.y;

  const clientName = costCentre?.billingClientName || costCentre?.companyName || "—";

  const billTo = addressLines(
    costCentre?.billToAddress1 ?? null, costCentre?.billToAddress2 ?? null, costCentre?.billToAddress3 ?? null
  );
  const shipTo = addressLines(
    costCentre?.shipToAddress1 ?? null, costCentre?.shipToAddress2 ?? null, costCentre?.shipToAddress3 ?? null
  );

  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("BILL TO", left, startY, { width: colWidth });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(clientName, { width: colWidth });
  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  for (const line of billTo) doc.text(line, { width: colWidth });
  if (costCentre?.vendorGstNo) doc.text(`GSTIN: ${costCentre.vendorGstNo}`, { width: colWidth });
  if (costCentre?.vendorGstState) doc.text(`State: ${costCentre.vendorGstState}`, { width: colWidth });

  const rightX = left + colWidth + 20;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("SHIP TO", rightX, startY, { width: colWidth });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(clientName, rightX, doc.y, { width: colWidth });
  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  if (shipTo.length > 0) {
    for (const line of shipTo) doc.text(line, rightX, doc.y, { width: colWidth });
  } else {
    doc.fillColor(MUTED).text("Same as Bill To", rightX, doc.y, { width: colWidth });
  }

  doc.y = Math.max(doc.y, startY + 60);
  doc.x = left;
  doc.fillColor(INK);
  doc.moveDown(0.8);
}

function drawLineItemsTable(doc: Doc, invoice: InvoiceRow, lines: LineRow[], costCentre: CostCentreRow | undefined) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const cols = { particulars: width * 0.42, hsn: width * 0.16, qty: width * 0.12, rate: width * 0.14, amount: width * 0.16 };
  const hsnSac = costCentre?.hsnCode || costCentre?.sacCode || "—";

  const headerY = doc.y;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED);
  let x = left;
  doc.text("Particulars", x, headerY, { width: cols.particulars }); x += cols.particulars;
  doc.text("HSN/SAC", x, headerY, { width: cols.hsn, align: "right" }); x += cols.hsn;
  doc.text("Qty", x, headerY, { width: cols.qty, align: "right" }); x += cols.qty;
  doc.text("Rate", x, headerY, { width: cols.rate, align: "right" }); x += cols.rate;
  doc.text("Amount", x, headerY, { width: cols.amount, align: "right" });
  doc.y = headerY + 12;
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.8).strokeColor("#D1D5DB").stroke();
  doc.y += 4;

  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  for (const line of lines) {
    const rowY = doc.y;
    const signedAmount = line.line_type === "deduction" ? -Number(line.amount) : Number(line.amount);
    x = left;
    doc.text(line.particulars, x, rowY, { width: cols.particulars }); x += cols.particulars;
    doc.text(hsnSac, x, rowY, { width: cols.hsn, align: "right" }); x += cols.hsn;
    doc.text(String(line.qty), x, rowY, { width: cols.qty, align: "right" }); x += cols.qty;
    doc.text(money(line.rate), x, rowY, { width: cols.rate, align: "right" }); x += cols.rate;
    doc.text(money(signedAmount), x, rowY, { width: cols.amount, align: "right" });
    doc.y = Math.max(doc.y, rowY + 14);
  }
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.8).strokeColor("#D1D5DB").stroke();
  doc.moveDown(0.6);
}

/** Taxable total, then IGST (Integrated) or CGST+SGST (Intrastate), then grand total — all frozen columns, never recomputed. */
function drawTaxSummary(doc: Doc, invoice: InvoiceRow) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const labelWidth = width - 140;
  const amountX = left + labelWidth;

  const row = (label: string, amount: number, bold = false) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(INK)
      .text(label, left, y, { width: labelWidth, align: "right" })
      .text(money(amount), amountX, y, { width: 140, align: "right" });
    doc.y = y + 14;
  };

  row("Taxable Value", Number(invoice.total_amount));
  if (invoice.apply_gst) {
    if (invoice.gst_type === "Integrated") {
      row("IGST", Number(invoice.igst_amount));
    } else {
      row("CGST", Number(invoice.cgst_amount));
      row("SGST", Number(invoice.sgst_amount));
    }
  }
  doc.moveTo(amountX, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor("#D1D5DB").stroke();
  doc.y += 4;
  row("Grand Total", Number(invoice.grand_total), true);
  doc.moveDown(0.8);
}

function drawFooter(doc: Doc) {
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
    .text("This is a system-generated invoice and does not require a physical signature.", left, doc.y, { width })
    .text(`Generated: ${generatedTimestamp()}`, left, doc.y, { width });
}

function renderPdf(invoice: InvoiceRow, lines: LineRow[], costCentre: CostCentreRow | undefined): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc, invoice, costCentre);
    drawPartyColumns(doc, invoice, costCentre);
    drawLineItemsTable(doc, invoice, lines, costCentre);
    drawTaxSummary(doc, invoice);
    drawFooter(doc);

    doc.end();
  });
}

async function generateInvoicePdf(invoiceId: string): Promise<Buffer> {
  const { invoice, lines, costCentre } = await loadInvoice(invoiceId);
  return renderPdf(invoice, lines, costCentre);
}

export const clientBillingPdfService = { generateInvoicePdf };
