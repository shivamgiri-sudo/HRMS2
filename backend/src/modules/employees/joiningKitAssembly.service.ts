/**
 * Merges an employee's joining documents into one PDF for a single eSign.
 *
 * Why merge at all: the provider takes exactly one file per call.
 * /eSignWithURL accepts one multipart `file` and answers with a singular
 * esignDetails carrying one file_name — there is no docs[] anywhere in the
 * contract. So six documents means six billed calls unless they become one
 * document. Across ~1,152 employees that is the difference between roughly
 * 1,152 and 6,900 calls.
 *
 * What is genuinely lost: one Aadhaar eSign is one PKCS#7 signature over one
 * byte range. The merged kit is a single legal instrument, not six separately
 * verifiable ones. The consolidated signature page compensates by naming and
 * hashing every document it covers, so what was signed is provable from the
 * artefact itself rather than from our database.
 */
import { createHash } from "crypto";
import fs from "fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { istDisplayDate } from "../letters/letterFormat.js";

/** Must clear the provider's widget at Rect [425,100,545,160]. Measured, not assumed. */
export const KIT_RESERVE_BAND = 180;

/** Deterministic order, so a kit's page map is reproducible. */
const ORDER_FIRST = "EMPLOYMENT_CONTRACT";

/**
 * What belongs in a kit: the six documents rendered from TEMPLATE_DEFINITIONS.
 *
 * The EPF forms are deliberately excluded. They are acroform documents with
 * their own consent receipt, correction loop, payroll review stage and
 * company-seal step, and EPF Form 2 alone carries 53 fields of statutory
 * nominee data — EPS nominee, family members, dates of birth, addresses.
 * Including them meant no kit could send until EPF was complete, which defeats
 * the purpose of consolidating at all. They keep their existing per-document
 * flow, which is built around those extra stages.
 */
export const KIT_DOCUMENT_CODES = [
  "EMPLOYMENT_CONTRACT",
  "NDA_CONFIDENTIALITY",
  "IT_COMPLIANCE",
  "BAMS_DECLARATION",
  "PI_PROCESSING_CONSENT",
  "ZERO_TOLERANCE_ACK",
] as const;

export type KitItem = {
  checklistId: string;
  documentCode: string;
  documentName: string;
  sourceFileId: string | null;
  sourceSha256: string;
  pageFrom: number;
  pageTo: number;
};

export type AssembledKit = {
  buffer: Buffer;
  sha256: string;
  items: KitItem[];
  totalPages: number;
};

export class KitAssemblyError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.statusCode = 409;
  }
}

