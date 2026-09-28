/**
 * Extracts the real, cryptographically-signed identity from an Aadhaar eSign'd PDF.
 *
 * Owner-directed fraud check (2026-09-18): a joining kit can be sent to one employee
 * and completed with a DIFFERENT person's Aadhaar — confirmed live, as a deliberate
 * test, on MAS63544's kit. Neither Luckpay's status-check API nor the document's own
 * visible page text carries independently-verified signer identity: the API only
 * returns lifecycle status fields, and the page text is whatever WE pre-filled before
 * sending it for signature (see gs1/joining-doc session notes) — so a substituted
 * signer's name never shows up in either place.
 *
 * The one place real, unforgeable identity data exists is the PDF's own embedded
 * PKCS#7 signature (`/SubFilter /adbe.pkcs7.detached`, the standard Aadhaar eSign
 * format): a short-lived X.509 certificate issued by a licensed Certifying Authority
 * (e.g. e-Mudhra's "Sub CA for eKYC"), whose Subject Common Name carries the
 * UIDAI-verified signer's name at the moment of signing. Verified live: MAS63544's
 * kit was addressed to "RISHABH PANDEY" but the embedded certificate's CN read
 * "Shivam Shiv Giri" — the actual signer, provably, since the CA would not have
 * issued that certificate to anyone else.
 *
 * This only reads what a compliant PDF signer already embedded; it verifies nothing
 * cryptographically itself (no chain validation, no revocation check) — it is an
 * identity SIGNAL for a human fraud reviewer, not a legal proof of forgery.
 */
import forge from "node-forge";
import { X509Certificate } from "crypto";

export type EsignCertificateIdentity = {
  /** The signer's name as the Certifying Authority verified it (Subject CN). Null if absent/unparseable. */
  commonName: string | null;
  /** The issuing CA's own CN, for audit ("who vouched for this"). */
  issuerCommonName: string | null;
  validFrom: Date | null;
  validTo: Date | null;
};

/** True once `strict:false` still stops after the real BER content and reports the rest as unparsed trailing bytes. */
function isUnparsedTrailingBytesError(e: unknown): e is { remaining: number; byteCount: number } {
  return typeof e === "object" && e !== null && "remaining" in e && "byteCount" in e;
}

function parseBerLeadingObject(buf: Buffer): forge.asn1.Asn1 {
  // node-forge's fromDer accepts either a boolean strict flag or an options object
  // depending on the installed version; cast to any to stay compatible with both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts = { strict: false } as any;
  try {
    return forge.asn1.fromDer(forge.util.createBuffer(buf.toString("binary")), opts);
  } catch (e: unknown) {
    // PDF /Contents is a fixed-size hex placeholder; the real BER-encoded PKCS#7 blob
    // is usually shorter than the reserved space and the rest is zero-padding. forge's
    // top-level parser insists the WHOLE buffer be consumed, so re-parse just the
    // portion it actually used.
    if (isUnparsedTrailingBytesError(e)) {
      const consumed = e.byteCount - e.remaining;
      return forge.asn1.fromDer(forge.util.createBuffer(buf.slice(0, consumed).toString("binary")), opts);
    }
    throw e;
  }
}

/** Every `/Contents <hex...>` byte range found in a PDF signature dictionary (there can be more than one signature). */
function findSignatureContentsHexRanges(pdfBytes: Buffer): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const marker = Buffer.from("/Contents");
  let searchFrom = 0;
  for (;;) {
    const markerIdx = pdfBytes.indexOf(marker, searchFrom);
    if (markerIdx === -1) break;
    searchFrom = markerIdx + marker.length;
    const openIdx = pdfBytes.indexOf(0x3c /* '<' */, markerIdx);
    if (openIdx === -1 || openIdx > markerIdx + 20) continue; // not immediately followed by a hex string
    const closeIdx = pdfBytes.indexOf(0x3e /* '>' */, openIdx);
    if (closeIdx === -1) continue;
    ranges.push({ start: openIdx + 1, end: closeIdx });
  }
  return ranges;
}

type ParsedSignature = {
  identity: EsignCertificateIdentity;
  /** Certificate issuer == subject: a self-signed certificate (the company's own DSC, never an Aadhaar CA one). */
  selfSigned: boolean;
  /** Byte offset in the file where the signature dictionary's `<` sits. */
  order: number;
  /** End of the last byte range this signature covers (= file length when it was applied); -1 if not found. */
  coversUpTo: number;
};

