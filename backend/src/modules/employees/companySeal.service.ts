/**
 * Applies the company's authorised signature and rubber stamp to generated
 * documents.
 *
 * Both statutory EPF forms carry an employer block that the form itself says
 * must bear a seal — Form 11 prints "SIGNATURE OF EMPLOYER WITH SEAL OF
 * ESTABLISHMENT" and Form 2 prints "Signature of the employer with designation
 * and rubber stamp". Until now those were blank text fields, so HR printed
 * every document, signed and stamped it by hand, scanned it and uploaded it.
 *
 * Placement is derived from the AcroForm field's own widget rectangle rather
 * than from hardcoded coordinates. If a form is ever re-laid-out, the signature
 * moves with its field instead of silently landing in the wrong place.
 *
 * After stamping, the signature field is removed from the form so the mark
 * cannot be edited or dragged in a PDF reader.
 */
import fs from "fs";
import path from "path";
import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const COMPANY_SEAL_SETTING_KEYS = {
  signature: "company_authorised_signature_file",
  stamp: "company_rubber_stamp_file",
  signatoryName: "company_authorised_signatory_name",
  signatoryDesignation: "company_authorised_signatory_designation",
} as const;

/** Where /api/files/upload writes, mirrored from files.routes.ts. */
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
export const COMPANY_ASSET_CATEGORY = "company-assets";

export type CompanySeal = {
  signature: Buffer | null;
  stamp: Buffer | null;
  signatoryName: string | null;
  signatoryDesignation: string | null;
};

/** Documents whose employer block should be sealed, and the field to seal. */
const SEALED_DOCUMENTS: Record<string, { signatureField: string }> = {
  EPF_DECLARATION: { signatureField: "employer_signature" },
  EPF_NOMINATION_FORM2: { signatureField: "employer_signature" },
};

export function documentAcceptsCompanySeal(documentCode: string) {
  return Boolean(SEALED_DOCUMENTS[String(documentCode || "").trim().toUpperCase()]);
}

function readAsset(fileName: string | null): Buffer | null {
  if (!fileName) return null;
  // Only ever a bare filename from our own upload category — never a path from
  // the request, so a traversal cannot escape the uploads directory.
  const safe = path.basename(fileName);
  const full = path.join(UPLOADS_ROOT, COMPANY_ASSET_CATEGORY, safe);
  if (!full.startsWith(path.join(UPLOADS_ROOT, COMPANY_ASSET_CATEGORY))) return null;
  return fs.existsSync(full) ? fs.readFileSync(full) : null;
}

export async function loadCompanySeal(): Promise<CompanySeal> {
  const keys = Object.values(COMPANY_SEAL_SETTING_KEYS);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN (?)`,
    [keys],
  );
  const byKey = new Map((rows as RowDataPacket[]).map((r) => [String(r.setting_key), r.setting_value ? String(r.setting_value).trim() : null]));
  return {
    signature: readAsset(byKey.get(COMPANY_SEAL_SETTING_KEYS.signature) ?? null),
    stamp: readAsset(byKey.get(COMPANY_SEAL_SETTING_KEYS.stamp) ?? null),
    signatoryName: byKey.get(COMPANY_SEAL_SETTING_KEYS.signatoryName) ?? null,
    signatoryDesignation: byKey.get(COMPANY_SEAL_SETTING_KEYS.signatoryDesignation) ?? null,
  };
}

/** PNG and JPEG only — pdf-lib embeds nothing else. */
async function embed(doc: PDFDocument, bytes: Buffer): Promise<PDFImage | null> {
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  try {
    if (isPng) return await doc.embedPng(bytes);
    if (isJpg) return await doc.embedJpg(bytes);
  } catch {
    return null;
  }
  return null;
}

/** Scales to fit inside a box without distorting the image. */
function fit(image: PDFImage, maxW: number, maxH: number) {
  const ratio = Math.min(maxW / image.width, maxH / image.height);
  return { width: image.width * ratio, height: image.height * ratio };
}

/**
 * Draws the signature (and stamp, if uploaded) into the employer block of a
 * generated PDF. Returns the input unchanged when the document has no employer
 * block or nothing has been uploaded yet — never throws, because a missing
 * signature must not stop a joiner's paperwork from being produced.
 */
export async function applyCompanySeal(
  pdfBytes: Uint8Array,
  documentCode: string,
  seal?: CompanySeal,
): Promise<Uint8Array> {
  const target = SEALED_DOCUMENTS[String(documentCode || "").trim().toUpperCase()];
  if (!target) return pdfBytes;

  const resolved = seal ?? (await loadCompanySeal());
  if (!resolved.signature && !resolved.stamp) return pdfBytes;

  try {
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();

    const field = form.getFields().find((f) => f.getName() === target.signatureField);
    if (!field) return pdfBytes;

    const widget = field.acroField.getWidgets()[0];
    if (!widget) return pdfBytes;
    const rect = widget.getRectangle();

    // Locate the page carrying this widget by matching the annotation it
    // resolves to, rather than trusting an optional /P back-reference.
    const page: PDFPage | undefined = doc.getPages().find((p) => {
      const annots = p.node.Annots();
      if (!annots) return false;
      for (let i = 0; i < annots.size(); i++) {
        if (doc.context.lookup(annots.get(i)) === widget.dict) return true;
      }
      return false;
    });
    if (!page) return pdfBytes;

    const signature = resolved.signature ? await embed(doc, resolved.signature) : null;
    const stamp = resolved.stamp ? await embed(doc, resolved.stamp) : null;
    if (!signature && !stamp) return pdfBytes;

    // The stamp sits behind and slightly above the signature, the way a rubber
    // stamp is struck on paper and then signed across.
    if (stamp) {
      const size = fit(stamp, Math.min(rect.width, 96), 64);
      page.drawImage(stamp, {
        x: rect.x + rect.width - size.width,
        y: rect.y - 6,
        width: size.width,
        height: size.height,
        opacity: 0.9,
      });
    }
    if (signature) {
      const size = fit(signature, Math.min(rect.width * 0.72, 150), 40);
      page.drawImage(signature, {
        x: rect.x + 4,
        y: rect.y + 2,
        width: size.width,
        height: size.height,
      });
    }

    // Remove the field so the mark cannot be edited in a reader.
    try { form.removeField(field); } catch { /* older readers: leave as-is */ }

    return await doc.save();
  } catch {
    // Sealing is a finishing touch. A failure here must never block a joiner's
    // document from being generated.
    return pdfBytes;
  }
}
