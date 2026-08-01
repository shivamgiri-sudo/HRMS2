/**
 * Applies the company's digital signature to a PDF.
 *
 * Replaces the previous "company sign" step, which was not a signature at all:
 * appointment-esign.service.ts flipped a database column, with no provider, no
 * PDF and no cryptography, and any admin/hr user could POST an arbitrary
 * signedBy string.
 *
 * Produces a real PKCS#7 detached signature with a /ByteRange, the same shape
 * the Aadhaar eSign provider returns — so a signed letter verifies in any PDF
 * reader rather than merely asserting that it was signed.
 *
 * Signing is refused rather than degraded: no active certificate, or an expired
 * one, stops issuance. A letter that claims a signature it does not carry is
 * worse than no letter.
 */
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { PDFDocument } from "pdf-lib";
import { getActiveCertificate, type ActiveCertificate } from "./dscConfig.service.js";

/** Text stamped on any letter signed with a self-signed certificate. */
export const SELF_SIGNED_NOTICE =
  "Internal draft — not a CCA-licensed digital signature";

export type SignedPdfResult = {
  bytes: Buffer;
  signerName: string;
  signerDesignation: string;
  isCaIssued: boolean;
  isSelfSigned: boolean;
  /** Present only when the signature is not CA-issued. */
  notice: string | null;
  certificateId: string;
};

export class DscUnavailableError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.statusCode = 409;
  }
}

/** The active certificate, with the reasons it might not be usable surfaced. */
export async function requireSigningCertificate(): Promise<ActiveCertificate> {
  const cert = await getActiveCertificate();
  if (!cert) {
    throw new DscUnavailableError(
      "no_signing_certificate",
      "No company signing certificate is active. A Super Admin must upload a DSC, or generate a self-signed certificate for testing, before letters can be issued.",
    );
  }
  if (cert.validTo && cert.validTo.getTime() < Date.now()) {
    // Signing under an expired certificate invalidates every letter produced
    // after it lapsed, so this is a hard stop rather than a warning.
    throw new DscUnavailableError(
      "signing_certificate_expired",
      `The active signing certificate expired on ${cert.validTo.toISOString().slice(0, 10)}. Activate a current certificate before issuing letters.`,
    );
  }
  return cert;
}

/**
 * Sign `pdfBytes` on behalf of the company.
 *
 * `reason`, `location` and `contactInfo` land in the signature dictionary, which
 * is what a PDF reader shows when the signature is inspected.
 */
export async function signPdfAsCompany(pdfBytes: Buffer, opts: {
  reason: string;
  location?: string;
  contactInfo?: string;
  /** Where the visible widget sits. Defaults to the reserved band at the page foot. */
  rect?: [number, number, number, number];
}): Promise<SignedPdfResult> {
  const cert = await requireSigningCertificate();

  // The placeholder reserves the byte range the signature is written into. Its
  // widget must sit inside the reserved band so it cannot collide with the
  // employee's later Aadhaar stamp at Rect [425,100,545,160] — measured from a
  // real signed contract, not assumed.
  const doc = await PDFDocument.load(pdfBytes);
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: opts.reason,
    location: opts.location ?? "India",
    contactInfo: opts.contactInfo ?? "",
    name: cert.signerName,
    signatureLength: 8192,
    widgetRect: opts.rect ?? [56, 40, 300, 96],
  });
  const withPlaceholder = Buffer.from(await doc.save());

  const signer = new P12Signer(cert.p12, { passphrase: cert.passphrase });
  const signed = await new SignPdf().sign(withPlaceholder, signer);

  return {
    bytes: Buffer.from(signed),
    signerName: cert.signerName,
    signerDesignation: cert.signerDesignation,
    isCaIssued: cert.isCaIssued,
    isSelfSigned: cert.isSelfSigned,
    notice: cert.isCaIssued ? null : SELF_SIGNED_NOTICE,
    certificateId: cert.id,
  };
}

/** True when a PDF carries a cryptographic signature. Used by the tests and the verifier. */
export function hasCryptographicSignature(pdfBytes: Buffer): boolean {
  const s = pdfBytes.toString("latin1");
  return s.includes("/ByteRange") && /\/Type\s*\/Sig/.test(s);
}
