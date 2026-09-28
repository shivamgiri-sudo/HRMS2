import { describe, expect, it } from "vitest";
import { describePeriod, formatBucketTick } from "../onfidoReportShared";

describe("formatBucketTick", () => {
  it("labels a weekly bucket as week commencing", () => {
    expect(formatBucketTick("2026-08-03", "weekly")).toBe("WC 03 Aug");
  });

  it("labels a daily bucket with the weekday", () => {
    expect(formatBucketTick("2026-08-03", "daily")).toBe("03 Aug (Mon)");
  });

  it("leaves monthly buckets untouched", () => {
    expect(formatBucketTick("2026-08", "monthly")).toBe("2026-08");
  });
});

describe("describePeriod", () => {
  it("names the day for a single-day range", () => {
    expect(describePeriod({ from: "2026-08-03", to: "2026-08-03" }, "daily")).toBe("Day: 03 Aug 2026 (Mon)");
  });

  it("names the week for a weekly range", () => {
    expect(describePeriod({ from: "2026-08-03", to: "2026-08-09" }, "weekly")).toContain("Week commencing 03 Aug 2026");
  });

  it("names the month for a monthly range", () => {
    expect(describePeriod({ from: "2026-08-01", to: "2026-08-31" }, "monthly")).toContain("Aug 2026");
  });
});
