/**
 * Guards the company signature / rubber stamp applied to statutory forms.
 *
 * Both EPF forms carry an employer block the form itself requires to bear a
 * seal. Placement is derived from the employer_signature field's own widget
 * rectangle, so these tests pin the two properties that make that safe:
 * the mark lands on the page that actually holds the block, and the field is
 * removed afterwards so it cannot be dragged or edited in a reader.
 */
import { describe, it, expect, vi } from "vitest";

// The service reads org_settings; these tests drive it with explicit seals.
vi.mock("../src/db/mysql.js", () => ({ db: { query: vi.fn().mockResolvedValue([[], []]) } }));

import { PDFDocument, rgb } from "pdf-lib";
import { applyCompanySeal, documentAcceptsCompanySeal } from "../src/modules/employees/companySeal.service.js";
import { buildEpfDeclarationPdf } from "../src/modules/employees/epfDeclarationForm.js";
import { buildEpfNominationPdf } from "../src/modules/employees/epfNominationForm.js";

/** A small real PNG, generated rather than checked in as a fixture. */
async function pngBytes(r: number, g: number, b: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([60, 30]);
  page.drawRectangle({ x: 0, y: 0, width: 60, height: 30, color: rgb(r, g, b) });
  // pdf-lib cannot encode PNG, so build the smallest valid one by hand:
  // a 1x1 opaque pixel is enough to prove embedding and placement.
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000100ff5f2a4b0000000049454e44ae426082",
    "hex",
  );
}

/** Counts image XObjects reachable from a page's resources. */
function imageCount(page: any): number {
  const resources = page.node.Resources();
  const xobjects = resources?.lookup?.(page.node.context.obj("XObject"));
  if (!xobjects || typeof xobjects.entries !== "function") return 0;
  return xobjects.entries().length;
}

describe("company seal", () => {
  it("TC-SEAL-01: only the documents with an employer block accept a seal", () => {
    expect(documentAcceptsCompanySeal("EPF_DECLARATION")).toBe(true);
    expect(documentAcceptsCompanySeal("EPF_NOMINATION_FORM2")).toBe(true);
    // These are signed by the employee alone; stamping them would be wrong.
    expect(documentAcceptsCompanySeal("NDA_CONFIDENTIALITY")).toBe(false);
    expect(documentAcceptsCompanySeal("PI_PROCESSING_CONSENT")).toBe(false);
    expect(documentAcceptsCompanySeal("")).toBe(false);
  });

  it("TC-SEAL-02: the mark lands on the employer page and the field is removed", async () => {
    const blank = await buildEpfDeclarationPdf();
    const before = await PDFDocument.load(blank);
    expect(before.getForm().getFields().some((f) => f.getName() === "employer_signature")).toBe(true);
    const employerPage = before.getPageCount() - 1; // employer block is on the last page
    expect(imageCount(before.getPage(employerPage))).toBe(0);

    const sealed = await applyCompanySeal(blank, "EPF_DECLARATION", {
      signature: await pngBytes(0, 0, 0.6),
      stamp: await pngBytes(0.6, 0, 0),
      signatoryName: "R. RAMACHANDRAN",
      signatoryDesignation: "Director",
    });

    const after = await PDFDocument.load(sealed);
    expect(imageCount(after.getPage(employerPage)), "seal did not land on the employer page").toBeGreaterThan(0);
    // No other page should have been stamped.
    for (let p = 0; p < employerPage; p++) {
      expect(imageCount(after.getPage(p)), `page ${p + 1} was stamped by mistake`).toBe(0);
    }
    // The field is gone, so the mark cannot be edited in a reader.
    expect(after.getForm().getFields().some((f) => f.getName() === "employer_signature")).toBe(false);
  });

  it("TC-SEAL-03: Form 2 is sealed on its employer page too", async () => {
    const blank = await buildEpfNominationPdf();
    const sealed = await applyCompanySeal(blank, "EPF_NOMINATION_FORM2", {
      signature: await pngBytes(0, 0, 0.6),
      stamp: null,
      signatoryName: null,
      signatoryDesignation: null,
    });
    const after = await PDFDocument.load(sealed);
    const employerPage = after.getPageCount() - 1;
    expect(imageCount(after.getPage(employerPage))).toBeGreaterThan(0);
  });

  it("TC-SEAL-04: nothing uploaded yet leaves the document untouched", async () => {
    const blank = await buildEpfDeclarationPdf();
    const out = await applyCompanySeal(blank, "EPF_DECLARATION", {
      signature: null, stamp: null, signatoryName: null, signatoryDesignation: null,
    });
    // Byte-identical: an unconfigured seal must not even re-save the PDF.
    expect(Buffer.from(out).equals(Buffer.from(blank))).toBe(true);
  });

  it("TC-SEAL-05: a corrupt image never blocks a joiner's document", async () => {
    const blank = await buildEpfDeclarationPdf();
    const out = await applyCompanySeal(blank, "EPF_DECLARATION", {
      signature: Buffer.from("this is not an image"),
      stamp: null, signatoryName: null, signatoryDesignation: null,
    });
    // Falls back to the unsealed document rather than throwing.
    expect(out.byteLength).toBeGreaterThan(0);
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });
});
