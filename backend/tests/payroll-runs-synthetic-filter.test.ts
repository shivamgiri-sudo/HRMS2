import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A Jul-2026 payroll run written directly into salary_prep_run by 'test-auto-gen'
 * sits beside the real one and renders identically in the runs list — same month,
 * same "processing" status, 1,288 lines, INR 1.22 Cr net. The CEO UAT of
 * 31-Jul-2026 reported "Jul 2026 - processing" appearing twice with no way to
 * tell which was real.
 *
 * listRuns had no DISTINCT or GROUP BY on run_month, so both rows came back.
 * These tests pin the filter, and pin what it must NOT do: hide real runs.
 */

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn() },
  pingDb: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { payrollService } from "../src/modules/payroll/payroll.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;

/** Capture the SELECT (not the COUNT) that listRuns issues. */
function captured() {
  const call = exec.mock.calls.find(([sql]) => /SELECT \* FROM salary_prep_run/i.test(String(sql)));
  return { sql: String(call?.[0] ?? ""), params: (call?.[1] ?? []) as unknown[] };
}

beforeEach(() => {
  exec.mockReset();
  exec.mockResolvedValue([[], []]);
});

describe("listRuns — synthetic run filter", () => {
  it("excludes runs created by test-auto-gen", async () => {
    await payrollService.listRuns({ page: 1, limit: 20 } as any);
    const { sql, params } = captured();
    expect(sql).toMatch(/created_by NOT IN/i);
    expect(params).toContain("test-auto-gen");
  });

  it("keeps runs whose created_by is NULL", async () => {
    // Older real runs predate the column being populated. `NOT IN` alone is NULL
    // in SQL three-valued logic, which would silently drop every one of them.
    await payrollService.listRuns({ page: 1, limit: 20 } as any);
    expect(captured().sql).toMatch(/created_by IS NULL OR created_by NOT IN/i);
  });

  it("still applies the caller's month and status filters", async () => {
    await payrollService.listRuns({ page: 1, limit: 20, runMonth: "2026-07", status: "processing" } as any);
    const { sql, params } = captured();
    expect(sql).toMatch(/run_month = \?/);
    expect(sql).toMatch(/status = \?/);
    // Order matters: month, status, then the synthetic-creator list.
    expect(params).toEqual(["2026-07", "processing", "test-auto-gen"]);
  });

  it("applies the same filter to the COUNT, so pagination totals agree", async () => {
    await payrollService.listRuns({ page: 1, limit: 20 } as any);
    const countCall = exec.mock.calls.find(([sql]) => /COUNT\(\*\)/i.test(String(sql)));
    expect(String(countCall?.[0])).toMatch(/created_by NOT IN/i);
    expect(countCall?.[1]).toContain("test-auto-gen");
  });

  it("short-circuits before the filter when scope denies all access", async () => {
    const res = await payrollService.listRuns({
      page: 1, limit: 20, scopeFilter: { sql: "1=0", params: [] },
    } as any);
    expect(res).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    expect(exec).not.toHaveBeenCalled();
  });

  it("composes with a row-scope filter rather than replacing it", async () => {
    await payrollService.listRuns({
      page: 1, limit: 20,
      scopeFilter: { sql: "spr.branch_id = ?", params: ["branch-1"] },
    } as any);
    const { sql, params } = captured();
    expect(sql).toMatch(/spr\.branch_id = \?/);
    expect(sql).toMatch(/created_by NOT IN/i);
    // The synthetic filter is appended before the scope block, so its parameter
    // comes first. What matters is that conds and params are pushed in lockstep,
    // so placeholder N still binds to params[N].
    expect(params).toEqual(["test-auto-gen", "branch-1"]);
  });

  it("hides only the one known creator — not every run that looks odd", async () => {
    // Empty or failed runs are real and must stay visible; someone has to fix them.
    await payrollService.listRuns({ page: 1, limit: 20 } as any);
    const { params } = captured();
    expect(params.filter((p) => p === "test-auto-gen")).toHaveLength(1);
    expect(params).not.toContain("system");
  });
});
