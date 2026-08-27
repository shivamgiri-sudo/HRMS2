import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * getWorkforceDashboard builds a branch/process scope and applied it to only some of its
 * queries. The attendance status breakdown was one of the ones it skipped, so on the same
 * tile row a NOIDA branch head read:
 *
 *   Total Employees 441   (branch-scoped)
 *   Rostered Today  724   (whole company)
 *   Attendance      78%   (whole company)
 *   Present today   457   (whole company)
 *
 * — 457 people present out of a total of 441. Verified against production on 2026-08-26:
 * NOIDA held 214 present + 70 half_day + 23 absent + 1 missing_punch = 308 records, while
 * the company held 457 + 214 + 51 + 2 = 724, which is exactly what "Rostered Today" showed.
 *
 * expected_to_work, attendance_pct and shrinkage_pct are all derived from those rows, so
 * one missing predicate moved four visible figures onto the wrong population.
 *
 * These are source-shape assertions in the same style as
 * workforce-dashboard-shrinkage-scope.test.ts: the queries are private to a function that
 * fans out 25 statements, and the property worth pinning is "this statement carries the
 * scope", which is checkable without standing up the whole fan-out.
 */
describe("getWorkforceDashboard scopes its non-employee queries", () => {
  const source = readFileSync(resolve(__dirname, "../management.service.ts"), "utf-8");

  /** The body of getWorkforceDashboard, so assertions cannot pass on some other method. */
  const dashboard = (() => {
    const start = source.indexOf("async getWorkforceDashboard(");
    expect(start, "getWorkforceDashboard not found").toBeGreaterThan(-1);
    const next = source.indexOf("\n  async ", start + 10);
    return source.slice(start, next === -1 ? source.length : next);
  })();

  function statementContaining(marker: string): string {
    const at = dashboard.indexOf(marker);
    expect(at, `query containing ${marker} not found`).toBeGreaterThan(-1);
    const open = dashboard.lastIndexOf("`", at);
    const close = dashboard.indexOf("`", at);
    return dashboard.slice(open, close + 1);
  }

  it("scopes the attendance status breakdown that drives attendance_pct and shrinkage_pct", () => {
    const sql = statementContaining("attendance_status AS status");
    expect(sql, "must reach employees to filter on branch/process").toMatch(
      /JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*adr\.employee_id/,
    );
    expect(sql, "must apply the caller's scope").toContain("${empScopeJoinWhere}");
  });

  it("scopes the team roster instead of listing the whole company alphabetically", () => {
    const sql = statementContaining("as today_status");
    expect(sql).toContain("${empScopeJoinWhere}");
  });

  it("anchors the roster's today_status to the same day as every other attendance figure", () => {
    const sql = statementContaining("as today_status");
    // Reading CURDATE() here reported 'missing_punch' for people whose day simply had not
    // been processed yet, beside tiles anchored to the last complete day.
    expect(sql).toContain("LATEST_COMPLETE_ATTENDANCE_DATE_SQL");
    expect(sql).not.toMatch(/adr\.record_date\s*=\s*CURDATE\(\)/);
  });

  it("scopes the 90-day leave summary", () => {
    const sql = statementContaining("INTERVAL 90 DAY");
    expect(sql).toMatch(/JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*lr\.employee_id/);
    expect(sql).toContain("${empScopeJoinWhere}");
  });

  it("scopes the submitted expense-claim queue", () => {
    const sql = statementContaining("expense_type = 'employee_claim'");
    expect(sql).toMatch(/JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*ec\.employee_id/);
    expect(sql).toContain("${empScopeJoinWhere}");
  });

  it("scopes overdue work items on work_item's own branch/process columns", () => {
    // work_item has no employee_id — it carries branch_id/process_id directly, so it is
    // scoped on itself rather than through a join that would not compile.
    const sql = statementContaining("as overdue");
    expect(sql).toContain("${workItemScopeWhere}");
    expect(sql).not.toMatch(/JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*wi\.employee_id/);
  });

  it("does not claim zero projects at risk when nothing computes that figure", () => {
    // A literal 0 renders as "no projects at risk", which this dashboard has never had a
    // source for. null renders as "—".
    expect(dashboard).toMatch(/projects_at_risk:\s*null/);
    expect(dashboard).not.toMatch(/projects_at_risk:\s*0\s*,/);
  });
});
