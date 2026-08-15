import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Two defects that made the minimum-rest guard inert, found 2026-08-16 while running the
 * Rule 11 threshold impact simulation.
 *
 * 1. IT COULD NOT SEE THE REAL ROSTER.
 *    findAdjacentShifts filtered on shift_start_time / shift_end_time being non-NULL. In
 *    production all 1,354 cycle-bound assignments carry BOTH as NULL and hold their times only
 *    in shift_template_id. The 412,032 rows that do populate those columns are a synthetic
 *    single-window backfill (every one of them 09:00-18:00, created in one batch, no employee
 *    ever changing shift). So the guard evaluated seed data and silently skipped every genuine
 *    assignment - a NULL time just filtered the row out and the employee looked like they had
 *    no neighbouring shift at all.
 *
 * 2. IT COULD NOT SEE NIGHT SHIFTS.
 *    The previous shift's end was dated on its own roster_date, so a 21:00-06:00 shift was
 *    treated as finishing at 06:00 that MORNING - about 24 hours before it really did. Every
 *    gap following a night shift was overstated by roughly a day and could never breach any
 *    threshold. 10 of the 23 configured shift templates cross midnight and 202 employees are
 *    on 21:00-06:00 alone: night workers are precisely who a rest rule protects, and they were
 *    precisely who it could not see.
 *
 * Together these are why the impact simulation reported zero violations at 8h, 10h, 11h and
 * 12h across 410,640 shift pairs. That was not a safe roster; it was a blind guard.
 */

const { execute, getConnection } = vi.hoisted(() => {
  const lockConn = { execute: vi.fn(), query: vi.fn(), release: vi.fn() };
  return { execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(lockConn) };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const { findAdjacentShifts, restGapMinutes, shiftEndDate, validateMinimumRest } = await import(
  "../rest-policy.service.js"
);

const policyRow = (over: Record<string, unknown> = {}) => ({
  id: "pol-1",
  scope_type: "organization",
  scope_id: null,
  minimum_rest_minutes: 660,
  allows_emergency_override: 0,
  ...over,
});

beforeEach(() => execute.mockReset());

describe("shiftEndDate - a shift that runs past midnight ends the next day", () => {
  it("rolls the date for a night shift", () => {
    expect(shiftEndDate("2026-08-17", "21:00", "06:00")).toBe("2026-08-18");
    expect(shiftEndDate("2026-08-17", "22:00", "07:00")).toBe("2026-08-18");
  });

  it("leaves a day shift on its own date", () => {
    expect(shiftEndDate("2026-08-17", "09:00", "18:00")).toBe("2026-08-17");
  });

  it("treats an exactly-24h shift as ending the next day", () => {
    expect(shiftEndDate("2026-08-17", "09:00", "09:00")).toBe("2026-08-18");
  });

  it("rolls across a month boundary", () => {
    expect(shiftEndDate("2026-08-31", "21:00", "06:00")).toBe("2026-09-01");
  });

  it("rolls across a year boundary", () => {
    expect(shiftEndDate("2026-12-31", "22:00", "07:00")).toBe("2027-01-01");
  });
});

describe("the guard reads times from the shift template when the snapshot is NULL", () => {
  it("resolves a template-only assignment instead of ignoring it", async () => {
    // The production shape: snapshot columns NULL, times only on the template.
    execute.mockImplementation(async (rawSql?: unknown) => {
      const sql = String(rawSql ?? "");
      if (sql.includes("roster_date < ?")) {
        return [[{ roster_date: "2026-08-16", start_time: "13:00:00", end_time: "22:00:00" }], []];
      }
      return [[], []];
    });
    const { previous } = await findAdjacentShifts("emp-1", "2026-08-17");
    expect(previous).toEqual({ date: "2026-08-16", time: "22:00" });
  });

  it("asks the database to COALESCE the snapshot with the template", async () => {
    execute.mockResolvedValue([[], []]);
    await findAdjacentShifts("emp-1", "2026-08-17");
    const sql = execute.mock.calls.map(([s]) => String(s)).join("\n");
    expect(sql).toMatch(/COALESCE\(a\.shift_end_time,\s*t\.end_time\)/);
    expect(sql).toMatch(/LEFT JOIN wfm_shift_template/);
  });

  it("dates a night shift's end on the following morning", async () => {
    execute.mockImplementation(async (rawSql?: unknown) => {
      const sql = String(rawSql ?? "");
      if (sql.includes("roster_date < ?")) {
        return [[{ roster_date: "2026-08-16", start_time: "21:00:00", end_time: "06:00:00" }], []];
      }
      return [[], []];
    });
    const { previous } = await findAdjacentShifts("emp-1", "2026-08-17");
    // Not 2026-08-16: the shift began on the 16th and finished on the 17th.
    expect(previous).toEqual({ date: "2026-08-17", time: "06:00" });
  });
});

describe("rest after a night shift is now measured, not waved through", () => {
  it("catches a 21:00-06:00 shift followed by a 13:00 start the same day", async () => {
    // Real rest is 06:00 -> 13:00 = 7h. Dating the end on the 16th made it look like 31h.
    execute.mockImplementation(async (rawSql?: unknown) => {
      const sql = String(rawSql ?? "");
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[policyRow({ minimum_rest_minutes: 660 })], []];
      if (sql.includes("roster_date < ?")) {
        return [[{ roster_date: "2026-08-16", start_time: "21:00:00", end_time: "06:00:00" }], []];
      }
      return [[], []];
    });

    const result: any = await validateMinimumRest(
      { employeeId: "emp-1", forDate: "2026-08-17" },
      { startTime: "13:00", endTime: "22:00" }
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_REST");
    expect(result.against).toBe("previous");
    expect(result.actualRestMinutes).toBe(7 * 60);
  });

  it("measures the NEXT shift against a candidate that itself crosses midnight", async () => {
    // Candidate 22:00-07:00 on the 17th ends 07:00 on the 18th; next starts 14:00 that day = 7h.
    execute.mockImplementation(async (rawSql?: unknown) => {
      const sql = String(rawSql ?? "");
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[policyRow({ minimum_rest_minutes: 660 })], []];
      if (sql.includes("roster_date > ?")) return [[{ roster_date: "2026-08-18", start_time: "14:00:00" }], []];
      return [[], []];
    });

    const result: any = await validateMinimumRest(
      { employeeId: "emp-1", forDate: "2026-08-17" },
      { startTime: "22:00", endTime: "07:00" }
    );
    expect(result.ok).toBe(false);
    expect(result.against).toBe("next");
    expect(result.actualRestMinutes).toBe(7 * 60);
  });

  it("still passes a genuine 11h break after a night shift", async () => {
    // 21:00-06:00 on the 16th ends 06:00 on the 17th; next starts 17:00 = 11h exactly.
    execute.mockImplementation(async (rawSql?: unknown) => {
      const sql = String(rawSql ?? "");
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[policyRow({ minimum_rest_minutes: 660 })], []];
      if (sql.includes("roster_date < ?")) {
        return [[{ roster_date: "2026-08-16", start_time: "21:00:00", end_time: "06:00:00" }], []];
      }
      return [[], []];
    });

    const result: any = await validateMinimumRest(
      { employeeId: "emp-1", forDate: "2026-08-17" },
      { startTime: "17:00", endTime: "02:00" }
    );
    expect(result.ok).toBe(true);
  });
});

describe("restGapMinutes stays a pure function of two instants", () => {
  it("spans a month boundary", () => {
    expect(restGapMinutes({ date: "2026-08-31", time: "22:00" }, { date: "2026-09-01", time: "06:00" })).toBe(480);
  });
});
