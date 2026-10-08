import { describe, expect, it } from "vitest";
import { parsePerformanceQuery } from "../performance-intelligence.validation.js";

describe("parsePerformanceQuery", () => {
  it("accepts a valid bounded date range", () => {
    expect(parsePerformanceQuery({
      from: "2026-07-01",
      to: "2026-07-18",
    })).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-18",
      page: 1,
      pageSize: 25,
    });
  });

  it("rejects non-ISO dates", () => {
    expect(() => parsePerformanceQuery({
      from: "18/07/2026",
      to: "2026-07-18",
    })).toThrow(/YYYY-MM-DD/);
  });

  it("rejects impossible calendar dates", () => {
    expect(() => parsePerformanceQuery({
      from: "2026-02-30",
      to: "2026-03-01",
    })).toThrow(/valid calendar date/);
  });

  it("rejects an inverted range", () => {
    expect(() => parsePerformanceQuery({
      from: "2026-07-18",
      to: "2026-07-01",
    })).toThrow(/on or before/);
  });

  it("rejects a range longer than 93 inclusive days", () => {
    expect(() => parsePerformanceQuery({
      from: "2025-01-01",
      to: "2026-07-18",
    })).toThrow(/93 days/);
  });

  it("caps the page size and trims optional identifiers", () => {
    expect(parsePerformanceQuery({
      from: "2026-07-01",
      to: "2026-07-18",
      pageSize: "500",
      branchId: " branch-1 ",
      processId: "",
    })).toMatchObject({
      pageSize: 100,
      branchId: "branch-1",
      processId: undefined,
    });
  });
});
