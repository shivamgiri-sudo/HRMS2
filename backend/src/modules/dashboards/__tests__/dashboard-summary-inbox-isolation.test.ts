/**
 * The shared dashboard summary must survive an inbox aggregation failure.
 *
 * CEO UAT 31-Jul-2026 (/ceo/dashboard, Critical): every KPI tile rendered an
 * em-dash — Active Headcount, Onboarding Pending, Payroll Readiness, Attendance
 * rate, Resignation Risk — and four panels read "unavailable".
 *
 * getUnifiedInboxSummary is awaited in /:dashboardCode/summary BEFORE
 * executeDashboardMetrics. It was unguarded, so a single failure in the inbox
 * union 500'd the entire response and blanked metrics that had nothing to do
 * with the inbox.
 *
 * The fix must satisfy two rules at once, which is why it is worth pinning:
 *   1. an inbox failure must not blank the metrics (this UAT finding), and
 *   2. it must not be papered over with zeros either — see
 *      dashboard-error-semantics.test.ts, which forbids
 *      "pending_count: 0, overdue_count: 0" in this file. An inbox that is
 *      *unknown* must not render as an inbox that is *empty*.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(
  resolve(process.cwd(), "src/modules/dashboards/dashboard.routes.ts"),
  "utf8",
);
const contract = readFileSync(
  resolve(process.cwd(), "src/shared/dashboardMetricContract.ts"),
  "utf8",
);

/** Body of the shared summary handler only. */
const summaryHandler = (() => {
  const start = routes.indexOf('router.get("/:dashboardCode/summary"');
  expect(start, "shared summary route not found").toBeGreaterThan(-1);
  const next = routes.indexOf("router.get(", start + 1);
  return routes.slice(start, next === -1 ? undefined : next);
})();

describe("dashboard summary — inbox failure isolation", () => {
  it("guards the inbox aggregation so it cannot fail the whole summary", () => {
    expect(summaryHandler).toContain("getUnifiedInboxSummary");
    expect(
      summaryHandler,
      "getUnifiedInboxSummary is awaited before the metrics are computed; " +
        "without a try/catch one inbox failure blanks every metric tile"
    ).toMatch(/try\s*\{[\s\S]*getUnifiedInboxSummary[\s\S]*\}\s*catch/);
  });

  it("still computes and returns the metrics on that path", () => {
    // The whole point: metrics are independent of the inbox and must survive.
    // executeDashboardMetrics is now called inside a getOrSet() passed to
    // Promise.all alongside the guarded inbox promise, rather than directly
    // awaited after it — both still run, and neither can take the other down.
    // Match the call site, not the bare identifier — the identifier also appears
    // in the explanatory comment above the try/catch.
    const callIdx = summaryHandler.search(/executeDashboardMetrics\(/);
    expect(callIdx, "shared summary no longer computes metrics").toBeGreaterThan(-1);
    const catchIdx = summaryHandler.search(/\}\s*catch/);
    expect(
      callIdx,
      "executeDashboardMetrics must be defined after the guarded inbox call, not inside its try"
    ).toBeGreaterThan(catchIdx);
  });

  it("omits workItems on failure rather than fabricating an empty inbox", () => {
    // Complements dashboard-error-semantics.test.ts: that test forbids the
    // zeroed literal, this one requires the honest alternative be present.
    expect(summaryHandler).not.toContain("pending_count: 0, overdue_count: 0");
    expect(summaryHandler).toMatch(/workItems:\s*undefined/);
  });

  it("reports the degraded state instead of leaving it indistinguishable from empty", () => {
    expect(summaryHandler).toMatch(/workItemsStatus:\s*"unavailable"/);
    expect(summaryHandler).toContain("workItemsStatus,");
    // The field has to survive parsing — zod strips unknown keys by default, so
    // an unschema'd marker would be silently dropped before it reached the client.
    expect(
      contract,
      "workItemsStatus must be declared on dashboardSummarySchema or zod will strip it"
    ).toMatch(/workItemsStatus:\s*z\.enum\(\["ok",\s*"unavailable"\]\)/);
  });

  it("keeps workItems optional in the contract so omission is valid", () => {
    const workItemsBlock = contract.slice(
      contract.indexOf("workItems: z.object("),
      contract.indexOf("workItemsStatus:"),
    );
    expect(workItemsBlock).toMatch(/\}\)\.optional\(\)/);
  });
});
