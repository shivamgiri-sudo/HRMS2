import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute, dbQuery, processEmployee, upsertDailyRecord } = vi.hoisted(() => ({
  dbExecute: vi.fn(), dbQuery: vi.fn(), processEmployee: vi.fn(), upsertDailyRecord: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbQuery } }));
vi.mock("../attendance-engine.service.js", () => ({ attendanceEngineService: { processEmployee, upsertDailyRecord } }));

import { payrollStartedMonths, regradeAprChanges } from "../apr-sync-regrade.service.js";

describe("re-grading days whose APR arrived late", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processEmployee.mockImplementation(async (id: string, date: string) => ({ employeeId: id, date }));
    upsertDailyRecord.mockResolvedValue({});
  });

  it("treats any non-rejected payroll run as freezing its month", () => {
    const m = payrollStartedMonths([
      { month: "2026-09", status: "processing" },
      { month: "2026-08", status: "finalized" },
      { month: "2026-10", status: "cancelled" },
    ]);
    expect([...m].sort()).toEqual(["2026-08", "2026-09"]);
  });

  it("re-grades unlocked past days, skips locked ones, today, and payroll-started months", async () => {
    dbExecute.mockResolvedValue([[{ month: "2026-09", status: "processing" }], []]);
    dbQuery.mockResolvedValue([[{ employee_id: "e1", is_locked: 0 }, { employee_id: "e2", is_locked: 1 }], []]);
    const changes = new Map([
      ["2026-09-29", new Set(["MAS1"])],
      ["2026-10-02", new Set(["MAS1", "MAS2", "MAS3"])],
      ["2026-10-05", new Set(["MAS1"])],
    ]);

    const r = await regradeAprChanges(changes, "2026-10-05");

    expect(r).toEqual({ regraded: 1, skippedPayroll: 1, skippedLocked: 1, noRecord: 1, failed: 0 });
    expect(processEmployee).toHaveBeenCalledTimes(1);
    expect(processEmployee).toHaveBeenCalledWith("e1", "2026-10-02");
    expect(upsertDailyRecord).toHaveBeenCalledWith({ employeeId: "e1", date: "2026-10-02" }, "apr-sync-regrade");
    expect(dbQuery).toHaveBeenCalledTimes(1); // only 2026-10-02 reached the record lookup
  });

  it("does nothing when no APR changed", async () => {
    const r = await regradeAprChanges(new Map(), "2026-10-05");
    expect(r.regraded).toBe(0);
    expect(dbExecute).not.toHaveBeenCalled();
  });
});
