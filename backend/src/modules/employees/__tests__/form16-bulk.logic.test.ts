import { describe, expect, it } from "vitest";
import { extractPanFromFilename, isValidFinancialYear, looksLikePdf, summarise, form16DocName } from "../form16-bulk.logic.js";

describe("extractPanFromFilename", () => {
  it("finds the PAN in common TRACES-style names, upper-cased", () => {
    expect(extractPanFromFilename("ABCDE1234F_2025-26.pdf")).toBe("ABCDE1234F");
    expect(extractPanFromFilename("Form16_abcde1234f.pdf")).toBe("ABCDE1234F");
    expect(extractPanFromFilename("C:\\downloads\\ABCDE1234F.pdf")).toBe("ABCDE1234F");
  });
  it("returns null when there is no PAN or when two different PANs are present", () => {
    expect(extractPanFromFilename("form16.pdf")).toBeNull();
    expect(extractPanFromFilename("ABCDE1234F_FGHIJ5678K.pdf")).toBeNull();
    expect(extractPanFromFilename("")).toBeNull();
  });
  it("the same PAN written twice is still one PAN", () => {
    expect(extractPanFromFilename("ABCDE1234F_abcde1234f.pdf")).toBe("ABCDE1234F");
  });
});

describe("isValidFinancialYear", () => {
  it("accepts consecutive years only", () => {
    expect(isValidFinancialYear("2025-26")).toBe(true);
    expect(isValidFinancialYear("2099-00")).toBe(true);
    expect(isValidFinancialYear("2025-27")).toBe(false);
    expect(isValidFinancialYear("25-26")).toBe(false);
    expect(isValidFinancialYear("2025/26")).toBe(false);
    expect(isValidFinancialYear(undefined)).toBe(false);
  });
});

describe("looksLikePdf", () => {
  it("checks the header, not the extension", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.7\nrest"))).toBe(true);
    expect(looksLikePdf(Buffer.from("<html>not a pdf</html>"))).toBe(false);
    expect(looksLikePdf(Buffer.from("%PDF"))).toBe(false);
  });
});

describe("naming and summary", () => {
  it("document name carries the year so duplicates are per year", () => {
    expect(form16DocName("2025-26")).toBe("Form 16 FY 2025-26");
  });
  it("summarise counts by outcome", () => {
    expect(summarise([{ outcome: "ready" }, { outcome: "ready" }, { outcome: "no_pan" }])).toEqual({ total: 3, ready: 2, no_pan: 1 });
  });
});
