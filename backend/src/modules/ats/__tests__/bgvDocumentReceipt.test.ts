/**
 * The BGV report's "Documents Received" checklist.
 *
 * Every doc_type below is one that exists in production today. The complete
 * vocabulary was read from the live table rather than assumed, because the two
 * spellings of the same document ("Aadhaar" / "aadhaar_card") are exactly the
 * sort of thing an invented fixture would not contain.
 */
import { describe, it, expect } from "vitest";
import {
  receiptFlagForDocType,
  receiptFlagsFromDocuments,
  RECEIPT_FLAGS,
} from "../bgv-document-receipt.js";

/** doc_type -> expected flag, for all 21 values present in production. */
const PRODUCTION_DOC_TYPES: Array<[string, string | null]> = [
  ["Aadhaar", "aadhaar_received"],
  ["aadhaar_card", "aadhaar_received"],
  ["PAN Card", "pan_received"],
  ["pan_card", "pan_received"],
  ["Passport Photo", "photo_received"],
  ["Live Selfie", "photo_received"],
  ["10th Marksheet", "edu_cert_received"],
  ["12th Marksheet", "edu_cert_received"],
  ["marksheet_0", "edu_cert_received"],
  ["Degree Certificate", "edu_cert_received"],
  ["Diploma Certificate", "edu_cert_received"],
  ["Bank Passbook", "bank_proof_received"],
  ["Cancelled Cheque", "bank_proof_received"],
  ["cancelled_cheque", "bank_proof_received"],
  ["Experience Letter", "prev_exp_received"],
  ["Appointment Letter", "offer_letter_received"],
  ["passport", "passport_received"],
  ["Driving License", "driving_license_received"],
  // No column exists for these. null is the honest answer.
  ["Address Proof", null],
  ["Voter ID", null],
  ["Other", null],
];

describe("every doc_type in production maps correctly", () => {
  for (const [docType, expected] of PRODUCTION_DOC_TYPES) {
    it(`${docType} -> ${expected ?? "no flag"}`, () => {
      expect(receiptFlagForDocType(docType)).toBe(expected);
    });
  }
});

describe("the two spellings of one document agree", () => {
  for (const [a, b] of [
    ["Aadhaar", "aadhaar_card"],
    ["PAN Card", "pan_card"],
    ["Cancelled Cheque", "cancelled_cheque"],
  ] as const) {
    it(`${a} and ${b} produce the same flag`, () => {
      expect(receiptFlagForDocType(a)).toBe(receiptFlagForDocType(b));
      expect(receiptFlagForDocType(a)).not.toBeNull();
    });
  }
});

describe("a passport photo is not a passport", () => {
  it("counts Passport Photo as a photograph", () => {
    // 36 candidates uploaded one. Reading it as a passport would record a
    // travel document none of them provided.
    expect(receiptFlagForDocType("Passport Photo")).toBe("photo_received");
  });

  it("still counts an actual passport", () => {
    expect(receiptFlagForDocType("passport")).toBe("passport_received");
  });
});

describe("reducing a candidate's uploads", () => {
  it("ticks exactly what a real 8-document candidate provided", () => {
    const flags = receiptFlagsFromDocuments([
      "Aadhaar", "PAN Card", "Passport Photo", "10th Marksheet",
      "12th Marksheet", "Bank Passbook", "Address Proof", "Other",
    ]);
    expect(flags.aadhaar_received).toBe(true);
    expect(flags.pan_received).toBe(true);
    expect(flags.photo_received).toBe(true);
    expect(flags.edu_cert_received).toBe(true);
    expect(flags.bank_proof_received).toBe(true);
    // Not provided:
    expect(flags.passport_received).toBe(false);
    expect(flags.driving_license_received).toBe(false);
    expect(flags.prev_exp_received).toBe(false);
    expect(flags.offer_letter_received).toBe(false);
  });

  it("returns all nine flags, so no column is left undefined", () => {
    const flags = receiptFlagsFromDocuments([]);
    expect(Object.keys(flags).sort()).toEqual([...RECEIPT_FLAGS].sort());
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, "", "   ", 42, {}]) {
      expect(() => receiptFlagForDocType(junk)).not.toThrow();
      expect(receiptFlagForDocType(junk)).toBeNull();
    }
  });
});
