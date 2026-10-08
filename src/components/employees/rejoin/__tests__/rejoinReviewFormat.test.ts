import { describe, expect, it } from "vitest";
import {
  DASH,
  attendanceSeries,
  eligibilityLabel,
  eligibilityTone,
  fmtDate,
  fmtInr,
  fmtMonth,
  fmtNum,
  fmtPct,
  fmtTenure,
  humanize,
  initials,
  monthAttendancePct,
  plural,
  ratingLabel,
  ratingTone,
  requestStatusLabel,
  roleLabel,
  severityTone,
} from "../rejoinReviewFormat";
import type { AttendanceMonth } from "../rejoinTypes";

const month = (over: Partial<AttendanceMonth> = {}): AttendanceMonth => ({
  month: "2026-03",
  workingDays: 20,
  present: 18,
  halfDay: 0,
  absent: 2,
  leave: 0,
  missingPunch: 0,
  lateMarks: 0,
  lopDays: 0,
  lateMinutes: 0,
  ...over,
});

describe("fmtDate (string math, no timezone shift)", () => {
  it("formats a YYYY-MM-DD date without moving the day", () => {
    expect(fmtDate("2026-03-01")).toBe("01 Mar 2026");
    expect(fmtDate("2026-12-31")).toBe("31 Dec 2026");
  });
  it("uses the date part of an ISO timestamp as written", () => {
    expect(fmtDate("2026-10-03T23:30:00.000Z")).toBe("03 Oct 2026");
  });
  it("returns a dash for null, blank, garbage and out-of-range parts", () => {
    expect(fmtDate(null)).toBe(DASH);
    expect(fmtDate(undefined)).toBe(DASH);
    expect(fmtDate("")).toBe(DASH);
    expect(fmtDate("not a date")).toBe(DASH);
    expect(fmtDate("2026-13-01")).toBe(DASH);
    expect(fmtDate("2026-02-00")).toBe(DASH);
    expect(fmtDate("2026-02-32")).toBe(DASH);
  });
});

describe("fmtMonth", () => {
  it("short and long forms", () => {
    expect(fmtMonth("2026-03")).toBe("Mar 26");
    expect(fmtMonth("2026-03", true)).toBe("Mar 2026");
    expect(fmtMonth("2025-12-15", true)).toBe("Dec 2025");
  });
  it("dash for null and bad months", () => {
    expect(fmtMonth(null)).toBe(DASH);
    expect(fmtMonth("2026-00")).toBe(DASH);
  });
});

describe("fmtPct", () => {
  it("never turns null into 0%", () => {
    expect(fmtPct(null)).toBe(DASH);
    expect(fmtPct(undefined)).toBe(DASH);
    expect(fmtPct(Number.NaN)).toBe(DASH);
  });
  it("keeps a real zero and trims trailing zeros", () => {
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(95)).toBe("95%");
    expect(fmtPct(92.345)).toBe("92.3%");
    expect(fmtPct(92.345, 0)).toBe("92%");
  });
});

describe("fmtNum", () => {
  it("Indian grouping and a dash for null", () => {
    expect(fmtNum(1234567)).toBe("12,34,567");
    expect(fmtNum(2.25)).toBe("2.3");
    expect(fmtNum(null)).toBe(DASH);
  });
});

describe("fmtInr", () => {
  it("rupees with Indian grouping, no paise", () => {
    expect(fmtInr(123456.6)).toBe("₹1,23,457");
    expect(fmtInr(0)).toBe("₹0");
  });
  it("puts the minus sign before the rupee symbol and never shows -0", () => {
    expect(fmtInr(-1500)).toBe("-₹1,500");
    expect(fmtInr(-0.4)).toBe("₹0");
  });
  it("dash for null", () => {
    expect(fmtInr(null)).toBe(DASH);
    expect(fmtInr(undefined)).toBe(DASH);
  });
});

describe("fmtTenure", () => {
  it("years and months", () => {
    expect(fmtTenure(27)).toBe("2 yr 3 mo");
    expect(fmtTenure(24)).toBe("2 yr");
    expect(fmtTenure(5)).toBe("5 mo");
    expect(fmtTenure(0)).toBe("0 mo");
  });
  it("rounds before splitting so it never shows 12 mo", () => {
    expect(fmtTenure(23.6)).toBe("2 yr");
  });
  it("dash for null or negative", () => {
    expect(fmtTenure(null)).toBe(DASH);
    expect(fmtTenure(-1)).toBe(DASH);
  });
});

