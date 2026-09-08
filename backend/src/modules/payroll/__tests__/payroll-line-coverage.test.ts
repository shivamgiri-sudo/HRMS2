import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The gate that stops a payroll being signed off while somebody who worked is missing from it.
 *
 * Each of the three gaps below is a real production incident, not a hypothetical:
 *   no_line                   — 43 employees eligible for 2026-08 held no line; 25 had worked
 *   no_salary_structure       — 9 people worked 27 days in August with no salary ever recorded
 *   zero_paid_with_attendance — 63 lines in the LOCKED 2026-07 run pay Rs 0 against 292 days
 *
 * The bar these tests hold: the check must ask the same question the ENGINE asks about who
 * belongs in a run, and a gap with real attendance behind it must not pass silently.
 */

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { getRunLineCoverage } = await import("../payroll-line-coverage.service.js");
const { employmentWindowPredicate } = await import("../employment-end-date.js");

const RUN = "run-1";
const rows = (r: unknown[]) => [r, []];

/** Queries fire in a fixed order: run header, line count, then the three gap queries. */
function mockQueries(opts: {
  noLine?: unknown[];
  noSalary?: unknown[];
  zeroPaid?: unknown[];
  lines?: number;
} = {}) {
  execute.mockReset();
  execute
    .mockResolvedValueOnce(rows([{ id: RUN, run_month: "2026-08" }]))
    .mockResolvedValueOnce(rows([{ n: opts.lines ?? 1188 }]))
    .mockResolvedValueOnce(rows(opts.noLine ?? []))
    .mockResolvedValueOnce(rows(opts.noSalary ?? []))
    .mockResolvedValueOnce(rows(opts.zeroPaid ?? []));
}

beforeEach(() => execute.mockReset());

describe("the eligibility question is the engine's, not a private copy", () => {
  it("selects missing lines with employmentWindowPredicate(), so a leaver rule change reaches it", async () => {
    mockQueries();
    await getRunLineCoverage(RUN);
    const noLineSql = String(execute.mock.calls[2][0]);
    expect(noLineSql).toContain(employmentWindowPredicate().trim().slice(0, 60));
  });

  it("resolves the salary assignment point-in-time, not by active_status", async () => {
    // A leaver's assignment is deactivated when they go. Joining on the live flag would drop the
    // very people this looks for and misfile them as having no salary at all.
    mockQueries();
    await getRunLineCoverage(RUN);
    const noLineSql = String(execute.mock.calls[2][0]);
    expect(noLineSql).toContain("effective_from <= LAST_DAY");
  });
});

describe("gap 1 — eligible, no line (the 2026-08 mid-month leavers)", () => {
  it("reports a leaver who worked and holds no line, and refuses to call the run clean", async () => {
    mockQueries({ noLine: [{ id: "e1", employee_code: "MAS60144", end_date: "2026-08-17", days: 19 }] });
    const out = await getRunLineCoverage(RUN);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0].kind).toBe("no_line");
    expect(out.gaps[0].employmentEndDate).toBe("2026-08-17");
    expect(out.gaps[0].detail).toContain("recalculate");
    expect(out.unpaidAttendanceDays).toBe(19);
    expect(out.clean).toBe(false);
  });
});

describe("gap 2 — worked with no resolvable salary (the 9 August joiners)", () => {
  it("names the fix as HR assigning a structure, not a recalculation", async () => {
    mockQueries({ noSalary: [{ id: "e2", employee_code: "MAS63408", end_date: null, days: 6 }] });
    const out = await getRunLineCoverage(RUN);
    expect(out.gaps[0].kind).toBe("no_salary_structure");
    expect(out.gaps[0].detail).toContain("HR assigns one");
    expect(out.clean).toBe(false);
  });

  it("treats a zero-CTC assignment as no salary — it resolves, then pays nothing", async () => {
    mockQueries();
    await getRunLineCoverage(RUN);
    expect(String(execute.mock.calls[3][0])).toContain("COALESCE(s.ctc_annual, 0) > 0");
  });
});