/** Reads the leaf certificate out of one `/Contents` hex string; null when it is not a parseable PKCS#7 signature. */
function parseSignatureRange(pdfBytes: Buffer, range: { start: number; end: number }): ParsedSignature | null {
  try {
    const hex = pdfBytes.slice(range.start, range.end).toString("latin1").replace(/[^0-9A-Fa-f]/g, "");
    if (hex.length < 100) return null; // too short to be a real signature blob
    const der = Buffer.from(hex, "hex");
    const contentInfo = parseBerLeadingObject(der);
    // ContentInfo ::= SEQUENCE { contentType, content [0] EXPLICIT SignedData }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedData = (contentInfo as any).value?.[1]?.value?.[0];
    if (!signedData || !Array.isArray(signedData.value)) return null;
    // SignedData's `certificates [0] IMPLICIT CertificateSet` is the only child tagged
    // context-class (tagClass 128); position varies slightly by encoder.
    const certsField = signedData.value.find(
      (v: forge.asn1.Asn1) => v.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && v.type === 0,
    );
    const certAsn1 = certsField?.value?.[0]; // first cert = the leaf/signer, by PKCS#7 convention
    if (!certAsn1) return null;
    const certDer = Buffer.from(forge.asn1.toDer(certAsn1).getBytes(), "binary");
    const x509 = new X509Certificate(certDer);
    return {
      identity: {
        commonName: extractSubjectField(x509.subject, "CN"),
        issuerCommonName: extractSubjectField(x509.issuer, "CN"),
        validFrom: x509.validFrom ? new Date(x509.validFrom) : null,
        validTo: x509.validTo ? new Date(x509.validTo) : null,
      },
      selfSigned: x509.subject === x509.issuer,
      order: range.start,
      coversUpTo: -1,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the leaf (signer's own) certificate out of the first PDF digital signature
 * found. Returns null if the PDF has no embedded PKCS#7 signature at all, or if the
 * structure can't be parsed (a malformed/unexpected signature format is reported as
 * "no identity available", never as a false match).
 *
 * Use this for a document that carried NO signature before the signer signed it (the
 * joining kit). For a document that was already signed by someone else first, use
 * extractLatestEsignCertificateIdentity instead.
 */
export function extractEsignCertificateIdentity(pdfBytes: Buffer): EsignCertificateIdentity | null {
  for (const range of findSignatureContentsHexRanges(pdfBytes)) {
    const parsed = parseSignatureRange(pdfBytes, range);
    if (parsed) return parsed.identity;
  }
  return null;
}

/** For every signed `/ByteRange [0 b c d]`: offset of the `<` opening its /Contents (b) -> the file offset it covers up to (c + d). */
function byteRangeEndsByContentsOpen(pdfBytes: Buffer): Map<number, number> {
  const ends = new Map<number, number>();
  const marker = Buffer.from("/ByteRange");
  let from = 0;
  for (;;) {
    const idx = pdfBytes.indexOf(marker, from);
    if (idx === -1) break;
    from = idx + marker.length;
    const m = /^\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
      pdfBytes.slice(from, from + 120).toString("latin1"),
    );
    if (!m) continue; // an unsigned placeholder (`/ByteRange [0 ********** ...]`) or malformed
    // Range 1 is [0, m[2]) and stops right before the `<` of /Contents; range 2 is [m[3], m[3]+m[4]).
    ends.set(Number(m[2]), Number(m[3]) + Number(m[4]));
  }
  return ends;
}

/**
 * The identity of the signature that was applied LAST, ignoring the signer's own
 * organisation.
 *
 * For a document that already carries another party's signature before the signer
 * signs — e.g. an appointment letter the company signed first — the first
 * signature is not the signer's. The last one is: each later signature is an
 * incremental update whose /ByteRange reaches further into the file, so the
 * signature covering the most bytes (file order breaks ties) is the newest.
 *
 * Signatures are skipped, never returned, when their certificate is self-signed
 * (issuer == subject; an Aadhaar eSign certificate is always CA-issued) or its CN
 * is in `excludeCommonNames` (case-insensitive). So a file holding only the
 * company's signature yields null — "unverifiable" — instead of the company being
 * mistaken for the employee. Malformed input yields null and never throws.
 */
export function extractLatestEsignCertificateIdentity(
  pdfBytes: Buffer,
  opts: { excludeCommonNames?: readonly string[] } = {},
): EsignCertificateIdentity | null {
  try {
    const excluded = new Set((opts.excludeCommonNames ?? []).map((n) => n.trim().toLowerCase()));
    const ends = byteRangeEndsByContentsOpen(pdfBytes);
    let best: ParsedSignature | null = null;
    for (const range of findSignatureContentsHexRanges(pdfBytes)) {
      const parsed = parseSignatureRange(pdfBytes, range);
      if (!parsed || parsed.selfSigned) continue;
      const cn = parsed.identity.commonName?.trim().toLowerCase();
      if (cn && excluded.has(cn)) continue;
      // range.start is the offset just after '<'.
      const scoped = { ...parsed, coversUpTo: ends.get(range.start - 1) ?? -1 };
      if (!best || scoped.coversUpTo > best.coversUpTo
        || (scoped.coversUpTo === best.coversUpTo && scoped.order > best.order)) {
        best = scoped;
      }
    }
    return best?.identity ?? null;
  } catch {
    return null;
  }
}

/** Node's X509Certificate.subject/.issuer come back as "K=V\nK=V\n...", not parsed fields. */
function extractSubjectField(subjectString: string, field: string): string | null {
  for (const line of subjectString.split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === field) return line.slice(idx + 1).trim();
  }
  return null;
}