/** The eSign documents that belong in a kit, in a stable order. */
export async function kitEligibleDocuments(employeeId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.document_code, c.document_name, c.status,
            f.id AS file_id, f.storage_path
       FROM employee_joining_document_checklist c
       LEFT JOIN employee_joining_document_file f
         ON f.id = (
           SELECT f2.id FROM employee_joining_document_file f2
            WHERE f2.checklist_id = c.id AND f2.deleted_at IS NULL
              AND f2.file_role IN ('generated','hr_uploaded')
            ORDER BY f2.uploaded_at DESC LIMIT 1
         )
      WHERE c.employee_id = ? AND c.action_type = 'esign'
        AND c.document_code IN (${KIT_DOCUMENT_CODES.map(() => "?").join(",")})
      ORDER BY (c.document_code = ?) DESC, c.document_code`,
    [employeeId, ...KIT_DOCUMENT_CODES, ORDER_FIRST],
  );
  return rows as RowDataPacket[];
}

/**
 * Build the merged kit.
 *
 * Flattens any AcroForm before merging: copyPages does not carry field
 * hierarchies cleanly, and stray empty fields named *_signature are exactly
 * what a field-binding provider latches onto — the EPF forms are handed over
 * with flatten:false today, leaving several such fields for it to choose
 * wrongly between.
 */
export async function assembleJoiningKit(employeeId: string, opts: {
  employeeName: string;
  employeeCode: string;
  designation?: string | null;
  branchName?: string | null;
  dateOfJoining?: Date | string | null;
}): Promise<AssembledKit> {
  const docs = await kitEligibleDocuments(employeeId);
  if (docs.length === 0) {
    throw new KitAssemblyError("no_documents", "This employee has no eSign joining documents to assemble.");
  }

  const missing = docs.filter((d) => !d.storage_path || !fs.existsSync(String(d.storage_path)));
  if (missing.length) {
    // Never merge a partial kit: the signature page would name documents the
    // employee never saw.
    throw new KitAssemblyError(
      "draft_missing",
      `Cannot assemble the kit — ${missing.length} document(s) have no generated file on disk: ` +
        missing.map((d) => d.document_name ?? d.document_code).join(", "),
    );
  }

  const kit = await PDFDocument.create();
  const items: KitItem[] = [];

  for (const d of docs) {
    const bytes = await fs.promises.readFile(String(d.storage_path));
    const sha = createHash("sha256").update(bytes).digest("hex");

    let src: PDFDocument;
    try {
      src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch {
      throw new KitAssemblyError(
        "unreadable_document",
        `"${d.document_name ?? d.document_code}" is not a readable PDF, so it cannot be added to the kit.`,
      );
    }

    // Flatten before copying — see the note above.
    try {
      const form = src.getForm();
      if (form.getFields().length > 0) form.flatten();
    } catch { /* no form, or already flat */ }

    const pageFrom = kit.getPageCount() + 1;
    const copied = await kit.copyPages(src, src.getPageIndices());
    copied.forEach((p) => kit.addPage(p));
    const pageTo = kit.getPageCount();

    items.push({
      checklistId: String(d.id),
      documentCode: String(d.document_code),
      documentName: String(d.document_name ?? d.document_code),
      sourceFileId: d.file_id ? String(d.file_id) : null,
      sourceSha256: sha,
      pageFrom,
      pageTo,
    });
  }

  await appendConsentPage(kit, items, opts);

  const buffer = Buffer.from(await kit.save());
  return {
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    items,
    totalPages: kit.getPageCount(),
  };
}

/**
 * The page that makes one signature bind several documents.
 *
 * Lists every document with its page range and content hash, so the scope of
 * the signature is provable from the PDF itself. The lower portion is left
 * empty for the provider's stamp.
 */
async function appendConsentPage(kit: PDFDocument, items: KitItem[], opts: {
  employeeName: string; employeeCode: string;
  designation?: string | null; branchName?: string | null;
  dateOfJoining?: Date | string | null;
}) {
  const page = kit.addPage([595, 842]);
  const font = await kit.embedFont(StandardFonts.Helvetica);
  const bold = await kit.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);
  const left = 56;
  let y = 780;

  page.drawText("CONSOLIDATED CONSENT & SIGNATURE", { x: left, y, size: 14, font: bold, color: ink });
  y -= 10;
  page.drawLine({ start: { x: left, y }, end: { x: 539, y }, thickness: 1.2, color: rgb(0.05, 0.65, 0.91) });
  y -= 26;

  for (const [label, value] of [
    ["Name", opts.employeeName],
    ["Employee code", opts.employeeCode],
    ["Designation", opts.designation ?? "—"],
    ["Branch", opts.branchName ?? "—"],
    ["Date of joining", opts.dateOfJoining ? istDisplayDate(opts.dateOfJoining) : "—"],
  ] as Array<[string, string]>) {
    page.drawText(`${label}:`, { x: left, y, size: 9, font, color: muted });
    page.drawText(value, { x: left + 110, y, size: 9, font: bold, color: ink });
    y -= 14;
  }

  y -= 12;
  page.drawText("This signature applies to each of the following documents:", {
    x: left, y, size: 9.5, font: bold, color: ink,
  });
  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: 539, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  y -= 14;

  page.drawText("Document", { x: left, y, size: 7.5, font: bold, color: muted });
  page.drawText("Pages", { x: 360, y, size: 7.5, font: bold, color: muted });
  page.drawText("Content hash (SHA-256)", { x: 410, y, size: 7.5, font: bold, color: muted });
  y -= 12;

  for (const it of items) {
    page.drawText(it.documentName.slice(0, 52), { x: left, y, size: 8, font, color: ink });
    page.drawText(`${it.pageFrom}–${it.pageTo}`, { x: 360, y, size: 8, font, color: ink });
    page.drawText(it.sourceSha256.slice(0, 24) + "…", { x: 410, y, size: 7, font, color: muted });
    y -= 12;
  }

  y -= 14;
  const consent =
    "By affixing my Aadhaar-based electronic signature to this page I confirm that I have read, " +
    "understood and agree to be bound by each of the documents listed above, which together form " +
    "a single instrument. The content hashes above identify the exact documents to which this " +
    "signature applies.";
  page.drawText(consent, { x: left, y, size: 8.5, font, color: ink, lineHeight: 12, maxWidth: 483 });
  y -= 62;

  // Everything below is left clear for the provider's stamp. No footer and no
  // page number on this page: the widget lands at Rect [425,100,545,160].
  page.drawRectangle({
    x: 410, y: 88, width: 145, height: 88,
    borderColor: rgb(0.8, 0.83, 0.86), borderWidth: 1,
  });
  page.drawText("Digital signature area", { x: 418, y: 168, size: 6.5, font, color: muted });
  page.drawText(`${items.length} document(s) covered by one Aadhaar eSign`, {
    x: left, y: 96, size: 7, font, color: muted,
  });
}

/**
 * Where the signature ended up. Run against the artefact returned by the
 * provider, so a change in their placement surfaces as an alert rather than a
 * silently wrong document.
 */
export async function analyzeSignaturePlacement(pdfBytes: Buffer): Promise<Array<{
  pageIndex: number; rect: [number, number, number, number]; fieldName: string | null;
}>> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const out: Array<{ pageIndex: number; rect: [number, number, number, number]; fieldName: string | null }> = [];
  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      try {
        const d = annots.lookup(i) as unknown as {
          get?: (k: unknown) => unknown; context?: { obj: (v: unknown) => unknown };
        };
        const rect = d?.get?.(d.context!.obj("Rect")) as { asArray?: () => Array<{ toString(): string }> } | undefined;
        const arr = rect?.asArray?.().map((n) => Number(n.toString()));
        if (!arr || arr.length !== 4 || arr.every((n) => n === 0)) continue;
        const t = d?.get?.(d.context!.obj("T"));
        out.push({
          pageIndex,
          rect: [arr[0], arr[1], arr[2], arr[3]],
          fieldName: t ? String(t).replace(/^\(|\)$/g, "") : null,
        });
      } catch { /* not an annotation we can read */ }
    }
  });
  return out;
}

/** True when every signature widget sits inside the reserved band. */
export async function assertSignatureInsideReservedArea(
  pdfBytes: Buffer,
  band = KIT_RESERVE_BAND,
): Promise<{ ok: boolean; violations: Array<{ pageIndex: number; rect: number[] }> }> {
  const widgets = await analyzeSignaturePlacement(pdfBytes);
  const violations = widgets
    .filter((w) => w.rect[3] > band)
    .map((w) => ({ pageIndex: w.pageIndex, rect: w.rect }));
  return { ok: violations.length === 0, violations };
}
