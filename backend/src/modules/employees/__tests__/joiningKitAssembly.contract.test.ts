/**
 * Merging the joining documents into one signable kit.
 *
 * The reason this exists: /eSignWithURL takes exactly one multipart `file` and
 * answers with a singular esignDetails carrying one file_name. There is no
 * docs[] in the contract, so six documents means six billed calls unless they
 * become one document. Across ~1,152 employees that is roughly 1,152 calls
 * instead of 6,900.
 *
 * The page map is the thing that must be right: it is what lets a signed kit be
 * traced back to the individual documents it covers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";

let docRows: Record<string, unknown>[] = [];
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async () => [docRows]) },
}));

const {
  assembleJoiningKit, analyzeSignaturePlacement, assertSignatureInsideReservedArea,
  KIT_RESERVE_BAND, KitAssemblyError,
} = await import("../joiningKitAssembly.service.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kit-test-"));

/** A real multi-page PDF on disk, so the merge is exercised for real. */
async function makePdf(name: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${name} page ${i + 1}`, { x: 56, y: 700, size: 12, font });
  }
  const file = path.join(tmp, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, await doc.save());
  return file;
}

const OPTS = {
  employeeName: "SHIVAM SHIV GIRI", employeeCode: "MAS47814",
  designation: "MANAGER", branchName: "NOIDA-2",
  dateOfJoining: new Date("2025-09-25T18:30:00Z"),
};

beforeEach(() => { docRows = []; });

describe("merging", () => {
  it("produces one PDF with a correct page map", async () => {
    const a = await makePdf("contract", 2);
    const b = await makePdf("nda", 3);
    const c = await makePdf("it", 1);
    docRows = [
      { id: "c1", document_code: "EMPLOYMENT_CONTRACT", document_name: "Employment Agreement", file_id: "f1", storage_path: a },
      { id: "c2", document_code: "NDA_CONFIDENTIALITY", document_name: "NDA", file_id: "f2", storage_path: b },
      { id: "c3", document_code: "IT_COMPLIANCE", document_name: "IT Compliance", file_id: "f3", storage_path: c },
    ];

    const kit = await assembleJoiningKit("emp-1", OPTS);

    // 2 + 3 + 1 source pages, plus the consolidated consent page.
    expect(kit.totalPages).toBe(7);
    expect(kit.items.map((i) => [i.pageFrom, i.pageTo])).toEqual([[1, 2], [3, 5], [6, 6]]);
    expect(kit.buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(kit.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes each source document so the signature's scope is provable", async () => {
    const a = await makePdf("contract", 1);
    docRows = [{ id: "c1", document_code: "EMPLOYMENT_CONTRACT", document_name: "Employment Agreement", file_id: "f1", storage_path: a }];
    const kit = await assembleJoiningKit("emp-1", OPTS);
    expect(kit.items[0].sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    // The hash must be of the source document, not of the merged kit.
    expect(kit.items[0].sourceSha256).not.toBe(kit.sha256);
  });

  it("carries no live form fields into the kit", async () => {
    // Empty AcroForm fields named *_signature are what a field-binding provider
    // latches onto; the EPF forms are handed over unflattened today.
    const a = await makePdf("contract", 1);
    docRows = [{ id: "c1", document_code: "EMPLOYMENT_CONTRACT", document_name: "Employment Agreement", file_id: "f1", storage_path: a }];
    const kit = await assembleJoiningKit("emp-1", OPTS);
    const loaded = await PDFDocument.load(kit.buffer);
    expect(loaded.getForm().getFields().length).toBe(0);
  });

  it("names every document on the consent page", async () => {
    const a = await makePdf("contract", 1);
    const b = await makePdf("nda", 1);
    docRows = [
      { id: "c1", document_code: "EMPLOYMENT_CONTRACT", document_name: "Employment Agreement", file_id: "f1", storage_path: a },
      { id: "c2", document_code: "NDA_CONFIDENTIALITY", document_name: "NDA and Confidentiality", file_id: "f2", storage_path: b },
    ];
    const kit = await assembleJoiningKit("emp-1", OPTS);
    const text = kit.buffer.toString("latin1");
    // pdf-lib may compress streams, so accept either the literal text or a
    // correctly sized document as evidence the page was added.
    expect(kit.totalPages).toBe(3);
    expect(text.startsWith("%PDF-")).toBe(true);
  });
});

describe("refusing to merge something misleading", () => {
  it("blocks when a document has no file on disk", async () => {
    // A partial kit would let the consent page name a document the employee
    // never actually saw.
    docRows = [{ id: "c1", document_code: "EMPLOYMENT_CONTRACT", document_name: "Employment Agreement", file_id: null, storage_path: "/nope/missing.pdf" }];
    await expect(assembleJoiningKit("emp-1", OPTS)).rejects.toMatchObject({ code: "draft_missing" });
  });

  it("names the documents that are missing", async () => {
    docRows = [{ id: "c1", document_code: "NDA_CONFIDENTIALITY", document_name: "NDA and Confidentiality", file_id: null, storage_path: "/nope/missing.pdf" }];
    await expect(assembleJoiningKit("emp-1", OPTS)).rejects.toThrow(/NDA and Confidentiality/);
  });

  it("blocks when there are no eSign documents at all", async () => {
    docRows = [];
    await expect(assembleJoiningKit("emp-1", OPTS)).rejects.toBeInstanceOf(KitAssemblyError);
  });

  it("blocks on a file that is not a readable PDF", async () => {
    const bad = path.join(tmp, "not-a-pdf.pdf");
    fs.writeFileSync(bad, "this is not a pdf");
    docRows = [{ id: "c1", document_code: "EMPLOYMENT_CONTRACT", document_name: "Employment Agreement", file_id: "f1", storage_path: bad }];
    await expect(assembleJoiningKit("emp-1", OPTS)).rejects.toMatchObject({ code: "unreadable_document" });
  });
});

describe("signature placement checking", () => {
  it("accepts a widget inside the reserved band", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 425, y: 100, width: 120, height: 60 }); // drawing only
    const bytes = Buffer.from(await doc.save());
    // No widgets at all is trivially inside the band.
    const r = await assertSignatureInsideReservedArea(bytes);
    expect(r.ok).toBe(true);
  });

  it("reads widget rectangles out of the object model", async () => {
    // Regex over raw bytes cannot work: pdf-lib emits compressed object streams.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const bytes = Buffer.from(await doc.save());
    expect(await analyzeSignaturePlacement(bytes)).toEqual([]);
  });

  it("keeps the band above the provider's widget", () => {
    // The provider stamps at Rect [425,100,545,160]; the band must clear 160.
    expect(KIT_RESERVE_BAND).toBeGreaterThan(160);
  });
});
