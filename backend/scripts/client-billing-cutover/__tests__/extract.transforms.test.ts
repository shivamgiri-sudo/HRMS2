import { describe, it, expect } from "vitest";
import {
  shouldExcludeInvoice,
  shouldExcludeCreditNote,
  mapGstFields,
  computeGstType,
  normalizeCategory,
  buildDescription,
  parseLegacyDecimal,
  sanitizeLegacyDatetime,
} from "../extract.transforms.js";

describe("shouldExcludeInvoice (design §5.7)", () => {
  it("excludes status=1 (legacy's own deleted flag)", () => {
    expect(shouldExcludeInvoice(1)).toBe(true);
  });
  it("keeps status=0 (active, including legal-hold rows)", () => {
    expect(shouldExcludeInvoice(0)).toBe(false);
  });
  it("keeps null status (never treat unknown as deleted)", () => {
    expect(shouldExcludeInvoice(null)).toBe(false);
  });
});

describe("shouldExcludeCreditNote (tbl_credit_note status is NOT tbl_invoice's status)", () => {
  it("never excludes on status=1 — that is the APPROVED signal here, not deleted", () => {
    expect(shouldExcludeCreditNote(1)).toBe(false);
  });
  it("never excludes on status=0 either — extraction migrates everything, Task 3 decides", () => {
    expect(shouldExcludeCreditNote(0)).toBe(false);
  });
  it("never excludes on null", () => {
    expect(shouldExcludeCreditNote(null)).toBe(false);
  });
});

describe("mapGstFields (design §5.2 — 2,237 NULL/empty GSTType rows)", () => {
  it("null GSTType -> gst_type NULL, apply_gst 0", () => {
    expect(mapGstFields(null)).toEqual({ target_gst_type: null, target_apply_gst: 0 });
  });
  it("empty-string GSTType -> gst_type NULL, apply_gst 0", () => {
    expect(mapGstFields("")).toEqual({ target_gst_type: null, target_apply_gst: 0 });
  });
  it("whitespace-only GSTType -> gst_type NULL, apply_gst 0", () => {
    expect(mapGstFields("   ")).toEqual({ target_gst_type: null, target_apply_gst: 0 });
  });
  it("Integrated -> preserved verbatim, apply_gst 1", () => {
    expect(mapGstFields("Integrated")).toEqual({ target_gst_type: "Integrated", target_apply_gst: 1 });
  });
  it("Intrastate -> preserved verbatim, apply_gst 1", () => {
    expect(mapGstFields("Intrastate")).toEqual({ target_gst_type: "Intrastate", target_apply_gst: 1 });
  });
  it("trims surrounding whitespace on a real value", () => {
    expect(mapGstFields("  Integrated  ")).toEqual({ target_gst_type: "Integrated", target_apply_gst: 1 });
  });
});

describe("normalizeCategory (design §5.5 — built from a fresh live query, not the doc sample)", () => {
  it("merges the doc's own example: Talktime -> Talk Time", () => {
    expect(normalizeCategory("Talktime")).toBe("Talk Time");
  });
  it("is case-insensitive on the Talktime variant", () => {
    expect(normalizeCategory("TALKTIME")).toBe("Talk Time");
    expect(normalizeCategory("talktime")).toBe("Talk Time");
  });
  it("leaves the canonical Talk Time value untouched", () => {
    expect(normalizeCategory("Talk Time")).toBe("Talk Time");
  });
  it("merges the variant found only by the fresh unlimited query: Other -> Others", () => {
    expect(normalizeCategory("Other")).toBe("Others");
  });
  it("leaves the dominant Others value untouched", () => {
    expect(normalizeCategory("Others")).toBe("Others");
  });
  it("passes through an unrelated category verbatim (trimmed)", () => {
    expect(normalizeCategory("  Subscription  ")).toBe("Subscription");
    expect(normalizeCategory("first_bill")).toBe("first_bill");
    expect(normalizeCategory("Setup Cost")).toBe("Setup Cost");
  });
  it("defaults blank/empty string to 'Others' (A1 addendum A2 — column is NOT NULL)", () => {
    expect(normalizeCategory("")).toBe("Others");
    expect(normalizeCategory("   ")).toBe("Others");
  });
  it("defaults null to 'Others'", () => {
    expect(normalizeCategory(null)).toBe("Others");
  });
});

