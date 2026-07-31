import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `salary_prep_run` carries UNIQUE (run_month, branch_filter, process_filter), but
 * both filter columns are nullable and MySQL treats NULLs as distinct — and all 67
 * production runs have both NULL. So the constraint has never prevented a
 * duplicate, and 2026-07 really does hold two full-company runs with 1,288
 * employees sharing a line in both.
 *
 * Recalculating only the newest left the other line holding pre-change values.
 * These tests lock in that every open run is updated.
 */

const { dbExecute, calculatePayrollRunScoped } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  calculatePayrollRunScoped: vi.fn(),
}));

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: dbExecute },
  pingDb: vi.fn(),
}));
vi.mock("../src/modules/payroll/payrollCalculate.service.js", () => ({
  calculatePayrollRunScoped,
}));

import { recalculateOpenPayrollForEmployee } from "../src/modules/payroll/payroll-targeted-recalculation.service.js";

const BASE = {
  employeeId: "emp-1",
  payrollMonth: "2026-07",
  sourceEventType: "leave_discarded",
  sourceEventId: "lr-1",
  reason: "test",
  actorUserId: "u1",
};

/** Route by SQL text: the run lookup returns `runs`, the queue INSERT succeeds. */
function mockRuns(runs: Array<{ id: string; status: string }>) {
  dbExecute.mockImplementation((sql: string) => {
    if (/FROM salary_prep_run/i.test(sql)) return Promise.resolve([runs, []]);
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

function queuedInserts(): number {
  return dbExecute.mock.calls.filter(([sql]) =>
    /INSERT INTO payroll_recalculation_queue/i.test(String(sql))).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  calculatePayrollRunScoped.mockResolvedValue(undefined);
});

describe("recalculateOpenPayrollForEmployee", () => {
  it("recalculates BOTH open runs when a month has two", async () => {
    mockRuns([
      { id: "run-new", status: "processing" },
      { id: "run-old", status: "processing" },
    ]);

    const res = await recalculateOpenPayrollForEmployee(BASE);

    expect(calculatePayrollRunScoped).toHaveBeenCalledTimes(2);
    expect(calculatePayrollRunScoped.mock.calls.map((c) => c[0]).sort())
      .toEqual(["run-new", "run-old"]);
    // Scoped to just this employee, not the whole run.
    for (const call of calculatePayrollRunScoped.mock.calls) {
      expect(call[2]).toEqual({ employeeIds: ["emp-1"] });
    }
    expect(res.status).toBe("recalculated");
    expect(res.message).toMatch(/across 2 open runs/);
    expect(queuedInserts()).toBe(0);
  });

  it("recalculates the single open run and queues the closed one", async () => {
    mockRuns([
      { id: "run-open", status: "processing" },
      { id: "run-closed", status: "locked" },
    ]);

    const res = await recalculateOpenPayrollForEmployee(BASE);

    expect(calculatePayrollRunScoped).toHaveBeenCalledTimes(1);
    expect(calculatePayrollRunScoped.mock.calls[0][0]).toBe("run-open");
    expect(queuedInserts()).toBe(1);
    expect(res.status).toBe("recalculated");
    expect(res.message).toMatch(/1 closed run\(s\) queued/);
  });

  it("returns 'queued' and recalculates nothing when every run is closed", async () => {
    mockRuns([
      { id: "run-a", status: "locked" },
      { id: "run-b", status: "disbursed" },
    ]);

    const res = await recalculateOpenPayrollForEmployee(BASE);

    expect(calculatePayrollRunScoped).not.toHaveBeenCalled();
    expect(queuedInserts()).toBe(2);
    expect(res.status).toBe("queued");
  });

  it("returns 'no_open_run' when the employee has no line for the month", async () => {
    mockRuns([]);

    const res = await recalculateOpenPayrollForEmployee(BASE);

    expect(calculatePayrollRunScoped).not.toHaveBeenCalled();
    expect(queuedInserts()).toBe(1);
    expect(res.status).toBe("no_open_run");
    expect(res.runId).toBeNull();
  });

  it("no longer caps the run lookup at one row", async () => {
    mockRuns([{ id: "run-1", status: "processing" }]);
    await recalculateOpenPayrollForEmployee(BASE);

    const lookup = dbExecute.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => /FROM salary_prep_run/i.test(sql))!;
    expect(lookup).not.toMatch(/LIMIT\s+1/i);
  });
});
