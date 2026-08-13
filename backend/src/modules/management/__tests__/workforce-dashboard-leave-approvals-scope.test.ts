import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * getWorkforceDashboard's pending_leave_approvals figure used to be an unscoped
 * `SELECT COUNT(*) FROM leave_request WHERE LOWER(status) = 'pending'` — no employee
 * join, no active_status filter, no branch/process scope, despite the function
 * accepting branchId/processId. dashboard-metric.service.ts's getLeaveApprovalMetrics
 * (the metric the Manager/HR dashboard's own Leave Approval panel reads) does apply
 * all three. Both are reachable in one super_admin session via the tab bar on
 * /dashboard, and live-verified to disagree (26 vs 11 on 2026-08-13).
 *
 * A static source check rather than a mocked functional test, matching this
 * repo's existing convention for pinning "don't reintroduce this exact query shape"
 * facts (see dashboard-error-semantics.test.ts, attendance-canon.contract.test.ts).
 */
describe("getWorkforceDashboard pending_leave_approvals stays scoped", () => {
  const source = readFileSync(
    resolve(__dirname, "../management.service.ts"),
    "utf-8",
  );

  function extractLeaveApprovalsQuery(): string {
    const start = source.indexOf("pending_leave_approvals");
    expect(start, "pending_leave_approvals query not found in management.service.ts").toBeGreaterThan(-1);
    // The subquery is short; a generous window is enough to capture its own FROM/WHERE
    // without pulling in the unrelated performance_alert subquery that follows it.
    return source.slice(Math.max(0, start - 260), start + 40);
  }

  it("joins to employees and requires active_status = 1", () => {
    const query = extractLeaveApprovalsQuery();
    expect(query).toMatch(/JOIN employees e ON e\.id = lr\.employee_id/);
    expect(query).toMatch(/e\.active_status\s*=\s*1/);
  });

  it("applies the function's own branch/process scope fragment", () => {
    const query = extractLeaveApprovalsQuery();
    expect(query).toContain("${empScopeJoinWhere}");
  });

  it("passes scopeParams to the query so the scope fragment's placeholders are bound", () => {
    // The query call site: db.execute(<sql containing pending_leave_approvals>, scopeParams)
    const callStart = source.lastIndexOf("db.execute", source.indexOf("pending_leave_approvals"));
    const callSlice = source.slice(callStart, source.indexOf("critical_performance_alerts") + 400);
    expect(callSlice).toMatch(/scopeParams,?\s*\),/);
  });
});
