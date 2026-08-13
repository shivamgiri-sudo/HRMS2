import { describe, it, expect } from "vitest";
import { validateStatutoryFields, validateBankFields } from "../statutoryFormat.js";

describe("validateStatutoryFields", () => {
  it("accepts well-formed values", () => {
    expect(validateStatutoryFields({
      pan_number: "ABCDE1234F",
      aadhaar_id: "123456789012",
      uan_number: "100200300400",
      esi_number: "12345678901234567",
      epf_number: "KA/BLR/12345/000/0000123",
    })).toEqual([]);
  });

  it.each([
    ["pan_number", "ABCDE1234", "too short"],
    ["pan_number", "abcde1234f", "lowercase not accepted as-is (caller must uppercase first)"],
    ["pan_number", "12345ABCDE", "wrong character pattern"],
    ["aadhaar_id", "12345", "not 12 digits"],
    ["aadhaar_id", "1234567890AB", "contains letters"],
    ["uan_number", "1234567890", "not 12 digits"],
    ["esi_number", "123456789012345", "not 17 digits"],
  ])("rejects malformed %s (%s): %s", (field, value) => {
    const errors = validateStatutoryFields({ [field]: value });
    expect(errors.some((e) => e.field === field)).toBe(true);
  });

  it("rejects an epf_number over 40 characters", () => {
    const errors = validateStatutoryFields({ epf_number: "X".repeat(41) });
    expect(errors.some((e) => e.field === "epf_number")).toBe(true);
  });

  it("skips fields that are undefined, null, or empty — partial updates stay partial", () => {
    expect(validateStatutoryFields({ pan_number: undefined, aadhaar_id: null, uan_number: "" })).toEqual([]);
  });

  it("only reports the fields that are actually present and wrong", () => {
    const errors = validateStatutoryFields({ pan_number: "ABCDE1234F", aadhaar_id: "bad" });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("aadhaar_id");
  });
});

describe("validateBankFields", () => {
  it("accepts well-formed values", () => {
    expect(validateBankFields({ ifsc_code: "HDFC0001234", account_number: "50100234567890" })).toEqual([]);
  });

  it.each([
    ["ifsc_code", "HDFC001234", "10 chars, missing the 0"],
    ["ifsc_code", "hdfc0001234", "lowercase not accepted as-is"],
    ["ifsc_code", "1234HDFC001", "doesn't start with 4 letters"],
    ["account_number", "12345", "too short"],
    ["account_number", "123456789012345678901", "too long"],
    ["account_number", "ABC123456789", "contains letters"],
  ])("rejects malformed %s (%s): %s", (field, value) => {
    const errors = validateBankFields({ [field]: value });
    expect(errors.some((e) => e.field === field)).toBe(true);
  });

  it("skips fields that are absent", () => {
    expect(validateBankFields({})).toEqual([]);
  });
});
