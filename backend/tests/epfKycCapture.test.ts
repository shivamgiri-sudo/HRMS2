/**
 * EPF statutory KYC capture.
 *
 * The contract that matters: the member's real PAN / Aadhaar / UAN / bank
 * account reach the generated PDF and nothing else. If a raw value ever appears
 * in a SQL parameter, the design has failed and DPDP masking has been undone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({ execute: vi.fn().mockResolvedValue([[], []]) }));
const fillMock = vi.hoisted(() => ({ generateChecklistDraft: vi.fn().mockResolvedValue({}) }));

vi.mock("../src/db/mysql.js", () => ({ db: dbMock }));
vi.mock("../src/modules/employees/universalDigitalFormFill.service.js", () => fillMock);

import {
  validateEpfKyc,
  applyEpfKycAndRegenerate,
} from "../src/modules/employees/epfKycCapture.service.js";

// A real-format, Verhoeff-valid Aadhaar used purely as test data.
const VALID_AADHAAR = "234123412346";
const VALID = {
  panNumber: "ABCDE1234F",
  aadhaarNumber: VALID_AADHAAR,
  uanNumber: "100200300400",
  bankAccountNumber: "50100123456789",
  bankIfsc: "HDFC0001234",
  bankAccountName: "Employee One",
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.execute.mockImplementation(async (sql: string) => {
    if (String(sql).includes("FROM employee_joining_document_checklist")) {
      return [[{ document_code: "EPF_DECLARATION" }], []];
    }
    return [[], []];
  });
});

describe("validation", () => {
  it("TC-KYC-01: bank account and IFSC are mandatory — EPFO marks them so on the form", () => {
    const errors = validateEpfKyc({ panNumber: "ABCDE1234F" });
    expect(errors.map((e) => e.field)).toEqual(expect.arrayContaining(["bankAccountNumber", "bankIfsc"]));
  });

  it("TC-KYC-02: accepts a complete, well-formed submission", () => {
    expect(validateEpfKyc(VALID)).toEqual([]);
  });

  it("TC-KYC-03: rejects malformed PAN and IFSC", () => {
    const errors = validateEpfKyc({ ...VALID, panNumber: "ABCD1234F", bankIfsc: "HDFC1234567" });
    expect(errors.map((e) => e.field)).toEqual(expect.arrayContaining(["panNumber", "bankIfsc"]));
  });

  it("TC-KYC-04: rejects an Aadhaar that fails the Verhoeff checksum", () => {
    // 12 digits, right shape, wrong checksum — a length check alone would pass
    // it and EPFO would reject the filing weeks later.
    const errors = validateEpfKyc({ ...VALID, aadhaarNumber: "234123412345" });
    expect(errors.map((e) => e.field)).toContain("aadhaarNumber");
  });

  it("TC-KYC-05: rejects Aadhaar numbers starting 0 or 1, which are never issued", () => {
    expect(validateEpfKyc({ ...VALID, aadhaarNumber: "012345678901" }).map((e) => e.field)).toContain("aadhaarNumber");
  });

  it("TC-KYC-06: tolerates spaces and hyphens as typed", () => {
    expect(validateEpfKyc({ ...VALID, aadhaarNumber: "2341 2341 2346", bankIfsc: "hdfc0001234" })).toEqual([]);
  });
});

describe("applying the values", () => {
  it("TC-KYC-07: passes the real values to the PDF renderer", async () => {
    const result = await applyEpfKycAndRegenerate({ checklistId: "check-1", employeeId: "emp-1", input: VALID });

    expect(result.regenerated).toBe(true);
    const [, , transient] = fillMock.generateChecklistDraft.mock.calls[0];
    expect(transient).toMatchObject({
      kyc_pan_number: "ABCDE1234F",
      kyc_aadhaar_number: VALID_AADHAAR,
      uan: "100200300400",
      kyc_bank_account_number: "50100123456789",
    });
  });

  it("TC-KYC-08: never writes a raw value into any SQL parameter", async () => {
    await applyEpfKycAndRegenerate({ checklistId: "check-1", employeeId: "emp-1", input: VALID });

    const everyParam = dbMock.execute.mock.calls
      .flatMap((call) => (Array.isArray(call[1]) ? call[1] : []))
      .map((p) => String(p ?? ""));
    const serialized = everyParam.join(" | ");

    for (const raw of [VALID.panNumber, VALID.aadhaarNumber, VALID.uanNumber, VALID.bankAccountNumber]) {
      expect(serialized, `raw ${raw} must not be persisted`).not.toContain(raw);
    }
    // The masked forms are expected — that is what the profile already stores.
    expect(serialized).toMatch(/X/);
  });

  it("TC-KYC-09: refuses to run against a non-EPF document", async () => {
    dbMock.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM employee_joining_document_checklist")) {
        return [[{ document_code: "NDA_CONFIDENTIALITY" }], []];
      }
      return [[], []];
    });

    const result = await applyEpfKycAndRegenerate({ checklistId: "check-1", employeeId: "emp-1", input: VALID });
    expect(result.regenerated).toBe(false);
    expect(fillMock.generateChecklistDraft).not.toHaveBeenCalled();
  });

  it("TC-KYC-10: does not regenerate when validation fails", async () => {
    const result = await applyEpfKycAndRegenerate({
      checklistId: "check-1",
      employeeId: "emp-1",
      input: { ...VALID, bankIfsc: "" },
    });
    expect(result.regenerated).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("bankIfsc");
    expect(fillMock.generateChecklistDraft).not.toHaveBeenCalled();
  });
});