describe("labels", () => {
  it("humanize", () => {
    expect(humanize("termination_misconduct")).toBe("Termination misconduct");
    expect(humanize("  ")).toBe(DASH);
    expect(humanize(null)).toBe(DASH);
  });
  it("plural and initials", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(3, "day")).toBe("3 days");
    expect(initials("asha kumari singh")).toBe("AK");
    expect(initials("")).toBe("?");
  });
  it("rating, eligibility, request status and role labels", () => {
    expect(ratingLabel("insufficient_data")).toBe("Insufficient data");
    expect(ratingLabel("strong")).toBe("Strong");
    expect(eligibilityLabel("review")).toBe("Needs review");
    expect(eligibilityLabel("blocked")).toBe("Blocked");
    expect(requestStatusLabel("pending")).toBe("Pending branch head");
    expect(requestStatusLabel("branch_head_approved")).toBe("Awaiting final decision (old process)");
    expect(requestStatusLabel("something_else")).toBe("Something else");
    expect(roleLabel("branch_head")).toBe("Branch head");
    expect(roleLabel(null)).toBe("Unknown role");
  });
  it("tones", () => {
    expect(ratingTone("strong")).toBe("good");
    expect(ratingTone("weak")).toBe("bad");
    expect(ratingTone("average")).toBe("warn");
    expect(ratingTone("insufficient_data")).toBe("neutral");
    expect(eligibilityTone("eligible")).toBe("good");
    expect(eligibilityTone("blocked")).toBe("bad");
    expect(eligibilityTone("review")).toBe("warn");
  });
  it("warning severity (employee_warning: verbal / written / final)", () => {
    expect(severityTone("final")).toBe("bad");
    expect(severityTone("written")).toBe("warn");
    expect(severityTone("verbal")).toBe("neutral");
    expect(severityTone(null)).toBe("neutral");
  });
});

describe("monthAttendancePct (same formula as the backend total)", () => {
  it("(present + 0.5 x half day + leave) / working days x 100", () => {
    expect(monthAttendancePct(month({ workingDays: 20, present: 16, halfDay: 2, leave: 1 }))).toBe(90);
    expect(monthAttendancePct(month({ workingDays: 22, present: 20, halfDay: 1, leave: 0 }))).toBe(93.2);
  });
  it("caps at 100", () => {
    expect(monthAttendancePct(month({ workingDays: 10, present: 10, leave: 2 }))).toBe(100);
  });
  it("is a real 0 when every working day was absent", () => {
    expect(monthAttendancePct(month({ workingDays: 20, present: 0, absent: 20 }))).toBe(0);
  });
  it("is a gap (null), not 0%, when the month had no working days", () => {
    expect(monthAttendancePct(month({ workingDays: 0, present: 0, absent: 0 }))).toBeNull();
  });
  it("matches the backend total formula (dossier.attendance.ts) for every small month", () => {
    // Verbatim copy of the backend: Math.min(100, round1(pct)) with round1 from dossierTypes.ts.
    const round1 = (n: number) => Math.round(n * 10 + Number.EPSILON * 10) / 10;
    const backend = (p: number, h: number, l: number, wd: number) => Math.min(100, round1(((p + 0.5 * h + l) / wd) * 100));
    for (let wd = 1; wd <= 31; wd++) {
      for (let p = 0; p <= wd; p += 3) {
        for (let h = 0; p + h <= wd; h += 2) {
          for (let l = 0; p + h + l <= wd + 2; l += 1) {
            expect(monthAttendancePct(month({ workingDays: wd, present: p, halfDay: h, leave: l }))).toBe(backend(p, h, l, wd));
          }
        }
      }
    }
  });
});

describe("attendanceSeries (12-month chart with gaps)", () => {
  const windowMonths = ["2026-01", "2026-02", "2026-03", "2026-04"];
  it("has one point per window month, null for months with no records or no working days", () => {
    const s = attendanceSeries(
      [month({ month: "2026-02", workingDays: 20, present: 20, absent: 0 }), month({ month: "2026-04", workingDays: 0, present: 0, absent: 0 })],
      windowMonths,
    );
    expect(s.map((p) => p.month)).toEqual(windowMonths);
    expect(s.map((p) => p.pct)).toEqual([null, 100, null, null]);
    expect(s[0]!.label).toBe("Jan 26");
    expect(s[0]!.row).toBeNull();
    expect(s[1]!.row?.present).toBe(20);
  });
  it("falls back to the backend months when no window is given, and keeps months outside the window", () => {
    const s = attendanceSeries([month({ month: "2025-12" }), month({ month: "2026-01" })]);
    expect(s.map((p) => p.month)).toEqual(["2025-12", "2026-01"]);
    const outside = attendanceSeries([month({ month: "2025-11" })], ["2026-01"]);
    expect(outside.map((p) => p.month)).toEqual(["2025-11", "2026-01"]);
  });
});
