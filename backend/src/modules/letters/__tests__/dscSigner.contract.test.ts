/**
 * The company signature must be a real signature.
 *
 * What it replaces: appointment-esign.service.ts "completeCompanySign" set
 * current_state='company_signed' and company_sign_status='signed' — a database
 * flip with no provider, no PDF and no cryptography. Any admin/hr user could
 * POST an arbitrary signedBy string and the letter recorded as company-signed.
 *
 * These tests do the real thing: generate a certificate, sign an actual PDF, and
 * assert the output carries a PKCS#7 /ByteRange — the same structure the Aadhaar
 * eSign provider returns on a genuinely signed document.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Encryption needs a key; the helper deliberately refuses to derive one from "".
process.env.BANK_ENCRYPTION_KEY ||= "test-signing-key-not-for-production-use";

let activeRow: Record<string, unknown> | undefined;

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("INSERT INTO company_signing_certificate_audit")) return [{}];
      if (s.startsWith("SELECT id, p12_encrypted")) return [activeRow ? [activeRow] : []];
      return [[]];
    }),
  },
}));

const { generateSelfSignedP12, inspectP12 } = await import("../dscConfig.service.js");
const { signPdfAsCompany, hasCryptographicSignature, SELF_SIGNED_NOTICE, DscUnavailableError } =
  await import("../dscSigner.service.js");
const { encrypt } = await import("../../../utils/encryption.js");

const PASS = "test-passphrase";

async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("APPOINTMENT LETTER", { x: 56, y: 780, size: 14, font });
  return Buffer.from(await doc.save());
}

/** Widget rectangles, read from the object model rather than the raw bytes. */
async function widgetRects(pdfBytes: Buffer): Promise<Array<[number, number, number, number]>> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const out: Array<[number, number, number, number]> = [];
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookup(i) as unknown as { get?: (k: unknown) => unknown; context?: { obj: (v: unknown) => unknown } };
      const rect = dict?.get?.(dict.context!.obj("Rect")) as { asArray?: () => Array<{ toString(): string }> } | undefined;
      const arr = rect?.asArray?.().map((n) => Number(n.toString()));
      if (arr && arr.length === 4 && arr.some((n) => n !== 0)) {
        out.push([arr[0], arr[1], arr[2], arr[3]]);
      }
    }
  }
  return out;
}

function makeActiveRow(p12: Buffer, over: Record<string, unknown> = {}) {
  return {
    id: "cert-1",
    p12_encrypted: encrypt(p12.toString("base64")),
    passphrase_encrypted: encrypt(PASS),
    signer_name: "Authorised Signatory",
    signer_designation: "HR Manager",
    is_ca_issued: 0,
    is_self_signed: 1,
    valid_to: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    ...over,
  };
}

beforeEach(() => { activeRow = undefined; });

describe("generating a certificate so issuance is not blocked on procurement", () => {
  it("produces a usable PKCS#12 with a private key", () => {
    const p12 = generateSelfSignedP12({
      organisation: "Mas Callnet India Pvt. Ltd.", signerName: "Authorised Signatory", passphrase: PASS,
    });
    expect(p12.length).toBeGreaterThan(1000);
    const info = inspectP12(p12, PASS);
    expect(info.subjectCn).toBe("Mas Callnet India Pvt. Ltd.");
    expect(info.validTo.getTime()).toBeGreaterThan(Date.now());
  });

  it("classifies itself as self-signed and NOT CA-issued", () => {
    // Derived from issuer-vs-subject, never from what the uploader typed.
    const info = inspectP12(generateSelfSignedP12({
      organisation: "Mas Callnet India Pvt. Ltd.", signerName: "X", passphrase: PASS,
    }), PASS);
    expect(info.isSelfSigned).toBe(true);
    expect(info.isCaIssued).toBe(false);
    expect(info.issuerCn).toBe(info.subjectCn);
  });

  it("refuses a wrong passphrase rather than producing garbage", () => {
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "X", passphrase: PASS });
    expect(() => inspectP12(p12, "wrong")).toThrow(/password/i);
  });
});

