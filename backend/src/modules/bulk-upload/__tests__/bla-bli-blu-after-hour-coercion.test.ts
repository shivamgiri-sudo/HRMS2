import { describe, it, expect } from "vitest";
import { parseDateTime, cleanText, BLA_BLI_BLU_AFTER_HOUR_HEADERS } from "../bla-bli-blu-after-hour-bulk.service.js";

describe("parseDateTime", () => {
  it("reads the real plain-text sample", () => {
    expect(parseDateTime("2026-09-08 19:03:59")).toBe("2026-09-08 19:03:59");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and returns null for blank", () => {
    expect(cleanText(" +919355380180 ")).toBe("+919355380180");
    expect(cleanText("")).toBeNull();
  });
});

describe("headers", () => {
  it("names Date and Contact No, this row's identity", () => {
    expect(BLA_BLI_BLU_AFTER_HOUR_HEADERS).toContain("Date");
    expect(BLA_BLI_BLU_AFTER_HOUR_HEADERS).toContain("Contact No");
  });
});
