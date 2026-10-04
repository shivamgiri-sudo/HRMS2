import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { resolveHolidaysForEmployeeV2 } = await import("../holiday-work.service.js");

const rows = (r: unknown[]) => [r, []];

/**
 * Query order inside resolveHolidaysForEmployeeV2: employee master, holidays in the month,
 * (a mandatory-work lookup per holiday ONLY when the employee has a branch or process id --
 * this employee has neither), then the holiday-work extra payout.
 */
function mockQueries() {
  execute.mockReset();
  execute
    .mockResolvedValueOnce(rows([{
      date_of_joining: "2024-01-15", salary_start_date: null, branch_id: null,
      process_id: null, cost_centre_id: null, designation_id: null, employment_end_date: null,
    }]))
    .mockResolvedValueOnce(rows([
      { id: "h1", holiday_date: "2026-09-05", holiday_type: "national", active_status: 1 },
      { id: "h2", holiday_date: "2026-09-15", holiday_type: "national", active_status: 1 },
    ]))
    .mockResolvedValueOnce(rows([{ extra_payout: 0 }]));
}

const RANGES = [{ from: "2026-09-01", to: "2026-09-10" }, { from: "2026-09-20", to: "2026-09-30" }];

beforeEach(() => execute.mockReset());

describe("resolveHolidaysForEmployeeV2 with employed ranges", () => {
  it("without ranges both holidays count (unchanged)", async () => {
    mockQueries();
    const r = await resolveHolidaysForEmployeeV2("e1", "2026-09");
    expect(r.eligibleHolidayCount).toBe(2);
    expect(r.eligibleHolidayDates.map((d) => String(d).slice(0, 10))).toEqual(["2026-09-05", "2026-09-15"]);
  });

  it("with ranges, the holiday inside the gap (Sep 15) is dropped, Sep 5 stays", async () => {
    mockQueries();
    const r = await resolveHolidaysForEmployeeV2("e1", "2026-09", RANGES);
    expect(r.eligibleHolidayCount).toBe(1);
    expect(r.eligibleHolidayDates.map((d) => String(d).slice(0, 10))).toEqual(["2026-09-05"]);
  });

  it("with ranges covering the whole month nothing is dropped", async () => {
    mockQueries();
    const r = await resolveHolidaysForEmployeeV2("e1", "2026-09", [{ from: "2026-09-01", to: "2026-09-30" }]);
    expect(r.eligibleHolidayCount).toBe(2);
  });
});
