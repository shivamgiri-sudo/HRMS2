import { describe, it, expect } from "vitest";
import {
  ackGroupOf, addDays, attritionPct, buildFunnel, clampToToday, daySpan, dayStatus, deriveRates, deltaPts,
  eachDate, funnelByWeek, isPublishStage, isValidDate, previousWindow, safePct, sumCounts, toCounts, weekStartMonday,
} from "../roster-trends.calc.js";
import { COUNT_COLUMNS, REAL_ROSTER, scopeSql } from "../roster-trends.sql.js";

describe("rates", () => {
  it("never divides by zero or returns NaN", () => {
    expect(safePct(5, 0)).toBe(0);
    expect(safePct(NaN, 10)).toBe(0);
    expect(deriveRates({ scheduled: 0, present: 0, absent: 0, onLeave: 0, late: 0 })).toEqual({
      shrinkagePct: 0, unplannedPct: 0, plannedPct: 0, attendancePct: 0, lateRatePct: 0,
    });
  });
  it("shrinkage = (absent+leave)/scheduled and differs from unplanned when there is leave", () => {
    const r = deriveRates({ scheduled: 100, present: 80, absent: 12, onLeave: 8, late: 8 });
    expect(r.shrinkagePct).toBe(20);
    expect(r.unplannedPct).toBe(12);
    expect(r.plannedPct).toBe(8);
    expect(r.attendancePct).toBe(80);
    expect(r.lateRatePct).toBe(10);
  });
  it("toCounts tolerates nulls from empty SUMs", () => {
    expect(toCounts({ scheduled: null, present: "3", absent: undefined, on_leave: 1, late_count: null })).toEqual({
      scheduled: 0, present: 3, absent: 0, onLeave: 1, late: 0,
    });
    expect(sumCounts([{ scheduled: 2, present: 1, absent: 1, onLeave: 0, late: 0 }, { scheduled: 3, present: 3, absent: 0, onLeave: 0, late: 1 }]).scheduled).toBe(5);
  });
});

