/**
 * Renders joining documents as finished, letterheaded PDFs.
 *
 * These documents were previously handed to a new joiner as .docx files. That
 * was wrong twice over: a Word file is editable by whoever receives it, which
 * is indefensible for a document they are about to sign, and it arrives with no
 * letterhead, no logo and no page numbering, so it does not read as an official
 * company record.
 *
 * The wording is not touched. Content still comes from the approved blocks in
 * joiningDocumentTemplates.ts; this only decides how they are set on the page.
 */
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { TEMPLATE_DEFINITIONS } from "./joiningDocumentTemplates.js";

const COMPANY_NAME = "Mas Callnet India Pvt. Ltd.";
const COMPANY_ADDRESS = "B-24, Okhla Phase-II, New Delhi - 110020";
const CONFIDENTIAL_NOTE = "Private & Confidential";

const PAGE = { size: "A4" as const, margin: 56 };
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const ACCENT = "#7f1d1d";

/** The logo lives in the frontend's public directory, one level above backend. */
function logoPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "..", "public", "mcn-logo.png"),
    path.resolve(process.cwd(), "public", "mcn-logo.png"),
    path.resolve(process.cwd(), "..", "dist", "mcn-logo.png"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Indian documents are read as DD/MM/YYYY; an ISO string reads as a system
 * dump. Applied only when setting the page, never to the stored value, which
 * must stay ISO for the EPF date boxes to split correctly.
 */
function displayValue(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function substitute(text: string, replacements: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_whole, token: string) => {
    const value = replacements[token.trim()];
    // An unresolved token must not be left as {{token}} on a document going out
    // for signature; an underscore rule reads as a field to be completed.
    if (value == null || value === "") return "__________________";
    return displayValue(value);
  });
}

type Doc = PDFKit.PDFDocument;

function drawLetterhead(doc: Doc) {
  const top = 34;
  const logo = logoPath();
  if (logo) {
    try { doc.image(logo, PAGE.margin, top, { height: 26 }); } catch { /* fall through to text */ }
  }
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
    .text(COMPANY_NAME, PAGE.margin, top, { width: doc.page.width - PAGE.margin * 2, align: "right" });
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
    .text(COMPANY_ADDRESS, PAGE.margin, top + 12, { width: doc.page.width - PAGE.margin * 2, align: "right" });

  const ruleY = top + 32;
  doc.moveTo(PAGE.margin, ruleY).lineTo(doc.page.width - PAGE.margin, ruleY)
    .lineWidth(1.2).strokeColor(ACCENT).stroke();
  doc.y = ruleY + 18;
  doc.fillColor(INK);
}

function drawFooters(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - 42;
    doc.moveTo(PAGE.margin, y).lineTo(doc.page.width - PAGE.margin, y)
      .lineWidth(0.6).strokeColor(RULE).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(MUTED)
      .text(`${COMPANY_NAME}  |  ${CONFIDENTIAL_NOTE}`, PAGE.margin, y + 6, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE.margin, y + 6, {
      width: doc.page.width - PAGE.margin * 2,
      align: "right",
      lineBreak: false,
    });
  }
}

/**
 * Keeps a heading with the text that follows it rather than orphaning it.
 * The letterhead is drawn by the pageAdded hook, not here — PDFKit also creates
 * pages on its own when text overflows, and those were coming out bare.
 */
function ensureRoom(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - 70) doc.addPage();
}

/** "Signature: ______  Date: 29/07/2026" is set as a ruled block, not body text. */
const SIGNATURE_LINE = /^(Signature|Employee Signature|For and on behalf of|Witness \d)/i;

export function renderJoiningDocumentPdf(
  documentCode: string,
  replacements: Record<string, string>,
): Promise<Buffer> {
  const definition = TEMPLATE_DEFINITIONS.find((entry) => entry.code === documentCode);
  if (!definition) throw new Error(`No template definition for ${documentCode}`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // Every page gets the letterhead, including the ones PDFKit adds itself
    // when a paragraph overflows. The first page already exists, so it is drawn
    // directly; the hook covers the rest.
    doc.on("pageAdded", () => drawLetterhead(doc));

    drawLetterhead(doc);
    const contentWidth = doc.page.width - PAGE.margin * 2;

    for (const block of definition.blocks) {
      const style = block.style ?? "body";
      if (style === "spacer") { doc.moveDown(0.6); continue; }

      const text = substitute(block.text, replacements);

      if (style === "title") {
        ensureRoom(doc, 46);
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(13).fillColor(INK)
          .text(text, { width: contentWidth, align: "center" });
        // A rule under the title, the width of the words, reads as a heading.
        doc.moveDown(0.3);
        const w = Math.min(contentWidth, doc.widthOfString(text) + 20);
        const x = PAGE.margin + (contentWidth - w) / 2;
        doc.moveTo(x, doc.y).lineTo(x + w, doc.y).lineWidth(0.8).strokeColor(ACCENT).stroke();
        doc.moveDown(0.8);
        continue;
      }

      if (style === "heading") {
        ensureRoom(doc, 40);
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(ACCENT)
          .text(text, { width: contentWidth });
        doc.moveDown(0.25);
        continue;
      }

      if (style === "bullet") {
        // Clauses arrive already numbered ("1. ", "(a) "); hang the indent on
        // that marker so wrapped lines align under the text, not the number.
        const marker = /^(\d+\.\d+|\d+\.|\([a-z]\)|\([iv]+\))\s+/i.exec(text);
        ensureRoom(doc, 30);
        if (marker) {
          const label = marker[1];
          const body = text.slice(marker[0].length);
          const labelWidth = 34;
          const startY = doc.y;
          doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
            .text(label, PAGE.margin + 8, startY, { width: labelWidth, lineBreak: false });
          doc.font("Helvetica").fontSize(9).fillColor(INK)
            .text(body, PAGE.margin + 8 + labelWidth, startY, {
              width: contentWidth - labelWidth - 8,
              align: "justify",
            });
        } else {
          doc.font("Helvetica").fontSize(9).fillColor(INK)
            .text(text, PAGE.margin + 8, doc.y, { width: contentWidth - 8, align: "justify" });
        }
        doc.moveDown(0.35);
        continue;
      }

      if (SIGNATURE_LINE.test(text)) {
        ensureRoom(doc, 44);
        doc.moveDown(0.5);
        doc.font("Helvetica").fontSize(9).fillColor(INK)
          .text(text, { width: contentWidth });
        doc.moveDown(0.3);
        continue;
      }

      ensureRoom(doc, 28);
      doc.font("Helvetica").fontSize(9).fillColor(INK)
        .text(text, { width: contentWidth, align: "justify" });
      doc.moveDown(0.45);
    }

    drawFooters(doc);
    doc.end();
  });
}

/** Document codes this renderer can set. */
export function hasStructuredPdf(documentCode: string) {
  return TEMPLATE_DEFINITIONS.some((entry) => entry.code === documentCode);
}
