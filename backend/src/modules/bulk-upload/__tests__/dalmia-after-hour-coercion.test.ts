import { describe, it, expect } from "vitest";
import { parseDateTime, cleanText, DALMIA_AFTER_HOUR_HEADERS } from "../dalmia-after-hour-bulk.service.js";

describe("parseDateTime", () => {
  it("reads the real Date sample", () => {
    expect(parseDateTime("2026-07-01 19:08:17")).toBe("2026-07-01 19:08:17");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and nulls blank", () => {
    expect(cleanText(" 8235592747 ")).toBe("8235592747");
    expect(cleanText("")).toBeNull();
  });
});

describe("headers", () => {
  it("names Date and Contact No, together this row's identity", () => {
    expect(DALMIA_AFTER_HOUR_HEADERS).toContain("Date");
    expect(DALMIA_AFTER_HOUR_HEADERS).toContain("Contact No");
  });
});