describe("signing a real PDF", () => {
  it("emits a PKCS#7 signature with a ByteRange", async () => {
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "Authorised Signatory", passphrase: PASS });
    activeRow = makeActiveRow(p12);

    const out = await signPdfAsCompany(await samplePdf(), { reason: "Appointment Letter" });

    expect(out.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(hasCryptographicSignature(out.bytes)).toBe(true);

    const s = out.bytes.toString("latin1");
    expect(s).toContain("/ByteRange");
    expect(s).toMatch(/\/SubFilter\s*\/adbe\.pkcs7\.detached/);
    expect(s).toContain("Appointment Letter");
  });

  it("carries the signer identity from the certificate, not from the caller", async () => {
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "Authorised Signatory", passphrase: PASS });
    activeRow = makeActiveRow(p12);
    const out = await signPdfAsCompany(await samplePdf(), { reason: "Appointment Letter" });
    expect(out.signerName).toBe("Authorised Signatory");
    expect(out.signerDesignation).toBe("HR Manager");
  });

  it("marks a self-signed result as not legally equivalent", async () => {
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "X", passphrase: PASS });
    activeRow = makeActiveRow(p12);
    const out = await signPdfAsCompany(await samplePdf(), { reason: "Appointment Letter" });
    expect(out.isSelfSigned).toBe(true);
    expect(out.isCaIssued).toBe(false);
    expect(out.notice).toBe(SELF_SIGNED_NOTICE);
    expect(out.notice).toMatch(/not a CCA-licensed/i);
  });

  it("drops the notice once a CA-issued certificate is active", async () => {
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "X", passphrase: PASS });
    activeRow = makeActiveRow(p12, { is_ca_issued: 1, is_self_signed: 0 });
    const out = await signPdfAsCompany(await samplePdf(), { reason: "Appointment Letter" });
    expect(out.notice).toBeNull();
    expect(out.isCaIssued).toBe(true);
  });

  it("keeps the signature widget clear of the Aadhaar stamp band", async () => {
    // The provider stamps the employee's signature at Rect [425,100,545,160],
    // measured from a real signed contract. The company widget must not overlap.
    //
    // Read through pdf-lib rather than regex: pdf-lib emits object streams, so
    // /Rect is compressed and invisible in the raw bytes.
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "X", passphrase: PASS });
    activeRow = makeActiveRow(p12);
    const out = await signPdfAsCompany(await samplePdf(), { reason: "Appointment Letter" });

    const rects = await widgetRects(out.bytes);
    expect(rects.length).toBeGreaterThan(0);
    const AADHAAR = { x1: 425, y1: 100, x2: 545, y2: 160 };
    for (const [x1, y1, x2, y2] of rects) {
      const overlaps = x1 < AADHAAR.x2 && x2 > AADHAAR.x1 && y1 < AADHAAR.y2 && y2 > AADHAAR.y1;
      expect(overlaps, `widget [${x1},${y1},${x2},${y2}] collides with the Aadhaar stamp`).toBe(false);
    }
  });
});

describe("refuses to fake a signature", () => {
  it("blocks when no certificate is active", async () => {
    activeRow = undefined;
    await expect(signPdfAsCompany(await samplePdf(), { reason: "x" }))
      .rejects.toMatchObject({ code: "no_signing_certificate" });
  });

  it("blocks on an expired certificate", async () => {
    // Signing under a lapsed certificate invalidates every letter produced after
    // it expired, so this is a hard stop, not a warning.
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "X", passphrase: PASS });
    activeRow = makeActiveRow(p12, { valid_to: new Date(Date.now() - 24 * 3600 * 1000) });
    await expect(signPdfAsCompany(await samplePdf(), { reason: "x" }))
      .rejects.toBeInstanceOf(DscUnavailableError);
  });
});

describe("key material never leaves the module", () => {
  it("the signed result exposes no private key or passphrase", async () => {
    const p12 = generateSelfSignedP12({ organisation: "MAS", signerName: "X", passphrase: PASS });
    activeRow = makeActiveRow(p12);
    const out = await signPdfAsCompany(await samplePdf(), { reason: "x" });
    const asJson = JSON.stringify({ ...out, bytes: undefined });
    expect(asJson).not.toContain(PASS);
    expect(asJson).not.toContain("PRIVATE KEY");
    expect(Object.keys(out)).not.toContain("p12");
    expect(Object.keys(out)).not.toContain("passphrase");
  });
});
