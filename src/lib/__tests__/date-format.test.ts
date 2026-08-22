import { describe, expect, it } from "vitest";
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from "@/lib/date-format";

describe("formatDateDDMMYYYY", () => {
  it("formats a normal date as DD-MM-YYYY", () => {
    expect(formatDateDDMMYYYY("2026-08-20")).toBe("20-08-2026");
  });

  it("parses a MySQL 'YYYY-MM-DD HH:MM:SS' string (space -> T fix)", () => {
    expect(formatDateDDMMYYYY("2026-08-20 14:30:00")).toBe("20-08-2026");
  });

  it("zero-pads single-digit day and month", () => {
    expect(formatDateDDMMYYYY("2026-01-05")).toBe("05-01-2026");
  });

  it("returns the fallback ('—' by default) for a missing value", () => {
    expect(formatDateDDMMYYYY(null)).toBe("—");
    expect(formatDateDDMMYYYY(undefined)).toBe("—");
    expect(formatDateDDMMYYYY("")).toBe("—");
  });

  it("returns the fallback for an unparseable value", () => {
    expect(formatDateDDMMYYYY("not-a-date")).toBe("—");
  });

  it("honours a custom fallback", () => {
    expect(formatDateDDMMYYYY(null, "N/A")).toBe("N/A");
    expect(formatDateDDMMYYYY("garbage", "N/A")).toBe("N/A");
  });

  it("accepts an already-parsed Date instance", () => {
    expect(formatDateDDMMYYYY(new Date(2026, 7, 20))).toBe("20-08-2026");
  });
});

describe("formatDateTimeDDMMYYYY", () => {
  it("formats a normal date-time as DD-MM-YYYY, HH:MM", () => {
    expect(formatDateTimeDDMMYYYY("2026-08-20T14:30:00")).toBe("20-08-2026, 14:30");
  });

  it("parses a MySQL 'YYYY-MM-DD HH:MM:SS' string (space -> T fix)", () => {
    expect(formatDateTimeDDMMYYYY("2026-08-20 09:05:00")).toBe("20-08-2026, 09:05");
  });

  it("zero-pads single-digit day, month, hour and minute", () => {
    expect(formatDateTimeDDMMYYYY("2026-01-05 03:07:00")).toBe("05-01-2026, 03:07");
  });

  it("returns null (not a placeholder string) for a missing value", () => {
    expect(formatDateTimeDDMMYYYY(null)).toBeNull();
    expect(formatDateTimeDDMMYYYY(undefined)).toBeNull();
    expect(formatDateTimeDDMMYYYY("")).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(formatDateTimeDDMMYYYY("not-a-date")).toBeNull();
  });
});
