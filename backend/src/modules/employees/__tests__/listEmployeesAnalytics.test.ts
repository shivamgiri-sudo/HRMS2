import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import { employeeService } from "../employee.service.js";

const base = { page: 1, limit: 1, recordStatus: "active" } as any;

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/COUNT\(DISTINCT e\.department_id\)/.test(sql)) return [[{ total_employees: "10", active_employees: "4", inactive_employees: "6", department_count: "3" }], []];
    if (/GROUP BY e\.process_id/.test(sql)) return [[{ process_id: null, process_name: "Unassigned", active_count: "1", inactive_count: "2", total_count: "3" }], []];
    if (/COUNT\(\*\) AS total FROM employees/.test(sql)) return [[{ total: 7 }], []];
    return [[], []];
  });
});

describe("listEmployees analytics", () => {
  it("issues rows, count and both aggregates together and keeps the response shape", async () => {
    const r: any = await employeeService.listEmployees({ ...base, includeAnalytics: true });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(r.total).toBe(7);
    expect(r.stats).toEqual({ total_employees: 10, active_employees: 4, inactive_employees: 6, department_count: 3 });
    expect(r.process_breakdown).toEqual([{ process_id: null, process_name: "Unassigned", active_count: 1, inactive_count: 2, total_count: 3 }]);
    const breakdown = String(execute.mock.calls.find((c) => /GROUP BY e\.process_id/.test(c[0]))![0]);
    expect(breakdown).toMatch(/USE INDEX \(idx_employees_directory_status_process\)/);
  });

  it("does not pin the index when filters are applied, and skips analytics when not requested", async () => {
    await employeeService.listEmployees({ ...base, includeAnalytics: true, branchId: "b1" });
    const breakdown = String(execute.mock.calls.find((c) => /GROUP BY e\.process_id/.test(c[0]))![0]);
    expect(breakdown).not.toMatch(/USE INDEX/);
    execute.mockClear();
    const r: any = await employeeService.listEmployees({ ...base });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(r.stats).toBeUndefined();
  });
});
