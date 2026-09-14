import { describe, it, expect } from "vitest";
import {
  parseDateTime, parseDateOnly, parseNullableInt, cleanText, BLA_BLI_BLU_AUTO_CALLBACK_HEADERS,
} from "../bla-bli-blu-auto-callback-bulk.service.js";

describe("parseDateTime / parseDateOnly", () => {
  it("reads the real plain-text samples", () => {
    expect(parseDateTime("2026-09-08 10:15:26")).toBe("2026-09-08 10:15:26");
    expect(parseDateOnly("2026-09-08")).toBe("2026-09-08");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
  });
});

describe("parseNullableInt", () => {
  it("parses the real Length (Sec) sample", () => {
    expect(parseNullableInt("0")).toBe(0);
  });
  it("returns null for blank", () => {
    expect(parseNullableInt("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and returns null for blank", () => {
    expect(cleanText(" MAS60390 ")).toBe("MAS60390");
    expect(cleanText("")).toBeNull();
  });
});

describe("headers", () => {
  it("names Agent/Phone Number/Start Time, this row's identity", () => {
    expect(BLA_BLI_BLU_AUTO_CALLBACK_HEADERS).toContain("Agent");
    expect(BLA_BLI_BLU_AUTO_CALLBACK_HEADERS).toContain("Phone Number");
    expect(BLA_BLI_BLU_AUTO_CALLBACK_HEADERS).toContain("Start Time");
  });
});
