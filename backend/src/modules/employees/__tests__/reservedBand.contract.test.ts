/**
 * Nothing may be drawn in the signature band.
 *
 * This is the test for the bug that started all of it: an employee completed an
 * Aadhaar eSign and the signature landed on top of the contract text.
 *
 * The cause was measurable, not mysterious. The provider stamps the visible
 * signature at Rect [425,100,545,160] on the last page — read directly out of a
 * real signed Employment Contract — while the renderer let body text flow down
 * to y≈56, straight through that band.
 *
 * So the assertion is concrete: render each joining document and prove no text
 * is positioned below y=180. A 120pt reserve, which is what was planned before
 * measuring, would fail this test.
 */
import { describe, it, expect } from "vitest";
import zlib from "zlib";
import { PDFDocument as PDFLibDocument, PDFRawStream } from "pdf-lib";
import { renderJoiningDocumentPdf, hasStructuredPdf } from "../joiningDocumentPdf.service.js";

/** Where the provider puts the employee's signature. Measured, not assumed. */
const AADHAAR_WIDGET = { x1: 425, y1: 100, x2: 545, y2: 160 };
const RESERVED_BAND = 180;

const CODES = [
  "EMPLOYMENT_CONTRACT", "NDA_CONFIDENTIALITY", "IT_COMPLIANCE",
  "BAMS_DECLARATION", "PI_PROCESSING_CONSENT", "ZERO_TOLERANCE_ACK",
];

const REPLACEMENTS: Record<string, string> = {
  employee_name: "SHIVAM SHIV GIRI", employee_code: "MAS47814",
  designation: "MANAGER", department: "Operations", branch: "NOIDA-2",
  joining_date: "2021-03-15", current_date: "2026-08-01", place: "New Delhi",
  employee_address: "Test address, New Delhi",
  nda_signature_date: "2026-08-01", it_signature_date: "2026-08-01",
  pi_signature_date: "2026-08-01", zero_tolerance_signature_date: "2026-08-01",
  surveillance_signature_date: "2026-08-01",
};

/** Every text-drawing y coordinate on a page, from the decoded content stream. */
async function textYCoordinates(pdf: Buffer): Promise<Array<{ page: number; y: number }>> {
  const doc = await PDFLibDocument.load(pdf, { updateMetadata: false });
  const out: Array<{ page: number; y: number }> = [];

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i);
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

    for (const stream of streams) {
      let raw = Buffer.from(stream.contents);
      try { raw = zlib.inflateSync(raw); } catch { /* already plain */ }
      const text = raw.toString("latin1");

      // Track the text matrix. Td/TD are relative to the line matrix, Tm sets it
      // absolutely; only positions inside a BT/ET block draw glyphs.
      let inText = false, curY = 0;
      for (const m of text.matchAll(/(BT|ET)|([-\d.]+)\s+([-\d.]+)\s+(Td|TD)|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|(Tj|TJ)/g)) {
        if (m[1] === "BT") { inText = true; curY = 0; continue; }
        if (m[1] === "ET") { inText = false; continue; }
        if (m[4]) { curY += Number(m[3]); continue; }          // Td / TD
        if (m[10] !== undefined) { curY = Number(m[10]); continue; } // Tm -> f
        if (m[11] && inText) out.push({ page: i, y: curY });    // Tj / TJ
      }
    }
  }
  return out;
}

describe("the signature band is kept clear", () => {
  for (const code of CODES) {
    it(`${code} draws no text below y=${RESERVED_BAND}`, async () => {
      expect(hasStructuredPdf(code)).toBe(true);
      const pdf = await renderJoiningDocumentPdf(code, REPLACEMENTS);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const offenders = (await textYCoordinates(pdf)).filter((t) => t.y > 0 && t.y < RESERVED_BAND);
      expect(
        offenders,
        `${code}: ${offenders.length} text runs inside the reserved band, e.g. ` +
        offenders.slice(0, 3).map((o) => `page ${o.page + 1} y=${o.y.toFixed(1)}`).join(", "),
      ).toEqual([]);
    });
  }

  it("nothing overlaps the provider's widget rectangle", async () => {
    // The narrower, decisive check: the exact box the signature occupies.
    const pdf = await renderJoiningDocumentPdf("EMPLOYMENT_CONTRACT", REPLACEMENTS);
    const collisions = (await textYCoordinates(pdf))
      .filter((t) => t.y > AADHAAR_WIDGET.y1 - 6 && t.y < AADHAAR_WIDGET.y2 + 6);
    expect(collisions).toEqual([]);
  });

  it("a 120pt reserve would NOT have been enough", () => {
    // Recorded so the number is never quietly reduced: the widget's top edge is
    // at 160, so any band at or below that leaves it overlapping content.
    expect(AADHAAR_WIDGET.y2).toBeGreaterThan(120);
    expect(RESERVED_BAND).toBeGreaterThan(AADHAAR_WIDGET.y2);
  });
});

describe("the reserve is applied in every place that can place content", () => {
  const src = require("fs").readFileSync(
    require("path").resolve(__dirname, "../joiningDocumentPdf.service.ts"), "utf8") as string;

  it("ensureRoom accounts for the band", () => {
    // Explicit block placement.
    expect(src).toContain("doc.page.height - (70 + RESERVE.band)");
    expect(src).not.toContain("doc.page.height - 70)");
  });

  it("the page margin accounts for the band", () => {
    // PDFKit paginates overflowing paragraphs on the bottom margin, so a bare
    // `margin` would let text run into the band regardless of ensureRoom.
    expect(src).toContain("bottom: PAGE.margin + RESERVE.band");
  });

  it("the footer sits above the band", () => {
    expect(src).toContain("const y = RESERVE.band + 2;");
    expect(src).not.toContain("const y = 42;");
  });
});
