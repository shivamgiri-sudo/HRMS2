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
import zlib from "zlib";
import PDFDocument from "pdfkit";
import { PDFDocument as PDFLibDocument, PDFRawStream, PDFName, StandardFonts, rgb } from "pdf-lib";
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

function renderContent(
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

    doc.end();
  });
}

/** Document codes this renderer can set. */
export function hasStructuredPdf(documentCode: string) {
  return TEMPLATE_DEFINITIONS.some((entry) => entry.code === documentCode);
}

/** Text drawn on a page, used only to decide whether it carries any content. */
async function pageText(doc: PDFLibDocument, index: number): Promise<string> {
  const page = doc.getPage(index);
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  const asArray = (contents as unknown as { asArray?: () => unknown[] })?.asArray;
  if (contents instanceof PDFRawStream) streams.push(contents);
  else if (typeof asArray === "function") {
    for (const ref of asArray.call(contents)) {
      const looked = doc.context.lookup(ref as never);
      if (looked instanceof PDFRawStream) streams.push(looked);
    }
  }
  let out = "";
  for (const stream of streams) {
    let raw = Buffer.from(stream.contents);
    const filter = stream.dict.get(PDFName.of("Filter"));
    if (filter && String(filter).includes("FlateDecode")) {
      try { raw = zlib.inflateSync(raw); } catch { continue; }
    }
    const text = raw.toString("latin1");
    for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
      out += Buffer.from(match[1].replace(/\s/g, ""), "hex").toString("latin1");
    }
  }
  return out;
}

/**
 * Drops pages carrying nothing but the letterhead, then stamps the footer.
 *
 * A paragraph that lands near the bottom can push PDFKit into starting a page
 * it then never writes to, and the pageAdded hook dutifully letterheads it. The
 * joiner would receive a document ending in blank sheets. Footers are applied
 * here rather than in PDFKit so "Page N of M" is counted after the removal.
 */
async function finish(pdfBytes: Buffer): Promise<Buffer> {
  const doc = await PDFLibDocument.load(pdfBytes);
  const boilerplate = (COMPANY_NAME + COMPANY_ADDRESS).replace(/\s/g, "");

  const empty: number[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const text = (await pageText(doc, i)).replace(/\s/g, "");
    // Whatever remains once the letterhead is discounted is real content.
    if (text.replace(boilerplate, "").length === 0) empty.push(i);
  }
  // Never remove every page; a document with no content at all is a bug worth
  // seeing rather than an empty file.
  if (empty.length && empty.length < doc.getPageCount()) {
    for (const index of empty.reverse()) doc.removePage(index);
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  doc.getPages().forEach((page, index) => {
    const { width } = page.getSize();
    const y = 42;
    page.drawLine({
      start: { x: PAGE.margin, y: y + 12 }, end: { x: width - PAGE.margin, y: y + 12 },
      thickness: 0.6, color: rgb(0.82, 0.84, 0.86),
    });
    const left = `${COMPANY_NAME}  |  ${CONFIDENTIAL_NOTE}`;
    page.drawText(left, { x: PAGE.margin, y, size: 7, font, color: rgb(0.42, 0.45, 0.5) });
    const right = `Page ${index + 1} of ${total}`;
    page.drawText(right, {
      x: width - PAGE.margin - font.widthOfTextAtSize(right, 7),
      y, size: 7, font, color: rgb(0.42, 0.45, 0.5),
    });
  });
  return Buffer.from(await doc.save());
}

/** Renders a joining document, letterheaded, footered and free of blank pages. */
export async function renderJoiningDocumentPdf(
  documentCode: string,
  replacements: Record<string, string>,
): Promise<Buffer> {
  return finish(await renderContent(documentCode, replacements));
}
