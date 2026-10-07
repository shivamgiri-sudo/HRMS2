/**
 * listRuns / listLines / listPayrollRecords issue a page query and a COUNT query that do not
 * depend on each other. They are now issued together; the returned shape must not change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { payrollService } from "../payroll.service.js";

let inFlight = 0;
let maxInFlight = 0;
beforeEach(() => {
  execute.mockReset();
  inFlight = 0;
  maxInFlight = 0;
  execute.mockImplementation(async (sql: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (/COUNT\(\*\)/i.test(sql)) return [[{ total: 42 }], []];
    if (/salary_prep_line_component/i.test(sql)) return [[], []];
    return [[{ id: "r1", run_month: "2026-08" }], []];
  });
});

describe("page + count are issued together", () => {
  it("listRuns", async () => {
    const out = await payrollService.listRuns({ page: 2, limit: 10 } as any);
    expect(out).toEqual({
      data: [{ id: "r1", run_month: "2026-08" }],
      total: 42,
      page: 2,
      limit: 10,
    });
    expect(maxInFlight).toBe(2);
    expect(String(execute.mock.calls[0][0])).toMatch(/LIMIT 10 OFFSET 10/);
  });

  it("listLines", async () => {
    const out = await payrollService.listLines("run-1", 1, 50, "abc");
    expect(out.total).toBe(42);
    expect(out.lines).toEqual([{ id: "r1", run_month: "2026-08" }]);
    expect(maxInFlight).toBe(2);
    // page params and count params keep their own placeholder lists
    expect(execute.mock.calls[0][1]).toEqual([
      "run-1",
      "%abc%",
      "%abc%",
      "%abc%",
    ]);
    expect(execute.mock.calls[1][1]).toEqual([
      "run-1",
      "%abc%",
      "%abc%",
      "%abc%",
    ]);
  });

  it("listPayrollRecords", async () => {
    const out = await (payrollService as any).listPayrollRecords({
      page: 1,
      limit: 5,
      runMonth: "2026-08",
      scopeFilter: { sql: "1=1", params: [] },
    });
    expect(out.total).toBe(42);
    expect(out.data).toHaveLength(1);
    expect(out.data[0].earnings).toEqual([]);
    const countCall = execute.mock.calls.find(([s]) =>
      /SELECT COUNT\(\*\) as total/i.test(String(s)),
    )!;
    expect(countCall[1]).toEqual(["2026-08"]);
  });
});