describe("gap 3 — line pays zero against recorded attendance (the locked 2026-07 run)", () => {
  it("catches the case where every count reconciles and only the amount is wrong", async () => {
    mockQueries({
      zeroPaid: [{ id: "e3", employee_code: "MAS61476", end_date: null, days: 17.5, attendance_data_source: "NO_DATA" }],
    });
    const out = await getRunLineCoverage(RUN);
    expect(out.gaps[0].kind).toBe("zero_paid_with_attendance");
    expect(out.gaps[0].detail).toContain("NO_DATA");
    expect(out.gaps[0].detail).toContain("before the run closes");
    expect(out.unpaidAttendanceDays).toBe(17.5);
  });
});

describe("what counts as clean", () => {
  it("a gap with no attendance behind it does not block a correct payroll", async () => {
    // A leaver with no line and no days worked is a records question. Blocking sign-off on it
    // would train people to acknowledge the warning by reflex, which is worse than not having it.
    mockQueries({ noLine: [{ id: "e4", employee_code: "MAS63272", end_date: "2026-08-06", days: 0 }] });
    const out = await getRunLineCoverage(RUN);
    expect(out.gaps).toHaveLength(1);
    expect(out.gapsWithAttendance).toBe(0);
    expect(out.clean).toBe(true);
  });

  it("sums unpaid days across all three gap kinds", async () => {
    mockQueries({
      noLine: [{ id: "a", employee_code: "A", end_date: "2026-08-18", days: 12 }],
      noSalary: [{ id: "b", employee_code: "B", end_date: null, days: 6 }],
      zeroPaid: [{ id: "c", employee_code: "C", end_date: null, days: 2.5, attendance_data_source: "ADR" }],
    });
    const out = await getRunLineCoverage(RUN);
    expect(out.gapsWithAttendance).toBe(3);
    expect(out.unpaidAttendanceDays).toBe(20.5);
    expect(out.clean).toBe(false);
  });

  it("counts an employee once when they satisfy two gaps, keeping the fix that comes first", async () => {
    // Live case MAS63411: a zero-CTC assignment resolves in the salary join, so they read as
    // "eligible, no line" AND as "no salary". Counted twice, both the headcount and the unpaid
    // days inflate — and "recalculate the run" would do nothing for them.
    mockQueries({
      noLine: [{ id: "dup", employee_code: "MAS63411", end_date: "2026-09-07", days: 1 }],
      noSalary: [{ id: "dup", employee_code: "MAS63411", end_date: "2026-09-07", days: 1 }],
    });
    const out = await getRunLineCoverage(RUN);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0].kind).toBe("no_salary_structure");
    expect(out.gapsWithAttendance).toBe(1);
    expect(out.unpaidAttendanceDays).toBe(1);
  });

  it("orders gaps by unpaid days, so the costliest is read first", async () => {
    mockQueries({
      noLine: [{ id: "a", employee_code: "A", end_date: null, days: 2 }],
      zeroPaid: [{ id: "b", employee_code: "B", end_date: null, days: 17.5, attendance_data_source: "NO_DATA" }],
    });
    const out = await getRunLineCoverage(RUN);
    expect(out.gaps.map((g) => g.employeeCode)).toEqual(["B", "A"]);
  });

  it("a run with nobody missing is clean", async () => {
    mockQueries();
    const out = await getRunLineCoverage(RUN);
    expect(out.clean).toBe(true);
    expect(out.gaps).toHaveLength(0);
    expect(out.linesInRun).toBe(1188);
  });
});

describe("attendance evidence", () => {
  it("counts present and half-day only — never the roster", async () => {
    mockQueries();
    await getRunLineCoverage(RUN);
    const sql = String(execute.mock.calls[2][0]);
    expect(sql).toContain("'present'");
    expect(sql).toContain("'half_day'");
    expect(sql).not.toContain("wfm_roster_assignment");
  });

  it("counts a half day as half an unpaid day", async () => {
    mockQueries({ zeroPaid: [{ id: "h", employee_code: "H", end_date: null, days: 0.5, attendance_data_source: "ADR" }] });
    const out = await getRunLineCoverage(RUN);
    expect(out.unpaidAttendanceDays).toBe(0.5);
    expect(out.clean).toBe(false);
  });
});

describe("unknown run", () => {
  it("404s rather than reporting an empty, clean coverage", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce(rows([]));
    await expect(getRunLineCoverage("nope")).rejects.toMatchObject({ statusCode: 404 });
  });
});
