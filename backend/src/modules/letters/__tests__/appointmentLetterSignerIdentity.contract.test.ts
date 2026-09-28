/**
 * The signer-identity fraud signal for an appointment letter.
 *
 * The letter is company-signed (self-signed "Mas Callnet India Pvt. Ltd." certificate)
 * BEFORE the employee's Aadhaar eSign is appended, so the returned PDF carries two
 * signatures. Reading the first one made every letter look like a stranger signed it
 * (matchTier 'none', is_suspicious=1). These tests build that exact two-signature shape
 * — a real company signature from our own signer, then the employee's appended — and
 * pin what recordSignerIdentity writes. No database, provider or network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

process.env.BANK_ENCRYPTION_KEY ||= "test-signing-key-not-for-production-use";

type Call = { sql: string; params: unknown[] };
const inserts: Call[] = [];
const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
let activeRow: Record<string, unknown> | undefined;

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql).replace(/\s+/g, " ");
      if (s.includes("INSERT INTO esign_signer_identity_check")) { inserts.push({ sql: s, params }); return [{ affectedRows: 1 }]; }
      if (s.includes("INSERT INTO company_signing_certificate_audit")) return [{}];
      if (s.startsWith("SELECT id, p12_encrypted")) return [activeRow ? [activeRow] : []];
      return [[]];
    }),
    getConnection: vi.fn(),
  },
}));
vi.mock("../../../config/env.js", () => ({ env: {} }));
vi.mock("../appointmentLetterAudit.js", () => ({
  auditAppointmentLetter: vi.fn(async (_i: string | null, action: string, _a: string | null, detail: Record<string, unknown>) => {
    audits.push({ action, detail });
  }),
}));

const { recordSignerIdentity } = await import("../appointmentLetterEsign.service.js");
const { generateSelfSignedP12 } = await import("../dscConfig.service.js");
const { signPdfAsCompany } = await import("../dscSigner.service.js");
const { encrypt } = await import("../../../utils/encryption.js");
const { appendSignature } = await import("../../../shared/__tests__/esignFixtures.js");

const PASS = "test-passphrase";
const CA = "e-Mudhra Sub CA for eKYC";

async function companySignedLetter(): Promise<Buffer> {
  const p12 = generateSelfSignedP12({ organisation: "Mas Callnet India Pvt. Ltd.", signerName: "Authorised Signatory", passphrase: PASS });
  activeRow = {
    id: "cert-1", p12_encrypted: encrypt(p12.toString("base64")), passphrase_encrypted: encrypt(PASS),
    signer_name: "Authorised Signatory", signer_designation: "HR Manager", is_ca_issued: 0, is_self_signed: 1,
    valid_to: new Date(Date.now() + 365 * 24 * 3600 * 1000),
  };
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText("APPOINTMENT LETTER", { x: 56, y: 780, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const out = await signPdfAsCompany(Buffer.from(await doc.save()), { reason: "Appointment Letter" });
  return out.bytes;
}

const tx = (employeeName: string) => ({
  id: "tx-1", employee_id: "emp-1", candidate_id: null, employee_name: employeeName,
} as unknown as Parameters<typeof recordSignerIdentity>[0]);

// [id, employee_id, candidate_id, reference_id, transaction_id, owner, cn, issuer_cn, from, to, tier, suspicious, reason]
const row = () => {
  const p = inserts[0].params;
  return { owner: p[5], cn: p[6], issuer: p[7], tier: p[10], suspicious: p[11] };
};

beforeEach(() => { inserts.length = 0; audits.length = 0; });

describe("appointment-letter signer identity", () => {
  it("company signature first, employee's eSign appended: the employee is read, a matching name is not suspicious", async () => {
    const pdf = appendSignature(await companySignedLetter(), { cn: "Sujeet Vishwakarma", issuerCn: CA });
    await recordSignerIdentity(tx("SUJEET VISHWAKARMA"), "issue-1", pdf);

    expect(inserts).toHaveLength(1);
    expect(row()).toMatchObject({ cn: "Sujeet Vishwakarma", issuer: CA, suspicious: 0 });
    expect(row().tier).not.toBe("none");
    expect(audits).toEqual([]);
  });

  it("a genuinely different last signer IS suspicious and audited", async () => {
    const pdf = appendSignature(await companySignedLetter(), { cn: "Shivam Shiv Giri", issuerCn: CA });
    await recordSignerIdentity(tx("SUJEET VISHWAKARMA"), "issue-1", pdf);

    expect(row()).toMatchObject({ cn: "Shivam Shiv Giri", tier: "none", suspicious: 1 });
    expect(audits.map((a) => a.action)).toEqual(["ESIGN_SIGNER_IDENTITY_MISMATCH"]);
    expect(audits[0].detail).toMatchObject({ certificateCommonName: "Shivam Shiv Giri", documentOwnerName: "SUJEET VISHWAKARMA" });
  });

  it("only the company signature present: never suspicious, recorded as unverifiable", async () => {
    await recordSignerIdentity(tx("SUJEET VISHWAKARMA"), "issue-1", await companySignedLetter());

    expect(row()).toMatchObject({ cn: null, tier: "unverifiable", suspicious: 0 });
    expect(audits).toEqual([]);
  });

  it("an unsigned or malformed file is unverifiable, not a mismatch, and does not throw", async () => {
    await recordSignerIdentity(tx("SUJEET VISHWAKARMA"), "issue-1", Buffer.from("%PDF-1.7 nothing"));
    expect(row()).toMatchObject({ cn: null, tier: "unverifiable", suspicious: 0 });
    expect(audits).toEqual([]);
  });
});
