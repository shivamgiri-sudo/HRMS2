import { describe, expect, it } from "vitest";
import { fmtRef, parseRef } from "../he-call-ref.service.js";

describe("call reference", () => {
  it("starts at HRMS-001 and keeps counting", () => {
    expect(fmtRef(1)).toBe("HRMS-001");
    expect(fmtRef(42)).toBe("HRMS-042");
    expect(fmtRef(999)).toBe("HRMS-999");
    expect(fmtRef(1000)).toBe("HRMS-1000");
  });
  it("parses what it formats, and nothing else", () => {
    expect(parseRef("HRMS-001")).toBe(1);
    expect(parseRef(" hrms-1000 ")).toBe(1000);
    expect(parseRef("01d19c9c-c0e6-11f1-b9a7-00155d0ab410")).toBeNull();
    expect(parseRef("HRMS-1")).toBeNull();
  });
});
