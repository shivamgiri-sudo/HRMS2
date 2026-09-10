import { describe, it, expect } from "vitest";
import { parseDate, parseNullableInt, cleanText, DALMIA_OUTBOUND_HEADERS } from "../dalmia-outbound-bulk.service.js";

describe("parseDate", () => {
  it("reads the real Calling Date sample", () => {
    expect(parseDate("2026-07-03")).toBe("2026-07-03");
  });
});

describe("parseNullableInt", () => {
  it("parses the real ID sample", () => {
    expect(parseNullableInt(1)).toBe(1);
  });
  it("returns null for blank, not zero", () => {
    expect(parseNullableInt("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and nulls blank", () => {
    expect(cleanText(" Gyana Ranjan Dash ")).toBe("Gyana Ranjan Dash");
    expect(cleanText(undefined)).toBeNull();
  });
});

describe("headers", () => {
  it("names ID and Calling Date, this row's identity", () => {
    expect(DALMIA_OUTBOUND_HEADERS).toContain("ID");
    expect(DALMIA_OUTBOUND_HEADERS).toContain("Calling Date");
  });
});
