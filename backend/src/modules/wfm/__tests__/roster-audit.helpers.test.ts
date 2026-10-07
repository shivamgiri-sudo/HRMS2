import { describe, it, expect } from "vitest";
import {
  formatDecisionType,
  effectiveDecisionCode,
  isEngineErrorRule,
  istToday,
  resolvePeriod,
  previousPeriod,
  pct,
  deltaPct,
  clampInt,
  validateAmendmentInput,
  DECISION_TYPE_CODES,
  isIsoDate,
  addDaysIso,
} from "../roster-audit.helpers";

describe("formatDecisionType", () => {
  it("labels every real enum member (none fall through to raw code)", () => {
    for (const c of DECISION_TYPE_CODES)
      expect(formatDecisionType(c)).not.toBe(c);
    expect(formatDecisionType("manager_rejected_request")).toBe(
      "Request Rejected by Manager",
    );
    expect(formatDecisionType("hr_override")).toBe("HR Override");
  });
  it("humanises unknown codes and tolerates null", () => {
    expect(formatDecisionType("some_new_type")).toBe("Some New Type");
    expect(formatDecisionType(null)).toBe("Unknown");
  });
});

describe("engine error rows", () => {
  it("is detected from rule_applied and re-coded", () => {
    expect(isEngineErrorRule("error:boom")).toBe(true);
    expect(isEngineErrorRule("fcfs")).toBe(false);
    expect(isEngineErrorRule(null)).toBe(false);
    expect(effectiveDecisionCode("shift_assigned", "error:x")).toBe(
      "engine_error",
    );
    expect(effectiveDecisionCode("shift_assigned", "fcfs")).toBe(
      "shift_assigned",
    );
  });
});

describe("periods (IST, inclusive)", () => {
  it("istToday uses IST not UTC (18:31 UTC is already next day in IST)", () => {
    expect(istToday(new Date("2026-09-29T18:31:00Z"))).toBe("2026-09-30");
    expect(istToday(new Date("2026-09-29T18:29:00Z"))).toBe("2026-09-29");
  });
  it("defaults to last 30 days ending today", () => {
    expect(
      resolvePeriod(undefined, undefined, new Date("2026-09-30T06:00:00Z")),
    ).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("rejects malformed / reversed ranges", () => {
    expect(resolvePeriod("2026-9-1", "2026-09-30")).toHaveProperty("error");
    expect(resolvePeriod("2026-09-30", "2026-09-01")).toHaveProperty("error");
    expect(resolvePeriod("2026-02-31", "2026-03-01")).toHaveProperty("error");
  });
  it("previous period has identical length and ends the day before", () => {
    expect(previousPeriod({ from: "2026-09-01", to: "2026-09-07" })).toEqual({
      from: "2026-08-25",
      to: "2026-08-31",
    });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-01" })).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
  });
  it("date helpers", () => {
    expect(isIsoDate("2026-09-30")).toBe(true);
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("math", () => {
  it("pct never NaN and keeps one decimal", () => {
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 300)).toBe(0.3); // used to round to 0
    expect(pct(NaN, 5)).toBe(0);
  });
  it("deltaPct is null without a baseline", () => {
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
  });
  it("clampInt bounds and defaults", () => {
    expect(clampInt("abc", 100, 1, 500)).toBe(100);
    expect(clampInt("9999", 100, 1, 500)).toBe(500);
    expect(clampInt("-5", 0, 0, 10)).toBe(0);
  });
});

describe("validateAmendmentInput", () => {
  const cycle = { week_start_date: "2026-09-01", week_end_date: "2026-09-07" };
  const ok = {
    employeeId: "e1",
    date: "2026-09-03",
    newAssignmentType: "SHIFT",
    newShiftId: "s1",
    reason: "Swap approved by PM",
  };
  it("accepts a valid body", () =>
    expect(validateAmendmentInput(ok, cycle)).toBeNull());
  it("requires shift for SHIFT but not for WEEK_OFF", () => {
    expect(
      validateAmendmentInput({ ...ok, newShiftId: undefined }, cycle),
    ).toMatch(/newShiftId/);
    expect(
      validateAmendmentInput(
        { ...ok, newAssignmentType: "WEEK_OFF", newShiftId: undefined },
        cycle,
      ),
    ).toBeNull();
  });
  it("rejects out-of-window date, bad type, short reason", () => {
    expect(
      validateAmendmentInput({ ...ok, date: "2026-09-08" }, cycle),
    ).toMatch(/within the cycle/);
    expect(
      validateAmendmentInput({ ...ok, newAssignmentType: "regular" }, cycle),
    ).toMatch(/newAssignmentType/);
    expect(validateAmendmentInput({ ...ok, reason: "hi" }, cycle)).toMatch(
      /reason/,
    );
  });
});
