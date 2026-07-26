import { describe, expect, it } from "vitest";
import {
  buildShiftWindowInfo,
  classifyOperationsNetLogin,
  isCrossMidnightShift,
  nextIstDate,
} from "../attendance-engine.service.js";

describe("attendance engine night-shift helpers", () => {
  it("detects cross-midnight shifts from roster timings", () => {
    expect(isCrossMidnightShift("21:00:00", "06:00:00")).toBe(true);
    expect(isCrossMidnightShift("16:00:00", "01:00:00")).toBe(true);
    expect(isCrossMidnightShift("09:00:00", "18:00:00")).toBe(false);
    expect(isCrossMidnightShift(null, "06:00:00")).toBe(false);
  });

  it("computes the next IST date for a shift that crosses midnight", () => {
    expect(nextIstDate("2026-07-25")).toBe("2026-07-26");
    expect(nextIstDate("2026-07-31")).toBe("2026-08-01");
  });

  it("builds a two-day shift window for night shifts", () => {
    expect(
      buildShiftWindowInfo("2026-07-25", "21:00:00", "06:00:00")
    ).toEqual({
      isNightShift: true,
      startDate: "2026-07-25",
      endDate: "2026-07-26",
      shiftStartTime: "21:00:00",
      shiftEndTime: "06:00:00",
    });
  });

  it("keeps same-day windows for normal shifts", () => {
    expect(
      buildShiftWindowInfo("2026-07-25", "09:00:00", "18:00:00")
    ).toEqual({
      isNightShift: false,
      startDate: "2026-07-25",
      endDate: "2026-07-25",
      shiftStartTime: "09:00:00",
      shiftEndTime: "18:00:00",
    });
  });

  it("preserves APR payroll classification for summed cross-midnight minutes", () => {
    expect(classifyOperationsNetLogin(540)).toEqual({
      status: "present",
      lwpValue: 0,
    });
    expect(classifyOperationsNetLogin(300)).toEqual({
      status: "half_day",
      lwpValue: 0.5,
    });
    expect(classifyOperationsNetLogin(180)).toEqual({
      status: "absent",
      lwpValue: 1,
    });
  });
});
