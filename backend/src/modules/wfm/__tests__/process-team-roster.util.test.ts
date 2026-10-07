import { describe, it, expect } from "vitest";
import {
  classifyMember,
  dedupeByEmployee,
  signedMinutesFromShiftStart,
} from "../process-team-roster.util.js";
import {
  completedDaysBound,
  summarizeMonth,
} from "../process-team-roster-detail.service.js";

const NOW = new Date(2026, 8, 11, 10, 0, 0);

describe("signedMinutesFromShiftStart", () => {
  it("is wrap-safe across midnight", () => {
    expect(signedMinutesFromShiftStart("23:55:00", "00:00:00")).toBe(-5);
    expect(signedMinutesFromShiftStart("00:20:00", "23:50:00")).toBe(30);
    expect(signedMinutesFromShiftStart("09:20:00", "09:00:00")).toBe(20);
  });
});

describe("classifyMember", () => {
  const base = {
    assignmentType: "REGULAR",
    shiftStart: "09:00:00",
    firstIn: null as string | null,
  };
  it("treats approved leave without punch as ON_LEAVE, not ABSENT", () => {
    expect(
      classifyMember({ ...base, hasApprovedLeave: true }, "2026-09-11", NOW)
        .status,
    ).toBe("ON_LEAVE");
    expect(
      classifyMember(
        { ...base, attStatus: "leave_approved" },
        "2026-09-11",
        NOW,
      ).status,
    ).toBe("ON_LEAVE");
  });
  it("uses engine present status when no punch time", () => {
    expect(
      classifyMember(
        { ...base, attStatus: "present", attLateMark: 1, attLateByMinutes: 12 },
        "2026-09-11",
        NOW,
      ),
    ).toEqual({ status: "LATE", minutesLate: 12 });
    expect(
      classifyMember(
        { ...base, attStatus: "present", attLateMark: 0 },
        "2026-09-11",
        NOW,
      ).status,
    ).toBe("ON_TIME");
  });
  it("a 23:55 punch for a 00:00 shift is on time", () => {
    expect(
      classifyMember(
        { ...base, shiftStart: "00:00:00", firstIn: "23:55:00" },
        "2026-09-10",
        NOW,
      ).status,
    ).toBe("ON_TIME");
  });
  it("honours per-shift grace", () => {
    expect(
      classifyMember(
        { ...base, firstIn: "09:10:00", graceMinutes: 15 },
        "2026-09-11",
        NOW,
      ).status,
    ).toBe("ON_TIME");
    expect(
      classifyMember(
        { ...base, firstIn: "09:10:00", graceMinutes: 5 },
        "2026-09-11",
        NOW,
      ).status,
    ).toBe("LATE");
  });
  it("week-off type wins over everything", () => {
    expect(
      classifyMember(
        { ...base, assignmentType: "WEEK_OFF", firstIn: "09:00:00" },
        "2026-09-11",
        NOW,
      ).status,
    ).toBe("WEEK_OFF_HOLIDAY");
  });
});

describe("dedupeByEmployee", () => {
  it("collapses join fan-out and prefers the row carrying the leave name", () => {
    const out = dedupeByEmployee([
      { employee_id: "a", leave_name: null },
      { employee_id: "a", leave_name: "Casual Leave" },
      { employee_id: "b", leave_name: null },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].leave_name).toBe("Casual Leave");
  });
});

describe("month summary", () => {
  it("excludes week-off / leave from planned and never divides by zero", () => {
    const r = summarizeMonth([
      { type: "REGULAR", isWeekOff: 0, attStatus: "present", lateMark: 0 },
      { type: "REGULAR", isWeekOff: 0, attStatus: "present", lateMark: 1 },
      { type: "REGULAR", isWeekOff: 0, attStatus: null, lateMark: null },
      { type: "WEEK_OFF", isWeekOff: 1, attStatus: null, lateMark: null },
      {
        type: "REGULAR",
        isWeekOff: 0,
        attStatus: "leave_approved",
        lateMark: null,
      },
    ]);
    expect(r).toMatchObject({
      planned: 3,
      present: 2,
      late: 1,
      onTime: 1,
      absent: 1,
      leave: 1,
      weekOff: 1,
      adherencePct: 66.7,
    });
    expect(summarizeMonth([]).adherencePct).toBeNull();
  });
  it("completed-days bound excludes today", () => {
    expect(completedDaysBound("2026-09-11", "2026-09-11")).toBe("2026-09-11");
    expect(completedDaysBound("2026-09-10", "2026-09-11")).toBe("2026-09-11");
  });
});
