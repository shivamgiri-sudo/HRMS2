import { describe, expect, it } from "vitest";
import {
  MAX_REPAIR_DAYS, enumerateDates, validateRepairRange,
  AUTO_HEAL_DAYS, MAX_BACKFILL_DAYS, addDays, autoHealWindow, coveragePct, daysBetween, isIsoDate, isLowCoverage, jobTone,
  summariseMissing, validateBackfillRange,
} from "../attendance-heal.logic.js";

const TODAY = "2026-10-03";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-07-26")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-07-2026")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-03", -7)).toBe("2026-09-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-07-26", "2026-08-01")).toBe(6);
  });
  it("the automatic window is the last 7 complete days, ending yesterday", () => {
    expect(autoHealWindow(TODAY)).toEqual({ from: "2026-09-26", to: "2026-10-02" });
    expect(AUTO_HEAL_DAYS).toBe(7);
  });
});

describe("validateBackfillRange", () => {
  it("accepts a past range and says a person must confirm anything older than the automatic window", () => {
    expect(validateBackfillRange("2026-07-20", "2026-07-31", TODAY)).toEqual({ ok: true, needsConfirmation: true });
    expect(validateBackfillRange("2026-09-30", "2026-10-02", TODAY)).toEqual({ ok: true, needsConfirmation: false });
  });
  it("rejects bad input, reversed ranges, today/future, and ranges over 31 days", () => {
    expect(validateBackfillRange("x", "2026-07-31", TODAY).ok).toBe(false);
    expect(validateBackfillRange("2026-08-01", "2026-07-31", TODAY).ok).toBe(false);
    expect(validateBackfillRange("2026-09-01", TODAY, TODAY).ok).toBe(false);
    expect(validateBackfillRange("2026-09-01", "2026-10-09", TODAY).ok).toBe(false);
    expect(validateBackfillRange("2026-07-01", "2026-08-01", TODAY).message).toContain(String(MAX_BACKFILL_DAYS));
  });
  it("exactly 31 days is allowed", () => {
    expect(validateBackfillRange("2026-07-01", "2026-07-31", TODAY).ok).toBe(true);
  });
});

describe("summariseMissing", () => {
  it("counts by branch and date, with unassigned branches grouped", () => {
    const s = summariseMissing([
      { employeeId: "a", employeeCode: "1", branchId: "b1", date: "2026-07-26" },
      { employeeId: "b", employeeCode: "2", branchId: "b1", date: "2026-07-26" },
      { employeeId: "c", employeeCode: "3", branchId: null, date: "2026-07-27" },
    ]);
    expect(s).toEqual({ total: 3, byBranch: { b1: 2, unassigned: 1 }, byDate: { "2026-07-26": 2, "2026-07-27": 1 } });
  });
});

describe("coverage", () => {
  it("is records over active staff, capped at 100, and an empty branch reads complete", () => {
    expect(coveragePct(235, 420)).toBe(56);
    expect(coveragePct(440, 420)).toBe(100);
    expect(coveragePct(0, 0)).toBe(100);
  });
  it("flags a cut-off night but not a normal one", () => {
    expect(isLowCoverage(coveragePct(235, 420))).toBe(true);
    expect(isLowCoverage(coveragePct(415, 420))).toBe(false);
  });
});

describe("jobTone", () => {
  const now = Date.UTC(2026, 9, 3, 12, 0, 0);
  const ago = (h: number) => new Date(now - h * 3_600_000);
  it("fresh is ok, getting old is warn, very old is bad, never run is unknown, a failed last run is bad", () => {
    expect(jobTone(ago(2), "completed", now, 24)).toBe("ok");
    expect(jobTone(ago(40), "completed", now, 24)).toBe("warn");
    expect(jobTone(ago(80), "completed", now, 24)).toBe("bad");
    expect(jobTone(null, null, now, 24)).toBe("unknown");
    expect(jobTone(ago(1), "failed", now, 24)).toBe("bad");
  });
});

describe("repair range", () => {
  it("lists every date inclusive, oldest first", () => {
    expect(enumerateDates("2026-08-30", "2026-09-02")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(enumerateDates("2026-08-01", "2026-08-01")).toEqual(["2026-08-01"]);
  });
  it("allows up to 14 past days and refuses more, today, reversed or invalid ranges", () => {
    expect(validateRepairRange("2026-08-01", "2026-08-14", TODAY).ok).toBe(true);
    expect(validateRepairRange("2026-08-01", "2026-08-15", TODAY).ok).toBe(false);
    expect(validateRepairRange("2026-09-30", "2026-10-03", TODAY).ok).toBe(false);
    expect(validateRepairRange("2026-08-05", "2026-08-01", TODAY).ok).toBe(false);
    expect(validateRepairRange("nope", "2026-08-01", TODAY).ok).toBe(false);
    expect(MAX_REPAIR_DAYS).toBe(14);
  });
});
