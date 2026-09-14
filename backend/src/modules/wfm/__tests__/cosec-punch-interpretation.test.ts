import { describe, expect, it } from "vitest";
import { assessAggregatePunches } from "../cosec-punch-interpretation.service.js";

describe("assessAggregatePunches", () => {
  it("uses first-to-last minutes for even completed punch groups", () => {
    const result = assessAggregatePunches({
      firstPunch: "2026-07-24 09:00:00",
      lastPunch: "2026-07-24 18:15:00",
      totalPunches: 4,
      workingMinutes: 555,
      mode: "historical",
    });

    expect(result.state).toBe("PUNCHED_OUT");
    expect(result.effectivePunchOut).toBe("2026-07-24 18:15:00");
    expect(result.effectiveWorkingMinutes).toBe(555);
    expect(result.reviewRequired).toBe(false);
  });

  it("keeps a single punch incomplete for payroll review", () => {
    const result = assessAggregatePunches({
      firstPunch: "2026-07-24 09:00:00",
      lastPunch: "2026-07-24 09:00:00",
      totalPunches: 1,
      workingMinutes: 0,
      mode: "historical",
    });

    expect(result.state).toBe("PUNCHED_IN");
    expect(result.effectivePunchOut).toBeNull();
    expect(result.effectiveWorkingMinutes).toBe(0);
    expect(result.reason).toBe("single_punch");
  });

  it("keeps odd punch counts live as punched-in", () => {
    const result = assessAggregatePunches({
      firstPunch: "2026-07-25 09:00:00",
      lastPunch: "2026-07-25 18:00:00",
      totalPunches: 3,
      workingMinutes: 540,
      mode: "live",
    });

    expect(result.state).toBe("PUNCHED_IN");
    expect(result.effectivePunchOut).toBeNull();
    expect(result.effectiveWorkingMinutes).toBe(0);
    expect(result.reason).toBe("odd_punch_count");
  });

  it("uses first-to-last span for odd punch counts on historical dates and flags review", () => {
    const result = assessAggregatePunches({
      firstPunch: "2026-07-24 09:00:00",
      lastPunch: "2026-07-24 18:00:00",
      totalPunches: 3,
      workingMinutes: 540,
      mode: "historical",
    });

    expect(result.state).toBe("PUNCHED_OUT");
    expect(result.effectivePunchOut).toBe("2026-07-24 18:00:00");
    expect(result.effectiveWorkingMinutes).toBe(540);
    expect(result.reason).toBe("historical_odd_punch_span");
    expect(result.reviewRequired).toBe(true);
  });
});