describe("dates", () => {
  it("validates real calendar dates", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-09-30")).toBe(true);
    expect(isValidDate("30/09/2026")).toBe(false);
  });
  it("week starts Monday incl. Sunday edge and month/year boundaries", () => {
    expect(weekStartMonday("2026-09-30")).toBe("2026-09-28"); // Wed
    expect(weekStartMonday("2026-10-04")).toBe("2026-09-28"); // Sun belongs to the week before
    expect(weekStartMonday("2026-09-28")).toBe("2026-09-28"); // Mon
    expect(weekStartMonday("2027-01-01")).toBe("2026-12-28");
  });
  it("previous window is the same length and ends the day before from", () => {
    expect(previousWindow("2026-09-17", "2026-09-30")).toEqual({ from: "2026-09-03", to: "2026-09-16" });
    expect(daySpan("2026-09-03", "2026-09-16")).toBe(14);
    expect(previousWindow("2026-03-01", "2026-03-01")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });
  it("eachDate is inclusive; clampToToday drops future days", () => {
    expect(eachDate("2026-09-28", "2026-10-01")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(clampToToday("2026-09-20", "2026-10-10", "2026-09-30")).toEqual({ from: "2026-09-20", to: "2026-09-30", empty: false });
    expect(clampToToday("2026-10-01", "2026-10-10", "2026-09-30").empty).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("publish funnel", () => {
  it("maps final_roster_status to ack groups like /my-roster does", () => {
    expect(ackGroupOf("generated")).toBe("not_published");
    expect(ackGroupOf("pending_employee_ack")).toBe("awaiting_ack");
    expect(ackGroupOf("acknowledged")).toBe("acknowledged");
    expect(ackGroupOf("force_approved_by_manager")).toBe("acknowledged");
    expect(ackGroupOf("escalated_to_hr")).toBe("disputed");
  });
  it("ack % is of PUBLISHED assignments, not of all", () => {
    const f = buildFunnel([
      { status: "generated", count: 80 }, { status: "pending_employee_ack", count: 10 },
      { status: "acknowledged", count: 8 }, { status: "rejected_by_employee", count: 2 },
    ]);
    expect(f.total).toBe(100);
    expect(f.published).toBe(20);
    expect(f.publishedPct).toBe(20);
    expect(f.ackPctOfPublished).toBe(40);
    expect(f.disputedPctOfPublished).toBe(10);
  });
  it("empty funnel is all zeros", () => {
    expect(buildFunnel([]).publishedPct).toBe(0);
  });
  it("groups by week oldest first", () => {
    const w = funnelByWeek([
      { week: "2026-09-28", status: "generated", count: 5 }, { week: "2026-09-21", status: "acknowledged", count: 3 },
      { week: "2026-09-21", status: "generated", count: 1 },
    ]);
    expect(w.map((x) => x.week)).toEqual(["2026-09-21", "2026-09-28"]);
    expect(w[0].total).toBe(4);
    expect(isPublishStage("acknowledged")).toBe(true);
    expect(isPublishStage("drop table")).toBe(false);
  });
});

describe("dayStatus", () => {
  const base = { date: "2026-09-30", today: "2026-09-30", assignmentType: "REGULAR", clockIn: null as string | null, lateMark: 0 };
  it("future days are Upcoming, not Absent", () => {
    expect(dayStatus({ ...base, date: "2026-10-02" })).toBe("Upcoming");
  });
  it("today before shift start is Upcoming, after is Absent", () => {
    expect(dayStatus({ ...base, shiftStart: "14:00", nowMinutes: 9 * 60 })).toBe("Upcoming");
    expect(dayStatus({ ...base, shiftStart: "09:00", nowMinutes: 11 * 60 })).toBe("Absent");
  });
  it("approved-leave attendance with no punch is On Leave", () => {
    expect(dayStatus({ ...base, date: "2026-09-29", attendanceStatus: "leave_approved" })).toBe("On Leave");
  });
  it("null assignment type counts as a working day; week-off flag wins", () => {
    expect(dayStatus({ ...base, date: "2026-09-29", assignmentType: null, clockIn: "09:05", lateMark: 1 })).toBe("Late");
    expect(dayStatus({ ...base, isWeekOff: true, assignmentType: "REGULAR" })).toBe("Week Off");
  });
});

describe("misc", () => {
  it("attrition uses exits / (headcount + exits)", () => {
    expect(attritionPct(10, 90)).toBe(10);
    expect(attritionPct(0, 0)).toBeNull();
    expect(deltaPts(12.5, 10)).toBe(2.5);
    expect(deltaPts(null, 10)).toBeNull();
  });
});

describe("shared SQL fragments", () => {
  it("treat NULL assignment_type as working (COALESCE, never bare NOT IN) and exclude week-off/holiday from the denominator", () => {
    expect(COUNT_COLUMNS).toContain("COALESCE(ra.assignment_type,'')");
    expect(COUNT_COLUMNS).not.toMatch(/ra\.assignment_type NOT IN/);
    expect(COUNT_COLUMNS).toContain("AS scheduled");
  });
  it("keeps the synthetic-cohort guard", () => {
    expect(REAL_ROSTER).toContain("import_batch_id IS NULL");
  });
  it("scopeSql builds branch/process/lob predicates with bound params only", () => {
    const s = scopeSql({ branchId: "b1", processId: "p1", lob: { kind: "lob", id: "l1" } });
    expect(s.sql).toBe(" AND e.branch_id = ? AND e.process_id = ? AND e.lob_id = ?");
    expect(s.params).toEqual(["b1", "p1", "l1"]);
    expect(scopeSql({}).sql).toBe("");
    expect(scopeSql({ lob: { kind: "unassigned" } }).sql).toBe(" AND e.lob_id IS NULL");
  });
});
