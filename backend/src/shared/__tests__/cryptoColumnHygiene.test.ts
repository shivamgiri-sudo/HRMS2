import { describe, it, expect } from "vitest";
import {
  stripCryptoPlumbing,
  isCryptoPlumbingColumn,
  CRYPTO_PLUMBING_PATTERN,
} from "../cryptoColumnHygiene.js";

/**
 * Regression coverage for at-rest crypto columns reaching API responses.
 *
 * GET /api/bgv/report/full built its `profile` and `bank` fields from SELECT * over
 * candidate_onboarding_profile and candidate_onboarding_bank_detail — unlike the
 * explicitly-columned queries beside them in the same Promise.all. Measured against the
 * live schema, that shipped pan_number_encrypted, pan_number_hash, aadhaar_number_hash,
 * account_no_encrypted, account_no_hash and onboarding_token_hash to the client.
 *
 * Neither table has a raw pan_number or account_no column, so the masked values the UI
 * renders are unaffected — the entire exposure was plumbing.
 */

// Column names taken from the live schema of the two tables.
const PROFILE_ROW = {
  id: "prof-1",
  candidate_id: "cand-1",
  employee_name: "Test Person",
  personal_email_id: "someone@example.com",
  pan_number_masked: "ABXXXXX34F",
  aadhaar_number_masked: "XXXX-XXXX-9012",
  passport_no: "Z1234567",
  uan_number: "100234567890",
  full_name_aadhaar: "Test Person",
  onboarding_token_hash: "3f9a2c8e11",
  pan_number_hash: "9b1c",
  pan_number_encrypted: "eyJ2IjoxfQ==",
  aadhaar_number_hash: "77ac",
};

const BANK_ROW = {
  id: "bank-1",
  account_holder_name: "Test Person",
  account_no_masked: "XXXXXX7890",
  ifsc_code: "HDFC0001234",
  account_type: "savings",
  account_no_hash: "44de",
  account_no_encrypted: "eyJ2IjoxfQ==",
};

describe("isCryptoPlumbingColumn", () => {
  it.each([
    "pan_number_encrypted",
    "account_no_encrypted",
    "aadhaar_number_hash",
    "onboarding_token_hash",
    "pan_blind_index",
    "aadhaar_enc_key_version",
    "account_number_enc",
  ])("treats %s as plumbing", (col) => {
    expect(isCryptoPlumbingColumn(col)).toBe(true);
  });

  it.each([
    "pan_number_masked",
    "aadhaar_number_masked",
    "account_no_masked",
    "aadhaar_last4",
    "pan_number",
    "account_holder_name",
    "full_name_aadhaar",
    "ifsc_code",
  ])("does not treat %s as plumbing", (col) => {
    expect(isCryptoPlumbingColumn(col)).toBe(false);
  });

  it("keeps the safe pre-computed renderings, which are often all a UI should show", () => {
    // Stripping these would push callers back to the raw column — the opposite of intent.
    expect(CRYPTO_PLUMBING_PATTERN.test("pan_number_masked")).toBe(false);
    expect(CRYPTO_PLUMBING_PATTERN.test("aadhaar_last4")).toBe(false);
  });
});

describe("stripCryptoPlumbing", () => {
  it("removes every crypto column from the BGV profile row", () => {
    const out = stripCryptoPlumbing(PROFILE_ROW);
    for (const k of [
      "onboarding_token_hash",
      "pan_number_hash",
      "pan_number_encrypted",
      "aadhaar_number_hash",
    ]) {
      expect(out).not.toHaveProperty(k);
    }
    expect(JSON.stringify(out)).not.toContain("eyJ2IjoxfQ==");
  });

  it("removes every crypto column from the BGV bank row", () => {
    const out = stripCryptoPlumbing(BANK_ROW);
    expect(out).not.toHaveProperty("account_no_hash");
    expect(out).not.toHaveProperty("account_no_encrypted");
  });

  it("leaves the fields the BGV report actually renders", () => {
    const p = stripCryptoPlumbing(PROFILE_ROW);
    expect(p.employee_name).toBe("Test Person");
    expect(p.pan_number_masked).toBe("ABXXXXX34F");
    expect(p.aadhaar_number_masked).toBe("XXXX-XXXX-9012");
    expect(p.uan_number).toBe("100234567890");

    const b = stripCryptoPlumbing(BANK_ROW);
    expect(b.account_holder_name).toBe("Test Person");
    expect(b.account_no_masked).toBe("XXXXXX7890");
    expect(b.ifsc_code).toBe("HDFC0001234");
  });

  it("passes null and undefined through, so an optional row needs no caller guard", () => {
    expect(stripCryptoPlumbing(null)).toBeNull();
    expect(stripCryptoPlumbing(undefined)).toBeNull();
  });

  it("does not mutate the row it was given", () => {
    const input = { ...PROFILE_ROW };
    stripCryptoPlumbing(input);
    expect(input).toHaveProperty("pan_number_encrypted");
  });

  it("preserves falsy values rather than dropping them", () => {
    const out = stripCryptoPlumbing({ a: 0, b: "", c: false, d: null, e_hash: "x" });
    expect(out).toEqual({ a: 0, b: "", c: false, d: null });
  });
});