describe("computeGstType (2026-08-19 addendum A1 — supersedes mapGstFields's NULL result for blank GSTType)", () => {
  it("passes a non-blank legacy GSTType straight through, same as mapGstFields", () => {
    expect(
      computeGstType({ gstTypeRaw: "Integrated", vendorGstin: null, branchStateCode: null }),
    ).toEqual({ target_gst_type: "Integrated", target_apply_gst: 1 });
    expect(
      computeGstType({ gstTypeRaw: "  Intrastate  ", vendorGstin: null, branchStateCode: "07" }),
    ).toEqual({ target_gst_type: "Intrastate", target_apply_gst: 1 });
  });

  it("derives Intrastate when the vendor GSTIN's state prefix matches the branch state code", () => {
    expect(
      computeGstType({ gstTypeRaw: null, vendorGstin: "07AAACV1234A1Z5", branchStateCode: "07" }),
    ).toEqual({ target_gst_type: "Intrastate", target_apply_gst: 1 });
  });

  it("derives Integrated when the vendor GSTIN's state prefix differs from the branch state code", () => {
    expect(
      computeGstType({ gstTypeRaw: null, vendorGstin: "09AAACV1234A1Z5", branchStateCode: "07" }),
    ).toEqual({ target_gst_type: "Integrated", target_apply_gst: 1 });
  });

  it("is case-insensitive / trims the GSTIN before validating", () => {
    expect(
      computeGstType({ gstTypeRaw: "", vendorGstin: "  07aaacv1234a1z5  ", branchStateCode: "07" }),
    ).toEqual({ target_gst_type: "Intrastate", target_apply_gst: 1 });
  });

  it("falls back to Not Applicable when the GSTIN is blank", () => {
    expect(computeGstType({ gstTypeRaw: null, vendorGstin: null, branchStateCode: "07" })).toEqual({
      target_gst_type: "Not Applicable",
      target_apply_gst: 0,
    });
    expect(computeGstType({ gstTypeRaw: "", vendorGstin: "", branchStateCode: "07" })).toEqual({
      target_gst_type: "Not Applicable",
      target_apply_gst: 0,
    });
  });

  it("falls back to Not Applicable when the GSTIN is 'NA' or otherwise malformed", () => {
    expect(computeGstType({ gstTypeRaw: null, vendorGstin: "NA", branchStateCode: "07" })).toEqual({
      target_gst_type: "Not Applicable",
      target_apply_gst: 0,
    });
    expect(
      computeGstType({ gstTypeRaw: null, vendorGstin: "not-a-gstin", branchStateCode: "07" }),
    ).toEqual({ target_gst_type: "Not Applicable", target_apply_gst: 0 });
  });

  it("falls back to Not Applicable when no branch state code is resolvable, even with a valid-looking GSTIN", () => {
    expect(
      computeGstType({ gstTypeRaw: null, vendorGstin: "07AAACV1234A1Z5", branchStateCode: null }),
    ).toEqual({ target_gst_type: "Not Applicable", target_apply_gst: 0 });
    expect(
      computeGstType({ gstTypeRaw: null, vendorGstin: "07AAACV1234A1Z5", branchStateCode: "" }),
    ).toEqual({ target_gst_type: "Not Applicable", target_apply_gst: 0 });
  });
});

describe("buildDescription (design §5.6 — 89 'Under legal process' rows)", () => {
  it("appends the delete remark in a bracketed note when present", () => {
    expect(buildDescription("Monthly billing", "Under legal process")).toBe(
      "Monthly billing [Under legal process]",
    );
  });
  it("uses just the bracketed note when there is no base description", () => {
    expect(buildDescription(null, "Under legal process")).toBe("[Under legal process]");
    expect(buildDescription("", "Under legal process")).toBe("[Under legal process]");
  });
  it("returns the description unchanged when there is no delete remark", () => {
    expect(buildDescription("Monthly billing", null)).toBe("Monthly billing");
    expect(buildDescription("Monthly billing", "")).toBe("Monthly billing");
  });
  it("returns null when both are absent", () => {
    expect(buildDescription(null, null)).toBeNull();
    expect(buildDescription("", "")).toBeNull();
  });
  it("trims whitespace-only remarks as absent", () => {
    expect(buildDescription("Monthly billing", "   ")).toBe("Monthly billing");
  });
});

describe("parseLegacyDecimal (design §6.2 — VARCHAR total/tax/igst/sgst/cgst/grnd)", () => {
  it("parses a clean integer string", () => {
    expect(parseLegacyDecimal("15000")).toEqual({ value: 15000, ok: true });
  });
  it("parses a decimal string", () => {
    expect(parseLegacyDecimal("64618.38")).toEqual({ value: 64618.38, ok: true });
  });
  it("treats null as absent, not a failure", () => {
    expect(parseLegacyDecimal(null)).toEqual({ value: null, ok: true });
  });
  it("treats empty string as absent, not a failure", () => {
    expect(parseLegacyDecimal("")).toEqual({ value: null, ok: true });
    expect(parseLegacyDecimal("   ")).toEqual({ value: null, ok: true });
  });
  it("flags a real non-numeric string as a parse failure (the expected failure mode)", () => {
    const result = parseLegacyDecimal("N/A");
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
  });
  it("flags garbage text as a parse failure", () => {
    expect(parseLegacyDecimal("abc").ok).toBe(false);
  });
  it("accepts a leading/trailing-whitespace numeric string", () => {
    expect(parseLegacyDecimal("  4000  ")).toEqual({ value: 4000, ok: true });
  });
});

describe("sanitizeLegacyDatetime (MySQL 5.5 zero-date sentinel on ANY db_bill DATETIME column)", () => {
  it("normalizes the exact zero-date sentinel string to null", () => {
    expect(sanitizeLegacyDatetime("0000-00-00 00:00:00")).toBeNull();
  });
  it("normalizes a zero DATE-only sentinel to null", () => {
    expect(sanitizeLegacyDatetime("0000-00-00")).toBeNull();
  });
  it("normalizes an Invalid Date object to null", () => {
    expect(sanitizeLegacyDatetime(new Date(NaN))).toBeNull();
  });
  it("passes through a real datetime string unchanged", () => {
    expect(sanitizeLegacyDatetime("2026-08-18 08:45:08")).toBe("2026-08-18 08:45:08");
  });
  it("passes through a real Date object unchanged", () => {
    const d = new Date("2026-08-18T08:45:08Z");
    expect(sanitizeLegacyDatetime(d)).toBe(d);
  });
  it("passes through null as null", () => {
    expect(sanitizeLegacyDatetime(null)).toBeNull();
  });
  it("passes through undefined as null", () => {
    expect(sanitizeLegacyDatetime(undefined)).toBeNull();
  });
});