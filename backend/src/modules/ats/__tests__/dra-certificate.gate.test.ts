import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));

const { findMissingMandatoryDocuments } = await import("../onboarding-full.service.js");
const { draBlocksSubmission, saveCandidateDraDetails } = await import("../dra-certificate.service.js");

const ID = "cand-1";
// All the usual documents on file, so only the DRA rule can be what is missing.
const ALL_DOCS = ["Aadhaar", "PAN Card", "Address Proof", "Passport Photo", "Live Selfie", "10th Marksheet", "12th Marksheet"]
  .map((t) => ({ doc_type: t, doc_name: t }));

function mock(opts: { costCentre: string | null; draUploaded: boolean; dra?: Record<string, unknown> | null }) {
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("FROM ats_employment_offer")) {
      return [opts.costCentre ? [{ raw: opts.costCentre, code: opts.costCentre }] : [], []];
    }
    if (s.includes("FROM candidate_onboarding_document")) {
      return [[...ALL_DOCS, ...(opts.draUploaded ? [{ doc_type: "DRA Certificate", doc_name: "DRA Certificate" }] : [])], []];
    }
    if (s.includes("FROM candidate_dra_certificate")) return [opts.dra ? [opts.dra] : [], []];
    return [[], []]; // candidate_bgv_check etc.
  });
}

beforeEach(() => execute.mockReset());

describe("DRA certificate is mandatory for the SBI cost centre only", () => {
  it("is missing for BSS/OB/AHMH-JD/1050 when not uploaded", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: false });
    expect(await findMissingMandatoryDocuments(ID)).toEqual(["DRA Certificate"]);
  });
  it("is satisfied once uploaded", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: true });
    expect(await findMissingMandatoryDocuments(ID)).toEqual([]);
  });
  it("is not asked of any other cost centre", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/474", draUploaded: false });
    expect(await findMissingMandatoryDocuments(ID)).toEqual([]);
  });
  it("is not asked when there is no offer yet", async () => {
    mock({ costCentre: null, draUploaded: false });
    expect(await findMissingMandatoryDocuments(ID)).toEqual([]);
  });
});

describe("what blocks submission after upload", () => {
  const row = (o: Record<string, unknown>) => ({ id: "d1", status: "pending", uploaded_at: new Date(), details_entered_at: new Date(), ...o });
  it("an expired certificate blocks", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: true, dra: row({ status: "expired", valid_until: "2025-01-01" }) });
    expect(await draBlocksSubmission(ID)).toMatch(/expired/i);
  });
  it("an HR-rejected certificate blocks", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: true, dra: row({ status: "invalid", verification_source: "hr_iibf_portal", failure_reason: "serial not found" }) });
    expect(await draBlocksSubmission(ID)).toMatch(/serial not found/);
  });
  it("an automatic OCR mismatch does NOT block (candidate cannot fix a misread; HR reviews)", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: true, dra: row({ status: "mismatch", verification_source: "auto_ocr" }) });
    expect(await draBlocksSubmission(ID)).toBeNull();
  });
  it("never blocks outside the SBI cost centre", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/474", draUploaded: true, dra: row({ status: "expired" }) });
    expect(await draBlocksSubmission(ID)).toBeNull();
  });
});

describe("candidate-typed certificate details", () => {
  const row = (o: Record<string, unknown>) => ({ id: "d1", status: "pending", uploaded_at: new Date(), ...o });
  const good = { registrationNo: "DRA/12345678", serialNo: "IIBF-DRA-998877", securityCode: "a1b2c3d4", certificateDate: "2024-03-14" };

  it("blocks submit until the four details are typed", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: true, dra: row({ details_entered_at: null }) });
    expect(await draBlocksSubmission(ID)).toMatch(/enter your DRA certificate details/i);
  });
  it("rejects malformed details with the problems listed", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: false });
    await expect(saveCandidateDraDetails(ID, { ...good, securityCode: "1" })).rejects.toMatchObject({ statusCode: 400, code: "INVALID_DRA_DETAILS" });
  });
  it("refuses candidates the rule does not apply to", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/474", draUploaded: false });
    await expect(saveCandidateDraDetails(ID, good)).rejects.toMatchObject({ statusCode: 400 });
  });
  it("stores a details-only row (upper-cased) when nothing is uploaded yet", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: false });
    await saveCandidateDraDetails(ID, good);
    const insert = execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO candidate_dra_certificate"));
    expect(insert).toBeTruthy();
    expect(insert![1]).toEqual([expect.any(String), ID, "DRA/12345678", "IIBF-DRA-998877", "A1B2C3D4", "2024-03-14"]);
  });
  it("flags a mismatch when typed details disagree with what was read from the file", async () => {
    mock({ costCentre: "BSS/OB/AHMH-JD/1050", draUploaded: true, dra: row({
      details_entered_at: new Date(), registration_no: "DRA/1", ocr_registration_no: "DRA/99999999", ocr_serial_no: "IIBF-DRA-998877",
    }) });
    await saveCandidateDraDetails(ID, good);
    const update = execute.mock.calls.find((c) => String(c[0]).startsWith("UPDATE candidate_dra_certificate") || String(c[0]).includes("SET registration_no"));
    expect(update![1]).toContain("mismatch");
  });
});
