import { describe, it, expect } from "vitest";
import { parseDateTime, cleanText, BLA_BLI_BLU_CALL_DISPOSITION_HEADERS } from "../bla-bli-blu-call-disposition-bulk.service.js";

describe("parseDateTime", () => {
  it("reads the real 'DD-MM-YY HH:MM' sample", () => {
    expect(parseDateTime("08-09-26 18:50")).toBe("2026-09-08 18:50:00");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and returns null for blank", () => {
    expect(cleanText(" Connected ")).toBe("Connected");
    expect(cleanText("")).toBeNull();
  });
});

describe("headers", () => {
  it("names Session Id, the row's identity (matches dialer_db call_uuid)", () => {
    expect(BLA_BLI_BLU_CALL_DISPOSITION_HEADERS).toContain("Session Id");
  });
});
