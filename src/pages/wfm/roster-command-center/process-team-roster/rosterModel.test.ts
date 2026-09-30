import { describe, it, expect } from "vitest";
import { buildAlerts, breakdownBy, countMembers, deltaPoints, fmtDate, fmtDateTime, presentRate, prevDayISO, punctualityRate, sortMembers, type Member } from "./rosterModel";

const mk = (o: Partial<Member>): Member => ({
  employeeId: "1", employeeCode: "C1", employeeName: "A", branchId: null, branchName: null, lobId: null, lobName: null,
  status: "ON_TIME", shiftName: null, shiftTime: null, clockInTime: null, clockOutTime: null, minutesLate: null, leaveType: null, ...o,
});

describe("rates", () => {
  it("excludes week-off, leave and upcoming from the denominator; no NaN on zero", () => {
    const c = countMembers([mk({ status: "ON_TIME" }), mk({ status: "LATE" }), mk({ status: "ABSENT" }), mk({ status: "ON_LEAVE" }), mk({ status: "WEEK_OFF_HOLIDAY" }), mk({ status: "UPCOMING" })]);
    expect(c.total).toBe(6);
    expect(presentRate(c)).toBe(66.7);
    expect(punctualityRate(c)).toBe(50);
    const none = countMembers([mk({ status: "WEEK_OFF_HOLIDAY" })]);
    expect(presentRate(none)).toBeNull();
    expect(punctualityRate(none)).toBeNull();
  });
  it("delta", () => {
    expect(deltaPoints(80, 75.5)).toBe(4.5);
    expect(deltaPoints(null, 70)).toBeUndefined();
  });
});

describe("sort", () => {
  it("status sort is attention-first and nulls sort last in both directions", () => {
    const l = [mk({ employeeId: "a", employeeName: "A", status: "ON_TIME", clockInTime: "09:00:00" }), mk({ employeeId: "b", employeeName: "B", status: "ABSENT" }), mk({ employeeId: "c", employeeName: "C", status: "LATE", clockInTime: "09:30:00" })];
    expect(sortMembers(l, "status", "asc").map((m) => m.employeeId)).toEqual(["b", "c", "a"]);
    expect(sortMembers(l, "clockIn", "asc").map((m) => m.employeeId)).toEqual(["a", "c", "b"]);
    expect(sortMembers(l, "clockIn", "desc").map((m) => m.employeeId)).toEqual(["c", "a", "b"]);
  });
});

describe("alerts", () => {
  it("orders by severity and uses due-only percentages", () => {
    const a = buildAlerts({ onTime: 6, late: 1, absent: 3, onLeave: 0, weekOffHoliday: 0, upcoming: 2, total: 12 });
    expect(a.map((x) => x.key)).toEqual(["absent", "late", "upcoming"]);
    expect(a[0].severity).toBe("critical");
    expect(a[0].text).toContain("30%");
    expect(buildAlerts({ onTime: 5, late: 0, absent: 0, onLeave: 0, weekOffHoliday: 0, upcoming: 0, total: 5 })).toEqual([]);
  });
});

describe("misc", () => {
  it("breakdown groups with fallback", () => {
    const b = breakdownBy([mk({ shiftName: "M" }), mk({ shiftName: "M", status: "LATE" }), mk({})], (m) => m.shiftName, "No shift");
    expect(b[0]).toMatchObject({ name: "M", total: 2, LATE: 1 });
    expect(b[1].name).toBe("No shift");
  });
  it("formats DD/MM/YYYY", () => {
    expect(fmtDate("2026-09-05")).toBe("05/09/2026");
    expect(fmtDateTime("2026-09-05 08:07:00")).toBe("05/09/2026 08:07");
    expect(fmtDate(null)).toBe("—");
    expect(prevDayISO("2026-03-01")).toBe("2026-02-28");
  });
});
