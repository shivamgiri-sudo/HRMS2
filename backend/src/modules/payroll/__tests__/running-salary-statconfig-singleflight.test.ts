/**
 * The running-summary batch computes many employees at once and each re-read statutory_config for
 * the same month. Overlapping callers now share one in-flight load (dropped on settle, so never
 * stale) and each gets its own copy of the map.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, loadFlatStatutoryConfig, calculateNetSalary } = vi.hoisted(() => ({
  execute: vi.fn(),
  loadFlatStatutoryConfig: vi.fn(),
  calculateNetSalary: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../holiday-work.service.js", () => ({
  resolveHolidaysForEmployeeV2: vi.fn().mockResolvedValue({ eligibleHolidayDates: [] }),
}));
vi.mock("../weekoff-eligibility.service.js", () => ({ calculateWeekoffEligibility: vi.fn().mockResolvedValue(0) }));
vi.mock("../payroll.service.js", () => ({ payrollService: { calculateNetSalary } }));
vi.mock("../payrollCalculate.service.js", () => ({ getPtFromSlab: vi.fn().mockResolvedValue(0) }));
vi.mock("../statutory-config.loader.js", () => ({ loadFlatStatutoryConfig }));

import { computeRunningSalary } from "../running-salary.service.js";

beforeEach(() => {
  execute.mockReset();
  loadFlatStatutoryConfig.mockReset();
  calculateNetSalary.mockReset();
  calculateNetSalary.mockReturnValue({ net_salary: 0, pf_employee: 0, esic_employee: 0, professional_tax: 0 });
  execute.mockImplementation(async (sql: string) => {
    if (/FROM employees e\s+JOIN employee_salary_assignment/i.test(sql))
      return [[{ branch_id: "b", process_id: "p", ctc_annual: 1, structure_id: "s", state_code: null }], []];
    return [[], []];
  });
});

describe("statutory config in the running-salary batch", () => {
  it("shares one load between overlapping employees and does not cache after it settles", async () => {
    let release!: (v: Record<string, number>) => void;
    loadFlatStatutoryConfig.mockImplementation(() => new Promise((r) => { release = r; }));
    const runs = Promise.all(["e1", "e2", "e3"].map((id) => computeRunningSalary(id, "2026-08-01", "2026-08-10")));
    await new Promise((r) => setTimeout(r, 20));
    expect(loadFlatStatutoryConfig).toHaveBeenCalledTimes(1);
    release({ pf_employee_pct: 12 });
    await runs;
    // settled -> a later call must query again (no stale cache)
    loadFlatStatutoryConfig.mockResolvedValue({ pf_employee_pct: 13 });
    await computeRunningSalary("e4", "2026-08-01", "2026-08-10");
    expect(loadFlatStatutoryConfig).toHaveBeenCalledTimes(2);
    expect(calculateNetSalary.mock.calls.at(-1)![0].pfEmployeePct).toBe(13);
  });
});
