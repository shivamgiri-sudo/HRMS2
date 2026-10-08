import { beforeEach, describe, expect, it, vi } from "vitest";

/** Exit analytics (HR dashboard) is restricted to the caller's scope; org-wide callers pass 1=1. */
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute: query } }));
const { getExitAnalyticsSummary } = await import("../exit-analytics.service.js");

beforeEach(() => { query.mockReset(); query.mockResolvedValue([[{ count: 0, avg_days: 0 }], []]); });

describe("getExitAnalyticsSummary scope", () => {
  it("adds the scope predicate and params to every aggregate", async () => {
    await getExitAnalyticsSummary({ sql: "er.employee_id IN (SELECT se.id FROM employees se WHERE se.branch_id = ?)", params: ["branch-a"] });
    expect(query).toHaveBeenCalledTimes(8);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(/AND \(er\.employee_id IN \(SELECT se\.id/);
      expect(params).toContain("branch-a");
    }
  });
  it("default / org-wide scope is 1=1 (unrestricted)", async () => {
    await getExitAnalyticsSummary();
    for (const [sql] of query.mock.calls) expect(sql).toMatch(/AND \(1=1\)/);
  });
});
