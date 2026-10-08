/**
 * nocRequired()'s "salary pending" check (2026-08-25).
 *
 * Was `spr.status NOT IN ('disbursed', 'cancelled')` — over-triggered because no run
 * in production is ever marked 'disbursed' (0 of 103, live-verified), so every
 * inactive employee tied to a finalized run read as "salary pending". Confirmed live:
 * 21,127 inactive employees were flagged before this fix, 0 after.
 *
 * Now reuses CLOSED_RUN_STATUSES_SQL (run-status.ts) so an employee tied only to a
 * locked/disbursed/finalized run is correctly NOT flagged, while draft/approved/etc.
 * still correctly blocks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const EMPLOYEE_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { nocRequired } = await import("../noc.service.js");

beforeEach(() => {
  execute.mockReset();
});

function mockInactiveEmployee() {
  execute.mockResolvedValueOnce([[{ employment_status: "Resigned" }]]); // employee lookup
  execute.mockResolvedValueOnce([[]]); // no pending FNF
}

describe("nocRequired — salary-pending run-status check", () => {
  it("does NOT flag salary pending when the employee's only run is finalized", async () => {
    mockInactiveEmployee();
    execute.mockResolvedValueOnce([[]]); // run query: no rows match (finalized excluded)

    const result = await nocRequired(EMPLOYEE_ID);

    expect(result).toEqual({ required: false, reason: null });
    const runQuery = execute.mock.calls[2][0] as string;
    expect(runQuery).toContain("'finalized'");
    expect(runQuery).not.toContain("NOT IN ('disbursed', 'cancelled')");
  });

  it("still flags salary pending when the employee's run is draft (not settled)", async () => {
    mockInactiveEmployee();
    execute.mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-08" }]]);

    const result = await nocRequired(EMPLOYEE_ID);

    expect(result).toEqual({ required: true, reason: "Salary pending for 2026-08" });
  });

  it("returns not-required for an active employee without querying runs at all", async () => {
    execute.mockResolvedValueOnce([[{ employment_status: "active" }]]);

    const result = await nocRequired(EMPLOYEE_ID);

    expect(result).toEqual({ required: false, reason: null });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
