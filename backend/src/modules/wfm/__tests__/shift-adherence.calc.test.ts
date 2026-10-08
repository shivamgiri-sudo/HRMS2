import { describe, it, expect } from "vitest";
import { classifyRow, addToTally, emptyTally, deriveMetrics, lateBucketKey, type AdherenceRow } from "../shift-adherence.calc.js";

const row = (o: Partial<AdherenceRow> = {}): AdherenceRow => ({
  assignmentType: "SHIFT", isWeekOff: false, attendanceStatus: null, shiftStart: "09:00",
  punched: true, loginDeltaMin: 0, minutesSinceEnd: -60, earlyOutMin: null, hasPunchOut: false, dueYet: true, ...o,
});

describe("classifyRow", () => {
  it("on time at or before start; late only beyond grace", () => {
    expect(classifyRow(row({ loginDeltaMin: -10 }), 0).status).toBe("on_time");
    expect(classifyRow(row({ loginDeltaMin: 0 }), 0).status).toBe("on_time");
    expect(classifyRow(row({ loginDeltaMin: 1 }), 0).status).toBe("late");
    expect(classifyRow(row({ loginDeltaMin: 10 }), 15).status).toBe("on_time");
    expect(classifyRow(row({ loginDeltaMin: 16 }), 15)).toMatchObject({ status: "late", lateMin: 16 });
  });
  it("no punch: absent once due, yet_to_start before", () => {
    expect(classifyRow(row({ punched: false, loginDeltaMin: null, dueYet: true }), 0).status).toBe("absent");
    expect(classifyRow(row({ punched: false, loginDeltaMin: null, dueYet: false }), 0).status).toBe("yet_to_start");
  });
  it("week-off, leave and holiday are not planned; week-off worked is informational", () => {
    expect(classifyRow(row({ assignmentType: "WEEK_OFF", punched: false }), 0).status).toBe("non_working");
    expect(classifyRow(row({ assignmentType: "WEEK_OFF", punched: true }), 0).status).toBe("week_off_worked");
    expect(classifyRow(row({ assignmentType: "LEAVE", punched: false }), 0).status).toBe("leave");
    expect(classifyRow(row({ isWeekOff: true, punched: false }), 0).status).toBe("non_working");
    expect(classifyRow(row({ attendanceStatus: "leave_approved", punched: false }), 0).status).toBe("leave");
  });
  it("a punch with no rostered start time is present but not graded for punctuality", () => {
    const c = classifyRow(row({ loginDeltaMin: null }), 0);
    expect(c).toMatchObject({ status: "on_time", noShiftTime: true });
  });
  it("logout checks only apply once the shift has ended", () => {
    expect(classifyRow(row({ minutesSinceEnd: -30, hasPunchOut: false }), 0).missedLogout).toBe(false);
    expect(classifyRow(row({ minutesSinceEnd: 30, hasPunchOut: false }), 0).missedLogout).toBe(true);
    expect(classifyRow(row({ minutesSinceEnd: 30, hasPunchOut: true, earlyOutMin: 45 }), 0)).toMatchObject({ leftEarly: true, earlyOutMin: 45 });
    expect(classifyRow(row({ minutesSinceEnd: 30, hasPunchOut: true, earlyOutMin: 3 }), 0).leftEarly).toBe(false);
    expect(classifyRow(row({ minutesSinceEnd: 30, hasPunchOut: true, earlyOutMin: -20 }), 0).leftEarly).toBe(false);
  });
});

describe("lateBucketKey", () => {
  it("buckets minutes", () => {
    expect([1, 5, 6, 15, 16, 30, 31, 60, 61, 500].map(lateBucketKey)).toEqual(
      ["b1_5", "b1_5", "b6_15", "b6_15", "b16_30", "b16_30", "b31_60", "b31_60", "b60p", "b60p"]);
  });
});

describe("tally + metrics", () => {
  it("rolls up a process and derives percentages", () => {
    const t = emptyTally();
    for (const r of [
      row({ loginDeltaMin: -2 }), row({ loginDeltaMin: 0 }), row({ loginDeltaMin: 10 }), row({ loginDeltaMin: 40 }),
      row({ punched: false, loginDeltaMin: null }), row({ punched: false, loginDeltaMin: null, dueYet: false }),
      row({ assignmentType: "LEAVE", punched: false }),
    ]) addToTally(t, classifyRow(r, 0));
    expect(t).toMatchObject({ planned: 5, present: 4, onTime: 2, late: 2, absent: 1, yetToStart: 1, onLeave: 1, lateMinTotal: 50, lateMaxMin: 40 });
    expect(t.buckets.b6_15).toBe(1);
    expect(t.buckets.b31_60).toBe(1);
    expect(deriveMetrics(t)).toMatchObject({ adherencePct: 40, punctualityPct: 50, attendancePct: 80, avgLateMin: 25 });
  });
  it("returns null, not 0, when there is nothing to divide by", () => {
    expect(deriveMetrics(emptyTally())).toEqual({ adherencePct: null, punctualityPct: null, attendancePct: null, avgLateMin: null, logoutAdherencePct: null });
  });
});
