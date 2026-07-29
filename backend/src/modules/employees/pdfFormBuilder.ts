/**
 * Primitives for authoring fillable statutory PDFs.
 *
 * The EPFO-issued forms are flat scans — no AcroForm fields and no vector
 * rectangles — so they cannot be filled and their character boxes cannot be
 * located programmatically. Both EPF forms are therefore rebuilt here as real
 * AcroForms at coordinates we control, reusing the field names the field maps
 * already reference.
 *
 * Character boxes use PDF comb fields: a comb field with a max length of N lays
 * exactly one glyph per cell, so a space occupies its own box, which is what
 * EPFO expects of a boxed name.
 */
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFForm, type PDFFont } from "pdf-lib";

export const A4 = { w: 595.28, h: 841.89 };
export const MARGIN = 34;
export const INK = rgb(0, 0, 0);
export const BOX = rgb(0.45, 0.45, 0.45);

export type Ctx = {
  doc: PDFDocument;
  form: PDFForm;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
};

export async function newFormDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([A4.w, A4.h]);
  const ctx: Ctx = { doc, form: doc.getForm(), page, font, bold, y: A4.h - MARGIN };
  return ctx;
}

export function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([A4.w, A4.h]);
  ctx.y = A4.h - MARGIN;
  return ctx.y;
}

export function label(ctx: Ctx, s: string, x: number, y: number, size = 8, bold = false) {
  ctx.page.drawText(s, { x, y, size, font: bold ? ctx.bold : ctx.font, color: INK });
}

export function footer(ctx: Ctx, s: string) {
  ctx.page.drawText(s, { x: A4.w / 2 - 24, y: 24, size: 7, font: ctx.font, color: INK });
}

/** A row of empty cells plus a comb field writing one character per cell. */
export function combField(
  ctx: Ctx,
  name: string,
  x: number,
  y: number,
  cells: number,
  cellW = 13.5,
  cellH = 15,
) {
  for (let i = 0; i < cells; i++) {
    ctx.page.drawRectangle({
      x: x + i * cellW, y, width: cellW, height: cellH,
      borderColor: BOX, borderWidth: 0.6,
    });
  }
  const field = ctx.form.createTextField(name);
  field.setMaxLength(cells);
  field.enableCombing();
  // setFontSize needs the /DA entry that addToPage creates, so it comes after.
  field.addToPage(ctx.page, { x, y, width: cells * cellW, height: cellH, borderWidth: 0 });
  field.setFontSize(9);
  return field;
}

/** A plain bordered text field, for free text such as an address. */
export function lineField(
  ctx: Ctx,
  name: string,
  x: number,
  y: number,
  width: number,
  height = 15,
  fontSize = 9,
) {
  ctx.page.drawRectangle({ x, y, width, height, borderColor: BOX, borderWidth: 0.6 });
  const field = ctx.form.createTextField(name);
  field.addToPage(ctx.page, { x, y, width, height, borderWidth: 0 });
  field.setFontSize(fontSize);
  return field;
}

export function checkBox(ctx: Ctx, name: string, text: string, x: number, y: number, labelWidth = 74) {
  ctx.page.drawText(text, { x, y: y + 4, size: 7.5, font: ctx.font, color: INK });
  const bx = x + labelWidth;
  ctx.page.drawRectangle({ x: bx, y, width: 13, height: 13, borderColor: BOX, borderWidth: 0.6 });
  ctx.form.createCheckBox(name).addToPage(ctx.page, { x: bx, y, width: 13, height: 13, borderWidth: 0 });
  return bx + 13;
}

/** Day/month/year as separate comb groups, matching the date_* transform rules. */
export function dateBoxes(
  ctx: Ctx,
  names: { day: string; month: string; year: string },
  x: number,
  y: number,
) {
  combField(ctx, names.day, x, y, 2, 13.5);
  combField(ctx, names.month, x + 2 * 13.5 + 6, y, 2, 13.5);
  combField(ctx, names.year, x + 4 * 13.5 + 12, y, 4, 13.5);
}

/** The grey section band the EPFO forms use for "A. PREVIOUS EMPLOYMENT DETAILS" etc. */
export function sectionBand(ctx: Ctx, text: string, x: number, y: number, width: number, height = 13) {
  ctx.page.drawRectangle({ x, y, width, height, color: rgb(0.85, 0.85, 0.85) });
  ctx.page.drawText(text, { x: x + 6, y: y + 3.5, size: 7.5, font: ctx.bold, color: INK });
}

/**
 * A labelled tick table: one bordered header cell per option with an empty cell
 * beneath it holding the checkbox, exactly how Form 11 sets gender, marital
 * status and educational qualification.
 */
export function tickTable(
  ctx: Ctx,
  x: number,
  top: number,
  columns: Array<{ label: string; field: string }>,
  colWidth: number,
  headerHeight = 16,
  cellHeight = 15,
) {
  columns.forEach((column, index) => {
    const cx = x + index * colWidth;
    ctx.page.drawRectangle({ x: cx, y: top - headerHeight, width: colWidth, height: headerHeight, borderColor: BOX, borderWidth: 0.6 });
    // Long headings are split so they stay inside the cell.
    const words = column.label.split(" ");
    const lines = words.length > 1 && column.label.length > 11
      ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")]
      : [column.label];
    lines.forEach((line, li) => {
      const size = 5.8;
      const w = ctx.font.widthOfTextAtSize(line, size);
      ctx.page.drawText(line, {
        x: cx + Math.max(1, (colWidth - w) / 2),
        y: top - headerHeight + (lines.length === 1 ? 5.5 : 9.5 - li * 5.5),
        size, font: ctx.font, color: INK,
      });
    });
    const cellY = top - headerHeight - cellHeight;
    ctx.page.drawRectangle({ x: cx, y: cellY, width: colWidth, height: cellHeight, borderColor: BOX, borderWidth: 0.6 });
    ctx.form.createCheckBox(column.field).addToPage(ctx.page, {
      x: cx + colWidth / 2 - 6, y: cellY + 2, width: 11, height: 11, borderWidth: 0,
    });
  });
  return top - headerHeight - cellHeight;
}

/** Draws a table grid and returns the x offset of each column. */
export function tableGrid(
  ctx: Ctx,
  x: number,
  top: number,
  widths: number[],
  rowHeight: number,
  rows: number,
) {
  const xs: number[] = [];
  let cx = x;
  for (const w of widths) { xs.push(cx); cx += w; }
  const totalW = cx - x;
  for (let r = 0; r <= rows; r++) {
    const y = top - r * rowHeight;
    ctx.page.drawLine({ start: { x, y }, end: { x: x + totalW, y }, thickness: 0.6, color: BOX });
  }
  for (let c = 0; c <= widths.length; c++) {
    const lx = c === widths.length ? x + totalW : xs[c];
    ctx.page.drawLine({
      start: { x: lx, y: top }, end: { x: lx, y: top - rows * rowHeight },
      thickness: 0.6, color: BOX,
    });
  }
  return xs;
}
