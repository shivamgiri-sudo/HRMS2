/**
 * /api/employees?search=... (listEmployees) took 12-23 SECONDS per query in
 * production, measured live against the 57,517-row inactive employee
 * population. It's the shared search endpoint behind 18+ pages (Exit
 * Management, Loan Management, NOC, Offer Letter Generation, Reactivation,
 * ...) — Exit Management's "searching and searching" report is what surfaced
 * it, but every consumer was affected.
 *
 * Root cause was a 7-column leading-wildcard `LIKE '%term%'` OR-chain — not
 * servable by any B-tree index. The first fix attempt (porting /hr-hub's
 * pattern: FULLTEXT MATCH OR'd with a LIKE fallback) did NOT actually solve
 * it: measured live, MySQL will not index-merge a FULLTEXT match with a
 * B-tree-indexable OR condition in the same predicate — it kept picking a
 * full `employee_code` index scan filtering every row, same cost class as
 * before. MATCH() run ALONE (no OR) reliably used the FULLTEXT index and
 * ran in double digits of milliseconds.
 *
 * So the fix keeps the FULLTEXT path and the short-term prefix path fully
 * separate — never OR'd with each other or with a leading-wildcard LIKE.
 * These tests assert the query SHAPE stays that way; they cannot assert
 * live timing (no DB in this test), so they're a regression guard against
 * silently reintroducing the OR that made this slow in the first place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import { employeeService } from "../employee.service.js";

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

function lastEmployeeSelectCall(): { sql: string; params: unknown[] } {
  const call = execute.mock.calls.find(([s]) => /FROM employees e/i.test(String(s)));
  expect(call, "no employee SELECT was issued").toBeDefined();
  return { sql: String(call![0]), params: call![1] as unknown[] };
}

describe("employee search — no leading-wildcard LIKE OR'd with MATCH", () => {
  it("term >= 3 chars: uses MATCH() alone, no OR with any LIKE", async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, search: "Naresh", includeAnalytics: false } as never);
    const { sql, params } = lastEmployeeSelectCall();
    expect(sql).toMatch(/MATCH\(e\.full_name, e\.employee_code, e\.official_email\) AGAINST/i);
    // The specific regression this guards: a LIKE clause OR'd onto the same
    // predicate as MATCH() is what defeated the FULLTEXT index in production.
    expect(sql).not.toMatch(/AGAINST[^)]*\)\s*OR\b/i);
    expect(params).toContain("Naresh*");
  });

  it("term >= 3 chars: does not bind a leading-wildcard '%term%' anywhere", async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, search: "Naresh", includeAnalytics: false } as never);
    const { params } = lastEmployeeSelectCall();
    expect(params.some((p) => typeof p === "string" && p.startsWith("%"))).toBe(false);
  });

  it("term < 3 chars: uses prefix-only LIKE ('term%'), not leading-wildcard", async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, search: "Na", includeAnalytics: false } as never);
    const { sql, params } = lastEmployeeSelectCall();
    expect(sql).toMatch(/e\.first_name LIKE \?/);
    expect(sql).toMatch(/e\.last_name LIKE \?/);
    expect(sql).not.toMatch(/MATCH\(/i);
    for (const p of params) {
      if (typeof p === "string") expect(p.startsWith("%")).toBe(false);
    }
    expect(params).toContain("Na%");
  });

  it('"MAS..." code search: employee_code prefix only, no MATCH, no wildcard-leading LIKE', async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, search: "MAS197", includeAnalytics: false } as never);
    const { sql, params } = lastEmployeeSelectCall();
    expect(sql).toMatch(/e\.employee_code LIKE \?/);
    expect(sql).not.toMatch(/MATCH\(/i);
    expect(params).toContain("MAS197%");
  });

  it("personal email substring search was intentionally dropped (was part of the unindexable OR-chain)", async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, search: "someone@example.com", includeAnalytics: false } as never);
    const { sql } = lastEmployeeSelectCall();
    expect(sql).not.toMatch(/e\.email LIKE/);
  });
});
