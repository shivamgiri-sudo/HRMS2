/**
 * A holiday after an employee's last working day is not theirs.
 *
 * The engine had a joining-date exclusion but no leaving-date one, so it wrote a 'holiday'
 * attendance row for days after the employee had gone. The cost-centre sign-off grid and the
 * attendance register count those rows, while payroll resolves holidays from
 * leave_holiday_master (separately bounded) — so the same leaver read 10 salary days on the
 * grid against the 8 payroll pays.
 *
 * August 2026 holidays are the 15th and the 28th, which gives the three cases:
 *   left on the 8th  -> 0 holidays
 *   left on the 17th -> 1 holiday  (the 15th)
 *   left on the 30th -> 2 holidays (both)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../../db/mysql.js";
import { attendanceEngineService } from "../attendance-engine.service.js";

const calls: Array<{ sql: string; params: unknown[] }> = [];

beforeEach(() => {
  calls.length = 0;
  (db as any).execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return [[], []];
  });
  (db as any).query = vi.fn(async () => [[], []]);
});

/** The holiday-eligibility query the override resolver issues. */
const holidayCall = () => calls.find((c) => /leave_holiday_master/i.test(c.sql));

describe("the engine will not grant a holiday after the last working day", () => {
  it("bounds the holiday lookup by the leaving date when there is one", async () => {
    await attendanceEngineService.resolveOverridePriority(
      "emp-1", "2026-08-28", "branch-1", "2024-01-01", null, null, "2026-08-08",
    );
    const c = holidayCall();
    expect(c).toBeDefined();
    // Upper bound present, and carrying the last working day.
    expect(c!.sql).toMatch(/holiday_date\s*<=\s*\?/);
    expect(c!.params).toContain("2026-08-08");
  });

  it("keeps the joining-date exclusion alongside it — both bounds, not one replacing the other", async () => {
    await attendanceEngineService.resolveOverridePriority(
      "emp-1", "2026-08-15", "branch-1", "2026-08-10", null, null, "2026-08-20",
    );
    const c = holidayCall()!;
    expect(c.sql).toMatch(/holiday_date\s*>=\s*\?/);
    expect(c.sql).toMatch(/holiday_date\s*<=\s*\?/);
    expect(c.params).toContain("2026-08-10");
    expect(c.params).toContain("2026-08-20");
  });

  it("applies no upper bound for someone still employed", async () => {
    await attendanceEngineService.resolveOverridePriority(
      "emp-1", "2026-08-28", "branch-1", "2024-01-01", null, null, null,
    );
    const c = holidayCall()!;
    expect(c.sql).not.toMatch(/holiday_date\s*<=\s*\?/);
  });

  it("normalises a datetime end date to its date part", async () => {
    // mysql2 can hand a DATE back as a full timestamp; comparing that to a DATE column as a
    // string would silently exclude the last working day itself.
    await attendanceEngineService.resolveOverridePriority(
      "emp-1", "2026-08-15", "branch-1", "2024-01-01", null, null, "2026-08-15T18:30:00.000Z",
    );
    expect(holidayCall()!.params).toContain("2026-08-15");
  });
});

describe("the three cases, as the rule is stated", () => {
  // The bound is a SQL predicate, so the assertion is on the value handed to it: a holiday
  // qualifies when holiday_date <= last working day.
  const AUG_HOLIDAYS = ["2026-08-15", "2026-08-28"];
  const granted = (lastWorkingDay: string) =>
    AUG_HOLIDAYS.filter((h) => h <= lastWorkingDay).length;

  it("left on the 8th -> 0 holidays", () => expect(granted("2026-08-08")).toBe(0));
  it("left on the 17th -> 1 holiday", () => expect(granted("2026-08-17")).toBe(1));
  it("left on the 30th -> 2 holidays", () => expect(granted("2026-08-30")).toBe(2));
});
