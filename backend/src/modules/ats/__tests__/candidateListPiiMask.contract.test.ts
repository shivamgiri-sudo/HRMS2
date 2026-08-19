/**
 * GET /api/ats/candidates (listCandidates) is a bulk list endpoint — up to 500 rows/page,
 * open to admin/hr/recruiter/manager/super_admin — whose query used to be `SELECT c.*` on
 * ats_candidate. That table carries raw aadhar_number, pan_number, uan_number,
 * bank_account_no, bank_ifsc alongside the at-rest crypto plumbing for those same fields
 * (*_hash, *_encrypted). None of it is used by the frontend candidate grid
 * (NativeATSCandidateMaster.tsx), and the single-record view (getCandidate) never selected
 * these columns to begin with — the list was the one place raw values still left the backend.
 *
 * This is the I-Spark-equivalent failure mode this audit re-tests for: a bulk list response
 * handing every viewer's sensitive field to a broadly-held role in one call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { atsService } = await import("../ats.service.js");

const RAW_ROW = {
  id: "cand-1",
  candidate_code: "CND-1",
  full_name: "Test Candidate",
  mobile: "9999999999",
  email: "test@example.com",
  current_stage: "Applied",
  aadhar_number: "123456789012",
  pan_number: "ABCDE1234F",
  uan_number: "100123456789",
  bank_account_no: "00011122233",
  bank_ifsc: "HDFC0001234",
  bank_name: "HDFC Bank",
  aadhar_number_masked: "XXXXXXXX9012",
  pan_number_masked: "ABXXXXX34F",
  bank_account_no_masked: "XXXXX2233",
  aadhar_number_hash: "deadbeef".repeat(8),
  pan_number_hash: "deadbeef".repeat(8),
  bank_account_no_hash: "deadbeef".repeat(8),
  bank_account_no_encrypted: "ciphertext-blob",
  aadhar_number_encrypted: "ciphertext-blob",
  pan_number_encrypted: "ciphertext-blob",
};

beforeEach(() => {
  execute.mockReset();
  // First call: row-fetching query. Second call: COUNT(*) query.
  execute
    .mockResolvedValueOnce([[{ ...RAW_ROW }]])
    .mockResolvedValueOnce([[{ total: 1 }]]);
});

describe("listCandidates strips crypto plumbing and masks raw statutory/bank identifiers", () => {
  it("never returns the raw aadhaar/PAN/bank values", async () => {
    const result = await atsService.listCandidates({ page: 1, limit: 50 });
    const row = result.data[0] as unknown as Record<string, unknown>;

    expect(row.aadhar_number).not.toBe(RAW_ROW.aadhar_number);
    expect(row.pan_number).not.toBe(RAW_ROW.pan_number);
    expect(row.uan_number).not.toBe(RAW_ROW.uan_number);
    expect(row.bank_account_no).not.toBe(RAW_ROW.bank_account_no);
    expect(row.bank_ifsc).not.toBe(RAW_ROW.bank_ifsc);

    // Masked, not merely truthy — confirms real redaction, not an accidental drop.
    expect(row.aadhar_number).toBe("XXXXXXXX9012".replace(/\d(?=\d{4})/g, "X"));
    expect(String(row.pan_number)).toMatch(/^AB[X]+34F$/);
    expect(String(row.bank_account_no)).toMatch(/^X+2233$/);
  });

  it("never returns at-rest crypto plumbing columns, for any field", () => {
    return atsService.listCandidates({ page: 1, limit: 50 }).then((result) => {
      const row = result.data[0] as unknown as Record<string, unknown>;
      expect(row).not.toHaveProperty("aadhar_number_hash");
      expect(row).not.toHaveProperty("pan_number_hash");
      expect(row).not.toHaveProperty("bank_account_no_hash");
      expect(row).not.toHaveProperty("bank_account_no_encrypted");
      expect(row).not.toHaveProperty("aadhar_number_encrypted");
      expect(row).not.toHaveProperty("pan_number_encrypted");
    });
  });

  it("leaves the pre-computed *_masked columns and ordinary fields untouched", async () => {
    const result = await atsService.listCandidates({ page: 1, limit: 50 });
    const row = result.data[0] as unknown as Record<string, unknown>;
    expect(row.aadhar_number_masked).toBe(RAW_ROW.aadhar_number_masked);
    expect(row.pan_number_masked).toBe(RAW_ROW.pan_number_masked);
    expect(row.bank_account_no_masked).toBe(RAW_ROW.bank_account_no_masked);
    expect(row.full_name).toBe(RAW_ROW.full_name);
    expect(row.mobile).toBe(RAW_ROW.mobile);
  });
});
